'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const backupLib = require('../library/backup.cjs');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const FIRST_CHECK_DELAY_MS = 10 * 1000;
const MAX_FILES_PER_PRUNE = 500;
const PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;
const AUTO_PREFIX = 'hoshikuzu-auto-';
const AUTO_FILE_PATTERN = /^hoshikuzu-auto-(metadata|full)-\d{4}-\d{2}-\d{2}T[\d-]+Z\.(json|zip)$/;
const PARTIAL_FILE_PATTERN = /^hoshikuzu-auto-.+\.partial$/;

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled === true,
    folder: typeof source.folder === 'string' ? source.folder.trim() : '',
    intervalDays: clampInt(source.intervalDays, 1, 90, 7),
    kind: source.kind === 'full' ? 'full' : 'metadata',
    retention: clampInt(source.retention, 1, 30, 5),
    lastRunAt: isIsoDate(source.lastRunAt) ? source.lastRunAt : null,
    lastAttemptAt: isIsoDate(source.lastAttemptAt) ? source.lastAttemptAt : null,
    lastPath: typeof source.lastPath === 'string' ? source.lastPath : '',
    lastError: typeof source.lastError === 'string' && source.lastError ? source.lastError : null,
  };
}

/** True when candidate is parent itself or lives below parent. */
function containsPath(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Real path of a target whose leaf may not exist yet (resolves the nearest ancestor). */
async function projectedRealPath(target) {
  let probe = path.resolve(target);
  const suffix = [];
  for (;;) {
    const stat = await fsp.stat(probe).catch(() => null);
    if (stat) {
      const real = await fsp.realpath(probe).catch(() => probe);
      return path.join(real, ...suffix.reverse());
    }
    const parent = path.dirname(probe);
    if (parent === probe) return path.resolve(target);
    suffix.push(path.basename(probe));
    probe = parent;
  }
}

/**
 * Periodic desktop backup. Writes into a dedicated folder the user chooses
 * (default: Documents/Hoshikuzu Backups), prunes only files it created, and
 * refuses to write inside the live library so a backup can never archive
 * previous backups or be discovered as library content.
 */
class AutoBackupService {
  constructor(options = {}) {
    this.getRoot = options.getRoot || (() => null);
    this.getSettings = options.getSettings || (() => ({}));
    this.updateSettings = options.updateSettings || (async () => {});
    this.defaultFolder = options.defaultFolder || (() => '');
    this.onStatus = options.onStatus || (() => {});
    this.now = options.now || (() => new Date());
    this.timer = null;
    this.soonTimer = null;
    this.runningPromise = null;
  }

  settings() {
    return normalize(this.getSettings());
  }

  effectiveFolder(settings = this.settings()) {
    return settings.folder || this.defaultFolder();
  }

  nextRunAt(settings = this.settings()) {
    if (!settings.enabled) return null;
    if (!settings.lastAttemptAt) return null;
    const next = Date.parse(settings.lastAttemptAt) + settings.intervalDays * 86_400_000;
    return new Date(next).toISOString();
  }

  isDue(settings = this.settings()) {
    if (!settings.enabled || !this.effectiveFolder(settings)) return false;
    if (!settings.lastAttemptAt) return true;
    return this.now().getTime() >= Date.parse(settings.lastAttemptAt) + settings.intervalDays * 86_400_000;
  }

  status() {
    const settings = this.settings();
    return {
      ...settings,
      effectiveFolder: this.effectiveFolder(settings),
      usingDefaultFolder: !settings.folder,
      running: Boolean(this.runningPromise),
      due: this.isDue(settings),
      nextRunAt: this.nextRunAt(settings),
    };
  }

  pushStatus() {
    const status = this.status();
    this.onStatus(status);
    return status;
  }

  async persist(patch) {
    const merged = normalize({ ...this.settings(), ...patch });
    await this.updateSettings(merged);
    return merged;
  }

  async validateFolder(folder, root) {
    if (!folder) return '请选择自动备份文件夹。';
    if (!path.isAbsolute(folder)) return '自动备份文件夹必须是绝对路径。';
    if (root) {
      // Check before creating anything, including through a symlinked parent
      // whose child folder does not exist yet.
      const [realRoot, projected] = await Promise.all([
        fsp.realpath(root).catch(() => null),
        projectedRealPath(folder),
      ]);
      if (!realRoot) return '无法验证自动备份文件夹。';
      if (containsPath(realRoot, projected)) {
        return '自动备份文件夹不能位于存储库内部，否则备份会包含自身。';
      }
    }
    let stat = await fsp.stat(folder).catch(() => null);
    if (!stat) {
      try {
        await fsp.mkdir(folder, { recursive: true });
      } catch {
        return '无法创建自动备份文件夹。';
      }
      stat = await fsp.stat(folder).catch(() => null);
    }
    if (!stat || !stat.isDirectory()) return '自动备份位置不是文件夹。';
    if (!root) return null;
    try {
      const [realRoot, realFolder] = await Promise.all([fsp.realpath(root), fsp.realpath(folder)]);
      if (containsPath(realRoot, realFolder)) {
        return '自动备份文件夹不能位于存储库内部，否则备份会包含自身。';
      }
    } catch {
      return '无法验证自动备份文件夹。';
    }
    return null;
  }

  async update(patch = {}) {
    const current = this.settings();
    const merged = normalize({ ...current, ...(patch || {}) });
    const root = this.getRoot();
    const folder = this.effectiveFolder(merged);
    if (merged.enabled || merged.folder) {
      const error = await this.validateFolder(folder, root);
      if (error) return { ok: false, error, status: this.status() };
    }
    await this.updateSettings(merged);
    this.scheduleSoon(merged.enabled ? 700 : null);
    return { ok: true, status: this.pushStatus() };
  }

  async createBackup(settings, root) {
    const folder = this.effectiveFolder(settings);
    await fsp.mkdir(folder, { recursive: true });
    const stamp = timestampForFile(this.now());
    const extension = settings.kind === 'full' ? 'zip' : 'json';
    const target = path.join(folder, `${AUTO_PREFIX}${settings.kind}-${stamp}.${extension}`);
    const temporary = `${target}.partial`;
    const attemptAt = this.now().toISOString();

    try {
      if (settings.kind === 'full') {
        await backupLib.exportFull(root, temporary);
      } else {
        await backupLib.exportMetadata(root, temporary);
      }
      await fsp.rename(temporary, target);
      const stat = await fsp.stat(target).catch(() => null);
      await this.prune(folder, settings.retention).catch(() => {});
      const lastRunAt = this.now().toISOString();
      await this.persist({
        lastRunAt,
        lastAttemptAt: attemptAt,
        lastPath: target,
        lastError: null,
      });
      return {
        ok: true,
        path: target,
        kind: settings.kind,
        bytes: stat ? stat.size : 0,
      };
    } catch (error) {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      const message = (error && error.message) || '自动备份失败。';
      await this.persist({ lastAttemptAt: attemptAt, lastError: message });
      return { ok: false, error: message };
    }
  }

  async prune(folder, retention) {
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    const candidates = [];
    const stalePartials = [];
    const now = this.now().getTime();
    let inspected = 0;
    for (const entry of entries) {
      if (inspected >= MAX_FILES_PER_PRUNE) break;
      if (!entry.isFile()) continue;
      const isAutoFile = AUTO_FILE_PATTERN.test(entry.name);
      const isPartial = PARTIAL_FILE_PATTERN.test(entry.name);
      if (!isAutoFile && !isPartial) continue;
      inspected += 1;
      const absolute = path.join(folder, entry.name);
      const stat = await fsp.stat(absolute).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (isAutoFile) {
        candidates.push({ path: absolute, mtimeMs: stat.mtimeMs });
      } else if (now - stat.mtimeMs > PARTIAL_MAX_AGE_MS) {
        stalePartials.push(absolute);
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const stale = candidates.slice(retention);
    for (const file of [...stale.map((item) => item.path), ...stalePartials]) {
      await fsp.rm(file, { force: true }).catch(() => {});
    }
    return {
      removed: stale.length + stalePartials.length,
      kept: Math.min(candidates.length, retention),
    };
  }

  async runNow(reason = 'manual') {
    if (this.runningPromise) return { ok: false, error: '自动备份正在进行中。' };
    const settings = this.settings();
    if (reason !== 'manual' && !settings.enabled) {
      return { ok: false, error: '自动备份未启用。' };
    }
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const folder = this.effectiveFolder(settings);
    const folderError = await this.validateFolder(folder, root);
    if (folderError) {
      await this.persist({ lastAttemptAt: this.now().toISOString(), lastError: folderError });
      return { ok: false, error: folderError };
    }

    this.runningPromise = this.createBackup(settings, root).finally(() => {
      this.runningPromise = null;
      this.pushStatus();
    });
    this.pushStatus();
    return this.runningPromise;
  }

  async checkDue() {
    if (this.runningPromise) return null;
    if (!this.isDue()) return null;
    return this.runNow('schedule');
  }

  scheduleSoon(delay) {
    if (this.soonTimer) {
      clearTimeout(this.soonTimer);
      this.soonTimer = null;
    }
    if (delay === null || delay === undefined) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      void this.checkDue();
    }, delay);
    if (typeof this.soonTimer.unref === 'function') this.soonTimer.unref();
  }

  start() {
    this.stop();
    this.timer = setInterval(() => void this.checkDue(), CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.scheduleSoon(FIRST_CHECK_DELAY_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.soonTimer) {
      clearTimeout(this.soonTimer);
      this.soonTimer = null;
    }
  }
}

module.exports = {
  AUTO_FILE_PATTERN,
  AUTO_PREFIX,
  AutoBackupService,
  CHECK_INTERVAL_MS,
  containsPath,
  normalize,
  projectedRealPath,
};
