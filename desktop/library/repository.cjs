'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const {
  LIBRARY_FILE,
  LIBRARY_FORMAT,
  LIBRARY_VERSION,
  CACHE_DIR,
  BACKUP_DIR,
  INDEX_FILE,
  DEFAULT_THUMBNAIL_DIR,
  LEGACY_PREVIEW_DIR,
  DEFAULT_THUMBNAIL_PRESET_ID,
  DEFAULT_IMAGE_LOADING_MODE,
  IMAGE_LOADING_MODES,
  DEFAULT_PREVIEW_MAX_EDGE,
  DEFAULT_PREVIEW_QUALITY,
  resolveThumbnailPreset,
} = require('./constants.cjs');

function nowIso() {
  return new Date().toISOString();
}

function libraryFilePath(root) {
  return path.join(root, LIBRARY_FILE);
}

function cacheDir(root) {
  return path.join(root, CACHE_DIR);
}

/**
 * A thumbnail folder name is a single path segment directly inside the library
 * root. Reject separators and Windows-reserved characters so it can never
 * escape, become a drive path, or collide with a file.
 */
function sanitizeThumbnailDir(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 60) return null;
  if (trimmed === '.' || trimmed === '..') return null;
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(trimmed)) return null;
  if (/[.\s]$/.test(trimmed)) return null;
  if (/^[A-Za-z]:/.test(trimmed)) return null;
  return trimmed;
}

function thumbnailDirRelative(wrapperOrLibrary) {
  const library =
    wrapperOrLibrary && wrapperOrLibrary.library ? wrapperOrLibrary.library : wrapperOrLibrary;
  const configured = library && sanitizeThumbnailDir(library.thumbnailDir);
  return configured || LEGACY_PREVIEW_DIR;
}

/**
 * Display previews live in the configured thumbnail folder. Legacy libraries
 * (created before the second onboarding step) keep their hidden cache folder.
 */
function previewDir(root, wrapperOrLibrary) {
  return path.join(root, thumbnailDirRelative(wrapperOrLibrary));
}

function previewOptionsFor(wrapperOrLibrary) {
  const library =
    wrapperOrLibrary && wrapperOrLibrary.library ? wrapperOrLibrary.library : wrapperOrLibrary;
  const preset = resolveThumbnailPreset(
    library && library.previewPreset,
    library && library.previewMaxEdge,
  );
  return {
    preset,
    previewMaxEdge: preset.maxEdge,
    previewQuality:
      library && Number.isFinite(Number(library.previewQuality))
        ? Math.min(100, Math.max(1, Math.round(Number(library.previewQuality))))
        : preset.quality || DEFAULT_PREVIEW_QUALITY,
  };
}

function backupsDir(root) {
  return path.join(cacheDir(root), BACKUP_DIR);
}

function indexFilePath(root) {
  return path.join(cacheDir(root), INDEX_FILE);
}

function emptyAlbum() {
  return {
    version: 2,
    photos: [],
    worlds: [],
    settings: {},
    activity: [],
    updatedAt: nowIso(),
  };
}

function createLibraryWrapper(root, name) {
  const stamp = nowIso();
  const preset = resolveThumbnailPreset(DEFAULT_THUMBNAIL_PRESET_ID);
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    library: {
      id: crypto.randomUUID(),
      name: (name || path.basename(root) || '时间轴存储库').slice(0, 60),
      createdAt: stamp,
      previewPreset: preset.id,
      previewMaxEdge: preset.maxEdge,
      previewQuality: preset.quality,
      thumbnailDir: DEFAULT_THUMBNAIL_DIR,
      // The second onboarding step creates the cache folder and sets this.
      thumbnailsConfigured: false,
      imageLoadingMode: DEFAULT_IMAGE_LOADING_MODE,
      autoScan: true,
      watch: false,
      ignoredHashes: [],
      lastScanAt: null,
      lastSavedAt: null,
    },
    album: emptyAlbum(),
    sync: {
      enabled: false,
      provider: 'none',
      endpoint: '',
      lastSyncAt: null,
    },
  };
}

function normalizeWrapper(raw, root) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.format && raw.format !== LIBRARY_FORMAT) return null;
  const base = createLibraryWrapper(root, raw.library && raw.library.name);
  const library = raw.library && typeof raw.library === 'object' ? raw.library : {};
  const preset = resolveThumbnailPreset(library.previewPreset, library.previewMaxEdge);
  // Libraries created before thumbnails became a setup step already have a
  // usable preview cache in the legacy hidden folder.
  const isEstablishedLibrary = Boolean(library.id || library.createdAt);
  const thumbnailsConfigured =
    typeof library.thumbnailsConfigured === 'boolean'
      ? library.thumbnailsConfigured
      : isEstablishedLibrary;
  const thumbnailDir =
    sanitizeThumbnailDir(library.thumbnailDir) ||
    (isEstablishedLibrary ? LEGACY_PREVIEW_DIR : DEFAULT_THUMBNAIL_DIR);
  const ignoredHashes = Array.isArray(library.ignoredHashes)
    ? library.ignoredHashes.filter((hash) => typeof hash === 'string').slice(-50000)
    : [];
  return {
    ...base,
    ...raw,
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    library: {
      ...base.library,
      ...library,
      id: typeof library.id === 'string' && library.id ? library.id : base.library.id,
      name:
        typeof library.name === 'string' && library.name.trim()
          ? library.name.trim().slice(0, 60)
          : base.library.name,
      createdAt: library.createdAt || base.library.createdAt,
      previewPreset: preset.id,
      previewMaxEdge: preset.maxEdge,
      previewQuality:
        Number.isFinite(Number(library.previewQuality)) && library.previewQuality !== undefined
          ? Math.min(100, Math.max(1, Math.round(Number(library.previewQuality))))
          : preset.quality,
      thumbnailDir,
      thumbnailsConfigured,
      imageLoadingMode: IMAGE_LOADING_MODES.includes(library.imageLoadingMode)
        ? library.imageLoadingMode
        : DEFAULT_IMAGE_LOADING_MODE,
      autoScan: library.autoScan !== false,
      watch: library.watch === true,
      ignoredHashes,
    },
    album:
      raw.album && typeof raw.album === 'object' && Array.isArray(raw.album.photos)
        ? raw.album
        : emptyAlbum(),
    sync: {
      ...base.sync,
      ...(raw.sync && typeof raw.sync === 'object' ? raw.sync : {}),
      enabled: false,
    },
  };
}

async function readLibrary(root) {
  if (!root) return null;
  try {
    const raw = await fs.readFile(libraryFilePath(root), 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeWrapper(parsed, root);
  } catch {
    return null;
  }
}

/** Used by the renderer's synchronous album bootstrap IPC. */
function readLibrarySync(root) {
  if (!root) return null;
  try {
    const raw = fsSync.readFileSync(libraryFilePath(root), 'utf8');
    return normalizeWrapper(JSON.parse(raw), root);
  } catch {
    return null;
  }
}

async function pruneBackups(dir, keep = 10) {
  try {
    const entries = await fs.readdir(dir);
    const backups = entries
      .filter((name) => /^metadata-.*\.json$/i.test(name))
      .sort()
      .reverse();
    await Promise.all(
      backups.slice(keep).map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  } catch {
    // A missing backup folder is fine.
  }
}

async function backupExisting(root) {
  try {
    const source = libraryFilePath(root);
    const stat = await fs.stat(source);
    if (!stat.size) return;

    const dir = backupsDir(root);
    await fs.mkdir(dir, { recursive: true });

    // Avoid churning backups every 300ms during typing: one per 10 minutes.
    const existing = await fs.readdir(dir).catch(() => []);
    const backups = existing
      .filter((name) => /^metadata-.*\.json$/i.test(name))
      .sort()
      .reverse();
    if (backups.length > 0) {
      const latest = await fs.stat(path.join(dir, backups[0])).catch(() => null);
      if (latest && Date.now() - latest.mtimeMs < 10 * 60 * 1000) return;
    }

    const stamp = nowIso().replace(/[:.]/g, '-').slice(0, 19);
    const target = path.join(dir, `metadata-${stamp}.json`);
    await fs.copyFile(source, target);
    await pruneBackups(dir, 10);
  } catch {
    // Backups are best-effort; the atomic write below still protects the file.
  }
}

async function writeLibrary(root, wrapper, options = {}) {
  await fs.mkdir(root, { recursive: true });
  if (options.backup !== false) await backupExisting(root);

  const payload = {
    ...wrapper,
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
  };
  const target = libraryFilePath(root);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  try {
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(target, { force: true });
    await fs.rename(tmp, target);
  }
  return payload;
}

async function ensureLibrary(root, options = {}) {
  let wrapper = await readLibrary(root);
  if (wrapper) return wrapper;
  wrapper = createLibraryWrapper(root, options.name);
  await fs.mkdir(cacheDir(root), { recursive: true });
  if (wrapper.library.thumbnailsConfigured) {
    await fs.mkdir(previewDir(root, wrapper), { recursive: true });
  }
  await fs.mkdir(backupsDir(root), { recursive: true });
  await writeLibrary(root, wrapper, { backup: false });
  return wrapper;
}

async function updateAlbum(root, album) {
  const wrapper = (await readLibrary(root)) || createLibraryWrapper(root, path.basename(root));
  wrapper.album = album;
  wrapper.library.lastSavedAt = nowIso();
  return writeLibrary(root, wrapper);
}

async function updateLibraryConfig(root, patch) {
  const wrapper = await readLibrary(root);
  if (!wrapper) return null;
  const next = { ...wrapper.library };
  if (patch.name !== undefined && typeof patch.name === 'string' && patch.name.trim()) {
    next.name = patch.name.trim().slice(0, 60);
  }
  if (patch.previewPreset !== undefined || patch.previewMaxEdge !== undefined) {
    const preset = resolveThumbnailPreset(patch.previewPreset, patch.previewMaxEdge);
    next.previewPreset = preset.id;
    next.previewMaxEdge = preset.maxEdge;
    next.previewQuality = preset.quality;
  }
  if (patch.previewQuality !== undefined) {
    const quality = Number(patch.previewQuality);
    if (Number.isFinite(quality)) {
      next.previewQuality = Math.min(100, Math.max(1, Math.round(quality)));
    }
  }
  if (patch.thumbnailDir !== undefined) {
    const dir = sanitizeThumbnailDir(patch.thumbnailDir);
    if (dir) next.thumbnailDir = dir;
  }
  if (patch.thumbnailsConfigured !== undefined) {
    next.thumbnailsConfigured = patch.thumbnailsConfigured === true;
  }
  if (patch.imageLoadingMode !== undefined && IMAGE_LOADING_MODES.includes(patch.imageLoadingMode)) {
    next.imageLoadingMode = patch.imageLoadingMode;
  }
  if (patch.autoScan !== undefined) next.autoScan = patch.autoScan === true;
  if (patch.watch !== undefined) next.watch = patch.watch === true;
  if (patch.lastScanAt !== undefined) next.lastScanAt = patch.lastScanAt;
  wrapper.library = next;
  await writeLibrary(root, wrapper, { backup: false });
  return wrapper;
}

async function addIgnoredHashes(root, hashes) {
  const wrapper = await readLibrary(root);
  if (!wrapper) return 0;
  const set = new Set(wrapper.library.ignoredHashes || []);
  for (const hash of hashes || []) {
    if (typeof hash === 'string' && /^[0-9a-f]{40}$/i.test(hash)) set.add(hash.toLowerCase());
  }
  wrapper.library.ignoredHashes = Array.from(set).slice(-50000);
  await writeLibrary(root, wrapper, { backup: false });
  return wrapper.library.ignoredHashes.length;
}

async function resetIgnoredHashes(root) {
  const wrapper = await readLibrary(root);
  if (!wrapper) return 0;
  wrapper.library.ignoredHashes = [];
  await writeLibrary(root, wrapper, { backup: false });
  return 0;
}

async function removeIgnoredHashes(root, hashes) {
  const wrapper = await readLibrary(root);
  if (!wrapper) return 0;
  const remove = new Set(
    (hashes || [])
      .filter((hash) => typeof hash === 'string')
      .map((hash) => hash.toLowerCase()),
  );
  wrapper.library.ignoredHashes = (wrapper.library.ignoredHashes || []).filter(
    (hash) => !remove.has(String(hash).toLowerCase()),
  );
  await writeLibrary(root, wrapper, { backup: false });
  return wrapper.library.ignoredHashes.length;
}

async function getIgnoredHashes(root) {
  const wrapper = await readLibrary(root);
  return wrapper ? wrapper.library.ignoredHashes || [] : [];
}

async function readScanCache(root) {
  try {
    const raw = await fs.readFile(indexFilePath(root), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && parsed.files && typeof parsed.files === 'object') {
      return parsed;
    }
  } catch {
    // Missing/corrupt cache is fine: the next scan rebuilds it.
  }
  return { version: 1, files: {}, updatedAt: null };
}

async function writeScanCache(root, cache) {
  const dir = cacheDir(root);
  await fs.mkdir(dir, { recursive: true });
  const target = indexFilePath(root);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(
    tmp,
    JSON.stringify({ ...cache, version: 1, updatedAt: nowIso() }),
    'utf8',
  );
  try {
    await fs.rename(tmp, target);
  } catch {
    await fs.rm(target, { force: true });
    await fs.rename(tmp, target);
  }
}

function getLibraryConfig(root, wrapper, extra = {}) {
  const options = previewOptionsFor(wrapper);
  const thumbnailDir = wrapper ? thumbnailDirRelative(wrapper) : LEGACY_PREVIEW_DIR;
  return {
    configured: Boolean(root && wrapper),
    libraryPath: root || null,
    libraryName: wrapper ? wrapper.library.name : null,
    libraryId: wrapper ? wrapper.library.id : null,
    previewPreset: wrapper ? options.preset.id : DEFAULT_THUMBNAIL_PRESET_ID,
    previewMaxEdge: wrapper ? options.previewMaxEdge : DEFAULT_PREVIEW_MAX_EDGE,
    previewQuality: wrapper ? options.previewQuality : DEFAULT_PREVIEW_QUALITY,
    thumbnailDir,
    thumbnailDirPath: root ? path.join(root, thumbnailDir) : null,
    thumbnailsConfigured: wrapper ? wrapper.library.thumbnailsConfigured !== false : false,
    imageLoadingMode: wrapper
      ? wrapper.library.imageLoadingMode || DEFAULT_IMAGE_LOADING_MODE
      : DEFAULT_IMAGE_LOADING_MODE,
    autoScan: wrapper ? wrapper.library.autoScan !== false : true,
    watch: wrapper ? wrapper.library.watch === true : false,
    onboardingDismissed: extra.onboardingDismissed === true,
    unavailable: extra.unavailable === true,
  };
}

async function computeLibraryStats(root) {
  const wrapper = await readLibrary(root);
  const cache = await readScanCache(root);
  const entries = Object.values(cache.files || {});
  let libraryBytes = 0;
  for (const entry of entries) libraryBytes += Number(entry.size) || 0;

  let previewBytes = 0;
  let previewCount = 0;
  try {
    const dir = previewDir(root, wrapper);
    const files = await fs.readdir(dir);
    for (const file of files) {
      const stat = await fs.stat(path.join(dir, file)).catch(() => null);
      if (stat && stat.isFile()) {
        previewBytes += stat.size;
        previewCount += 1;
      }
    }
  } catch {
    // Empty cache folder.
  }

  return {
    imageCount: entries.length,
    libraryBytes,
    previewBytes,
    previewCount,
    lastScanAt: wrapper ? wrapper.library.lastScanAt || null : null,
  };
}

async function clearPreviewCache(root) {
  const wrapper = await readLibrary(root);
  const dir = previewDir(root, wrapper);
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files.map((file) => fs.rm(path.join(dir, file), { force: true, recursive: false })),
    );
    return { ok: true, dir };
  } catch (error) {
    return { ok: false, error: String(error && error.message) };
  }
}

/** Resolve a library-relative path and reject anything that escapes the root. */
function resolveInside(root, relativePath) {
  if (!root) return null;
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalized) return null;
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return absolute;
}

/** Network-facing variant: resolve symlinks before checking the prefix. */
async function resolveRealInside(root, relativePath) {
  const absolute = resolveInside(root, relativePath);
  if (!absolute) return null;
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(absolute);
    const relative = path.relative(realRoot, real);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return real;
  } catch {
    return null;
  }
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

module.exports = {
  addIgnoredHashes,
  backupsDir,
  cacheDir,
  clearPreviewCache,
  computeLibraryStats,
  createLibraryWrapper,
  emptyAlbum,
  ensureLibrary,
  getIgnoredHashes,
  getLibraryConfig,
  indexFilePath,
  libraryFilePath,
  nowIso,
  previewDir,
  previewOptionsFor,
  readLibrary,
  readLibrarySync,
  readScanCache,
  removeIgnoredHashes,
  resetIgnoredHashes,
  resolveInside,
  resolveRealInside,
  sanitizeThumbnailDir,
  thumbnailDirRelative,
  toPosix,
  updateAlbum,
  updateLibraryConfig,
  writeLibrary,
  writeScanCache,
};
