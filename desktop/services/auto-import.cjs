'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const repository = require('../library/repository.cjs');
const scanLib = require('../library/scan.cjs');
const ingest = require('../library/ingest.cjs');
const { quickContentHash } = require('../library/quick-hash.cjs');

const DEFAULT_PREVIEW_EDGE = 1600;
const WATCH_DEBOUNCE_MS = 1500;
const SAFETY_POLL_MS = 30_000;
const MAX_FILES_PER_SCAN = 80;
const MAX_SEEN_ENTRIES = 20_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileKey(absolute, stat) {
  return `${absolute.toLowerCase()}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
}

/**
 * Watch an external screenshots folder and copy new images into the library's
 * managed inbox. Uses fs.watch for immediacy plus a slow safety poll, so a
 * dropped watcher (network drive, sleep/resume) still catches up. Source files
 * are read-only inputs and are never deleted.
 */
class AutoImportService {
  constructor(options = {}) {
    this.getRoot = options.getRoot;
    this.getSettings = options.getSettings || (() => ({}));
    this.updateSettings = options.updateSettings || (async () => {});
    this.getPreviewMaxEdge = options.getPreviewMaxEdge;
    this.onImported = options.onImported || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.watcher = null;
    this.interval = null;
    this.debounce = null;
    this.currentScan = null;
    this.scanning = false;
    this.stopped = false;
    this.startedAt = null;
    this.importedCount = 0;
    this.lastScanAt = null;
    this.lastImportedAt = null;
    this.lastError = null;
    this.seen = new Map();
  }

  settings() {
    const raw = this.getSettings() || {};
    return {
      enabled: raw.enabled === true,
      folder: typeof raw.folder === 'string' ? raw.folder.trim() : '',
      lastScanAt: typeof raw.lastScanAt === 'string' ? raw.lastScanAt : null,
    };
  }

  status() {
    const settings = this.settings();
    return {
      enabled: settings.enabled,
      folder: settings.folder,
      running: Boolean(this.watcher || this.interval),
      scanning: this.scanning,
      watched: Boolean(this.watcher),
      startedAt: this.startedAt,
      lastScanAt: this.lastScanAt || settings.lastScanAt,
      lastImportedAt: this.lastImportedAt,
      importedCount: this.importedCount,
      lastError: this.lastError,
    };
  }

  pushStatus() {
    const status = this.status();
    this.onStatus(status);
    return status;
  }

  async validateFolder(folder) {
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) return '存储库不可用，请先选择存储库。';
    if (!folder) return '请选择要监视的文件夹。';
    const stat = await fsp.stat(folder).catch(() => null);
    if (!stat || !stat.isDirectory()) return '监视文件夹不存在或不可访问。';
    const relative = path.relative(root, folder);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return '监视文件夹不能在存储库内部，否则会把照片重复导入 _inbox。';
    }
    const rootInsideFolder = path.relative(folder, root);
    if (
      !rootInsideFolder ||
      (!rootInsideFolder.startsWith('..') && !path.isAbsolute(rootInsideFolder))
    ) {
      return '监视文件夹不能包含存储库，请选择单独的截图目录。';
    }
    return '';
  }

  async update(patch = {}) {
    const current = this.settings();
    const next = {
      enabled: patch.enabled === undefined ? current.enabled : patch.enabled === true,
      folder:
        typeof patch.folder === 'string' ? patch.folder.trim() : current.folder,
      lastScanAt: current.lastScanAt,
    };
    if (next.enabled) {
      const error = await this.validateFolder(next.folder);
      if (error) {
        this.lastError = error;
        return { ok: false, error, status: this.pushStatus() };
      }
    }
    await this.updateSettings({ autoImport: next });
    if (next.enabled) {
      await this.start();
    } else {
      this.stop();
    }
    return { ok: true, status: this.pushStatus() };
  }

  async start() {
    const settings = this.settings();
    this.stop();
    this.stopped = false;
    this.lastError = null;
    if (!settings.enabled || !settings.folder) {
      this.pushStatus();
      return { ok: true, status: this.status() };
    }
    const error = await this.validateFolder(settings.folder);
    if (error) {
      this.lastError = error;
      this.pushStatus();
      return { ok: false, error, status: this.status() };
    }
    this.startedAt = new Date().toISOString();
    try {
      this.watcher = fs.watch(settings.folder, { recursive: true }, () => this.schedule());
      this.watcher.on('error', (watchError) => {
        this.lastError = watchError && watchError.message
          ? watchError.message
          : '文件夹监视失败，将使用定时扫描。';
        this.closeWatcher();
        this.pushStatus();
      });
    } catch (watchError) {
      // Linux/network shares may not support recursive watch; the poll below
      // still works.
      this.lastError = watchError && watchError.message
        ? watchError.message
        : '文件夹监视不可用，将使用定时扫描。';
      this.watcher = null;
    }
    this.interval = setInterval(() => this.schedule(), SAFETY_POLL_MS);
    if (this.interval.unref) this.interval.unref();
    const status = this.pushStatus();
    await this.scanNow();
    return { ok: true, status };
  }

  stop() {
    this.stopped = true;
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.closeWatcher();
    this.pushStatus();
    return { ok: true, status: this.status() };
  }

  closeWatcher() {
    if (!this.watcher) return;
    try {
      this.watcher.close();
    } catch {
      // Already closed.
    }
    this.watcher = null;
  }

  schedule() {
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.scanNow();
    }, WATCH_DEBOUNCE_MS);
  }

  scanNow() {
    if (this.scanning) return this.currentScan;
    this.scanning = true;
    this.currentScan = this.runScan()
      .catch((error) => {
        this.lastError = error && error.message ? error.message : String(error);
        return { ok: false, error: this.lastError, imported: 0 };
      })
      .finally(() => {
        this.scanning = false;
        this.currentScan = null;
        this.pushStatus();
      });
    return this.currentScan;
  }

  async runScan() {
    const settings = this.settings();
    const root = this.getRoot ? this.getRoot() : null;
    this.lastScanAt = new Date().toISOString();
    if (!settings.enabled || !settings.folder || !root) {
      return { ok: true, imported: 0 };
    }
    const folderError = await this.validateFolder(settings.folder);
    if (folderError) {
      this.lastError = folderError;
      return { ok: false, error: folderError, imported: 0 };
    }

    const files = await scanLib.walkImages(settings.folder);
    const wrapper = await repository.readLibrary(root);
    const cache = await repository.readScanCache(root);
    const ignored = new Set(
      (await repository.getIgnoredHashes(root)).map((hash) => hash.toLowerCase()),
    );
    const known = new Set();
    for (const photo of (wrapper && wrapper.album && wrapper.album.photos) || []) {
      if (photo && photo.contentHash) known.add(String(photo.contentHash).toLowerCase());
    }
    for (const entry of Object.values(cache.files || {})) {
      if (entry && entry.hash) known.add(String(entry.hash).toLowerCase());
    }

    const previewEdge = this.getPreviewMaxEdge
      ? await this.getPreviewMaxEdge(root)
      : DEFAULT_PREVIEW_EDGE;

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let remaining = 0;
    let processed = 0;

    for (const absolute of files) {
      if (this.stopped) break;
      if (processed >= MAX_FILES_PER_SCAN) {
        remaining += 1;
        continue;
      }
      processed += 1;
      try {
        const stat = await fsp.stat(absolute);
        if (!stat.isFile() || stat.size <= 0) continue;
        const key = fileKey(absolute, stat);
        if (this.seen.has(key)) {
          skipped += 1;
          continue;
        }
        const hash = await quickContentHash(absolute, stat.size);
        const hashKey = hash.toLowerCase();
        if (known.has(hashKey) || ignored.has(hashKey)) {
          this.remember(key);
          skipped += 1;
          continue;
        }
        const result = await ingest.importPaths(root, [absolute], {
          previewMaxEdge: previewEdge,
        });
        this.remember(key);
        if (result.drafts && result.drafts.length > 0) {
          imported += 1;
          known.add(hashKey);
          this.importedCount += 1;
          this.lastImportedAt = new Date().toISOString();
          this.lastError = null;
          for (const draft of result.drafts) this.onImported(draft);
        } else {
          failed += 1;
          this.lastError =
            (result.errors && result.errors[0] && result.errors[0].message) ||
            result.error ||
            '自动导入失败。';
        }
      } catch (error) {
        failed += 1;
        this.lastError = error && error.message ? error.message : String(error);
      }
      // Let the scanner/preview queue breathe between imports.
      await delay(15);
    }

    await this.updateSettings({
      autoImport: {
        enabled: settings.enabled,
        folder: settings.folder,
        lastScanAt: this.lastScanAt,
      },
    }).catch(() => {});

    if (remaining > 0 && !this.stopped) {
      // More files than one pass allows: schedule a follow-up without waiting
      // for the next safety poll.
      setTimeout(() => this.schedule(), 800);
    }
    return { ok: failed === 0, imported, skipped, failed, remaining };
  }

  remember(key) {
    this.seen.set(key, Date.now());
    if (this.seen.size <= MAX_SEEN_ENTRIES) return;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const [entry, at] of this.seen) {
      if (at < cutoff) this.seen.delete(entry);
    }
    while (this.seen.size > MAX_SEEN_ENTRIES) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }

  dispose() {
    this.stop();
  }
}

module.exports = {
  AutoImportService,
  MAX_FILES_PER_SCAN,
};
