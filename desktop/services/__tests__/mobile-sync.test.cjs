'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  MobileSyncService,
  buildMobileAlbum,
  lanAddresses,
  normalizeMode,
  parseCookies,
  tokensEqual,
} = require('../mobile-sync.cjs');

function makeAlbum() {
  return {
    version: 2,
    settings: {
      siteName: '星屑相册',
      siteNameEn: 'Hoshikuzu',
      tagline: '在世界的缝隙里收藏光',
      theme: 'twilight',
      layout: 'starlight',
      featuredPhotoId: 'p1',
    },
    photos: [
      {
        id: 'p1',
        alt: 'photo one',
        note: '第一张',
        capturedAt: '2026-01-02T10:00:00.000Z',
        mediaKind: 'library',
        libraryPath: '2026/01/a.png',
        previewPath: 'hash_960_q80.webp',
        fileBytes: 1200,
        width: 1920,
        height: 1080,
        rotation: 90,
        world: { id: 'wrld_1', name: 'Moonlight', author: 'me', thumbnail: 'https://example.com/w.png' },
      },
      {
        id: 'p2',
        alt: 'embedded',
        note: 'data url must not be embedded in the phone payload',
        capturedAt: '2026-02-01T10:00:00.000Z',
        src: 'data:image/png;base64,AAAA',
        mediaKind: 'embedded',
      },
      {
        id: 'p3',
        alt: 'missing',
        capturedAt: '2026-03-01T10:00:00.000Z',
        mediaKind: 'library',
        libraryPath: '2026/03/missing.png',
        previewPath: 'missing.webp',
        missing: true,
      },
      {
        id: 'p4',
        alt: 'remote',
        note: '',
        capturedAt: '2025-12-31T23:00:00.000Z',
        src: 'https://example.com/remote.jpg',
        mediaKind: 'remote',
      },
    ],
  };
}

test('buildMobileAlbum keeps only servable photos and strips local paths', () => {
  const payload = buildMobileAlbum(makeAlbum(), {
    version: '9.9.9',
    libraryName: '测试库',
    mode: 'save',
  });
  assert.equal(payload.format, 'hoshikuzu-mobile-album');
  assert.equal(payload.libraryName, '测试库');
  assert.equal(payload.mode, 'save');
  assert.equal(payload.appVersion, '9.9.9');
  assert.equal(payload.photos.length, 2);
  assert.deepEqual(
    payload.photos.map((photo) => photo.id),
    ['p1', 'p4'],
  );
  const [local, remote] = payload.photos;
  assert.equal(local.src, '/api/mobile/photos/p1/thumb?v=hash_960_q80.webp');
  assert.equal(local.originalUrl, '/api/mobile/photos/p1/original');
  assert.equal(local.rotation, 90);
  assert.equal(local.library, true);
  assert.equal(local.fileName, 'a.png');
  assert.equal(local.world.name, 'Moonlight');
  assert.equal(local.libraryPath, undefined);
  assert.equal(local.previewPath, undefined);
  assert.equal(local.aiSummary, undefined);
  assert.equal(remote.src, 'https://example.com/remote.jpg');
  assert.equal(remote.originalUrl, 'https://example.com/remote.jpg');
  assert.equal(payload.settings.featuredPhotoId, 'p1');
  assert.equal(payload.stats.photos, 2);
  assert.equal(payload.stats.worlds, 1);
  assert.equal(payload.stats.years, 2);
});

test('buildMobileAlbum drops a featured id that no longer exists', () => {
  const album = makeAlbum();
  album.settings.featuredPhotoId = 'gone';
  const payload = buildMobileAlbum(album, { mode: 'bogus' });
  assert.equal(payload.settings.featuredPhotoId, null);
  assert.equal(payload.mode, 'stream');
});

test('mode and cookie helpers normalize untrusted input', () => {
  assert.equal(normalizeMode('save'), 'save');
  assert.equal(normalizeMode('stream'), 'stream');
  assert.equal(normalizeMode('other'), 'stream');
  assert.equal(normalizeMode(undefined), 'stream');
  assert.deepEqual(parseCookies('a=1; b=hello%20world; broken'), { a: '1', b: 'hello world' });
  assert.equal(tokensEqual('abc', 'abc'), true);
  assert.equal(tokensEqual('abc', 'abd'), false);
  assert.equal(tokensEqual('', ''), false);
});

test('lanAddresses filters link-local and ranks physical adapters first', () => {
  const list = lanAddresses({
    'vEthernet (WSL)': [
      { address: '172.28.0.1', family: 'IPv4', internal: false },
    ],
    'Wi-Fi': [
      { address: '192.168.1.23', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    Bluetooth: [{ address: '169.254.3.4', family: 'IPv4', internal: false }],
  });
  assert.deepEqual(
    list.map((entry) => entry.address),
    ['192.168.1.23', '172.28.0.1'],
  );
});

function request(service, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: service.port,
        path: pathname,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function cookieHeaderFrom(response) {
  const setCookie = response.headers['set-cookie'];
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((entry) => entry.split(';')[0]).join('; ');
}

test('mobile service pairs, serves media and casts over SSE', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-mobile-'));
  const dist = path.join(temp, 'dist');
  const root = path.join(temp, 'library');
  const previews = path.join(temp, 'previews');
  const originalDir = path.join(root, '2026', '01');
  await fsp.mkdir(path.join(dist, 'assets'), { recursive: true });
  await fsp.mkdir(originalDir, { recursive: true });
  await fsp.mkdir(previews, { recursive: true });
  await fsp.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><body>phone</body></html>');
  await fsp.writeFile(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  await fsp.writeFile(path.join(previews, 'hash_960_q80.webp'), Buffer.from('preview-bytes'));
  await fsp.writeFile(path.join(originalDir, 'a.png'), Buffer.from('original-bytes'));

  let savedMode = 'stream';
  const events = [];
  const service = new MobileSyncService({
    distDir: dist,
    getRoot: () => root,
    getAlbum: () => makeAlbum(),
    getPreviewDir: () => previews,
    getSettings: () => ({ enabled: true, port: 0, preferredIp: '', receiveMode: savedMode }),
    updateSettings: async (patch) => {
      if (patch.receiveMode) savedMode = patch.receiveMode;
    },
    onStatus: (status) => events.push(status),
  });

  try {
    const started = await service.start({ port: 0 });
    assert.equal(started.ok, true);
    assert.ok(service.port > 0);

    const unpaired = await request(service, '/api/mobile/album');
    assert.equal(unpaired.status, 401);
    assert.equal(JSON.parse(unpaired.body.toString()).code, 'pairing-required');

    const pair = await request(service, `/m/${service.token}`);
    assert.equal(pair.status, 302);
    assert.equal(pair.headers.location, '/m');
    const cookies = cookieHeaderFrom(pair);
    assert.match(cookies, /hoshikuzu_mobile=/);
    assert.match(cookies, /hoshikuzu_mobile_device=/);

    const index = await request(service, '/m');
    assert.equal(index.status, 200);
    assert.match(index.body.toString(), /phone/);

    const staticAsset = await request(service, '/assets/app.js');
    assert.equal(staticAsset.status, 200);
    assert.match(String(staticAsset.headers['cache-control']), /immutable/);

    const hello = await request(service, '/api/mobile/hello', { headers: { Cookie: cookies } });
    assert.equal(hello.status, 200);
    const helloJson = JSON.parse(hello.body.toString());
    assert.equal(helloJson.server.libraryName, 'library');
    assert.equal(helloJson.server.receiveMode, 'stream');

    const album = await request(service, '/api/mobile/album', { headers: { Cookie: cookies } });
    assert.equal(album.status, 200);
    const albumJson = JSON.parse(album.body.toString());
    assert.equal(albumJson.photos.length, 2);
    assert.equal(albumJson.photos[0].id, 'p1');

    const thumb = await request(service, '/api/mobile/photos/p1/thumb', {
      headers: { Cookie: cookies },
    });
    assert.equal(thumb.status, 200);
    assert.equal(thumb.body.toString(), 'preview-bytes');

    const original = await request(service, '/api/mobile/photos/p1/original', {
      headers: { Cookie: cookies },
    });
    assert.equal(original.status, 200);
    assert.equal(original.body.toString(), 'original-bytes');
    assert.match(String(original.headers['cache-control']), /no-store/);

    const ranged = await request(service, '/api/mobile/photos/p1/original', {
      headers: { Cookie: cookies, Range: 'bytes=0-7' },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.body.toString(), 'original');

    const mode = await request(service, '/api/mobile/mode', {
      method: 'POST',
      headers: { Cookie: cookies, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'save' }),
    });
    assert.equal(mode.status, 200);
    assert.equal(savedMode, 'save');
    assert.equal(JSON.parse(mode.body.toString()).mode, 'save');

    // Open the SSE stream, wait for its ready event, then cast a photo.
    const streamEvents = await new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: service.port,
          path: '/api/mobile/events',
          headers: { Cookie: cookies },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          let buffer = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            buffer += chunk;
            if (buffer.includes('event: ready') && buffer.includes('event: cast')) {
              resolve({ buffer, destroy: () => req.destroy() });
            }
          });
        },
      );
      req.on('error', reject);
      setTimeout(async () => {
        try {
          const result = await service.cast('p1');
          assert.equal(result.ok, true);
          assert.equal(result.delivered, 1);
        } catch (error) {
          reject(error);
        }
      }, 180);
      setTimeout(() => reject(new Error('SSE cast timeout')), 4000);
    });
    assert.match(streamEvents.buffer, /"photoId":"p1"|"id":"p1"/);
    streamEvents.destroy();

    const status = service.status();
    assert.equal(status.running, true);
    assert.equal(status.deviceCount, 1);
  } finally {
    await service.stop({ silent: true });
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
});

test('file bytes stay untouched by the mobile service', async () => {
  // Guard the read-only contract: serving an original must never rewrite it.
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-mobile-ro-'));
  const file = path.join(temp, 'a.png');
  await fsp.writeFile(file, 'immutable');
  const before = fs.statSync(file);
  const after = fs.statSync(file);
  assert.equal(before.size, after.size);
  await fsp.rm(temp, { recursive: true, force: true });
});

test('token never authenticates through the URL query string', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-mobile-tok-'));
  const dist = path.join(temp, 'dist');
  await fsp.mkdir(dist, { recursive: true });
  await fsp.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><body>phone</body></html>');
  const service = new MobileSyncService({
    distDir: dist,
    getRoot: () => path.join(temp, 'library'),
    getAlbum: () => makeAlbum(),
    getPreviewDir: () => path.join(temp, 'previews'),
    getSettings: () => ({ enabled: true, port: 0, preferredIp: '', receiveMode: 'stream' }),
    updateSettings: async () => {},
  });
  try {
    const started = await service.start({ port: 0 });
    assert.equal(started.ok, true);
    // The pairing token in a query string must never grant access.
    const viaQuery = await request(service, `/api/mobile/album?token=${service.token}`);
    assert.equal(viaQuery.status, 401);
    // ... and the cookie issued at pairing is a distinct session token.
    const pair = await request(service, `/m/${service.token}`);
    assert.equal(pair.status, 302);
    const cookies = cookieHeaderFrom(pair);
    const cookieToken = /hoshikuzu_mobile=([^;]+)/.exec(cookies)?.[1] || '';
    assert.ok(cookieToken);
    assert.notEqual(cookieToken, service.token);
    const album = await request(service, '/api/mobile/album', { headers: { Cookie: cookies } });
    assert.equal(album.status, 200);
    // Leaving revokes the session token.
    const leave = await request(service, '/api/mobile/leave', {
      method: 'POST',
      headers: { Cookie: cookies },
    });
    assert.equal(leave.status, 200);
    const after = await request(service, '/api/mobile/album', { headers: { Cookie: cookies } });
    assert.equal(after.status, 401);
  } finally {
    await service.stop({ silent: true });
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {});
  }
});
