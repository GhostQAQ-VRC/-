'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const repository = require('../repository.cjs');
const { scanLibrary } = require('../scan.cjs');
const { quickContentHash } = require('../quick-hash.cjs');
const {
  PreviewQueue,
  generatePreview,
  parsePreviewFileName,
  previewFileName,
  renderThumbnailSamples,
} = require('../preview.cjs');

test('thumbnail folder, preset naming and read-only originals', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-thumbs-'));
  const root = path.join(base, 'library');
  try {
    const created = await repository.ensureLibrary(root, { name: '缩略图测试' });
    assert.equal(created.library.thumbnailsConfigured, false);
    assert.equal(created.library.thumbnailDir, '缩略图缓存');
    assert.equal(created.library.imageLoadingMode, 'predictive');

    // Path safety: one folder directly inside the library, never traversal.
    assert.equal(repository.sanitizeThumbnailDir('缩略图缓存'), '缩略图缓存');
    assert.equal(repository.sanitizeThumbnailDir('../escape'), null);
    assert.equal(repository.sanitizeThumbnailDir('a/b'), null);
    assert.equal(repository.sanitizeThumbnailDir('..'), null);

    const wrapper = await repository.readLibrary(root);
    const previewDir = repository.previewDir(root, wrapper);
    assert.equal(path.basename(previewDir), '缩略图缓存');

    const imagePath = path.join(root, 'photo.png');
    const buffer = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer();
    await fs.writeFile(imagePath, buffer);
    const before = await fs.readFile(imagePath);

    await repository.updateLibraryConfig(root, {
      previewPreset: 'clear',
      thumbnailsConfigured: true,
    });
    const configured = await repository.readLibrary(root);
    const options = repository.previewOptionsFor(configured);
    assert.equal(options.previewMaxEdge, 1920);
    assert.equal(options.previewQuality, 86);
    assert.equal(configured.library.imageLoadingMode, 'predictive');
    await repository.updateLibraryConfig(root, { imageLoadingMode: 'realtime' });
    assert.equal(
      (await repository.readLibrary(root)).library.imageLoadingMode,
      'realtime',
    );
    await repository.updateLibraryConfig(root, { imageLoadingMode: 'predictive' });

    const generated = await generatePreview({
      absPath: imagePath,
      hash: 'a'.repeat(40),
      previewDir: repository.previewDir(root, configured),
      maxEdge: options.previewMaxEdge,
      quality: options.previewQuality,
    });
    assert.equal(generated.previewPath, previewFileName('a'.repeat(40), options.preset));
    assert.ok(generated.previewPath.includes('_1920_q86.webp'));
    assert.deepEqual(parsePreviewFileName(generated.previewPath), {
      hash: 'a'.repeat(40),
      maxEdge: 1920,
      quality: 86,
      legacy: false,
    });
    assert.deepEqual(parsePreviewFileName(`${'b'.repeat(40)}.webp`), {
      hash: 'b'.repeat(40),
      maxEdge: null,
      quality: null,
      legacy: true,
    });
    assert.equal(parsePreviewFileName('not-a-preview.jpg'), null);

    const after = await fs.readFile(imagePath);
    assert.deepEqual(after, before, 'the original file must never be rewritten');

    // A visible thumbnail folder must never be indexed as user photos.
    const fakeThumb = path.join(previewDir, 'thumb.png');
    await fs.writeFile(fakeThumb, buffer);
    const realHash = await quickContentHash(imagePath, buffer.length);
    await generatePreview({
      absPath: imagePath,
      hash: realHash,
      previewDir: repository.previewDir(root, configured),
      maxEdge: options.previewMaxEdge,
      quality: options.previewQuality,
    });
    const queue = new PreviewQueue({
      previewDir,
      maxEdge: options.previewMaxEdge,
      quality: options.previewQuality,
    });
    const scan = await scanLibrary({ root, previewQueue: queue });
    assert.equal(scan.stats.total, 1);
    assert.equal(scan.seeds.length, 1);
    assert.ok(scan.seeds[0].previewPath.includes('_1920_q86.webp'));
    await fs.rm(fakeThumb, { force: true });

    // Onboarding samples render every preset into a temp folder only.
    const sampleDir = path.join(base, 'samples');
    const samples = await renderThumbnailSamples({
      absPath: imagePath,
      outDir: sampleDir,
      filePrefix: 'abcdef123456-',
    });
    assert.equal(samples.length, 5);
    for (const sample of samples) {
      assert.ok(sample.bytes > 0);
      assert.ok(sample.width <= sample.maxEdge);
      assert.ok(sample.fileName.startsWith('abcdef123456-'));
    }
    const libraryFiles = await fs.readdir(previewDir);
    assert.ok(!libraryFiles.some((name) => name.startsWith('abcdef123456-')));
    assert.deepEqual(await fs.readFile(imagePath), before);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
