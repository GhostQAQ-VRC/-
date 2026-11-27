'use strict';

const LIBRARY_FILE = 'hoshikuzu-library.json';
const LIBRARY_FORMAT = 'hoshikuzu-library';
const LIBRARY_VERSION = 1;
const CACHE_DIR = '.hoshikuzu';
const PREVIEW_DIR = 'previews';
const BACKUP_DIR = 'backups';
const INDEX_FILE = 'index.json';
const INBOX_DIR = '_inbox';

/**
 * Thumbnail cache lives in its own visible folder inside the library root.
 * It is created by the second onboarding step and can be renamed there.
 * Originals are never written to; only generated WebP copies land here.
 */
const DEFAULT_THUMBNAIL_DIR = '缩略图缓存';
const LEGACY_PREVIEW_DIR = `${CACHE_DIR}/${PREVIEW_DIR}`;

/**
 * Five thumbnail presets. The ID is persisted in hoshikuzu-library.json and
 * must stay in sync with src/data/thumbnailPresets.ts (labels/perf copy live
 * in the renderer, resolution/quality live here).
 */
const THUMBNAIL_PRESETS = [
  { id: 'feather', maxEdge: 960, quality: 66 },
  { id: 'swift', maxEdge: 1280, quality: 74 },
  { id: 'balanced', maxEdge: 1600, quality: 82 },
  { id: 'clear', maxEdge: 1920, quality: 86 },
  { id: 'lush', maxEdge: 2560, quality: 90 },
];
const DEFAULT_THUMBNAIL_PRESET_ID = 'balanced';

/**
 * How the renderer brings thumbnails into memory:
 * - realtime: only cards at/near the viewport request an image
 * - predictive: visible cards plus ~10–20 cards (5%) in the scroll direction
 * - preload: prefetch every registered thumbnail once, then load on demand
 */
const IMAGE_LOADING_MODES = ['realtime', 'predictive', 'preload'];
const DEFAULT_IMAGE_LOADING_MODE = 'predictive';

const DEFAULT_PREVIEW_MAX_EDGE = 1600;
const DEFAULT_PREVIEW_QUALITY = 82;
const PREVIEW_MAX_EDGES = THUMBNAIL_PRESETS.map((preset) => preset.maxEdge);
const PREVIEW_QUALITY = DEFAULT_PREVIEW_QUALITY;

/**
 * Upper bound for decoded image pixels. sharp's own default is 0x3FFF^2
 * (~268 MP); keeping it explicit means every sharp entry point gets the same
 * decompression-bomb guard, even ones that used to opt out for huge captures.
 */
const MAX_INPUT_PIXELS = 0x3fff * 0x3fff;

/**
 * Canonical preview names include the preset signature so changing quality or
 * resolution can never serve a stale cached file. Legacy `<hash>.webp` names
 * from older libraries are still recognized and served.
 */
const PREVIEW_FILE_PATTERN = /^[0-9a-f]{40}(?:_\d{3,4}_q\d{2,3})?\.webp$/i;

function thumbnailPresetById(id) {
  return THUMBNAIL_PRESETS.find((preset) => preset.id === id) || null;
}

/** Map the old numeric preview size setting onto the closest new preset. */
function thumbnailPresetForMaxEdge(edge) {
  const size = Number(edge);
  if (!Number.isFinite(size) || size <= 0) return null;
  let best = THUMBNAIL_PRESETS[0];
  let bestDelta = Math.abs(best.maxEdge - size);
  for (const preset of THUMBNAIL_PRESETS.slice(1)) {
    const delta = Math.abs(preset.maxEdge - size);
    if (delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best;
}

function resolveThumbnailPreset(value, legacyMaxEdge) {
  return (
    thumbnailPresetById(value) ||
    thumbnailPresetForMaxEdge(legacyMaxEdge) ||
    thumbnailPresetById(DEFAULT_THUMBNAIL_PRESET_ID)
  );
}

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
]);

const SKIP_DIRECTORIES = new Set([
  CACHE_DIR,
  'node_modules',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.git',
  '.svn',
]);

module.exports = {
  LIBRARY_FILE,
  LIBRARY_FORMAT,
  LIBRARY_VERSION,
  CACHE_DIR,
  PREVIEW_DIR,
  BACKUP_DIR,
  INDEX_FILE,
  INBOX_DIR,
  DEFAULT_THUMBNAIL_DIR,
  LEGACY_PREVIEW_DIR,
  THUMBNAIL_PRESETS,
  DEFAULT_THUMBNAIL_PRESET_ID,
  IMAGE_LOADING_MODES,
  DEFAULT_IMAGE_LOADING_MODE,
  DEFAULT_PREVIEW_MAX_EDGE,
  DEFAULT_PREVIEW_QUALITY,
  PREVIEW_MAX_EDGES,
  PREVIEW_QUALITY,
  PREVIEW_FILE_PATTERN,
  thumbnailPresetById,
  thumbnailPresetForMaxEdge,
  resolveThumbnailPreset,
  IMAGE_EXTENSIONS,
  SKIP_DIRECTORIES,
};
