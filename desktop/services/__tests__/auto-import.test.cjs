'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const repository = require('../../library/repository.cjs');
const { AutoImportService } = require('../auto-import.cjs');

async function makePng(file, background) {
  await sharp({ create: { width: 24, height: 18, channels: 3, background } })
    .png()
    .toFile(file);
}

test('auto import copies new screenshots once and never touches the source', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-autoimport-'));
  const root = path.join(base, 'library');
  const shots = path.join(base, 'screenshots');
  await fs.mkdir(shots, { recursive: true });
  await repository.ensureLibrary(root, { name: '自动导入测试库' });
  await makePng(path.join(shots, 'VRChat_2026-01-02_03-04-05.png'), '#3355aa');

  let settings = { enabled: false, folder: '', lastScanAt: null };
  const imported = [];
  const service = new AutoImportService({
    getRoot: () => root,
    getSettings: () => settings,
    updateSettings: async (patch) => {
      settings = { ...settings, ...(patch.autoImport || {}) };
    },
    getPreviewMaxEdge: async () => 640,
    onImported: (draft) => imported.push(draft),
  });

  try {
    const enabled = await service.update({ enabled: true, folder: shots });
    assert.equal(enabled.ok, true);
    assert.equal(imported.length, 1);
    assert.ok(imported[0].libraryPath.startsWith('_inbox/'));
    assert.ok((await fs.stat(path.join(root, imported[0].libraryPath))).size > 0);
    // The source screenshot must still be in the user's folder.
    assert.ok((await fs.stat(path.join(shots, 'VRChat_2026-01-02_03-04-05.png'))).size > 0);

    await service.scanNow();
    assert.equal(imported.length, 1);

    await makePng(path.join(shots, 'VRChat_2026-01-03_04-05-06.png'), '#aa5533');
    await service.scanNow();
    assert.equal(imported.length, 2);
    assert.equal(service.status().importedCount, 2);

    // A folder inside the library would copy the library into itself.
    const inside = path.join(root, 'shots');
    await fs.mkdir(inside, { recursive: true });
    const rejected = await service.update({ enabled: true, folder: inside });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /内部|包含/);
  } finally {
    service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  }
});
