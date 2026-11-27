'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const repository = require('../../library/repository.cjs');
const { HealthService } = require('../health.cjs');

test('health scan reports missing files, orphan previews and trash, then cleans safely', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-health-'));
  const root = path.join(base, 'library');
  const pics = path.join(root, 'pics');
  await fs.mkdir(pics, { recursive: true });
  const wrapper = await repository.ensureLibrary(root, { name: '健康检查库' });
  const previewDir = repository.previewDir(root, wrapper);
  await fs.mkdir(previewDir, { recursive: true });
  await sharp({ create: { width: 24, height: 18, channels: 3, background: '#3366aa' } })
    .png()
    .toFile(path.join(pics, 'a.png'));
  await fs.writeFile(path.join(previewDir, `${'a'.repeat(40)}_800_q82.webp`), 'referenced');
  await fs.writeFile(path.join(previewDir, `${'b'.repeat(40)}_800_q82.webp`), 'orphan');
  const trashDir = path.join(root, '.hoshikuzu', 'trash', 'stamp', 'pics');
  await fs.mkdir(trashDir, { recursive: true });
  await fs.writeFile(path.join(trashDir, 'old.png'), 'trashed');

  const createdAt = new Date().toISOString();
  const photo = (id, libraryPath, previewPath, contentHash) => ({
    id,
    src: '',
    alt: id,
    capturedAt: '2026-01-02T03:04:05.000Z',
    note: '',
    worldLookup: 'none',
    createdAt,
    mediaKind: 'library',
    libraryPath,
    previewPath,
    contentHash,
    fileBytes: 100,
  });
  await repository.updateAlbum(root, {
    version: 2,
    photos: [
      photo('a1', 'pics/a.png', `${'a'.repeat(40)}_800_q82.webp`, 'hash-a'),
      photo('a2', 'pics/a.png', `${'a'.repeat(40)}_800_q82.webp`, 'hash-a'),
      photo('missing', 'pics/missing.png', '', 'hash-missing'),
    ],
    worlds: [],
    settings: {},
    activity: [],
    updatedAt: createdAt,
  });

  const service = new HealthService({ getRoot: () => root });
  const scan = await service.scan();
  assert.equal(scan.ok, true);
  assert.equal(scan.counts.missing, 1);
  assert.equal(scan.counts.orphanPreviews, 1);
  assert.equal(scan.counts.duplicatePaths, 1);
  assert.equal(scan.counts.duplicateHashes, 1);
  assert.equal(scan.counts.trashCount, 1);
  assert.deepEqual(scan.missingIds, ['missing']);

  const cleaned = await service.cleanOrphanPreviews();
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.removed, 1);
  await assert.rejects(fs.stat(path.join(previewDir, `${'b'.repeat(40)}_800_q82.webp`)));
  assert.ok((await fs.stat(path.join(previewDir, `${'a'.repeat(40)}_800_q82.webp`))).size > 0);

  const emptied = await service.emptyTrash();
  assert.equal(emptied.ok, true);
  assert.equal(emptied.removed, 1);
  await assert.rejects(fs.stat(path.join(root, '.hoshikuzu', 'trash')));

  const after = await service.scan();
  assert.equal(after.counts.orphanPreviews, 0);
  assert.equal(after.counts.trashCount, 0);
  assert.equal(after.counts.missing, 1);

  await fs.rm(base, { recursive: true, force: true });
});
