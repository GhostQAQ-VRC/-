'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { IMAGE_EXTENSIONS, SKIP_DIRECTORIES } = require('./constants.cjs');
const { quickContentHash } = require('./quick-hash.cjs');
const { readPhotoMetadata } = require('./metadata.cjs');
const { previewFileName, readImageDimensions } = require('./preview.cjs');
const repository = require('./repository.cjs');

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Walk the library recursively. Cache and system folders are skipped. */
async function walkImages(root, options = {}) {
  const files = [];
  const pathKey = (value) =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const skipAbsolute = new Set(
    (options.skipDirs || [])
      .map((relative) => repository.resolveInside(root, relative))
      .filter(Boolean)
      .map(pathKey),
  );

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue;
        if (skipAbsolute.has(pathKey(absolute))) continue;
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(absolute);
      }
    }
  }

  await walk(root);
  return files;
}

function buildWorldSeeds(seeds) {
  const worlds = new Map();
  for (const seed of seeds) {
    if (!seed.worldId) continue;
    const key = seed.worldId.toLowerCase();
    const previous = worlds.get(key);
    worlds.set(key, {
      id: previous ? previous.id : seed.worldId,
      name: (previous && previous.name) || seed.worldName || undefined,
      instanceId: seed.worldInstanceId || (previous && previous.instanceId) || undefined,
    });
  }
  return Array.from(worlds.values());
}

/**
 * Index a library folder. Uses a per-file cache keyed by size + mtime so a
 * rescan of an unchanged 10k photo library is mostly directory I/O.
 */
async function scanLibrary(options) {
  const { root, onProgress, shouldCancel, previewQueue } = options;
  if (!root) {
    return {
      ok: false,
      complete: false,
      seeds: [],
      worlds: [],
      stats: { scanned: 0, total: 0, withWorldId: 0, withDate: 0, previewsQueued: 0 },
      error: '尚未选择存储库。',
    };
  }

  const wrapper = options.wrapper || (await repository.readLibrary(root));
  const previewOptions = repository.previewOptionsFor(wrapper);
  const maxEdge = options.maxEdge || previewOptions.previewMaxEdge;
  const quality = options.quality || previewOptions.previewQuality;
  const thumbnailDir = repository.thumbnailDirRelative(wrapper);

  const cache = await repository.readScanCache(root);
  const ignoredHashes = new Set(
    (await repository.getIgnoredHashes(root)).map((hash) => hash.toLowerCase()),
  );
  const previewsDir = options.previewDir || repository.previewDir(root, wrapper);
  // The thumbnail cache may be a visible folder at the library root. It must
  // never be treated as user photos.
  const files = await walkImages(root, { skipDirs: [thumbnailDir] });
  const present = new Set(files.map((file) => repository.toPosix(path.relative(root, file))));

  const nextCache = { version: 1, files: { ...(cache.files || {}) } };
  const seeds = [];
  const seenHashes = new Set();
  let processed = 0;
  let withWorldId = 0;
  let withDate = 0;
  let canceled = false;
  let cursor = 0;
  const concurrency = Math.min(4, Math.max(1, files.length));

  const report = (message) => {
    if (typeof onProgress !== 'function') return;
    onProgress({
      phase: 'index',
      current: processed,
      total: files.length,
      message,
    });
  };

  async function worker() {
    while (true) {
      if (shouldCancel && shouldCancel()) {
        canceled = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;

      const absolute = files[index];
      const relative = repository.toPosix(path.relative(root, absolute));

      try {
        const stat = await fs.stat(absolute);
        const cached = nextCache.files[relative];
        let entry;

        if (
          cached &&
          cached.hash &&
          cached.size === stat.size &&
          Math.floor(cached.mtimeMs) === Math.floor(stat.mtimeMs) &&
          cached.capturedAt
        ) {
          entry = cached;
        } else {
          const hash = await quickContentHash(absolute, stat.size);
          const metadata = await readPhotoMetadata(absolute, {
            fileName: path.basename(absolute),
            mtimeMs: stat.mtimeMs,
          });
          const dimensions = await readImageDimensions(absolute);
          entry = {
            hash,
            capturedAt: metadata.capturedAt,
            metaSource: metadata.metaSource,
            dateSource: metadata.dateSource,
            worldId: metadata.worldId,
            worldName: metadata.worldName,
            worldInstanceId: metadata.worldInstanceId,
            alt: metadata.alt,
            width: dimensions.width,
            height: dimensions.height,
            diagnostics: metadata.diagnostics,
          };
        }

        nextCache.files[relative] = {
          ...entry,
          rel: relative,
          size: stat.size,
          mtimeMs: Math.floor(stat.mtimeMs),
        };

        processed += 1;

        if (ignoredHashes.has(String(entry.hash).toLowerCase())) {
          report(relative);
          continue;
        }

        if (seenHashes.has(entry.hash)) {
          report(relative);
          continue;
        }
        seenHashes.add(entry.hash);

        const previewName = previewFileName(entry.hash, { maxEdge, quality });
        const hasPreview = await pathExists(path.join(previewsDir, previewName));

        seeds.push({
          id: `photo_${entry.hash}`,
          contentHash: entry.hash,
          libraryPath: relative,
          previewPath: hasPreview ? previewName : undefined,
          fileBytes: stat.size,
          width: entry.width,
          height: entry.height,
          capturedAt: entry.capturedAt,
          metaSource: entry.metaSource,
          alt: entry.alt,
          worldId: entry.worldId,
          worldName: entry.worldName,
          worldInstanceId: entry.worldInstanceId,
        });

        if (entry.worldId) withWorldId += 1;
        if (entry.dateSource && entry.dateSource !== 'mtime') withDate += 1;

        if (!hasPreview && previewQueue) {
          previewQueue.enqueue({ absPath: absolute, hash: entry.hash });
        }

        report(relative);
      } catch {
        // A single unreadable file must not abort the whole scan.
        processed += 1;
        report(relative);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Drop cache entries for files that are no longer present.
  for (const relative of Object.keys(nextCache.files)) {
    if (!present.has(relative)) delete nextCache.files[relative];
  }

  const complete = !canceled && processed >= files.length;
  await repository.writeScanCache(root, nextCache);

  if (complete) {
    await repository.updateLibraryConfig(root, { lastScanAt: new Date().toISOString() });
  }

  // Seed the queue for cached entries that never got a preview yet.
  if (previewQueue) {
    for (const seed of seeds) {
      if (!seed.previewPath) {
        previewQueue.enqueue({
          absPath: path.join(root, seed.libraryPath),
          hash: seed.contentHash,
        });
      }
    }
  }

  return {
    ok: true,
    complete,
    seeds,
    worlds: buildWorldSeeds(seeds),
    stats: {
      scanned: seeds.length,
      total: files.length,
      withWorldId,
      withDate,
      previewsQueued: previewQueue ? previewQueue.pending : 0,
    },
  };
}

module.exports = { scanLibrary, walkImages, buildWorldSeeds };
