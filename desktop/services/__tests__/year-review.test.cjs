'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { YearReviewService, pickGallery } = require('../year-review.cjs');

function photo(id, capturedAt, overrides = {}) {
  return {
    id,
    src: '',
    alt: `照片 ${id}`,
    capturedAt,
    note: '',
    worldLookup: 'none',
    createdAt: capturedAt,
    mediaKind: 'library',
    libraryPath: `pics/${id}.png`,
    previewPath: 'preview.webp',
    ...overrides,
  };
}

test('year review embeds escaped, self-contained HTML with yearly stats', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-review-'));
  try {
    const previewDir = path.join(base, 'thumbnails');
    await fs.mkdir(previewDir, { recursive: true });
    const previewBytes = await sharp({
      create: { width: 90, height: 60, channels: 3, background: '#7a5cff' },
    })
      .webp()
      .toBuffer();
    await fs.writeFile(path.join(previewDir, 'preview.webp'), previewBytes);

    const album = {
      settings: { siteName: '时光 <轴>', siteNameEn: 'HOSHIKUZU' },
      photos: [
        photo('one', '2025-03-05T10:00:00.000Z', {
          favorite: true,
          note: '海边的 <img src=x onerror="alert(1)"> 夜晚',
          worldRef: 'wrld_1',
          world: { id: 'wrld_1', name: '<script>alert(1)</script> 世界' },
        }),
        photo('two', '2025-12-20T12:00:00.000Z', {
          worldRef: 'wrld_1',
          world: { id: 'wrld_1', name: '<script>alert(1)</script> 世界' },
        }),
        photo('outside', '2026-01-01T00:00:00.000Z'),
        photo('hidden', '2025-06-01T00:00:00.000Z', { missing: true }),
      ],
    };
    const service = new YearReviewService({
      getRoot: () => base,
      getAlbum: async () => album,
      getPreviewDir: async () => previewDir,
    });

    assert.deepEqual(await service.listYears(), [2026, 2025]);
    const built = await service.build(2025);
    assert.equal(built.ok, true, built.error);
    assert.equal(built.summary.photos, 2);
    assert.equal(built.summary.worlds, 1);
    assert.equal(built.summary.favorites, 1);
    assert.ok(built.summary.images >= 1);
    assert.match(built.filename, /2025\.html$/);
    assert.match(built.html, /^<!doctype html>/);
    assert.match(built.html, /Content-Security-Policy/);
    assert.match(built.html, /data:image\/jpeg;base64,/);
    assert.match(built.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(built.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(built.html, /<img src=x/);
    assert.doesNotMatch(built.html, /<script>alert/);
    assert.doesNotMatch(built.html, /file:\/\/|https?:\/\//);

    const target = path.join(base, 'out', 'review.html');
    const exported = await service.exportYear(2025, target);
    assert.equal(exported.ok, true, exported.error);
    assert.ok((await fs.stat(target)).size > 1000);

    const empty = await service.build(2024);
    assert.equal(empty.ok, false);
    assert.match(empty.error, /还没有照片/);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('pickGallery stays within the limit and samples across months', () => {
  const photos = [];
  for (let month = 0; month < 12; month += 1) {
    for (let index = 0; index < 4; index += 1) {
      photos.push(
        photo(`m${month}-${index}`, `2025-${String(month + 1).padStart(2, '0')}-${String(
          index * 5 + 2,
        ).padStart(2, '0')}T12:00:00.000Z`),
      );
    }
  }
  const picked = pickGallery(photos, 12);
  assert.ok(picked.length <= 12);
  assert.ok(picked.length >= 10);
  const months = new Set(picked.map((item) => new Date(item.capturedAt).getMonth()));
  assert.ok(months.size >= 6);
});
