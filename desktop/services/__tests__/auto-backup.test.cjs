'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const repository = require('../../library/repository.cjs');
const { AutoBackupService, normalize } = require('../auto-backup.cjs');

async function makeService(base, options = {}) {
  const root = path.join(base, 'library');
  await fs.mkdir(root, { recursive: true });
  await repository.ensureLibrary(root, { name: '自动备份测试库' });
  const folder = path.join(base, 'backups');
  let settings = {
    enabled: false,
    folder: '',
    intervalDays: 7,
    kind: 'metadata',
    retention: 5,
    lastRunAt: null,
    lastAttemptAt: null,
    lastPath: '',
    lastError: null,
  };
  let now = new Date('2026-11-27T12:00:00.000Z');
  const service = new AutoBackupService({
    getRoot: options.getRoot === undefined ? () => root : options.getRoot,
    getSettings: () => settings,
    updateSettings: async (patch) => {
      settings = {
        ...settings,
        ...patch,
      };
    },
    defaultFolder: () => folder,
    now: () => now,
  });
  return {
    root,
    folder,
    service,
    settings: () => settings,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

test('auto backup normalizes unsupported settings to safe defaults', () => {
  assert.deepEqual(normalize(null), {
    enabled: false,
    folder: '',
    intervalDays: 7,
    kind: 'metadata',
    retention: 5,
    lastRunAt: null,
    lastAttemptAt: null,
    lastPath: '',
    lastError: null,
  });
  const constrained = normalize({
    enabled: 1,
    folder: '  C:\\Backups  ',
    intervalDays: 999,
    kind: 'everything',
    retention: 0,
    lastRunAt: 'not-a-date',
  });
  assert.equal(constrained.enabled, false);
  assert.equal(constrained.folder, 'C:\\Backups');
  assert.equal(constrained.intervalDays, 90);
  assert.equal(constrained.kind, 'metadata');
  assert.equal(constrained.retention, 1);
  assert.equal(constrained.lastRunAt, null);
});

test('manual backup writes metadata, records status and prunes old auto files', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-auto-backup-'));
  try {
    const { service, folder, settings } = await makeService(base);
    const updated = await service.update({
      enabled: true,
      intervalDays: 3,
      retention: 3,
      kind: 'metadata',
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.status.effectiveFolder, folder);
    assert.equal(updated.status.usingDefaultFolder, true);

    await fs.mkdir(folder, { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      const file = path.join(
        folder,
        `hoshikuzu-auto-metadata-2026-01-0${index + 1}T00-00-00-000Z.json`,
      );
      await fs.writeFile(file, '{"old":true}');
      const time = new Date(`2026-01-0${index + 1}T00:00:00.000Z`);
      await fs.utimes(file, time, time);
    }
    const stalePartial = path.join(folder, 'hoshikuzu-auto-full-2026-01-01T00-00-00-000Z.zip.partial');
    const freshPartial = path.join(folder, 'hoshikuzu-auto-full-crash.zip.partial');
    await fs.writeFile(stalePartial, 'partial');
    await fs.writeFile(freshPartial, 'partial');
    const older = new Date('2026-01-01T00:00:00.000Z');
    await fs.utimes(stalePartial, older, older);
    const recent = new Date('2026-11-27T11:59:00.000Z');
    await fs.utimes(freshPartial, recent, recent);

    const result = await service.runNow('manual');
    assert.equal(result.ok, true, result.error);
    assert.ok(result.path.endsWith('.json'));
    assert.ok((await fs.stat(result.path)).size > 0);

    const kept = (await fs.readdir(folder)).filter((name) =>
      /^hoshikuzu-auto-metadata-/.test(name),
    );
    assert.equal(kept.length, 3);
    assert.ok(kept.includes(path.basename(result.path)));
    await assert.rejects(fs.stat(stalePartial), 'stale partial file should be pruned');
    await fs.stat(freshPartial);
    assert.equal(settings().lastRunAt, '2026-11-27T12:00:00.000Z');
    assert.equal(settings().lastError, null);
    assert.equal(service.status().nextRunAt, '2026-11-30T12:00:00.000Z');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('full backup honors interval and never backs up into the library', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-auto-full-'));
  try {
    const { service, root, folder, advance } = await makeService(base);
    const nested = path.join(root, 'backups');
    const rejected = await service.update({ enabled: true, folder: nested });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /存储库内部/);
    await assert.rejects(fs.stat(nested), 'rejected folder must not be created');

    const updated = await service.update({
      enabled: true,
      folder,
      intervalDays: 7,
      kind: 'full',
      retention: 2,
    });
    assert.equal(updated.ok, true, updated.error);
    assert.equal(service.isDue(), true, 'first run is due immediately');

    const result = await service.runNow('schedule');
    assert.equal(result.ok, true, result.error);
    assert.ok(result.path.endsWith('.zip'));
    assert.ok((await fs.stat(result.path)).size > 0);
    assert.equal(service.isDue(), false);

    advance(6 * 86_400_000);
    assert.equal(service.isDue(), false);
    advance(2 * 86_400_000);
    assert.equal(service.isDue(), true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('failed backup clears the partial file and records the error', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-auto-fail-'));
  try {
    const brokenRoot = path.join(base, 'empty-root');
    await fs.mkdir(brokenRoot, { recursive: true });
    const { service, folder } = await makeService(base, { getRoot: () => brokenRoot });
    const result = await service.runNow('manual');
    assert.equal(result.ok, false);
    assert.match(result.error, /存储库不可用/);
    const entries = await fs.readdir(folder).catch(() => []);
    assert.deepEqual(entries, []);
    assert.match(service.status().lastError, /存储库不可用/);
    assert.ok(service.status().lastAttemptAt);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
