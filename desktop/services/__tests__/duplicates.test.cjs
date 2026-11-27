'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const repository = require('../../library/repository.cjs');
const { DuplicateService } = require('../duplicates.cjs');

test('duplicate scan groups identical originals and trash moves only the copy', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-duplicates-'));
  const root = path.join(base, 'library');
  const pics = path.join(root, 'pics');
  await fs.mkdir(pics, { recursive: true });
  await repository.ensureLibrary(root, { name: '重复测试库' });

  const same = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#3366aa' },
  })
    .png()
    .toBuffer();
  const other = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#aa6633' },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(pics, 'a.png'), same);
  await fs.writeFile(path.join(pics, 'b.png'), same);
  await fs.writeFile(path.join(pics, 'c.png'), other);

  const createdAt = new Date().toISOString();
  const photo = (id, libraryPath) => ({
    id,
    src: '',
    alt: path.basename(libraryPath),
    capturedAt: '2026-01-02T03:04:05.000Z',
    note: '',
    worldLookup: 'none',
    createdAt,
    mediaKind: 'library',
    libraryPath,
    contentHash: `hash-${id}`,
    fileBytes: same.length,
  });
  await repository.updateAlbum(root, {
    version: 2,
    photos: [
      photo('a', 'pics/a.png'),
      photo('b', 'pics/b.png'),
      photo('c', 'pics/c.png'),
    ],
    worlds: [],
    settings: {},
    activity: [],
    updatedAt: createdAt,
  });

  const service = new DuplicateService({ getRoot: () => root });
  const scan = await service.scan();
  assert.equal(scan.ok, true);
  assert.equal(scan.scanned, 3);
  assert.equal(scan.groups.length, 1);
  assert.equal(scan.groups[0].entries.length, 2);
  assert.deepEqual(
    scan.groups[0].entries.map((entry) => entry.id).sort(),
    ['a', 'b'],
  );
  assert.ok(scan.reclaimableBytes > 0);

  const trashed = await service.trash([{ id: 'b', libraryPath: 'pics/b.png' }]);
  assert.equal(trashed.ok, true);
  assert.equal(trashed.trashed.length, 1);
  assert.ok(trashed.trashed[0].to.startsWith('.hoshikuzu/trash/'));
  await assert.rejects(fs.stat(path.join(pics, 'b.png')));
  assert.ok((await fs.stat(path.join(root, trashed.trashed[0].to))).size > 0);
  assert.ok((await fs.stat(path.join(pics, 'a.png'))).size > 0);
  assert.ok((await fs.stat(path.join(pics, 'c.png'))).size > 0);

  await fs.rm(base, { recursive: true, force: true });
});
