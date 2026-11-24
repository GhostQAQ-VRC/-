'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const AdmZip = require('adm-zip');

const repository = require('../repository.cjs');
const { scanLibrary } = require('../scan.cjs');
const { PreviewQueue } = require('../preview.cjs');
const backup = require('../backup.cjs');

test('library scan, metadata export, full zip export and zip restore', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-backup-'));
  const root = path.join(base, 'library');
  const restored = path.join(base, 'restored');
  try {
    await repository.ensureLibrary(root, { name: '测试库' });
    const png = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer();
    await fs.writeFile(path.join(root, 'VRChat_2024-09-10_11-12-13.000_2x2.png'), png);
    await fs.mkdir(path.join(root, 'sub'), { recursive: true });
    const second = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#aa5577' },
    })
      .png()
      .toBuffer();
    await fs.writeFile(path.join(root, 'sub', 'another.png'), second);

    const wrapper = await repository.readLibrary(root);
    const previewOptions = repository.previewOptionsFor(wrapper);
    const queue = new PreviewQueue({
      previewDir: repository.previewDir(root, wrapper),
      maxEdge: previewOptions.previewMaxEdge,
      quality: previewOptions.previewQuality,
      concurrency: 2,
    });
    const result = await scanLibrary({ root, previewQueue: queue });
    await queue.drain();

    assert.equal(result.ok, true);
    assert.equal(result.complete, true);
    assert.equal(result.stats.scanned, 2);
    assert.equal(result.seeds.length, 2);

    const stats = await repository.computeLibraryStats(root);
    assert.equal(stats.imageCount, 2);
    assert.ok(stats.previewCount >= 2);

    const metadataPath = path.join(base, 'metadata.json');
    await backup.exportMetadata(root, metadataPath);
    const parsed = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    assert.equal(parsed.format, 'hoshikuzu-library');
    assert.equal(parsed.album.version, 2);

    const zipPath = path.join(base, 'library.zip');
    await backup.exportFull(root, zipPath);
    const zip = new AdmZip(zipPath);
    const names = zip.getEntries().map((entry) => entry.entryName);
    assert.ok(names.includes('hoshikuzu-library.json'));
    assert.ok(names.some((name) => name.includes('VRChat_2024-09-10')));
    assert.ok(names.some((name) => name.startsWith('缩略图缓存/')));

    await backup.importZip(zipPath, restored);
    const restoredWrapper = await repository.readLibrary(restored);
    assert.ok(restoredWrapper);
    assert.equal(restoredWrapper.library.name, '测试库');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
