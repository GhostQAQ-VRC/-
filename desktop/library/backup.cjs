'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { CACHE_DIR, BACKUP_DIR, INDEX_FILE, LIBRARY_FILE } = require('./constants.cjs');
const repository = require('./repository.cjs');

async function exportMetadata(root, targetPath) {
  const wrapper = await repository.readLibrary(root);
  if (!wrapper) throw new Error('存储库不可用，无法导出元数据。');
  await fsp.writeFile(targetPath, JSON.stringify(wrapper, null, 2), 'utf8');
  return { ok: true, path: targetPath };
}

async function estimateFullBackupBytes(root) {
  let total = 0;
  const wrapper = await repository.readLibrary(root);
  const cache = await repository.readScanCache(root);
  for (const entry of Object.values(cache.files || {})) {
    total += Number(entry.size) || 0;
  }
  try {
    const dir = repository.previewDir(root, wrapper);
    const files = await fsp.readdir(dir);
    for (const file of files) {
      const stat = await fsp.stat(path.join(dir, file)).catch(() => null);
      if (stat) total += stat.size;
    }
  } catch {
    // No previews yet.
  }
  try {
    const playerAvatars = path.join(root, CACHE_DIR, 'players', 'avatars');
    const files = await fsp.readdir(playerAvatars);
    for (const file of files) {
      const stat = await fsp.stat(path.join(playerAvatars, file)).catch(() => null);
      if (stat) total += stat.size;
    }
  } catch {
    // No player avatars yet.
  }
  return total;
}

/**
 * Zip the whole library (originals + previews + metadata). Streaming, so it
 * works for libraries far larger than memory.
 */
async function exportFull(root, targetPath, options = {}) {
  const wrapper = await repository.readLibrary(root);
  if (!wrapper) throw new Error('存储库不可用，无法导出完整备份。');

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const output = fs.createWriteStream(targetPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  const finished = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
  });

  let entries = 0;
  archive.on('entry', () => {
    entries += 1;
    if (typeof options.onProgress === 'function' && entries % 50 === 0) {
      options.onProgress({ entries });
    }
  });

  archive.pipe(output);
  archive.glob(['**/*', '**/.*'], {
    cwd: root,
    dot: true,
    ignore: [`${CACHE_DIR}/${BACKUP_DIR}/**`, `${CACHE_DIR}/${INDEX_FILE}`],
  });
  await archive.finalize();
  await finished;
  return { ok: true, path: targetPath, entries };
}

function validateEntryName(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error('压缩包包含不安全的路径，已取消导入。');
  }
  return normalized;
}

/** Stream a previously exported full backup into a target folder. */
async function importZip(zipPath, targetRoot) {
  await fsp.mkdir(targetRoot, { recursive: true });
  const directory = await unzipper.Open.file(zipPath);
  const entries = directory.files;

  // Validate every path before writing a single byte (zip-slip guard).
  for (const entry of entries) validateEntryName(entry.path);

  for (const entry of entries) {
    const name = validateEntryName(entry.path);
    const destination = path.join(targetRoot, name);
    const relative = path.relative(targetRoot, destination);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('压缩包包含不安全的路径，已取消导入。');
    }
    if (entry.type === 'Directory') {
      await fsp.mkdir(destination, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(destination));
  }

  const wrapper = await repository.readLibrary(targetRoot);
  if (!wrapper) {
    throw new Error(`压缩包中没有找到 ${LIBRARY_FILE}。`);
  }
  return { ok: true, root: targetRoot, wrapper };
}

module.exports = {
  estimateFullBackupBytes,
  exportFull,
  exportMetadata,
  importZip,
};
