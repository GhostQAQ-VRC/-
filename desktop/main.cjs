'use strict';

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  screen,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');

const config = require('./config.cjs');
const constants = require('./library/constants.cjs');
const repository = require('./library/repository.cjs');
const scanLib = require('./library/scan.cjs');
const previewLib = require('./library/preview.cjs');
const ingest = require('./library/ingest.cjs');
const backupLib = require('./library/backup.cjs');
const { createAdvancedServices } = require('./ipc/advanced.cjs');
const { createSyncService } = require('./services/sync.cjs');
const { createNetworkService } = require('./ipc/network.cjs');

const isSmoke = process.env.HOSHIKUZU_SMOKE === '1';
const smokeNoLibrary = process.env.HOSHIKUZU_SMOKE_NO_LIBRARY === '1';
const smokeThumbs = process.env.HOSHIKUZU_SMOKE_THUMBS === '1';
const isDev = Boolean(process.env.HOSHIKUZU_DEV_URL);
const PROGRAM_NAME = 'VRchat时间轴纪念相册';
const DEV_URL = process.env.HOSHIKUZU_DEV_URL || '';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const APP_HOST = 'hoshikuzu';
const BACKGROUND_FILE_PATTERN = /^[0-9a-f]{40}\.(webm|mp4)$/;

if (isSmoke && process.env.HOSHIKUZU_SMOKE_DIR) {
  app.setPath('userData', process.env.HOSHIKUZU_SMOKE_DIR);
} else if (!isSmoke) {
  // Pin the existing data directory even though the user-facing product name
  // changed. This keeps window state, library path and secrets intact.
  app.setPath('userData', path.join(app.getPath('appData'), 'hoshikuzu-album'));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  {
    scheme: 'hoshikuzu-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow = null;
let currentLibraryRoot = null;
let currentPreviewDir = null;
let previewQueue = null;
let pendingAlbumJson = null;
let saveTimer = null;
let activeScan = null;
let scanCancelFlag = false;
let quitting = false;
let advancedServices = null;
let syncService = null;
let networkService = null;
let sampleTempDir = null;
let previewReadyBuffer = [];
let previewReadyTimer = null;
let previewProgressAt = 0;

function flushPreviewReady() {
  if (previewReadyBuffer.length === 0) return;
  const batch = previewReadyBuffer;
  previewReadyBuffer = [];
  broadcast('library:preview-ready', batch);
}

function resetPreviewBroadcasts() {
  if (previewReadyTimer) {
    clearTimeout(previewReadyTimer);
    previewReadyTimer = null;
  }
  previewReadyBuffer = [];
  previewProgressAt = 0;
}

function queuePreviewReady(payload) {
  previewReadyBuffer.push(payload);
  if (previewReadyTimer) return;
  previewReadyTimer = setTimeout(() => {
    previewReadyTimer = null;
    flushPreviewReady();
  }, 180);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function configuredPath() {
  const cfg = config.readConfigSync();
  return typeof cfg.libraryPath === 'string' && cfg.libraryPath ? cfg.libraryPath : null;
}

async function isDirectory(target) {
  try {
    const stat = await fsp.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function isDirectorySync(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function getAvailableRoot() {
  const target = configuredPath();
  if (!target || !isDirectorySync(target)) return null;
  return target;
}

async function refreshPreviewQueue(root) {
  if (previewQueue) previewQueue.clear();
  resetPreviewBroadcasts();
  if (!root) {
    previewQueue = null;
    currentPreviewDir = null;
    return;
  }
  const wrapper = await repository.readLibrary(root);
  const previewOptions = repository.previewOptionsFor(wrapper);
  currentPreviewDir = repository.previewDir(root, wrapper);
  previewQueue = new previewLib.PreviewQueue({
    previewDir: currentPreviewDir,
    maxEdge: previewOptions.previewMaxEdge,
    quality: previewOptions.previewQuality,
    // Keep background generation gentle: a smooth scroll matters more than
    // finishing a huge library a few seconds sooner.
    concurrency: Math.max(1, Math.min(2, Math.floor(os.cpus().length / 8))),
    onReady: (payload) => queuePreviewReady(payload),
    onProgress: (payload) => {
      const now = Date.now();
      const finished =
        payload.total > 0 && payload.done + payload.failed >= payload.total && payload.pending === 0;
      if (finished || now - previewProgressAt > 180) {
        previewProgressAt = now;
        if (finished) flushPreviewReady();
        broadcast('library:preview-progress', payload);
      }
    },
    onError: (payload) => broadcast('library:preview-error', payload),
  });
}

async function currentConfig() {
  const cfg = await config.readConfig();
  const root = cfg.libraryPath;
  const base = {
    configured: false,
    libraryPath: root || null,
    libraryName: null,
    libraryId: null,
    previewPreset: constants.DEFAULT_THUMBNAIL_PRESET_ID,
    previewMaxEdge: constants.DEFAULT_PREVIEW_MAX_EDGE,
    previewQuality: constants.DEFAULT_PREVIEW_QUALITY,
    thumbnailDir: constants.DEFAULT_THUMBNAIL_DIR,
    thumbnailDirPath: root ? path.join(root, constants.DEFAULT_THUMBNAIL_DIR) : null,
    thumbnailsConfigured: false,
    imageLoadingMode: constants.DEFAULT_IMAGE_LOADING_MODE,
    autoScan: true,
    watch: false,
    onboardingDismissed: cfg.onboardingDismissed === true,
    unavailable: false,
  };

  if (!root) return base;
  if (!(await isDirectory(root))) return { ...base, unavailable: true };

  let wrapper = await repository.readLibrary(root);
  if (!wrapper) {
    wrapper = await repository.ensureLibrary(root, { name: path.basename(root) });
  }
  currentLibraryRoot = root;
  currentPreviewDir = repository.previewDir(root, wrapper);
  return repository.getLibraryConfig(root, wrapper, {
    onboardingDismissed: cfg.onboardingDismissed === true,
  });
}

function mimeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
  };
  return map[extension] || 'application/octet-stream';
}

function encodeRelative(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function serveFile(request, absolutePath, options = {}) {
  const stat = await fsp.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) {
    return new Response('Not found', { status: 404 });
  }

  const headers = {
    'content-type': mimeFor(absolutePath),
    'accept-ranges': 'bytes',
    // Content-addressed thumbnails never change; letting Chromium keep the
    // decoded bytes makes scrolling back through a large library instant.
    'cache-control': options.immutable
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: { ...headers, 'content-length': String(stat.size) },
    });
  }

  const range = request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
        const safeEnd = Math.min(end, stat.size - 1);
        const stream = fs.createReadStream(absolutePath, { start, end: safeEnd });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            ...headers,
            'content-length': String(safeEnd - start + 1),
            'content-range': `bytes ${start}-${safeEnd}/${stat.size}`,
          },
        });
      }
    }
  }

  const stream = fs.createReadStream(absolutePath);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: { ...headers, 'content-length': String(stat.size) },
  });
}

function registerProtocols() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host && url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 });
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relative) relative = 'index.html';

    const absolute = path.resolve(DIST_DIR, relative);
    const within = path.relative(DIST_DIR, absolute);
    if (within.startsWith('..') || path.isAbsolute(within)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      // Vite hashes every asset name, so those bytes never change.
      return serveFile(request, absolute, { immutable: relative.startsWith('assets/') });
    }
    // Hash routing needs no fallback, but a direct asset miss should not break
    // the app shell either.
    return serveFile(request, path.join(DIST_DIR, 'index.html'));
  });

  protocol.handle('hoshikuzu-media', async (request) => {
    const root = currentLibraryRoot || getAvailableRoot();
    if (!root) return new Response('Library unavailable', { status: 404 });

    const url = new URL(request.url);
    const kind = url.host;
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');

    if (kind === 'preview') {
      const name = path.basename(relative);
      if (!constants.PREVIEW_FILE_PATTERN.test(name)) {
        return new Response('Invalid preview', { status: 400 });
      }
      const previewDir =
        currentPreviewDir || repository.previewDir(root, await repository.readLibrary(root));
      return serveFile(request, path.join(previewDir, name), { immutable: true });
    }

    if (kind === 'sample') {
      const name = path.basename(relative);
      if (
        !sampleTempDir ||
        !/^[0-9a-f]{12}-(feather|swift|balanced|clear|lush)\.webp$/.test(name)
      ) {
        return new Response('Invalid sample', { status: 400 });
      }
      return serveFile(request, path.join(sampleTempDir, name), { immutable: true });
    }

    if (kind === 'background') {
      const name = path.basename(relative);
      if (!BACKGROUND_FILE_PATTERN.test(name)) {
        return new Response('Invalid background', { status: 400 });
      }
      return serveFile(
        request,
        path.join(root, '.hoshikuzu', 'backgrounds', name),
        { immutable: true },
      );
    }

    if (kind === 'original') {
      const absolute = repository.resolveInside(root, relative);
      if (!absolute) return new Response('Forbidden', { status: 403 });
      return serveFile(request, absolute);
    }

    return new Response('Not found', { status: 404 });
  });
}

function restoreWindowOptions(cfg) {
  const state = cfg.window || {};
  const width = Number.isFinite(state.width) ? Math.max(960, state.width) : 1360;
  const height = Number.isFinite(state.height) ? Math.max(640, state.height) : 900;
  const options = {
    width,
    height,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0b0918',
    title: PROGRAM_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  };

  if (Number.isInteger(state.x) && Number.isInteger(state.y)) {
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (
        state.x < area.x + area.width &&
        state.x + width > area.x &&
        state.y < area.y + area.height &&
        state.y + height > area.y
      );
    });
    if (visible) {
      options.x = state.x;
      options.y = state.y;
    }
  }
  return options;
}

function trackWindowState(win) {
  let timer = null;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      if (!win || win.isDestroyed()) return;
      const bounds = win.getNormalBounds();
      try {
        await config.writeConfig({
          window: { ...bounds, maximized: win.isMaximized() },
        });
      } catch {
        // Window state is a convenience; never surface it as an error.
      }
    }, 400);
  };

  win.on('resize', persist);
  win.on('move', persist);
  win.on('maximize', persist);
  win.on('unmaximize', persist);
}

async function createWindow() {
  const cfg = await config.readConfig();
  mainWindow = new BrowserWindow(restoreWindowOptions(cfg));
  trackWindowState(mainWindow);

  const emitMaximized = () =>
    broadcast('window:maximized-changed', mainWindow ? mainWindow.isMaximized() : false);
  mainWindow.on('maximize', emitMaximized);
  mainWindow.on('unmaximize', emitMaximized);

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.show();
    if (cfg.window && cfg.window.maximized) mainWindow.maximize();
  });

  const contents = mainWindow.webContents;
  contents.on('console-message', (_event, ...args) => {
    const details = args[0];
    if (details && typeof details === 'object' && 'message' in details) {
      if (details.level === 'warning' || details.level === 'error') {
        console.log(`[renderer:${details.level}]`, details.message);
      }
      return;
    }
    // Electron < 30 signature: (event, level, message, line, sourceId)
    if (typeof args[0] === 'number' && args[0] >= 2) {
      console.log('[renderer]', args[1]);
    }
  });
  if (isDev) {
    contents.on('did-finish-load', async () => {
      try {
        const info = await contents.executeJavaScript(`({
          titlebar: Boolean(document.querySelector('.titlebar')),
          libraryGate: Boolean(document.querySelector('.library-gate')),
          rootChildren: document.getElementById('root')?.childElementCount ?? 0,
          desktop: document.documentElement.dataset.desktop ?? null,
        })`);
        console.log('[desktop:dev] renderer ready', info);
      } catch (error) {
        console.log('[desktop:dev] renderer check failed', error.message);
      }
    });
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith(`app://${APP_HOST}/`);
    if (allowed) return;
    event.preventDefault();
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
  });

  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    await mainWindow.loadURL(`app://${APP_HOST}/index.html`);
  }

  if (isSmoke) {
    void runSmokeTest(mainWindow).catch((error) => {
      console.error('[desktop:smoke] failed', error);
      app.exit(1);
    });
  } else if (process.env.HOSHIKUZU_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendCommand(command) {
  const target = BrowserWindow.getFocusedWindow() || mainWindow;
  if (target && !target.isDestroyed()) target.webContents.send('app:command', command);
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '选择存储库…', click: () => sendCommand('choose-library') },
        { label: '扫描存储库', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendCommand('scan-library') },
        { label: '导入照片…', accelerator: 'CmdOrCtrl+O', click: () => sendCommand('import-photos') },
        { type: 'separator' },
        { label: '导出元数据备份…', click: () => sendCommand('export-metadata') },
        { label: '导出完整库备份…', click: () => sendCommand('export-full') },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '打开存储库文件夹', click: () => sendCommand('open-library-folder') },
        { label: '打开设置', click: () => sendCommand('open-settings') },
        { type: 'separator' },
        {
          label: '关于 VRchat时间轴纪念相册',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: '关于 VRchat时间轴纪念相册',
              message: 'VRchat时间轴纪念相册 · 本地客户端',
              detail: `版本 ${app.getVersion()}\nElectron ${process.versions.electron}\n本地优先，照片留在你自己的存储库里。`,
              buttons: ['好的'],
            });
          },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function scheduleSave(root) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSave(root);
  }, 300);
}

async function flushSave(root) {
  const album = pendingAlbumJson;
  pendingAlbumJson = null;
  if (!album) return;
  if (!root || !(await isDirectory(root))) {
    broadcast('album:save-error', { message: '存储库不可用，修改尚未写入磁盘。' });
    return;
  }
  try {
    await repository.updateAlbum(root, album);
  } catch (error) {
    broadcast('album:save-error', {
      message: `写入存储库失败：${error && error.message ? error.message : '未知错误'}`,
    });
  }
}

function flushSaveSync() {
  if (!pendingAlbumJson) return;
  const root = configuredPath();
  if (!root || !isDirectorySync(root)) return;
  try {
    const wrapper =
      repository.readLibrarySync(root) ||
      repository.createLibraryWrapper(root, path.basename(root));
    wrapper.album = pendingAlbumJson;
    wrapper.library.lastSavedAt = new Date().toISOString();
    fs.writeFileSync(
      repository.libraryFilePath(root),
      JSON.stringify(wrapper, null, 2),
      'utf8',
    );
    pendingAlbumJson = null;
  } catch {
    // Best-effort last save; the regular debounced writer already ran most of the time.
  }
}

async function previewMaxEdgeFor(root) {
  const wrapper = await repository.readLibrary(root);
  return wrapper ? wrapper.library.previewMaxEdge : constants.DEFAULT_PREVIEW_MAX_EDGE;
}

async function importPaths(paths) {
  const root = getAvailableRoot();
  if (!root) {
    return {
      ok: false,
      drafts: [],
      errors: [],
      error: '请先选择存储库，再导入照片。',
    };
  }
  return ingest.importPaths(root, paths, {
    previewMaxEdge: await previewMaxEdgeFor(root),
  });
}

async function importDataUrls(items) {
  const root = getAvailableRoot();
  if (!root) {
    return { ok: false, drafts: [], errors: [], error: '请先选择存储库。' };
  }
  return ingest.importDataUrls(root, items, {
    previewMaxEdge: await previewMaxEdgeFor(root),
  });
}

async function pickImages() {
  const root = getAvailableRoot();
  if (!root) return { ok: false, drafts: [], errors: [], error: '请先选择存储库。' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入照片到存储库',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: '图片',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff'],
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, drafts: [], errors: [], canceled: true };
  }
  return importPaths(result.filePaths);
}

function clearSampleCache() {
  if (!sampleTempDir) return;
  try {
    fs.rmSync(sampleTempDir, { recursive: true, force: true });
  } catch {
    // A leftover temp folder is harmless; it will be replaced next time.
  }
  sampleTempDir = null;
}

/**
 * Pick one real image from the library for the A/B onboarding comparison.
 * The scan cache is used when available so huge folders are not re-walked.
 */
async function pickSampleImage(root, wrapper) {
  const thumbnailDir = repository.thumbnailDirRelative(wrapper);
  const cache = await repository.readScanCache(root);
  let relatives = Object.keys(cache.files || {});
  let imageCount = relatives.length;

  const pickFrom = async (list) => {
    if (list.length === 0) return null;
    const start = Math.floor(Math.random() * list.length);
    const attempts = Math.min(list.length, 40);
    for (let offset = 0; offset < attempts; offset += 1) {
      const relative = list[(start + offset) % list.length];
      if (!constants.IMAGE_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
      const absolute = repository.resolveInside(root, relative);
      if (!absolute) continue;
      try {
        const stat = await fsp.stat(absolute);
        if (stat.isFile() && stat.size > 0) {
          return { relative, absolute, bytes: stat.size, imageCount };
        }
      } catch {
        // Missing file: try the next candidate.
      }
    }
    return null;
  };

  const fromCache = await pickFrom(relatives);
  if (fromCache) return fromCache;

  // Empty or stale cache: walk the real folder instead.
  const files = await scanLib.walkImages(root, { skipDirs: [thumbnailDir] });
  relatives = files.map((file) => repository.toPosix(path.relative(root, file)));
  imageCount = relatives.length;
  return pickFrom(relatives);
}

/**
 * Render the sample image at all five presets into a temp folder. The library
 * thumbnail cache is not touched and the original is only read.
 */
async function createThumbnailSample() {
  const root = getAvailableRoot();
  if (!root) return { ok: false, error: '存储库不可用，请先选择文件夹。' };
  try {
    const wrapper =
      (await repository.readLibrary(root)) ||
      (await repository.ensureLibrary(root, { name: path.basename(root) }));
    const picked = await pickSampleImage(root, wrapper);
    if (!picked) {
      return { ok: false, error: '存储库里还没有可以用于对比的图片。' };
    }

    clearSampleCache();
    const token = crypto.randomBytes(6).toString('hex');
    sampleTempDir = path.join(
      app.getPath('temp'),
      `hoshikuzu-thumbnail-sample-${process.pid}-${token}`,
    );
    await fsp.mkdir(sampleTempDir, { recursive: true });

    const dimensions = await previewLib.readImageDimensions(picked.absolute);
    const rendered = await previewLib.renderThumbnailSamples({
      absPath: picked.absolute,
      outDir: sampleTempDir,
      filePrefix: `${token}-`,
    });

    return {
      ok: true,
      sample: {
        fileName: path.basename(picked.relative),
        relativePath: picked.relative,
        originalUrl: `hoshikuzu-media://original/${encodeRelative(picked.relative)}`,
        originalBytes: picked.bytes,
        width: dimensions.width,
        height: dimensions.height,
        imageCount: picked.imageCount,
        presets: rendered.map((item) => ({
          ...item,
          url: `hoshikuzu-media://sample/${item.fileName}`,
        })),
      },
    };
  } catch (error) {
    clearSampleCache();
    return {
      ok: false,
      error: error && error.message ? error.message : '无法生成缩略图对比样张。',
    };
  }
}

/**
 * Finish onboarding: create the thumbnail folder inside the library root,
 * persist the chosen preset, and start the background queue on next scan.
 * The folder is the only place this function writes.
 */
async function setupThumbnailCache(payload = {}) {
  const root = getAvailableRoot();
  if (!root) return { ok: false, error: '存储库不可用，请先选择文件夹。' };
  const requested =
    typeof payload.thumbnailDir === 'string' && payload.thumbnailDir.trim()
      ? payload.thumbnailDir
      : constants.DEFAULT_THUMBNAIL_DIR;
  const dirName = repository.sanitizeThumbnailDir(requested);
  if (!dirName) {
    return {
      ok: false,
      error: '文件夹名称只能是一层目录，不能包含 \\ / : * ? " < > | 等字符。',
    };
  }
  const target = repository.resolveInside(root, dirName);
  if (!target) return { ok: false, error: '缩略图文件夹必须位于存储库内部。' };
  const preset =
    constants.thumbnailPresetById(payload.presetId) ||
    constants.thumbnailPresetById(constants.DEFAULT_THUMBNAIL_PRESET_ID);

  try {
    // Never adopt a folder that already holds user photos: scans skip the
    // thumbnail folder, so those photos would silently disappear from view.
    const existing = await fsp.readdir(target, { withFileTypes: true }).catch(() => null);
    if (
      existing &&
      existing.some(
        (entry) =>
          entry.isFile() &&
          constants.IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
    ) {
      return {
        ok: false,
        error: '这个文件夹里已经有图片文件。请换一个名称，避免把它们当成缩略图缓存。',
      };
    }
    await fsp.mkdir(target, { recursive: true });
    await repository.updateLibraryConfig(root, {
      thumbnailDir: dirName,
      previewPreset: preset.id,
      thumbnailsConfigured: true,
    });
    await refreshPreviewQueue(root);
    const next = await currentConfig();
    broadcast('library:changed', next);
    return { ok: true, config: next, thumbnailDirPath: target };
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : '无法建立缩略图缓存目录。',
    };
  }
}

function registerIpc() {
  // ---- synchronous album bootstrap (keeps useAlbum's render-time load) ----
  ipcMain.on('album:load-sync', (event) => {
    const root = configuredPath();
    if (!root) {
      event.returnValue = { configured: false, json: null };
      return;
    }
    if (!isDirectorySync(root)) {
      event.returnValue = {
        configured: true,
        json: null,
        unavailable: true,
        error: '存储库文件夹不可用，请重新定位。',
      };
      return;
    }
    try {
      const wrapper = repository.readLibrarySync(root);
      event.returnValue = {
        configured: true,
        json: wrapper ? JSON.stringify(wrapper.album) : null,
      };
    } catch (error) {
      event.returnValue = {
        configured: true,
        json: null,
        error: error && error.message ? error.message : '读取存储库失败。',
      };
    }
  });

  ipcMain.on('album:save-sync', (event, json) => {
    const root = configuredPath();
    if (!root) {
      event.returnValue = { configured: false, ok: false };
      return;
    }
    if (!isDirectorySync(root)) {
      event.returnValue = {
        configured: true,
        ok: false,
        error: '存储库文件夹不可用，修改尚未写入磁盘。',
      };
      return;
    }
    try {
      const album = JSON.parse(String(json));
      if (!album || !Array.isArray(album.photos)) throw new Error('相册数据结构不正确。');
      pendingAlbumJson = album;
      scheduleSave(root);
      event.returnValue = { configured: true, ok: true };
    } catch (error) {
      event.returnValue = {
        configured: true,
        ok: false,
        error: error && error.message ? error.message : '无法保存相册。',
      };
    }
  });

  ipcMain.on('album:reset-sync', (event) => {
    const root = getAvailableRoot();
    if (!root) {
      event.returnValue = { configured: false, ok: false };
      return;
    }
    try {
      const wrapper =
        repository.readLibrarySync(root) ||
        repository.createLibraryWrapper(root, path.basename(root));
      wrapper.album = repository.emptyAlbum();
      fs.writeFileSync(repository.libraryFilePath(root), JSON.stringify(wrapper, null, 2), 'utf8');
      pendingAlbumJson = null;
      event.returnValue = { configured: true, ok: true };
    } catch (error) {
      event.returnValue = {
        configured: true,
        ok: false,
        error: error && error.message ? error.message : '重置失败。',
      };
    }
  });

  // ---- library ----
  ipcMain.handle('library:get-config', () => currentConfig());

  ipcMain.handle('library:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择存储库文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: '已取消。' };
    }
    const root = result.filePaths[0];
    await repository.ensureLibrary(root, { name: path.basename(root) });
    await config.writeConfig({ libraryPath: root, onboardingDismissed: true });
    currentLibraryRoot = root;
    await refreshPreviewQueue(root);
    const next = await currentConfig();
    broadcast('library:changed', next);
    return { ok: true, config: next };
  });

  ipcMain.handle('library:create-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '新建或选择存储库文件夹',
      buttonLabel: '使用这个文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: '已取消。' };
    }
    const root = result.filePaths[0];
    await repository.ensureLibrary(root, { name: path.basename(root) });
    await config.writeConfig({ libraryPath: root, onboardingDismissed: true });
    currentLibraryRoot = root;
    await refreshPreviewQueue(root);
    const next = await currentConfig();
    broadcast('library:changed', next);
    return { ok: true, config: next };
  });

  ipcMain.handle('library:dismiss-onboarding', async () => {
    await config.writeConfig({ onboardingDismissed: true });
    return currentConfig();
  });

  ipcMain.handle('library:get-thumbnail-presets', () => ({
    presets: constants.THUMBNAIL_PRESETS,
    defaultId: constants.DEFAULT_THUMBNAIL_PRESET_ID,
    defaultDir: constants.DEFAULT_THUMBNAIL_DIR,
  }));

  ipcMain.handle('library:sample-thumbnail-preview', () => createThumbnailSample());

  ipcMain.handle('library:setup-thumbnails', (_event, payload) =>
    setupThumbnailCache(payload && typeof payload === 'object' ? payload : {}),
  );

  ipcMain.handle('library:open-folder', async () => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const error = await shell.openPath(root);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle('library:reveal-file', async (_event, relativePath) => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const absolute = repository.resolveInside(root, relativePath);
    if (!absolute) return { ok: false, error: '文件路径不合法。' };
    shell.showItemInFolder(absolute);
    return { ok: true };
  });

  ipcMain.handle('library:scan', async (event) => {
    const root = getAvailableRoot();
    if (!root) {
      return {
        ok: false,
        complete: false,
        seeds: [],
        worlds: [],
        stats: { scanned: 0, total: 0, withWorldId: 0, withDate: 0, previewsQueued: 0 },
        error: '存储库不可用，请先选择文件夹。',
      };
    }
    if (activeScan) return activeScan;

    scanCancelFlag = false;
    let lastProgress = 0;
    activeScan = (async () => {
      try {
        event.sender.send('library:scan-progress', {
          phase: 'discover',
          current: 0,
          message: '正在发现图片…',
        });
        const result = await scanLib.scanLibrary({
          root,
          previewQueue,
          shouldCancel: () => scanCancelFlag,
          onProgress: (progress) => {
            const now = Date.now();
            if (now - lastProgress > 120 || progress.current === progress.total) {
              lastProgress = now;
              event.sender.send('library:scan-progress', progress);
            }
          },
        });
        event.sender.send('library:scan-progress', {
          phase: 'done',
          current: result.stats.scanned,
          total: result.stats.total,
          message: result.complete ? '扫描完成' : '扫描已取消',
        });
        // Publish the queue snapshot (including total) as soon as indexing
        // finishes, so the onboarding progress bar knows how much work is left.
        if (previewQueue) {
          event.sender.send('library:preview-progress', previewQueue.progress());
        }
        return result;
      } catch (error) {
        return {
          ok: false,
          complete: false,
          seeds: [],
          worlds: [],
          stats: { scanned: 0, total: 0, withWorldId: 0, withDate: 0, previewsQueued: 0 },
          error: error && error.message ? error.message : '扫描失败。',
        };
      }
    })();

    try {
      return await activeScan;
    } finally {
      activeScan = null;
    }
  });

  ipcMain.handle('library:cancel-scan', () => {
    scanCancelFlag = true;
    return { ok: true };
  });

  ipcMain.handle('library:set-options', async (_event, patch) => {
    const root = getAvailableRoot();
    if (!root) return currentConfig();
    const before = await repository.readLibrary(root);
    const presetChanged = Boolean(
      patch &&
        patch.previewPreset !== undefined &&
        before &&
        before.library.previewPreset !== String(patch.previewPreset),
    );
    await repository.updateLibraryConfig(root, patch || {});
    if (presetChanged) {
      // Old thumbnails have a different file-name signature and are no longer
      // referenced; remove them so the cache size matches the chosen preset.
      if (previewQueue) previewQueue.clear();
      await repository.clearPreviewCache(root);
    }
    await refreshPreviewQueue(root);
    const next = await currentConfig();
    broadcast('library:changed', next);
    return next;
  });

  ipcMain.handle('library:ignore-hashes', async (_event, hashes) => {
    const root = getAvailableRoot();
    if (!root) return { ok: false };
    const count = await repository.addIgnoredHashes(root, Array.isArray(hashes) ? hashes : []);
    return { ok: true, count };
  });

  ipcMain.handle('library:reset-ignored', async () => {
    const root = getAvailableRoot();
    if (!root) return { ok: false };
    await repository.resetIgnoredHashes(root);
    return { ok: true };
  });

  ipcMain.handle('library:stats', async () => {
    const root = getAvailableRoot();
    if (!root) {
      return {
        imageCount: 0,
        libraryBytes: 0,
        previewBytes: 0,
        previewCount: 0,
        lastScanAt: null,
      };
    }
    return repository.computeLibraryStats(root);
  });

  ipcMain.handle('library:clear-preview-cache', async () => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    if (previewQueue) previewQueue.clear();
    return repository.clearPreviewCache(root);
  });

  // ---- media ----
  ipcMain.handle('media:pick-and-import', () => pickImages());
  ipcMain.handle('media:import-files', (_event, paths) =>
    importPaths(Array.isArray(paths) ? paths : []),
  );
  ipcMain.handle('media:import-data-urls', (_event, items) =>
    importDataUrls(Array.isArray(items) ? items : []),
  );

  ipcMain.handle('media:delete-managed', async (_event, contentHash) => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const wrapper = await repository.readLibrary(root);
    if (!wrapper) return { ok: false, error: '存储库元数据缺失。' };
    const photo = (wrapper.album.photos || []).find(
      (item) => item.contentHash === contentHash,
    );
    if (!photo || photo.managedCopy !== true) {
      return { ok: false, error: '这张照片不是客户端复制的文件，不能删除原图。' };
    }
    if (!photo.libraryPath || !String(photo.libraryPath).startsWith(`${constants.INBOX_DIR}/`)) {
      return { ok: false, error: '只允许删除客户端导入目录中的副本。' };
    }
    const absolute = repository.resolveInside(root, photo.libraryPath);
    if (!absolute) return { ok: false, error: '文件路径不合法。' };
    try {
      await fsp.rm(absolute, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ---- background video ----
  ipcMain.handle('background:save-video', async (_event, payload) => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用，无法保存视频背景。' };
    const name = typeof payload?.name === 'string' ? payload.name : 'background-video';
    const mime = typeof payload?.mime === 'string' ? payload.mime : '';
    const raw = payload?.data;
    let buffer;
    if (raw instanceof ArrayBuffer) buffer = Buffer.from(raw);
    else if (ArrayBuffer.isView(raw)) {
      buffer = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    } else {
      return { ok: false, error: '视频数据格式不正确。' };
    }
    if (buffer.length === 0) return { ok: false, error: '视频数据为空。' };
    if (buffer.length > 200 * 1024 * 1024) {
      return { ok: false, error: '压缩后的视频仍然超过 200MB，请换一个更短的视频。' };
    }

    const isWebm =
      buffer.length > 4 &&
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3;
    const isMp4 =
      buffer.length > 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp';
    if (!isWebm && !isMp4) {
      return { ok: false, error: '只接受 WebM 或 MP4 视频背景文件。' };
    }
    const extension = isWebm ? 'webm' : 'mp4';
    if (mime && !/^video\//i.test(mime)) {
      return { ok: false, error: '文件类型不是视频。' };
    }

    const hash = crypto.createHash('sha1').update(buffer).digest('hex');
    const key = `${hash}.${extension}`;
    const dir = path.join(root, '.hoshikuzu', 'backgrounds');
    const absolute = path.join(dir, key);
    try {
      await fsp.mkdir(dir, { recursive: true });
      const temp = `${absolute}.${process.pid}.tmp`;
      await fsp.writeFile(temp, buffer);
      try {
        await fsp.rename(temp, absolute);
      } catch {
        await fsp.rm(absolute, { force: true });
        await fsp.rename(temp, absolute);
      }
      return { ok: true, key, bytes: buffer.length, name };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('background:delete-video', async (_event, key) => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    if (typeof key !== 'string' || !BACKGROUND_FILE_PATTERN.test(path.basename(key))) {
      return { ok: false, error: '视频文件名不合法。' };
    }
    const absolute = path.join(root, '.hoshikuzu', 'backgrounds', path.basename(key));
    try {
      await fsp.rm(absolute, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ---- backup ----
  ipcMain.handle('backup:export-metadata', async () => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出元数据备份',
      defaultPath: path.join(app.getPath('documents'), `hoshikuzu-metadata-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await backupLib.exportMetadata(root, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('backup:export-full', async () => {
    const root = getAvailableRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const bytes = await backupLib.estimateFullBackupBytes(root);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出完整库备份',
      defaultPath: path.join(app.getPath('documents'), `hoshikuzu-library-${stamp}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '导出完整库备份',
      message: `备份大小约 ${formatBytes(bytes)}`,
      detail: '将包含存储库中的全部原图、预览与元数据，可能需要较长时间并占用大量磁盘空间。',
      buttons: ['开始导出', '取消'],
      defaultId: 0,
      cancelId: 1,
    });
    if (confirm.response !== 0) return { ok: false, canceled: true };

    try {
      await backupLib.exportFull(root, result.filePath, {
        onProgress: (progress) => broadcast('backup:progress', progress),
      });
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('backup:import-file', async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: '导入备份',
      properties: ['openFile'],
      filters: [
        { name: '备份文件', extensions: ['json', 'zip'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'ZIP', extensions: ['zip'] },
      ],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    const file = picked.filePaths[0];
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat || stat.size > 2 * 1024 * 1024 * 1024) {
      return { ok: false, error: '备份文件过大或无法读取。' };
    }

    if (path.extname(file).toLowerCase() === '.zip') {
      const target = await dialog.showOpenDialog(mainWindow, {
        title: '选择恢复到的文件夹',
        buttonLabel: '恢复到此处',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (target.canceled || !target.filePaths[0]) return { ok: false, canceled: true };
      const targetRoot = target.filePaths[0];
      try {
        const existing = await fsp.readdir(targetRoot).catch(() => []);
        if (existing.length > 0) {
          const overwrite = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: '目标文件夹不是空的',
            message: '恢复完整库会写入同名文件',
            detail: '请选择一个空文件夹，或确认覆盖同名文件。图片文件不会被删除，但同名文件会被替换。',
            buttons: ['继续恢复', '取消'],
            defaultId: 1,
            cancelId: 1,
          });
          if (overwrite.response !== 0) return { ok: false, canceled: true };
        }
        await backupLib.importZip(file, targetRoot);
        await config.writeConfig({ libraryPath: targetRoot, onboardingDismissed: true });
        currentLibraryRoot = targetRoot;
        await refreshPreviewQueue(targetRoot);
        if (mainWindow) mainWindow.reload();
        return { ok: true, restored: true, path: targetRoot };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    try {
      const text = await fsp.readFile(file, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: '文件不是有效的 JSON。' };
      }
      if (parsed && parsed.format === constants.LIBRARY_FORMAT && parsed.album) {
        const converted = {
          format: 'hoshikuzu-album-backup',
          version: 2,
          exportedAt: parsed.exportedAt || new Date().toISOString(),
          data: parsed.album,
        };
        return { ok: true, text: JSON.stringify(converted), path: file };
      }
      return { ok: true, text, path: file };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  // ---- window / app ----
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow && mainWindow.isMaximized()));

  ipcMain.handle('app:info', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  ipcMain.handle('app:open-external', async (_event, url) => {
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) {
      await shell.openExternal(url);
    }
  });

  // Sync IPC (get-config / set-config / test / start / cancel / status) is
  // registered by desktop/services/sync.cjs.
}function insertPngTextChunk(pngBuffer, keyword, text) {
  const zlib = require('node:zlib');
  const crc32 =
    typeof zlib.crc32 === 'function'
      ? (buffer) => zlib.crc32(buffer)
      : (buffer) => {
          let crc = 0xffffffff;
          for (const byte of buffer) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit += 1) {
              crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
            }
          }
          return (crc ^ 0xffffffff) >>> 0;
        };
  const payload = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(text, 'utf8'),
  ]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const type = Buffer.from('iTXt', 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, payload])), 0);
  const chunk = Buffer.concat([length, type, payload, crc]);
  return Buffer.concat([
    pngBuffer.subarray(0, pngBuffer.length - 12),
    chunk,
    pngBuffer.subarray(pngBuffer.length - 12),
  ]);
}

async function setupSmokeLibrary() {
  const base = process.env.HOSHIKUZU_SMOKE_DIR || app.getPath('userData');
  const root = path.join(base, 'library');
  await fsp.mkdir(root, { recursive: true });
  const wrapper = await repository.ensureLibrary(root, { name: '冒烟存储库' });
  // Smoke runs against a ready library; the thumbnail setup smoke keeps the
  // gate visible, and normal first-run users see the two-step onboarding.
  if (!smokeThumbs) {
    await fsp.mkdir(repository.previewDir(root, wrapper), { recursive: true });
    await repository.updateLibraryConfig(root, { thumbnailsConfigured: true });
  }
  // Smoke intentionally enables the experimental black hole so its rendering
  // and screenshot path are covered. Normal users start with the flag off.
  wrapper.album.settings = { ...wrapper.album.settings, experimentalEffects: true };
  await repository.updateAlbum(root, wrapper.album);

  let sharp = null;
  try {
    sharp = require('sharp');
  } catch {
    sharp = null;
  }

  if (sharp) {
    const worldA = 'wrld_11111111-1111-4111-8111-111111111111';
    const worldB = 'wrld_22222222-2222-4222-8222-222222222222';
    const images = [
      {
        name: 'VRChat_2024-05-01_20-30-45.123_1920x1080.png',
        background: { r: 122, g: 91, b: 194 },
        chunk: 'XML:com.adobe.xmp',
        text: `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description xmlns:vrchat="http://vrchat.com/xmp/1.0/" vrchat:WorldID="${worldA}" vrchat:WorldName="Sakura Shrine" xmp:CreateDate="2024-05-01T20:30:45+09:00" /></rdf:RDF></x:xmpmeta>`,
      },
      {
        name: 'VRChat_2024-06-02_21-15-30.123_1920x1080.png',
        background: { r: 243, g: 174, b: 203 },
        chunk: 'Description',
        text: JSON.stringify({
          application: 'VRCX',
          version: 1,
          author: { id: 'usr_smoke', displayName: 'Traveller' },
          world: {
            id: worldB,
            name: 'Neon Alley',
            instanceId: `${worldB}:48291~region(jp)`,
          },
          players: [],
          Timestamp: '2024-06-02T21:15:30.123',
        }),
      },
      {
        name: 'holiday-2.png',
        background: { r: 155, g: 231, b: 223 },
        chunk: null,
        text: null,
        // A portrait capture keeps the orientation-aware card pipeline covered.
        width: 300,
        height: 480,
      },
    ];

    for (const image of images) {
      let buffer = await sharp({
        create: {
          width: image.width || 480,
          height: image.height || 300,
          channels: 3,
          background: image.background,
        },
      })
        .png()
        .toBuffer();
      if (image.chunk && image.text) {
        buffer = insertPngTextChunk(buffer, image.chunk, image.text);
      }
      await fsp.writeFile(path.join(root, image.name), buffer);
    }

    // Thumbnail smoke also needs a longer timeline to verify predictive
    // loading (invisible cards must not request images).
    if (smokeThumbs) {
      for (let index = 0; index < 14; index += 1) {
        const buffer = await sharp({
          create: {
            width: 360,
            height: 240,
            channels: 3,
            background: {
              r: 40 + index * 9,
              g: 70 + (index % 5) * 18,
              b: 110 + (index % 3) * 32,
            },
          },
        })
          .png()
          .toBuffer();
        await fsp.writeFile(
          path.join(root, `bulk-${String(index + 1).padStart(2, '0')}.png`),
          buffer,
        );
      }
    } else {
      // A portrait frame saved sideways with no EXIF tag: the scanner records
      // 480x300 landscape pixels, so only the display rotation can fix it.
      const portraitSvg = Buffer.from(`
        <svg width="300" height="480" xmlns="http://www.w3.org/2000/svg">
          <rect width="300" height="480" fill="#5b7fb9"/>
          <rect width="300" height="70" fill="#f0c86a"/>
          <circle cx="150" cy="160" r="50" fill="#e06a7a"/>
          <rect y="410" width="300" height="70" fill="#7ac9a0"/>
        </svg>
      `);
      const portrait = await sharp(portraitSvg).png().toBuffer();
      const sideways = await sharp(portrait).rotate(90).png().toBuffer();
      const sidewaysPath = path.join(root, 'sideways-portrait.png');
      await fsp.writeFile(sidewaysPath, sideways);
      const old = new Date('2023-01-01T00:00:00.000Z');
      await fsp.utimes(sidewaysPath, old, old);
    }
  }
  await config.writeConfig({ libraryPath: root, onboardingDismissed: true });
  currentLibraryRoot = root;
  await refreshPreviewQueue(root);
}

async function runSmokeTest(win) {
  const outDir =
    process.env.HOSHIKUZU_SMOKE_OUT ||
    (app.isPackaged
      ? path.join(
          app.getPath('temp'),
          `hoshikuzu-smoke-shots-${smokeThumbs ? 'thumbnails' : smokeNoLibrary ? 'onboarding' : 'library'}`,
        )
      : path.join(
          __dirname,
          smokeThumbs ? '.smoke-thumbnails' : smokeNoLibrary ? '.smoke-onboarding' : '.smoke',
        ));
  await fsp.mkdir(outDir, { recursive: true });
  console.log(
    `[desktop:smoke] runSmokeTest start (noLibrary=${smokeNoLibrary}, thumbnails=${smokeThumbs})`,
  );
  const shot = async (name) => {
    // Hidden/background windows throttle the compositor; wait for two frames
    // and force a repaint so screenshots match the current route.
    await Promise.race([
      win.webContents
        .executeJavaScript(
          'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
        )
        .catch(() => {}),
      delay(900),
    ]);
    if (win.isMinimized()) win.restore();
    win.webContents.invalidate();
    // Windows occasionally reports "Current display surface not available"
    // right after a route change or when the window is occluded; retry briefly.
    let image = null;
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        image = await win.webContents.capturePage();
        break;
      } catch (error) {
        lastError = error;
        await delay(350);
        win.webContents.invalidate();
      }
    }
    if (!image) throw lastError || new Error('screenshot capture failed');
    await fsp.writeFile(path.join(outDir, name), image.toPNG());
    console.log(`[desktop:smoke] wrote ${name}`);
  };

  if (smokeNoLibrary) {
    await delay(1800);
    await shot('01-onboarding.png');
    await win.webContents.executeJavaScript("window.location.hash = '#/'");
    await delay(800);
    await shot('02-onboarding-home.png');
    app.quit();
    return;
  }

  if (smokeThumbs) {
    const setupState = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const until = async (fn, timeout = 25000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const value = fn();
          if (value) return value;
          await wait(200);
        }
        return null;
      };
      const gate = await until(() => document.querySelector('.thumbnail-setup'));
      if (!gate) return { error: 'thumbnail setup gate missing' };
      await until(
        () =>
          document.querySelector('.thumb-compare') ||
          document.querySelector('.thumbnail-sample-state.is-warning'),
        30000,
      );
      return {
        compare: Boolean(document.querySelector('.thumb-compare')),
        warning: Boolean(document.querySelector('.thumbnail-sample-state.is-warning')),
        presets: document.querySelectorAll('.thumb-preset').length,
        samples: document.querySelectorAll('.thumb-compare img').length,
      };
    })()`);
    console.log('[desktop:smoke] thumbnail setup', setupState);
    if (setupState.error) throw new Error(setupState.error);
    if (setupState.presets !== 5) throw new Error('expected 5 thumbnail presets');
    if (!setupState.compare) throw new Error('A/B comparison sample did not render');
    await shot('01-thumbnail-setup.png');

    await win.webContents.executeJavaScript(
      `document.querySelectorAll('.thumb-preset')[3]?.click()`,
    );
    await delay(500);
    await win.webContents.executeJavaScript(
      `document.getElementById('thumb-compare-title')?.scrollIntoView({ block: 'center' })`,
    );
    await delay(900);
    await shot('02-thumbnail-preset-clear.png');

    await win.webContents.executeJavaScript(
      `document.querySelector('.thumb-compare__foot .text-button')?.click()`,
    );
    await delay(700);
    await shot('03-thumbnail-zoom.png');

    await win.webContents.executeJavaScript(
      `document.querySelector('.thumbnail-setup__actions .button--primary')?.click()`,
    );
    await delay(1200);

    const progressState = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const until = async (fn, timeout = 30000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const value = fn();
          if (value) return value;
          await wait(200);
        }
        return null;
      };
      const panel = await until(() => document.querySelector('.thumbnail-progress'));
      const success = await until(() => document.querySelector('.thumbnail-progress__success'), 30000);
      const bar = document.querySelector('.thumbnail-progress__bar');
      return {
        panel: Boolean(panel),
        success: Boolean(success),
        percent: bar?.getAttribute('aria-valuenow') || null,
        status:
          document.querySelector('.thumbnail-progress__meta span')?.textContent?.trim() || '',
        stats:
          document.querySelector('.thumbnail-progress__stats')?.textContent?.replace(/\\s+/g, ' ').trim() ||
          '',
        error:
          document.querySelector('.thumbnail-setup__error')?.textContent?.replace(/\\s+/g, ' ').trim() ||
          '',
      };
    })()`);
    console.log('[desktop:smoke] thumbnail generation', progressState);
    if (!progressState.panel) throw new Error('thumbnail progress panel did not appear');
    if (!progressState.success) {
      throw new Error(`thumbnail generation did not finish: ${progressState.error || progressState.status}`);
    }
    await shot('04-thumbnail-progress.png');

    await win.webContents.executeJavaScript(
      `document.querySelector('.thumbnail-setup__actions .button--primary')?.click()`,
    );
    await delay(1000);

    const after = await win.webContents.executeJavaScript(`(async () => {
      const api = window.hoshikuzu.desktop;
      const config = await api.library.getConfig();
      const images = Array.from(document.querySelectorAll('.photo-card__media img')).map(
        (image) => image.src,
      );
      return {
        configured: config.thumbnailsConfigured,
        preset: config.previewPreset,
        dir: config.thumbnailDir,
        loadingMode: config.imageLoadingMode,
        previews: images.filter((src) => src.includes('/preview/')).length,
        originals: images.filter((src) => src.includes('/original/')).length,
        gate: Boolean(document.querySelector('.thumbnail-setup')),
      };
    })()`);
    console.log('[desktop:smoke] thumbnail after setup', after);
    if (!after.configured) throw new Error('thumbnail setup did not persist');
    if (after.preset !== 'clear') throw new Error('thumbnail preset was not saved');
    if (after.gate) throw new Error('thumbnail setup gate did not close');
    if (after.originals > 0) {
      throw new Error('the timeline loaded original files instead of thumbnails');
    }
    if (after.previews > 0) {
      throw new Error('off-screen timeline cards loaded thumbnails before scrolling');
    }
    await shot('05-thumbnail-home.png');

    await win.webContents.executeJavaScript(
      `document.querySelector('.timeline-entry')?.scrollIntoView({ block: 'center' })`,
    );
    await delay(1600);
    const entryState = await win.webContents.executeJavaScript(`(() => {
      const entry = document.querySelector('.timeline-entry');
      const image = entry?.querySelector('.photo-card__media img');
      const images = Array.from(document.querySelectorAll('.timeline-entry .photo-card__media img'));
      return {
        visible: entry ? getComputedStyle(entry).opacity : null,
        inViewClass: entry?.classList.contains('is-visible') || false,
        image: image?.getAttribute('src') || '',
        loaded: images.filter((item) => item.src.includes('/preview/')).length,
        entries: document.querySelectorAll('.timeline-entry').length,
      };
    })()`);
    console.log('[desktop:smoke] timeline entry', entryState);
    if (entryState.visible === '0') {
      throw new Error('timeline entry stayed invisible after scrolling into view');
    }
    if (entryState.image.includes('/original/')) {
      throw new Error('timeline card requested an original file');
    }
    if (entryState.loaded < 5) {
      throw new Error('predictive loading did not preload upcoming cards');
    }
    await shot('06-thumbnail-timeline.png');

    const modeCheck = await win.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const api = window.hoshikuzu.desktop;
      const countLoaded = () =>
        Array.from(document.querySelectorAll('.timeline-entry .photo-card__media img')).filter(
          (image) => image.src.includes('/preview/'),
        ).length;
      await api.library.setOptions({ imageLoadingMode: 'realtime' });
      await wait(1400);
      const realtime = {
        mode: document.documentElement.dataset.thumbMode,
        config: (await api.library.getConfig()).imageLoadingMode,
        loaded: countLoaded(),
        window: document.documentElement.dataset.thumbWindow,
      };
      await api.library.setOptions({ imageLoadingMode: 'preload' });
      await wait(3000);
      const preload = {
        mode: document.documentElement.dataset.thumbMode,
        config: (await api.library.getConfig()).imageLoadingMode,
        loaded: countLoaded(),
        prefetched: Number(document.documentElement.dataset.thumbPrefetch || 0),
        prefetchTotal: Number(document.documentElement.dataset.thumbPrefetchTotal || 0),
      };
      await api.library.setOptions({ imageLoadingMode: 'predictive' });
      await wait(1000);
      const predictive = {
        mode: document.documentElement.dataset.thumbMode,
        loaded: countLoaded(),
      };
      return { realtime, preload, predictive };
    })()`);
    console.log('[desktop:smoke] loading modes', modeCheck);
    if (modeCheck.realtime.mode !== 'realtime' || modeCheck.realtime.config !== 'realtime') {
      throw new Error('realtime loading mode was not applied');
    }
    if (modeCheck.realtime.loaded > 7) {
      throw new Error('realtime mode kept too many decoded images');
    }
    if (modeCheck.preload.mode !== 'preload' || modeCheck.preload.config !== 'preload') {
      throw new Error('preload mode was not applied');
    }
    if (modeCheck.preload.prefetchTotal < entryState.entries) {
      throw new Error('preload mode did not register all thumbnails');
    }
    if (modeCheck.preload.prefetched < 1) {
      throw new Error('preload mode did not prefetch any thumbnail bytes');
    }
    if (modeCheck.predictive.loaded < 5) {
      throw new Error('predictive mode did not restore the prefetch window');
    }

    await win.webContents.executeJavaScript(
      `document.querySelector('.photo-card__hit')?.click()`,
    );
    await delay(2400);
    const detail = await win.webContents.executeJavaScript(`(() => {
      const image = document.querySelector('.detail-media__image--original');
      return {
        present: Boolean(image),
        loaded: Boolean(image && image.naturalWidth > 0),
        state: document.querySelector('.detail-original-state')?.textContent?.trim() || '',
      };
    })()`);
    console.log('[desktop:smoke] detail original', detail);
    if (!detail.present) throw new Error('detail view did not request the original');
    await shot('07-thumbnail-original.png');
    app.quit();
    return;
  }

  // Let the renderer auto-scan the smoke library and generate previews.
  await delay(4500);
  await shot('01-home.png');

  const orientationCheck = await win.webContents
    .executeJavaScript(`(() => ({
      portraitCards: document.querySelectorAll('.photo-card--portrait').length,
      landscapeCards: document.querySelectorAll('.photo-card--landscape').length,
      portraitFeature: Boolean(document.querySelector('.feature-card--portrait')),
      portraitWidth: document.querySelector('.photo-card--portrait')?.getBoundingClientRect().width || 0,
      portraitHeight: document.querySelector('.photo-card--portrait')?.getBoundingClientRect().height || 0,
    }))()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] orientation', orientationCheck);
  if (orientationCheck.error) throw new Error(orientationCheck.error);
  if (orientationCheck.portraitCards < 1) {
    throw new Error('portrait photo was not framed as portrait');
  }
  if (orientationCheck.landscapeCards < 1) {
    throw new Error('landscape photos lost their landscape frame');
  }

  // A sideways portrait screenshot: start landscape, rotate it from the card
  // action, then verify the frame becomes portrait and the CSS rotation is
  // applied to the rendered image.
  const findSidewaysCard = `(() => {
    const hit = document.querySelector('.photo-card__hit[aria-label*="sideways-portrait"]');
    return hit ? hit.closest('.photo-card') : null;
  })()`;
  const sidewaysBefore = await win.webContents
    .executeJavaScript(`(() => {
      const card = ${findSidewaysCard};
      if (!card) return { error: 'sideways card missing' };
      const media = card.querySelector('.photo-card__media');
      const rect = media.getBoundingClientRect();
      return {
        rotation: card.dataset.rotation,
        className: card.className,
        width: rect.width,
        height: rect.height,
      };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] sideways before', sidewaysBefore);
  if (sidewaysBefore.error) throw new Error(sidewaysBefore.error);
  if (sidewaysBefore.rotation !== '0' || sidewaysBefore.width <= sidewaysBefore.height) {
    throw new Error('sideways portrait should start as a landscape card');
  }
  const rotateClick = await win.webContents
    .executeJavaScript(`(() => {
      const card = ${findSidewaysCard};
      const button = card && card.querySelectorAll('.photo-card__action')[1];
      if (!button) return { error: 'rotate action missing' };
      button.click();
      return { ok: true };
    })()`)
    .catch((error) => ({ error: error.message }));
  if (rotateClick.error) throw new Error(rotateClick.error);
  await delay(900);
  const sidewaysAfter = await win.webContents
    .executeJavaScript(`(() => {
      const card = ${findSidewaysCard};
      if (!card) return { error: 'sideways card missing after rotate' };
      const media = card.querySelector('.photo-card__media');
      const rect = media.getBoundingClientRect();
      const image = media.querySelector('img');
      return {
        rotation: card.dataset.rotation,
        className: card.className,
        width: rect.width,
        height: rect.height,
        transform: image ? getComputedStyle(image).transform : null,
      };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] sideways after', sidewaysAfter);
  if (sidewaysAfter.error) throw new Error(sidewaysAfter.error);
  if (sidewaysAfter.rotation !== '270') {
    throw new Error('rotate action did not store a 270 degree rotation');
  }
  if (!sidewaysAfter.className.includes('photo-card--portrait')) {
    throw new Error('rotated sideways photo did not become portrait');
  }
  if (sidewaysAfter.height <= sidewaysAfter.width) {
    throw new Error('rotated sideways photo kept a landscape frame');
  }
  await win.webContents.executeJavaScript(`(() => {
    const card = ${findSidewaysCard};
    if (card) {
      const rect = card.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + rect.top - 140, behavior: 'instant' });
    }
  })()`);
  await delay(1500);
  await shot('01c-rotation.png');

  await win.webContents.executeJavaScript(
    `document.querySelector('.photo-card__hit[aria-label*="sideways-portrait"]')?.click()`,
  );
  await delay(1400);
  const rotationDetail = await win.webContents
    .executeJavaScript(`(() => {
      const media = document.querySelector('.detail-media');
      const image = media && media.querySelector('.detail-media__image:not(.detail-media__image--original)');
      const mediaRect = media ? media.getBoundingClientRect() : null;
      const imageRect = image ? image.getBoundingClientRect() : null;
      return {
        className: media ? media.className : null,
        transform: image ? getComputedStyle(image).transform : null,
        imageWidth: imageRect ? imageRect.width : null,
        imageHeight: imageRect ? imageRect.height : null,
        mediaWidth: mediaRect ? mediaRect.width : null,
        mediaHeight: mediaRect ? mediaRect.height : null,
      };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] rotation detail', rotationDetail);
  if (rotationDetail.error) throw new Error(rotationDetail.error);
  if (!rotationDetail.className?.includes('detail-media--rotate-270')) {
    throw new Error('detail view did not apply the stored rotation');
  }
  if (!rotationDetail.transform || rotationDetail.transform === 'none') {
    throw new Error('detail image was not rotated with CSS');
  }
  if (
    rotationDetail.imageWidth === null ||
    rotationDetail.imageHeight === null ||
    rotationDetail.imageHeight <= rotationDetail.imageWidth
  ) {
    throw new Error('rotated detail image is not portrait after rotation');
  }
  if (
    rotationDetail.imageWidth > rotationDetail.mediaWidth + 2 ||
    rotationDetail.imageHeight > rotationDetail.mediaHeight + 2
  ) {
    throw new Error('rotated detail image overflows the media frame');
  }
  await shot('01d-rotation-detail.png');
  await win.webContents.executeJavaScript(`document.querySelector('.detail-close')?.click()`);
  await delay(700);

  await win.webContents.executeJavaScript(
    `window.scrollTo({ top: 0, behavior: 'instant' })`,
  );
  await delay(500);
  await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.photo-card');
      if (card) {
        const rect = card.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top - 150, behavior: 'instant' });
      }
      return { y: window.scrollY };
    })()
  `);
  await delay(1600);
  const timelineScroll = await win.webContents.executeJavaScript(
    `({ y: window.scrollY, top: document.getElementById('timeline')?.getBoundingClientRect().top ?? null })`,
  );
  console.log('[desktop:smoke] timeline scroll', timelineScroll);
  await shot('01b-timeline.png');
  await win.webContents.executeJavaScript(
    `window.scrollTo({ top: 0, behavior: 'instant' })`,
  );
  await delay(500);

  await win.webContents.executeJavaScript(
    `document.querySelector('.header-appearance')?.click()`,
  );
  await delay(700);
  await shot('09-appearance.png');
  await win.webContents.executeJavaScript(
    `document.querySelector('#appearance-panel button[aria-label="关闭外观面板"]')?.click()`,
  );
  await delay(700);

  const chooseBackground = async (index) => {
    await win.webContents.executeJavaScript(
      `document.querySelector('.header-appearance')?.click()`,
    );
    await delay(900);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('.background-card')[${index}]?.click()`,
      );
      await delay(700);
      const active = await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('.background-card')).findIndex((el) => el.classList.contains('is-active'))`,
      );
      if (active === index) break;
      console.warn(`[desktop:smoke] background retry ${attempt + 1} (active=${active})`);
    }
    await win.webContents.executeJavaScript(
      `document.querySelector('#appearance-panel button[aria-label="关闭外观面板"]')?.click()`,
    );
    await delay(2200);
  };
  await chooseBackground(3);
  await shot('07-blackhole.png');
  await win.webContents.executeJavaScript(`
    (() => {
      const style = document.createElement('style');
      style.id = 'smoke-blackhole-clean';
      style.textContent = '.site-header,.hero-copy,.hero-feature,.hero-scroll,.hero-vertical,.hero-orbit,.hero-aurora,.site-footer,.skip-link,#appearance-panel{opacity:0 !important;}';
      document.head.appendChild(style);
    })()
  `);
  await delay(500);
  await shot('07a-blackhole-scene.png');
  await win.webContents.executeJavaScript(
    `document.querySelector('#smoke-blackhole-clean')?.remove()`,
  );
  await delay(400);
  await chooseBackground(1);
  await shot('08-rain.png');
  await chooseBackground(2);
  await shot('10-acrylic.png');
  await chooseBackground(5);
  await shot('11-aurora.png');
  await chooseBackground(0);

  // Unlock the admin console for screenshots without knowing a passphrase:
  // isAdminUnlocked only checks the session stamp.
  await Promise.race([
    win.webContents
      .executeJavaScript(`
    try {
      localStorage.setItem('hoshikuzu-admin-credential-v1', JSON.stringify({
        version: 1,
        salt: 'c21va2U=',
        hash: 'c21va2U=',
        createdAt: new Date().toISOString(),
      }));
      sessionStorage.setItem('hoshikuzu-admin-session-v1', JSON.stringify({ at: Date.now() }));
      location.hash = '#/admin';
      location.reload();
    } catch (error) { console.error(error); }
  `)
      .catch(() => {}),
    delay(1200),
  ]);
  await delay(2600);
  await shot('02-admin.png');

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/settings'");
  await delay(1600);
  await shot('03-settings.png');

  const settingsExtras = await win.webContents
    .executeJavaScript(`(async () => {
      const api = window.hoshikuzu.desktop;
      const hasVideo = Array.from(document.querySelectorAll('.background-card')).some((el) =>
        el.textContent.includes('视频背景'),
      );
      const hasNetwork = Boolean(document.getElementById('proxy-mode'));
      const before = await api.network.getConfig();
      const saved = await api.network.setProxy({
        mode: 'socks5',
        socksUrl: 'socks5://127.0.0.1:1080',
      });
      await api.network.setProxy({ mode: 'system' });
      const restored = await api.network.getConfig();
      const videoFile = await api.background.saveVideo({
        name: 'smoke.webm',
        mime: 'video/webm',
        data: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]).buffer,
      });
      let videoStatus = 0;
      if (videoFile.ok && videoFile.key) {
        const response = await fetch('hoshikuzu-media://background/' + videoFile.key);
        videoStatus = response.status;
        await api.background.deleteVideo(videoFile.key);
      }
      return {
        hasVideo,
        hasNetwork,
        saved: saved.ok,
        modes: before.modes.length,
        restored: restored.proxy.mode,
        videoSaved: videoFile.ok,
        videoStatus,
      };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] settings extras', settingsExtras);
  if (settingsExtras.error) throw new Error(settingsExtras.error);
  if (!settingsExtras.hasVideo) throw new Error('video background option missing');
  if (!settingsExtras.hasNetwork) throw new Error('proxy panel missing');
  if (!settingsExtras.saved) throw new Error('proxy setting was not applied');
  if (settingsExtras.modes < 6) throw new Error('proxy modes missing');
  if (settingsExtras.restored !== 'system') {
    throw new Error('proxy setting was not restored');
  }
  if (!settingsExtras.videoSaved || settingsExtras.videoStatus !== 200) {
    throw new Error('background video IPC or media protocol failed');
  }

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/worlds'");
  await delay(1800);
  const worldsCheck = await win.webContents
    .executeJavaScript(`(() => ({
      title: document.querySelector('.admin-topbar__title h1')?.textContent?.trim() || '',
      cards: document.querySelectorAll('.admin-world-card').length,
      vrchatLogin: Boolean(document.getElementById('vrchat-username')),
      apiBaseField: Boolean(document.getElementById('vrchat-api-base')),
    }))()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] worlds page', worldsCheck);
  if (worldsCheck.error) throw new Error(worldsCheck.error);
  if (!worldsCheck.vrchatLogin) throw new Error('VRChat official panel missing');
  if (!worldsCheck.apiBaseField) throw new Error('VRChat API base field missing');
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await delay(500);
  await shot('03f-worlds.png');

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/settings'");
  await delay(1200);

  const experimentalCheck = await win.webContents
    .executeJavaScript(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const hasBlackHole = () =>
        Array.from(document.querySelectorAll('.background-card')).some((el) =>
          el.textContent.includes('银河黑洞'),
        );
      const first = document.querySelector('.appearance-experimental input');
      if (!first) return { error: 'experimental toggle missing' };
      if (!first.checked) first.click();
      await wait(500);
      document.querySelector('.appearance-experimental input')?.click();
      await wait(500);
      const hiddenWhenOff = !hasBlackHole();
      document.querySelector('.appearance-experimental input')?.click();
      await wait(500);
      const shownWhenOn = hasBlackHole();
      return { hiddenWhenOff, shownWhenOn };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] experimental gating', experimentalCheck);
  if (!experimentalCheck.hiddenWhenOff || !experimentalCheck.shownWhenOn) {
    throw new Error('experimental background gating failed');
  }
  await win.webContents.executeJavaScript(`
    document.querySelector('.appearance-experimental')?.scrollIntoView({ block: 'center' });
  `);
  await delay(700);
  await shot('03d-experimental.png');

  await win.webContents.executeJavaScript(`
    document.querySelector('.library-panel')?.scrollIntoView({ block: 'start' });
  `);
  await delay(900);
  await shot('03b-library-panel.png');

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/sync'");
  await delay(1800);
  const syncPageState = await win.webContents.executeJavaScript(`(() => ({
    title: document.querySelector('.admin-topbar__title h1')?.textContent?.trim() || '',
    page: Boolean(document.querySelector('.sync-page')),
    panels: document.querySelectorAll('.sync-page .admin-panel').length,
  }))()`);
  console.log('[desktop:smoke] sync page', syncPageState);
  if (!syncPageState.page) throw new Error('sync page did not render');
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await delay(600);
  await shot('03e-sync.png');
  const syncApiCheck = await win.webContents
    .executeJavaScript(`(async () => {
      const api = window.hoshikuzu.desktop;
      const before = await api.sync.getConfig();
      await api.sync.setConfig({
        cloud: {
          provider: 'webdav',
          webdavUrl: 'https://dav.example.com/dav/',
          webdavUsername: 'smoke-user',
          webdavPassword: 'smoke-secret',
        },
      });
      const after = await api.sync.getConfig();
      await api.sync.setConfig({
        cloud: { provider: 'folder', clearWebdavPassword: true },
      });
      return {
        providers: before.providers.length,
        passwordSaved: after.cloud.hasWebdavPassword,
        provider: after.cloud.provider,
      };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] sync api', syncApiCheck);
  if (syncApiCheck.error) throw new Error(syncApiCheck.error);
  if (syncApiCheck.providers < 5) throw new Error('sync providers missing');
  if (!syncApiCheck.passwordSaved) throw new Error('sync secret was not stored');

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/settings'");
  await delay(1200);

  // Verify the light theme also covers the custom title bar and library card.
  await win.webContents.executeJavaScript(`
    document.documentElement.dataset.theme = 'dawn';
    document.documentElement.dataset.tone = 'light';
    document.documentElement.style.colorScheme = 'light';
  `);
  await delay(700);
  await shot('03c-library-light.png');

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/photos'");
  await delay(1400);
  await shot('04-photos.png');

  const advancedApiCheck = await win.webContents
    .executeJavaScript(`(async () => {
      const api = window.hoshikuzu.desktop;
      await api.ai.setConfig({ apiKey: 'smoke-test-key' });
      const ai = await api.ai.getConfig();
      const transfer = await api.transfer.setConfig({ regenerateToken: true });
      return { aiKeySaved: ai.hasApiKey, transferTokenLength: transfer.token.length };
    })()`)
    .catch((error) => ({ error: error.message }));
  console.log('[desktop:smoke] advanced api', advancedApiCheck);

  await win.webContents.executeJavaScript("window.location.hash = '#/admin/advanced'");
  await delay(2600);
  await shot('06-advanced.png');

  await win.webContents.executeJavaScript(`
    document.querySelector('.advanced-ai-panel')?.scrollIntoView({ block: 'start' });
  `);
  await delay(900);
  await shot('06b-ai-panel.png');

  await win.webContents.executeJavaScript(`
    document.querySelector('.advanced-batch-panel')?.scrollIntoView({ block: 'start' });
  `);
  await delay(900);
  await shot('06d-ai-batch.png');

  await win.webContents.executeJavaScript(`
    document.querySelector('.advanced-ip-list')?.scrollIntoView({ block: 'center' });
  `);
  await delay(900);
  await shot('06c-transfer.png');

  await win.webContents.executeJavaScript("window.location.hash = '#/'");
  await delay(1200);
  await shot('05-home-return.png');

  app.quit();
}

async function bootstrap() {
  Menu.setApplicationMenu(buildMenu());
  registerProtocols();

  const cfg = await config.readConfig();
  if (cfg.libraryPath && (await isDirectory(cfg.libraryPath))) {
    currentLibraryRoot = cfg.libraryPath;
    await repository.ensureLibrary(cfg.libraryPath, { name: path.basename(cfg.libraryPath) });
  }
  await refreshPreviewQueue(currentLibraryRoot);

  advancedServices = createAdvancedServices({
    broadcast,
    getWindow: () => mainWindow,
    getRoot: getAvailableRoot,
    getPreviewMaxEdge: previewMaxEdgeFor,
  });
  advancedServices.register();

  syncService = createSyncService({
    broadcast,
    getWindow: () => mainWindow,
    getRoot: getAvailableRoot,
  });
  syncService.register();

  networkService = createNetworkService({ broadcast });
  networkService.register();
  await networkService.startAuto();

  registerIpc();
  await createWindow();
  await advancedServices.startAuto();
}

const gotLock = isSmoke || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      if (isSmoke && !smokeNoLibrary) await setupSmokeLibrary();
      await bootstrap();
    } catch (error) {
      dialog.showErrorBox(
        'VRchat时间轴纪念相册启动失败',
        error && error.stack ? error.stack : String(error),
      );
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    flushSaveSync();
    clearSampleCache();
    if (syncService) syncService.dispose();
    if (advancedServices) {
      void advancedServices.stopAll();
    }
  });
}
