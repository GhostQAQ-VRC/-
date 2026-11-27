'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const repository = require('../library/repository.cjs');
const { PREVIEW_FILE_PATTERN } = require('../library/constants.cjs');

const TRASH_DIR = path.join('.hoshikuzu', 'trash');

async function directorySize(directory) {
  let count = 0;
  let bytes = 0;
  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(absolute).catch(() => null);
        if (!stat) continue;
        count += 1;
        bytes += stat.size;
      }
    }
  }
  await walk(directory);
  return { count, bytes };
}

/**
 * Read-only library diagnostics plus two safe cleanup actions (orphan
 * previews, trash). It never deletes originals; missing files are only
 * reported so the curator can remove the album records explicitly.
 */
class HealthService {
  constructor(options = {}) {
    this.getRoot = options.getRoot;
  }

  async scan() {
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) {
      return { ok: false, error: '存储库不可用。', counts: {}, issues: [] };
    }
    const wrapper = await repository.readLibrary(root);
    if (!wrapper) {
      return {
        ok: false,
        error: '存储库元数据缺失或损坏。',
        counts: {},
        issues: [],
      };
    }
    const photos = Array.isArray(wrapper.album.photos) ? wrapper.album.photos : [];
    const previewDir = repository.previewDir(root, wrapper);

    let previewFiles = [];
    try {
      previewFiles = await fsp.readdir(previewDir);
    } catch {
      // No preview folder yet.
    }
    const referencedPreviews = new Set(
      photos
        .map((photo) => (photo && typeof photo.previewPath === 'string'
          ? path.basename(photo.previewPath)
          : ''))
        .filter(Boolean),
    );
    const orphanPreviews = [];
    let orphanBytes = 0;
    let previewBytes = 0;
    for (const name of previewFiles) {
      if (!PREVIEW_FILE_PATTERN.test(name)) continue;
      const stat = await fsp.stat(path.join(previewDir, name)).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      previewBytes += stat.size;
      if (!referencedPreviews.has(name)) {
        orphanPreviews.push(name);
        orphanBytes += stat.size;
      }
    }

    const missingIds = [];
    let missingCount = 0;
    const pathCounts = new Map();
    const hashCounts = new Map();
    for (const photo of photos) {
      if (!photo) continue;
      if (typeof photo.libraryPath === 'string' && photo.libraryPath) {
        const relative = repository.toPosix(photo.libraryPath);
        pathCounts.set(relative, (pathCounts.get(relative) || 0) + 1);
        const absolute = photo.missing
          ? null
          : await repository.resolveRealInside(root, relative);
        if (!absolute) {
          missingCount += 1;
          missingIds.push(photo.id);
        }
      }
      if (typeof photo.contentHash === 'string' && photo.contentHash) {
        hashCounts.set(
          photo.contentHash.toLowerCase(),
          (hashCounts.get(photo.contentHash.toLowerCase()) || 0) + 1,
        );
      }
    }
    const duplicatePaths = [...pathCounts.entries()].filter(([, count]) => count > 1);
    const duplicateHashes = [...hashCounts.values()].filter((count) => count > 1).length;

    const trash = await directorySize(path.join(root, TRASH_DIR));

    const issues = [];
    if (missingCount > 0) {
      issues.push({
        id: 'missing',
        severity: 'warning',
        title: '文件缺失',
        detail: '相册记录指向的原图不在存储库中，可从相册移除这些记录。',
        count: missingCount,
        bytes: 0,
      });
    }
    if (orphanPreviews.length > 0) {
      issues.push({
        id: 'orphan-previews',
        severity: 'info',
        title: '未引用的缩略图',
        detail: '照片已从相册移除，但缩略图缓存还在，可以安全清理。',
        count: orphanPreviews.length,
        bytes: orphanBytes,
      });
    }
    if (duplicatePaths.length > 0) {
      issues.push({
        id: 'duplicate-paths',
        severity: 'info',
        title: '重复的相册路径',
        detail: '同一文件被多条相册记录引用；删除其中一条前请确认保留关系。',
        count: duplicatePaths.length,
        bytes: 0,
      });
    }
    if (duplicateHashes > 0) {
      issues.push({
        id: 'duplicate-hashes',
        severity: 'info',
        title: '可能重复的照片',
        detail: '内容哈希相同；使用「重复照片」按完整文件 SHA-256 精确分组。',
        count: duplicateHashes,
        bytes: 0,
      });
    }
    if (trash.count > 0) {
      issues.push({
        id: 'trash',
        severity: 'info',
        title: '回收站占用',
        detail: '重复照片处理时移入的副本，确认不再需要后可清空。',
        count: trash.count,
        bytes: trash.bytes,
      });
    }
    if (issues.length === 0) {
      issues.push({
        id: 'clean',
        severity: 'ok',
        title: '存储库状态良好',
        detail: '没有发现缺失文件、孤儿缩略图或回收站占用。',
        count: 0,
        bytes: 0,
      });
    }

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      counts: {
        photos: photos.length,
        previews: previewFiles.filter((name) => PREVIEW_FILE_PATTERN.test(name)).length,
        previewBytes,
        missing: missingCount,
        orphanPreviews: orphanPreviews.length,
        duplicatePaths: duplicatePaths.length,
        duplicateHashes,
        trashCount: trash.count,
        trashBytes: trash.bytes,
      },
      missingIds,
      issues,
    };
  }

  async cleanOrphanPreviews() {
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) return { ok: false, error: '存储库不可用。', removed: 0, bytes: 0 };
    const wrapper = await repository.readLibrary(root);
    if (!wrapper) return { ok: false, error: '存储库元数据缺失。', removed: 0, bytes: 0 };
    const previewDir = repository.previewDir(root, wrapper);
    const referenced = new Set(
      (wrapper.album.photos || [])
        .map((photo) => (photo && typeof photo.previewPath === 'string'
          ? path.basename(photo.previewPath)
          : ''))
        .filter(Boolean),
    );
    let names = [];
    try {
      names = await fsp.readdir(previewDir);
    } catch {
      return { ok: true, removed: 0, bytes: 0 };
    }
    let removed = 0;
    let bytes = 0;
    for (const name of names) {
      if (!PREVIEW_FILE_PATTERN.test(name) || referenced.has(name)) continue;
      const absolute = path.join(previewDir, name);
      const stat = await fsp.stat(absolute).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      try {
        await fsp.rm(absolute, { force: true });
        removed += 1;
        bytes += stat.size;
      } catch {
        // Skip files locked by another process.
      }
    }
    return { ok: true, removed, bytes };
  }

  async emptyTrash() {
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) return { ok: false, error: '存储库不可用。', removed: 0, bytes: 0 };
    const trash = path.join(root, TRASH_DIR);
    const before = await directorySize(trash);
    if (before.count === 0) return { ok: true, removed: 0, bytes: 0 };
    try {
      await fsp.rm(trash, { recursive: true, force: true });
    } catch (error) {
      return {
        ok: false,
        error: error.message || '清空回收站失败。',
        removed: 0,
        bytes: 0,
      };
    }
    return { ok: true, removed: before.count, bytes: before.bytes };
  }
}

module.exports = { HealthService, TRASH_DIR };
