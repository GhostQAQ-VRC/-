'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const sharp = require('sharp');
const {
  DEFAULT_PREVIEW_MAX_EDGE,
  DEFAULT_PREVIEW_QUALITY,
  PREVIEW_FILE_PATTERN,
  THUMBNAIL_PRESETS,
  resolveThumbnailPreset,
} = require('./constants.cjs');

// Background thumbnail work must not starve the renderer on low-core laptops.
// libvips otherwise uses every core for a single large screenshot.
try {
  sharp.concurrency(Math.max(1, Math.min(2, Math.floor(os.cpus().length / 4) || 1)));
} catch {
  // Older sharp builds may not expose concurrency; generation still works.
}

/**
 * Preview files are content-addressed and include the preset signature, so a
 * cached URL can be served immutably: changing resolution or quality produces
 * a new file name instead of overwriting a previously cached image.
 */
function previewFileName(hash, presetOrEdge, quality) {
  const preset =
    presetOrEdge && typeof presetOrEdge === 'object'
      ? presetOrEdge
      : resolveThumbnailPreset(null, presetOrEdge);
  const maxEdge = preset ? preset.maxEdge : DEFAULT_PREVIEW_MAX_EDGE;
  const finalQuality =
    Number.isFinite(Number(quality)) && quality !== undefined
      ? Math.min(100, Math.max(1, Math.round(Number(quality))))
      : preset
        ? preset.quality
        : DEFAULT_PREVIEW_QUALITY;
  return `${hash}_${maxEdge}_q${finalQuality}.webp`;
}

/** Accepts canonical `<hash>_<edge>_q<quality>.webp` and legacy `<hash>.webp`. */
function parsePreviewFileName(name) {
  const base = path.basename(String(name || ''));
  if (!PREVIEW_FILE_PATTERN.test(base)) return null;
  const canonical = /^([0-9a-f]{40})_(\d{3,4})_q(\d{2,3})\.webp$/i.exec(base);
  if (canonical) {
    return {
      hash: canonical[1].toLowerCase(),
      maxEdge: Number(canonical[2]),
      quality: Number(canonical[3]),
      legacy: false,
    };
  }
  const legacy = /^([0-9a-f]{40})\.webp$/i.exec(base);
  if (legacy) {
    return { hash: legacy[1].toLowerCase(), maxEdge: null, quality: null, legacy: true };
  }
  return null;
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Header-only read: works even for very large originals. */
async function readImageDimensions(absPath) {
  try {
    const meta = await sharp(absPath, { limitInputPixels: false, failOn: 'none' }).metadata();
    let width = meta.width;
    let height = meta.height;
    if (meta.orientation >= 5 && meta.orientation <= 8 && width && height) {
      [width, height] = [height, width];
    }
    return { width, height, format: meta.format, pages: meta.pages };
  } catch {
    return {};
  }
}

function sharpInput(absPath) {
  // Read-only pipeline. `failOn: none` keeps slightly damaged VRChat captures
  // visible instead of dropping them, and the original file is never written.
  return sharp(absPath, { limitInputPixels: false, failOn: 'none' });
}

/**
 * Generate the display preview. Originals are never modified; only a WebP
 * cache file is written into the configured thumbnail folder.
 */
async function generatePreview({
  absPath,
  hash,
  previewDir,
  maxEdge = DEFAULT_PREVIEW_MAX_EDGE,
  quality = DEFAULT_PREVIEW_QUALITY,
  force = false,
}) {
  const fileName = previewFileName(hash, { maxEdge, quality });
  const outPath = path.join(previewDir, fileName);
  if (!force && (await fileExists(outPath))) {
    return { previewPath: fileName, absPath: outPath, created: false };
  }

  await fs.mkdir(previewDir, { recursive: true });
  const tmpPath = `${outPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await sharpInput(absPath)
      .rotate()
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality, effort: 4 })
      .toFile(tmpPath);
    try {
      await fs.rename(tmpPath, outPath);
    } catch {
      await fs.rm(outPath, { force: true });
      await fs.rename(tmpPath, outPath);
    }
    return { previewPath: fileName, absPath: outPath, created: true };
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Render all five presets from one sample image into a temporary folder for the
 * onboarding A/B comparison. The library cache is deliberately untouched.
 */
async function renderThumbnailSamples({
  absPath,
  outDir,
  presets = THUMBNAIL_PRESETS,
  filePrefix = '',
}) {
  await fs.mkdir(outDir, { recursive: true });
  const results = [];
  for (const preset of presets) {
    const fileName = `${filePrefix}${preset.id}.webp`;
    const outPath = path.join(outDir, fileName);
    const started = Date.now();
    const info = await sharpInput(absPath)
      .rotate()
      .resize({
        width: preset.maxEdge,
        height: preset.maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: preset.quality, effort: 4 })
      .toFile(outPath);
    const stat = await fs.stat(outPath);
    results.push({
      id: preset.id,
      maxEdge: preset.maxEdge,
      quality: preset.quality,
      bytes: stat.size,
      width: info.width,
      height: info.height,
      encodeMs: Date.now() - started,
      fileName,
    });
  }
  return results;
}

/**
 * Small concurrency-limited queue so a large library does not block the UI and
 * does not saturate the disk. Progress is reported through callbacks.
 */
class PreviewQueue {
  constructor(options) {
    this.previewDir = options.previewDir;
    this.maxEdge = options.maxEdge ?? DEFAULT_PREVIEW_MAX_EDGE;
    this.quality = options.quality ?? DEFAULT_PREVIEW_QUALITY;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.onReady = options.onReady || (() => {});
    this.onError = options.onError || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.queue = [];
    this.seen = new Set();
    this.active = 0;
    this.pumping = false;
    this.paused = false;
    this.done = 0;
    this.failed = 0;
    this.total = 0;
  }

  get pending() {
    return this.queue.length;
  }

  enqueue(job) {
    if (!job || !job.hash || !job.absPath) return;
    if (this.seen.has(job.hash)) return;
    this.seen.add(job.hash);
    this.total += 1;
    this.queue.push(job);
    this.pump();
  }

  enqueueMany(jobs) {
    for (const job of jobs || []) this.enqueue(job);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.pump();
  }

  clear() {
    this.queue = [];
    this.seen.clear();
  }

  /** Snapshot used by IPC progress events. */
  progress() {
    return {
      done: this.done,
      failed: this.failed,
      pending: this.queue.length,
      total: this.total,
      active: this.active,
    };
  }

  /** Wait until every queued preview has been processed (used by the CLI). */
  async drain() {
    while (this.queue.length > 0 || this.active > 0) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async process(job) {
    try {
      const result = await generatePreview({
        absPath: job.absPath,
        hash: job.hash,
        previewDir: this.previewDir,
        maxEdge: this.maxEdge,
        quality: this.quality,
        force: job.force,
      });
      this.done += 1;
      this.onReady({ hash: job.hash, previewPath: result.previewPath });
    } catch (error) {
      this.failed += 1;
      this.onError({ hash: job.hash, absPath: job.absPath, error: String(error && error.message) });
    } finally {
      this.onProgress({ done: this.done, failed: this.failed, pending: this.queue.length, total: this.total, active: this.active });
    }
  }

  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.paused && this.queue.length > 0) {
        if (this.active >= this.concurrency) {
          await new Promise((resolve) => setTimeout(resolve, 90));
          continue;
        }
        const job = this.queue.shift();
        this.active += 1;
        void this.process(job).finally(() => {
          this.active -= 1;
        });
      }
    } finally {
      this.pumping = false;
    }
  }
}

module.exports = {
  generatePreview,
  parsePreviewFileName,
  previewFileName,
  readImageDimensions,
  renderThumbnailSamples,
  PreviewQueue,
};
