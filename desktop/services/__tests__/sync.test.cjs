'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sharp = require('sharp');

const {
  formatBytes,
  readManifest,
  runCloudSync,
  runWebsiteSync,
  testWebsiteConnection,
} = require('../sync-core.cjs');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function makePhoto(root, relative, color) {
  const absolute = path.join(root, relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const buffer = await sharp({
    create: { width: 48, height: 32, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  await fs.writeFile(absolute, buffer);
  return buffer;
}

function albumWith(photos) {
  return {
    version: 2,
    photos,
    worlds: [],
    settings: {},
    activity: [],
    updatedAt: new Date().toISOString(),
  };
}

test('cloud folder sync groups originals into date folders and skips synced files', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-sync-'));
  const root = path.join(base, 'library');
  const syncDir = path.join(base, 'cloud');
  await fs.mkdir(root, { recursive: true });
  try {
    const red = await makePhoto(root, 'photos/red.png', '#aa3344');
    const blue = await makePhoto(root, 'photos/blue.png', '#3344aa');
    const green = await makePhoto(root, 'photos/green.png', '#33aa55');
    const album = albumWith([
      {
        id: 'p1',
        src: '',
        mediaKind: 'library',
        libraryPath: 'photos/red.png',
        capturedAt: '2024-05-01T10:20:00+09:00',
        contentHash: 'a'.repeat(40),
        note: '',
        worldLookup: 'none',
        createdAt: '2024-05-01T10:20:00Z',
      },
      {
        id: 'p2',
        src: '',
        mediaKind: 'library',
        libraryPath: 'photos/blue.png',
        capturedAt: '2024-05-01T18:00:00+09:00',
        contentHash: 'b'.repeat(40),
        note: '',
        worldLookup: 'none',
        createdAt: '2024-05-01T18:00:00Z',
      },
      {
        id: 'p3',
        src: '',
        mediaKind: 'library',
        libraryPath: 'photos/green.png',
        capturedAt: '2024-06-02T08:00:00+09:00',
        contentHash: 'c'.repeat(40),
        note: '',
        worldLookup: 'none',
        createdAt: '2024-06-02T08:00:00Z',
      },
    ]);

    const progress = [];
    const first = await runCloudSync({
      root,
      album,
      settings: {
        provider: '123pan-folder',
        folderRoot: syncDir,
        baseFolder: 'Hoshikuzu Album',
        skipExisting: true,
        uploadMetadata: true,
      },
      secrets: {},
      onProgress: (payload) => progress.push(payload),
    });
    assert.equal(first.ok, true);
    assert.equal(first.uploaded, 3);
    assert.equal(first.dates, 2);
    assert.equal(first.failed, 0);

    const day1 = path.join(syncDir, 'Hoshikuzu Album', '2024-05-01');
    const day2 = path.join(syncDir, 'Hoshikuzu Album', '2024-06-02');
    assert.deepEqual(await fs.readFile(path.join(day1, 'red.png')), red);
    assert.deepEqual(await fs.readFile(path.join(day1, 'blue.png')), blue);
    assert.deepEqual(await fs.readFile(path.join(day2, 'green.png')), green);
    assert.ok(
      (await fs.readFile(path.join(syncDir, 'Hoshikuzu Album', 'hoshikuzu-album.json'), 'utf8'))
        .includes('red.png'),
    );
    assert.deepEqual(await fs.readFile(path.join(root, 'photos/red.png')), red);
    assert.ok(progress.some((item) => item.phase === 'folders' && item.date === '2024-05-01'));

    const manifest = await readManifest(root);
    assert.equal(Object.keys(manifest.entries).length, 3);

    const second = await runCloudSync({
      root,
      album,
      settings: {
        provider: '123pan-folder',
        folderRoot: syncDir,
        baseFolder: 'Hoshikuzu Album',
        skipExisting: true,
        uploadMetadata: true,
      },
      secrets: {},
    });
    assert.equal(second.ok, true);
    assert.equal(second.uploaded, 0);
    assert.equal(second.skipped, 3);

    const forced = await runCloudSync({
      root,
      album,
      settings: {
        provider: '123pan-folder',
        folderRoot: syncDir,
        baseFolder: 'Hoshikuzu Album',
        skipExisting: true,
        uploadMetadata: false,
      },
      secrets: {},
      full: true,
    });
    assert.equal(forced.uploaded, 3);
    assert.equal(formatBytes(1024), '1.0 KB');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('website sync posts album data with inlined previews', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-web-sync-'));
  const root = path.join(base, 'library');
  const previewDir = path.join(root, '缩略图缓存');
  await fs.mkdir(previewDir, { recursive: true });
  const previewName = `${'d'.repeat(40)}_1600_q82.webp`;
  const previewBuffer = Buffer.from('fake-webp-preview');
  await fs.writeFile(path.join(previewDir, previewName), previewBuffer);

  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body,
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, message: 'stored' }));
  });
  const endpoint = `${await listen(server)}/api/hoshikuzu/sync`;
  try {
    const probe = await testWebsiteConnection({
      settings: { endpoint, libraryId: 'lib_1', libraryName: '测试库' },
      token: 'secret-token',
    });
    assert.equal(probe.ok, true);
    assert.equal(JSON.parse(requests[0].body).kind, 'probe');
    assert.equal(requests[0].headers.authorization, 'Bearer secret-token');

    const album = albumWith([
      {
        id: 'p1',
        src: '',
        mediaKind: 'library',
        libraryPath: 'photos/a.png',
        previewPath: previewName,
        capturedAt: '2024-05-01T10:00:00Z',
        contentHash: 'd'.repeat(40),
        note: '晚霞',
        worldLookup: 'none',
        createdAt: '2024-05-01T10:00:00Z',
      },
      {
        id: 'sample',
        src: 'data:image/png;base64,AAAA',
        isSample: true,
        capturedAt: '2024-01-01T00:00:00Z',
        contentHash: '',
        note: '',
        worldLookup: 'none',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);
    const result = await runWebsiteSync({
      root,
      album,
      settings: {
        endpoint,
        includePreviewImages: true,
        maxPayloadMb: 10,
      },
      token: 'secret-token',
      previewDir,
    });
    assert.equal(result.ok, true);
    assert.equal(result.photos, 1);
    assert.equal(result.previews, 1);
    const payload = JSON.parse(requests[1].body);
    assert.equal(requests[1].headers.authorization, 'Bearer secret-token');
    assert.equal(payload.format, 'hoshikuzu-album-sync');
    assert.equal(payload.kind, 'album');
    assert.equal(payload.album.photos.length, 1);
    const photo = payload.album.photos[0];
    assert.equal(photo.mediaKind, 'embedded');
    assert.equal(photo.libraryPath, undefined);
    assert.equal(photo.previewPath, undefined);
    assert.ok(photo.src.startsWith('data:image/webp;base64,'));
    assert.equal(
      Buffer.from(photo.src.split(',')[1], 'base64').toString('utf8'),
      previewBuffer.toString('utf8'),
    );
    assert.equal(photo.note, '晚霞');
  } finally {
    await close(server);
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('webdav sync creates date folders and PUTs originals', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-dav-'));
  const root = path.join(base, 'library');
  await fs.mkdir(root, { recursive: true });
  const puts = [];
  const mkcols = [];
  const auth = `Basic ${Buffer.from('user:pass', 'utf8').toString('base64')}`;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.headers.authorization !== auth) {
      response.writeHead(401);
      response.end('unauthorized');
      return;
    }
    if (request.method === 'PROPFIND') {
      response.writeHead(207);
      response.end('<?xml version="1.0"?><multistatus xmlns="DAV:"/>');
      return;
    }
    if (request.method === 'MKCOL') {
      mkcols.push(request.url);
      response.writeHead(201);
      response.end();
      return;
    }
    if (request.method === 'PUT') {
      puts.push({ url: request.url, body: Buffer.concat(chunks) });
      response.writeHead(201);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const serverUrl = await listen(server);
  try {
    const image = await makePhoto(root, 'photos/a.png', '#aa8833');
    const album = albumWith([
      {
        id: 'p1',
        src: '',
        mediaKind: 'library',
        libraryPath: 'photos/a.png',
        capturedAt: '2024-05-01T10:00:00Z',
        contentHash: 'e'.repeat(40),
        note: '',
        worldLookup: 'none',
        createdAt: '2024-05-01T10:00:00Z',
      },
    ]);
    const result = await runCloudSync({
      root,
      album,
      settings: {
        provider: 'webdav',
        webdavUrl: `${serverUrl}/dav/`,
        webdavUsername: 'user',
        baseFolder: 'Hoshikuzu Album',
        skipExisting: true,
        uploadMetadata: false,
      },
      secrets: { webdavPassword: 'pass' },
    });
    assert.equal(result.ok, true);
    assert.equal(result.uploaded, 1);
    assert.ok(mkcols.some((url) => url.includes('/dav/Hoshikuzu%20Album/2024-05-01/')));
    const photoPut = puts.find((item) => item.url.includes('/2024-05-01/a.png'));
    assert.ok(photoPut);
    assert.deepEqual(photoPut.body, image);
    assert.deepEqual(await fs.readFile(path.join(root, 'photos/a.png')), image);
  } finally {
    await close(server);
    await fs.rm(base, { recursive: true, force: true });
  }
});
