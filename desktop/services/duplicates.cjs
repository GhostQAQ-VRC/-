'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = require('../library/repository.cjs');

const TRASH_ROOT = path.join('.hoshikuzu', 'trash');

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function fullFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function moveToTrash(root, source, trashRoot) {
  const relative = repository.toPosix(path.relative(root, source));
  const destination = path.join(trashRoot, relative);
  const relativeToTrash = path.relative(trashRoot, destination);
  if (!relativeToTrash || relativeToTrash.startsWith('..') || path.isAbsolute(relativeToTrash)) {
    throw new Error('回收站路径不合法。');
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  let target = destination;
  for (let index = 1; index < 1000; index += 1) {
    const exists = await fsp.access(target).then(() => true, () => false);
    if (!exists) break;
    const parsed = path.parse(destination);
    target = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
  }
  try {
    await fsp.rename(source, target);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      await fsp.copyFile(source, target);
      await fsp.rm(source, { force: true });
    } else {
      throw error;
    }
  }
  return target;
}

/**
 * Find byte-identical originals and move unwanted copies into the library's
 * local trash folder. The quick scan hash only samples head/tail, so duplicate
 * detection deliberately recomputes a full SHA-256 before grouping.
 */
class DuplicateService {
  constructor(options = {}) {
    this.getRoot = options.getRoot;
    this.onProgress = options.onProgress || (() => {});
    this.scanning = false;
    this.canceled = false;
  }

  cancel() {
    this.canceled = true;
    return { ok: true };
  }

  async scan() {
    if (this.scanning) return { ok: false, error: '重复扫描正在进行中。' };
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) return { ok: false, error: '存储库不可用。', groups: [], scanned: 0 };
    const wrapper = await repository.readLibrary(root);
    if (!wrapper) return { ok: false, error: '存储库元数据缺失。', groups: [], scanned: 0 };

    const photos = (wrapper.album.photos || []).filter(
      (photo) =>
        photo &&
        !photo.missing &&
        typeof photo.libraryPath === 'string' &&
        photo.libraryPath,
    );
    this.scanning = true;
    this.canceled = false;
    const byHash = new Map();
    let scanned = 0;
    let skipped = 0;
    let lastReport = 0;

    try {
      for (let index = 0; index < photos.length; index += 1) {
        if (this.canceled) break;
        const photo = photos[index];
        const absolute = await repository.resolveRealInside(root, photo.libraryPath);
        if (!absolute) {
          skipped += 1;
          continue;
        }
        let stat;
        try {
          stat = await fsp.stat(absolute);
        } catch {
          skipped += 1;
          continue;
        }
        if (!stat.isFile() || stat.size <= 0) {
          skipped += 1;
          continue;
        }
        let hash;
        try {
          hash = await fullFileHash(absolute);
        } catch {
          skipped += 1;
          continue;
        }
        scanned += 1;
        const relativePath = repository.toPosix(photo.libraryPath);
        const list = byHash.get(hash) || [];
        // Two album records can point at the same file; show it once so the
        // UI never offers to "remove the duplicate" of a path it must keep.
        if (list.some((entry) => entry.libraryPath === relativePath)) {
          skipped += 1;
          continue;
        }
        list.push({
          id: photo.id,
          libraryPath: relativePath,
          fileName: path.basename(photo.libraryPath),
          size: stat.size,
          capturedAt: photo.capturedAt || '',
          note: photo.note || '',
          previewPath: photo.previewPath || '',
          managedCopy: photo.managedCopy === true,
        });
        byHash.set(hash, list);
        const now = Date.now();
        if (now - lastReport > 180 || index === photos.length - 1) {
          lastReport = now;
          this.onProgress({
            done: index + 1,
            total: photos.length,
            scanned,
            skipped,
            file: photo.libraryPath,
          });
        }
      }
    } finally {
      this.scanning = false;
    }

    const groups = [];
    for (const [hash, entries] of byHash) {
      if (entries.length < 2) continue;
      const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
      const largest = entries.reduce(
        (max, entry) => (entry.size > max.size ? entry : max),
        entries[0],
      );
      groups.push({
        hash,
        entries,
        totalBytes,
        reclaimableBytes: Math.max(0, totalBytes - largest.size),
        suggestedKeepId: largest.id,
      });
    }
    groups.sort((a, b) => b.reclaimableBytes - a.reclaimableBytes);
    return {
      ok: true,
      canceled: this.canceled,
      groups,
      scanned,
      skipped,
      totalBytes: groups.reduce((sum, group) => sum + group.totalBytes, 0),
      reclaimableBytes: groups.reduce((sum, group) => sum + group.reclaimableBytes, 0),
    };
  }

  async trash(items) {
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) return { ok: false, error: '存储库不可用。', trashed: [], errors: [] };
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return { ok: false, error: '没有选择要移除的重复照片。', trashed: [], errors: [] };
    }
    const trashRoot = path.join(root, TRASH_ROOT, nowStamp());
    const trashed = [];
    const errors = [];
    const removing = new Set(list.map((item) => item.id));
    const wrapper = await repository.readLibrary(root);
    const remainingRefs = new Map();
    for (const photo of (wrapper && wrapper.album && wrapper.album.photos) || []) {
      if (!photo || removing.has(photo.id) || typeof photo.libraryPath !== 'string') continue;
      const relative = repository.toPosix(photo.libraryPath);
      remainingRefs.set(relative, (remainingRefs.get(relative) || 0) + 1);
    }
    const seenPaths = new Set();
    for (const item of list) {
      try {
        const relative = repository.toPosix(item.libraryPath);
        if (seenPaths.has(relative)) continue;
        seenPaths.add(relative);
        if ((remainingRefs.get(relative) || 0) > 0) {
          throw new Error('该文件仍被其他相册记录引用，已跳过。');
        }
        const absolute = await repository.resolveRealInside(root, item.libraryPath);
        if (!absolute) throw new Error('文件路径不合法或已不在存储库内。');
        if (absolute.split(path.sep).includes('.hoshikuzu')) {
          throw new Error('不能移除缓存或回收站内的文件。');
        }
        const to = await moveToTrash(root, absolute, trashRoot);
        trashed.push({
          id: item.id,
          libraryPath: item.libraryPath,
          to: repository.toPosix(path.relative(root, to)),
        });
      } catch (error) {
        errors.push({
          id: item.id,
          error: error && error.message ? error.message : '移入回收站失败。',
        });
      }
    }
    return {
      ok: errors.length === 0 && trashed.length > 0,
      trashDir: repository.toPosix(path.relative(root, trashRoot)),
      trashed,
      errors,
    };
  }
}

module.exports = {
  DuplicateService,
  TRASH_ROOT,
  fullFileHash,
};
