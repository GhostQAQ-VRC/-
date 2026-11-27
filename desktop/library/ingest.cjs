'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const {
  DEFAULT_PREVIEW_MAX_EDGE,
  DEFAULT_PREVIEW_QUALITY,
  IMAGE_EXTENSIONS,
  INBOX_DIR,
} = require('./constants.cjs');
const repository = require('./repository.cjs');
const { quickContentHash } = require('./quick-hash.cjs');
const { readPhotoMetadata } = require('./metadata.cjs');
const { generatePreview, readImageDimensions } = require('./preview.cjs');

/**
 * Known-good magic bytes per accepted extension. Files whose content does not
 * match are rejected before entering the library, so a renamed executable or
 * polyglot payload never lands in the photo folder.
 */
const MAGIC_SIGNATURES = {
  '.jpg': [Buffer.from([0xff, 0xd8, 0xff])],
  '.jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  '.png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  '.webp': [Buffer.from('RIFF')],
  '.avif': [
    Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]),
  ],
  '.gif': [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
  '.bmp': [Buffer.from([0x42, 0x4d])],
  '.heic': [Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70])],
  '.heif': [Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70])],
  '.tif': [Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
  '.tiff': [Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
};

function looksLikeImage(absolutePath, extension) {
  const signatures = MAGIC_SIGNATURES[extension.toLowerCase()];
  if (!signatures) return true;
  const fd = require('node:fs').openSync(absolutePath, 'r');
  try {
    const longest = Math.max(...signatures.map((sig) => sig.length));
    const buffer = Buffer.alloc(longest);
    const read = require('node:fs').readSync(fd, buffer, 0, longest, 0);
    if (read <= 0) return false;
    const head = buffer.subarray(0, read);
    return signatures.some((signature) => head.subarray(0, signature.length).equals(signature));
  } finally {
    require('node:fs').closeSync(fd);
  }
}

function sanitizeFileName(value) {
  const base = path.basename(String(value || 'photo'));
  let safe = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!safe) safe = 'photo';
  const extension = path.extname(safe).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    safe = `${path.parse(safe).name || 'photo'}.jpg`;
  }
  return safe;
}

function uniqueDestination(directory, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(directory, fileName);
  let index = 1;
  while (require('node:fs').existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

/** Read dimensions/hash/metadata/preview for a file already inside the library. */
async function prepareDraft(root, absPath, previewMaxEdge, options = {}) {
  const stat = await fsp.stat(absPath);
  const fileName = options.fileName || path.basename(absPath);
  const hash = await quickContentHash(absPath, stat.size);
  const metadata = await readPhotoMetadata(absPath, {
    fileName,
    mtimeMs: stat.mtimeMs,
  });
  const dimensions = await readImageDimensions(absPath);
  const wrapper = options.wrapper || (await repository.readLibrary(root));
  const previewOptions = repository.previewOptionsFor(wrapper);
  const preview = await generatePreview({
    absPath,
    hash,
    previewDir: options.previewDir || repository.previewDir(root, wrapper),
    maxEdge: previewMaxEdge || previewOptions.previewMaxEdge || DEFAULT_PREVIEW_MAX_EDGE,
    quality:
      options.previewQuality ?? previewOptions.previewQuality ?? DEFAULT_PREVIEW_QUALITY,
  }).catch(() => null);

  return { hash, metadata, dimensions, preview, stat };
}

function draftFromPrepared(root, relativePath, prepared) {
  const { metadata, dimensions, preview, hash, stat } = prepared;
  const previewPath = preview ? preview.previewPath : undefined;
  return {
    // Never hand the original file to the grid. If preview generation failed,
    // the card shows its placeholder until the background queue retries.
    src: previewPath ? `hoshikuzu-media://preview/${previewPath}` : '',
    alt: metadata.alt,
    capturedAt: metadata.capturedAt,
    width: dimensions.width,
    height: dimensions.height,
    fileBytes: stat.size,
    contentHash: hash,
    libraryPath: relativePath,
    previewPath,
    metaSource: metadata.metaSource,
    worldId: metadata.worldId,
    worldName: metadata.worldName,
    worldInstanceId: metadata.worldInstanceId,
    players: Array.isArray(metadata.players) && metadata.players.length ? metadata.players : undefined,
    world: metadata.worldId
      ? {
          id: metadata.worldId,
          name: metadata.worldName || `待补充世界 · ${metadata.worldId.slice(0, 16)}`,
          source: 'local',
        }
      : null,
    managedCopy: true,
  };
}

function cacheEntryFromPrepared(relativePath, prepared) {
  const { metadata, dimensions, hash, stat } = prepared;
  return {
    hash,
    capturedAt: metadata.capturedAt,
    metaSource: metadata.metaSource,
    dateSource: metadata.dateSource,
    worldId: metadata.worldId,
    worldName: metadata.worldName,
    worldInstanceId: metadata.worldInstanceId,
    players: Array.isArray(metadata.players) ? metadata.players : [],
    alt: metadata.alt,
    width: dimensions.width,
    height: dimensions.height,
    rel: relativePath,
    size: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
  };
}

/**
 * Copy files into the library inbox, recognize metadata, generate previews and
 * return drafts for the renderer. Root is explicit so early boot and transfer
 * receivers never depend on a global currentLibraryRoot.
 */
async function importPaths(root, paths, options = {}) {
  const previewMaxEdge = options.previewMaxEdge || DEFAULT_PREVIEW_MAX_EDGE;
  const inboxRoot = options.inboxDir || INBOX_DIR;
  const wrapper = await repository.readLibrary(root);
  const previewOptions = repository.previewOptionsFor(wrapper);
  const previewDir = options.previewDir || repository.previewDir(root, wrapper);
  const cache = await repository.readScanCache(root);
  const drafts = [];
  const errors = [];
  const importedHashes = [];
  const day = new Date().toISOString().slice(0, 10);

  for (const source of paths || []) {
    try {
      const stat = await fsp.stat(source);
      if (!stat.isFile()) throw new Error('不是文件。');
      const originalName = sanitizeFileName(options.fileName || source);
      if (!IMAGE_EXTENSIONS.has(path.extname(originalName).toLowerCase())) {
        throw new Error('不支持的图片格式。');
      }
      if (!looksLikeImage(source, path.extname(originalName).toLowerCase())) {
        throw new Error('文件内容与图片格式不符，已拒绝导入（可能是伪装成图片的文件）。');
      }

      const inbox = path.join(root, inboxRoot, day);
      await fsp.mkdir(inbox, { recursive: true });
      const destination = uniqueDestination(inbox, originalName);
      await fsp.copyFile(source, destination);
      await fsp.utimes(destination, stat.atime, stat.mtime);

      const prepared = await prepareDraft(root, destination, previewMaxEdge, {
        fileName: originalName,
        wrapper,
        previewDir,
        previewQuality: previewOptions.previewQuality,
      });
      const relative = repository.toPosix(path.relative(root, destination));
      drafts.push(draftFromPrepared(root, relative, prepared));
      cache.files[relative] = cacheEntryFromPrepared(relative, prepared);
      importedHashes.push(prepared.hash);
    } catch (error) {
      errors.push({
        file: path.basename(source),
        message: error && error.message ? error.message : '导入失败。',
      });
    }
  }

  if (importedHashes.length) {
    await repository.removeIgnoredHashes(root, importedHashes).catch(() => {});
    await repository.writeScanCache(root, cache).catch(() => {});
  }

  return {
    ok: drafts.length > 0,
    drafts,
    errors,
    error: drafts.length ? undefined : errors[0]?.message || '没有可导入的图片。',
  };
}

/** Materialize data URLs from a web backup into the current library. */
async function importDataUrls(root, items, options = {}) {
  const stagingDir = path.join(os.tmpdir(), `vrchat-album-import-${process.pid}`);
  await fsp.mkdir(stagingDir, { recursive: true });
  const staged = [];
  const errors = [];

  for (const item of items || []) {
    try {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(String(item.dataUrl || ''));
      if (!match) throw new Error('不是有效的内嵌图片。');
      const mime = match[1].toLowerCase();
      const extension =
        mime === 'image/jpeg'
          ? '.jpg'
          : mime === 'image/png'
            ? '.png'
            : mime === 'image/webp'
              ? '.webp'
              : '.jpg';
      const buffer = Buffer.from(match[2], 'base64');
      const safeName = sanitizeFileName(item.name || 'backup-photo');
      const nameWithoutExtension = path.parse(safeName).name;
      const file = path.join(
        stagingDir,
        `${staged.length}-${nameWithoutExtension}${extension}`,
      );
      await fsp.writeFile(file, buffer);
      staged.push(file);
    } catch (error) {
      errors.push({ file: item.name || 'photo', message: error.message });
    }
  }

  const result = await importPaths(root, staged, options);
  await fsp.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  return {
    ...result,
    errors: [...errors, ...result.errors],
  };
}

/**
 * Accept a received upload: dedupe by album content hash, copy into
 * `_inbox/transfer/<date>/`, then reuse the normal import pipeline.
 */
async function importReceivedFile(root, tempPath, originalName, options = {}) {
  const stat = await fsp.stat(tempPath);
  const hash = await quickContentHash(tempPath, stat.size);
  const wrapper = await repository.readLibrary(root);
  const cache = await repository.readScanCache(root);
  const ignored = new Set(
    (await repository.getIgnoredHashes(root)).map((value) => value.toLowerCase()),
  );
  const inAlbum = (wrapper?.album?.photos || []).some((photo) => photo.contentHash === hash);
  const inCache = Object.values(cache.files || {}).some((entry) => entry.hash === hash);
  const ignoredHash = ignored.has(hash.toLowerCase());
  if (inAlbum || (inCache && !ignoredHash)) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    return { ok: true, duplicate: true, hash };
  }

  const name = sanitizeFileName(originalName || `received-${crypto.randomUUID()}.jpg`);
  if (!IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw new Error('不支持的图片格式。');
  }
  if (!looksLikeImage(tempPath, path.extname(name).toLowerCase())) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw new Error('文件内容与图片格式不符，已拒绝接收（可能是伪装成图片的文件）。');
  }

  const day = new Date().toISOString().slice(0, 10);
  const inbox = path.join(root, INBOX_DIR, 'transfer', day);
  await fsp.mkdir(inbox, { recursive: true });
  const destination = uniqueDestination(inbox, name);
  await fsp.copyFile(tempPath, destination);
  await fsp.rm(tempPath, { force: true }).catch(() => {});

  const previewMaxEdge = options.previewMaxEdge || DEFAULT_PREVIEW_MAX_EDGE;
  const prepared = await prepareDraft(root, destination, previewMaxEdge, { fileName: name });
  const relative = repository.toPosix(path.relative(root, destination));

  cache.files[relative] = cacheEntryFromPrepared(relative, prepared);
  await repository.writeScanCache(root, cache).catch(() => {});
  await repository.removeIgnoredHashes(root, [prepared.hash]).catch(() => {});

  return {
    ok: true,
    duplicate: false,
    hash: prepared.hash,
    draft: draftFromPrepared(root, relative, prepared),
  };
}

module.exports = {
  draftFromPrepared,
  importDataUrls,
  importPaths,
  importReceivedFile,
  prepareDraft,
  sanitizeFileName,
  uniqueDestination,
};
