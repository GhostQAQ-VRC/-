'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const shotDir = path.join(__dirname, 'shots');
fs.mkdirSync(shotDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/media/preview/test.png' || url.pathname === '/media/original/test.png') {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    fs.createReadStream(path.join(root, 'build', 'icon.png')).pipe(res);
    return;
  }
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const absolute = path.resolve(dist, relative);
  if (!absolute.startsWith(path.resolve(dist))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const file = fs.existsSync(absolute) && fs.statSync(absolute).isFile()
    ? absolute
    : path.join(dist, 'index.html');
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
});

ipcMain.on('mock-http', (event, callbackId, requestJson) => {
  let status = 200;
  let body = {};
  try {
    const request = JSON.parse(requestJson || '{}');
    const url = String(request.url || '');
    const method = String(request.method || 'GET').toUpperCase();
    if (url.includes('/models')) {
      body = { data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] };
    } else if (url.includes('/chat/completions')) {
      body = {
        choices: [
          { message: { content: '{"summary":"测试回忆","tags":["星轨","月光"]}' } },
        ],
      };
    } else if (url.includes('/api/chat')) {
      body = { message: { content: '{"summary":"测试回忆","tags":["星轨"]}' } };
    } else if (url.includes('/website')) {
      body = { ok: true, message: '网站可访问' };
    } else if (method === 'OPTIONS') {
      status = 207;
    }
  } catch {
    status = 500;
    body = { error: 'mock failure' };
  }
  const response = JSON.stringify({
    ok: status < 400,
    status,
    headers: {},
    body: JSON.stringify(body),
  });
  event.sender
    .executeJavaScript(
      `window.__hoshikuzuMobileHttpResult(${JSON.stringify(callbackId)}, ${JSON.stringify(response)})`,
    )
    .catch(() => {});
});

ipcMain.on('mock-pick', (event, callbackId) => {
  const draft = {
    src: '',
    alt: '手机测试照片.png',
    capturedAt: new Date().toISOString(),
    width: 512,
    height: 512,
    fileBytes: 132000,
    contentHash: 'smoke-mobile-photo',
    libraryPath: 'test.png',
    previewPath: 'test.png',
    metaSource: 'filename',
    managedCopy: true,
  };
  const payload = JSON.stringify({
    ok: true,
    canceled: false,
    drafts: [draft],
    errors: [],
  });
  const script = `window.__hoshikuzuMobilePickResult(${JSON.stringify(callbackId)}, ${JSON.stringify(payload)})`;
  event.sender.executeJavaScript(script).catch(() => {});
});

app.whenReady().then(async () => {
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  process.env.MOBILE_PREVIEW_PORT = String(port);
  const win = new BrowserWindow({
    width: 390,
    height: 844,
    show: true,
    backgroundColor: '#05040c',
    webPreferences: {
      preload: path.join(__dirname, 'mobile-preview-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/mobile-client.html`);
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const bridge = window.hoshikuzu && window.hoshikuzu.desktop;
    const draftResult = bridge ? await bridge.media.pickAndImport() : null;
    const draft = draftResult && draftResult.drafts && draftResult.drafts[0];
    let mediaStatus = 0;
    if (draft && draft.previewPath) {
      try {
        const response = await fetch(
          window.__HOSHIKUZU_MOBILE_MEDIA_BASE__ + '/preview/' + draft.previewPath,
        );
        mediaStatus = response.status;
      } catch (error) {
        mediaStatus = -1;
      }
    }
    const ai = bridge ? await bridge.ai.getConfig() : null;
    const sync = bridge ? await bridge.sync.getConfig() : null;
    return {
      bridge: Boolean(bridge),
      version: bridge && bridge.version,
      app: Boolean(document.querySelector('.app')),
      desktopChrome: Boolean(document.querySelector('.desktop-titlebar, .titlebar')),
      connectButton: Boolean(document.querySelector('.header-connect')),
      mobileFlag: document.documentElement.dataset.mobile,
      empty: Boolean(document.querySelector('.empty-state')),
      headerName: document.querySelector('.brand__name')?.textContent || '',
      drafts: draftResult && draftResult.drafts ? draftResult.drafts.length : 0,
      mediaStatus,
      aiProtocol: ai && ai.protocol,
      syncProviders: sync && sync.providers ? sync.providers.length : 0,
    };
  })()`).catch((error) => ({ error: error.message }));

  const services = await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const bridge = window.hoshikuzu.desktop;
    await bridge.ai.setConfig({
      protocol: 'openai',
      baseUrl: 'https://mock.local/v1',
      primaryModel: 'gpt-4o',
      backupModel: '',
      apiKey: 'mock-key',
    });
    const tested = await bridge.ai.test({
      protocol: 'openai',
      baseUrl: 'https://mock.local/v1',
      apiKey: 'mock-key',
    });
    const models = await bridge.ai.listModels({
      protocol: 'openai',
      baseUrl: 'https://mock.local/v1',
      apiKey: 'mock-key',
    });
    const generated = await bridge.ai.generate({
      item: {
        id: 'smoke-photo',
        previewPath: 'test.png',
        libraryPath: 'test.png',
      },
      context: { capturedAt: new Date().toISOString() },
    });
    let batchDone = null;
    const off = bridge.ai.onBatchDone((summary) => {
      batchDone = summary;
    });
    const batch = await bridge.ai.startBatch({
      items: [{ id: 'smoke-photo', previewPath: 'test.png', libraryPath: 'test.png' }],
      mode: 'summary',
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(150);
      if (batchDone) break;
    }
    off && off();
    await bridge.sync.setConfig({
      website: {
        endpoint: 'https://mock.local/website',
        includePreviewImages: true,
        maxPayloadMb: 80,
      },
    });
    const websiteTest = await bridge.sync.test({ target: 'website' });
    let websiteDone = null;
    const offDone = bridge.sync.onDone((result) => {
      websiteDone = result;
    });
    const websiteStart = await bridge.sync.start({
      target: 'website',
      album: {
        version: 2,
        photos: [],
        worlds: [],
        settings: {},
        activity: [],
        updatedAt: new Date().toISOString(),
      },
    });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(150);
      if (websiteDone) break;
    }
    offDone && offDone();
    await bridge.sync.setConfig({
      cloud: {
        provider: 'webdav',
        webdavUrl: 'https://mock.local/dav',
        webdavUsername: 'mock',
        webdavPassword: 'mock-pass',
        baseFolder: 'Hoshikuzu Album',
        skipExisting: false,
      },
    });
    const cloudTest = await bridge.sync.test({ target: 'cloud' });
    const albumJson = bridge.album.loadSync();
    const albumData = albumJson && albumJson.json ? JSON.parse(albumJson.json) : null;
    let cloudDone = null;
    const offCloud = bridge.sync.onDone((result) => {
      cloudDone = result;
    });
    const cloudStart = albumData
      ? await bridge.sync.start({ target: 'cloud', album: albumData })
      : null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await wait(150);
      if (cloudDone) break;
    }
    offCloud && offCloud();
    return {
      aiTest: tested,
      models: models && models.models ? models.models.length : 0,
      generated,
      batch,
      batchDone,
      websiteTest,
      websiteStart: typeof websiteStart === 'object' ? websiteStart : websiteStart,
      websiteDone,
      cloudTest,
      cloudStart,
      cloudDone,
    };
  })()`).catch((error) => ({ error: error.message }));
  console.log('[mobile-preview] services', services);
  console.log('[mobile-preview]', result);
  const imported = await win.webContents.executeJavaScript(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('.header-upload')?.click();
    await wait(500);
    const pick = document.querySelector('.upload-desktop button');
    pick?.click();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await wait(150);
      if (document.querySelector('.photo-card')) break;
    }
    const card = document.querySelector('.photo-card');
    const cardImage = card?.querySelector('img');
    document.querySelector('.photo-card__hit')?.click();
    await wait(700);
    const detailImage = document.querySelector('.detail-media img');
    document.querySelector('.photo-detail .modal-close')?.click();
    await wait(400);
    return {
      cards: document.querySelectorAll('.photo-card').length,
      cardImageWidth: cardImage?.naturalWidth || 0,
      detailImageWidth: detailImage?.naturalWidth || 0,
      cardNote: document.querySelector('.photo-card__note')?.textContent?.trim() || '',
    };
  })()`).catch((error) => ({ error: error.message }));
  console.log('[mobile-preview] imported', imported);
  const importedImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shotDir, 'mobile-parity-imported.png'), importedImage.toPNG());

  await win.webContents.reload();
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const persisted = await win.webContents.executeJavaScript(`(() => ({
    cards: document.querySelectorAll('.photo-card').length,
    imageWidth: document.querySelector('.photo-card img')?.naturalWidth || 0,
    title: document.querySelector('.brand__name')?.textContent || '',
  }))()`).catch((error) => ({ error: error.message }));
  console.log('[mobile-preview] persisted', persisted);

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shotDir, 'mobile-parity-home.png'), image.toPNG());
  console.log('[mobile-preview] wrote', path.join(shotDir, 'mobile-parity-home.png'));
  await win.close();
  server.close();
  app.quit();
});
