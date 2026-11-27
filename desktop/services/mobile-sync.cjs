'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const repository = require('../library/repository.cjs');

const DEFAULT_PORT = 7880;
const COOKIE_NAME = 'hoshikuzu_mobile';
const DEVICE_COOKIE = 'hoshikuzu_mobile_device';
const SESSION_MAX_AGE = 60 * 60 * 12;
const RECEIVE_MODES = ['stream', 'save'];
// Pairing is a 144-bit secret, so the limit only exists to stop log/CPU abuse.
// It is scoped per IP and only applies to failed attempts: a phone with the
// correct QR token can always pair, even while someone else floods failures.
const PAIR_FAILURE_LIMIT = 20;
const PAIR_FAILURE_WINDOW_MS = 60_000;
const MAX_SESSION_TOKENS = 256;

const MIME = {
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
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.txt': 'text/plain; charset=utf-8',
};

const PHOTO_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

function normalizeMode(value) {
  return RECEIVE_MODES.includes(value) ? value : 'stream';
}

function mimeFor(filePath) {
  return MIME[path.extname(String(filePath || '')).toLowerCase()] || 'application/octet-stream';
}

function photoMimeFor(filePath) {
  return (
    PHOTO_MIME_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] ||
    'application/octet-stream'
  );
}

function tokensEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function cookie(name, value, maxAge = SESSION_MAX_AGE) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

function baseName(value) {
  return path.basename(String(value || '').replace(/\\/g, '/'));
}

function clientIp(req) {
  const address = req && req.socket ? req.socket.remoteAddress : '';
  return String(address || 'unknown').replace(/^::ffff:/, '');
}

function safeFileName(value, fallback = 'memory.jpg') {
  const name = baseName(String(value || '').trim());
  if (!name) return fallback;
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || fallback;
}

function scoreAddress(address, iface = '') {
  let score = 0;
  if (/^192\.168\./.test(address)) score += 40;
  else if (/^10\./.test(address)) score += 30;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 25;
  else score += 5;
  if (/wi-?fi|wlan|wireless|无线/i.test(iface)) score += 16;
  if (/ethernet|以太|realtek|intel|gbe/i.test(iface)) score += 10;
  if (
    /vethernet|vmware|virtualbox|hyper-v|docker|wsl|loopback|tailscale|zerotier|easytier|tap|tun|vpn/i.test(
      iface,
    )
  ) {
    score -= 30;
  }
  return score;
}

/** LAN IPv4 candidates, most likely physical Wi-Fi/Ethernet first. */
function lanAddresses(interfaces = os.networkInterfaces()) {
  const seen = new Set();
  const out = [];
  for (const [iface, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      const family = entry.family;
      if (family !== 'IPv4' && family !== 4) continue;
      const address = String(entry.address || '');
      if (!address || address.startsWith('169.254.') || seen.has(address)) continue;
      seen.add(address);
      out.push({ address, iface, score: scoreAddress(address, iface) });
    }
  }
  out.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return out.map(({ address, iface, score }) => ({ address, iface, score }));
}

function isPrivateAddress(address) {
  return Boolean(
    address &&
      (/^10\./.test(address) ||
        /^192\.168\./.test(address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
        /^127\./.test(address)),
  );
}

function photoIdFor(photo, index) {
  if (photo && typeof photo.id === 'string' && photo.id) return photo.id;
  return `photo_${index}`;
}

function isRemoteUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/**
 * Build the compact album the phone needs. Absolute library paths, AI state,
 * activity logs and embedded data URLs are deliberately left out; the phone
 * gets stable photo ids plus same-origin media URLs.
 */
function buildMobileAlbum(album, options = {}) {
  const version = String(options.version || '');
  const libraryName = String(options.libraryName || '');
  const mode = normalizeMode(options.mode);
  const source = album && Array.isArray(album.photos) ? album.photos : [];
  const photos = [];
  const worlds = new Set();
  let bytes = 0;
  let minYear = null;
  let maxYear = null;

  for (let index = 0; index < source.length; index += 1) {
    const photo = source[index];
    if (!photo || typeof photo !== 'object') continue;
    if (photo.missing) continue;
    const id = photoIdFor(photo, index);
    const encodedId = encodeURIComponent(id);
    const isLibrary = photo.mediaKind === 'library' || Boolean(photo.libraryPath);
    let src = '';
    let originalUrl = null;
    if (isLibrary) {
      if (photo.previewPath) {
        src = `/api/mobile/photos/${encodedId}/thumb?v=${encodeURIComponent(
          baseName(photo.previewPath),
        )}`;
      }
      if (photo.libraryPath) originalUrl = `/api/mobile/photos/${encodedId}/original`;
    } else if (isRemoteUrl(photo.src)) {
      src = photo.src;
      originalUrl = photo.src;
    }
    if (!src) continue;

    const rotation =
      photo.rotation === 90 || photo.rotation === 180 || photo.rotation === 270
        ? photo.rotation
        : 0;
    const width = Number.isFinite(photo.width) && photo.width > 0 ? Math.round(photo.width) : null;
    const height = Number.isFinite(photo.height) && photo.height > 0 ? Math.round(photo.height) : null;
    let world = null;
    if (photo.world && typeof photo.world.name === 'string' && photo.world.name) {
      worlds.add(photo.world.name);
      world = {
        id: typeof photo.world.id === 'string' ? photo.world.id : '',
        name: photo.world.name.slice(0, 120),
        author: typeof photo.world.author === 'string' ? photo.world.author.slice(0, 80) : '',
        thumbnail: isRemoteUrl(photo.world.thumbnail) ? photo.world.thumbnail : '',
      };
    }
    const fileBytes = Number.isFinite(photo.fileBytes) && photo.fileBytes > 0 ? photo.fileBytes : 0;
    bytes += fileBytes;
    const capturedAt = typeof photo.capturedAt === 'string' ? photo.capturedAt : '';
    const year = Number.parseInt(capturedAt.slice(0, 4), 10);
    if (Number.isFinite(year) && year > 1900) {
      if (minYear === null || year < minYear) minYear = year;
      if (maxYear === null || year > maxYear) maxYear = year;
    }

    photos.push({
      id,
      src,
      originalUrl,
      alt: typeof photo.alt === 'string' && photo.alt ? photo.alt.slice(0, 200) : '时光相册中的照片',
      note: typeof photo.note === 'string' ? photo.note.slice(0, 500) : '',
      capturedAt,
      width,
      height,
      rotation,
      world,
      fileBytes,
      library: isLibrary,
      fileName: isLibrary ? safeFileName(photo.libraryPath, 'memory.jpg') : '',
    });
  }

  photos.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));

  const settings = album && album.settings && typeof album.settings === 'object' ? album.settings : {};
  const featuredPhotoId =
    typeof settings.featuredPhotoId === 'string' &&
    photos.some((photo) => photo.id === settings.featuredPhotoId)
      ? settings.featuredPhotoId
      : null;

  return {
    format: 'hoshikuzu-mobile-album',
    version: 1,
    appVersion: version,
    libraryName,
    generatedAt: new Date().toISOString(),
    mode,
    settings: {
      siteName: typeof settings.siteName === 'string' ? settings.siteName.slice(0, 80) : '时光轴相册',
      siteNameEn:
        typeof settings.siteNameEn === 'string' ? settings.siteNameEn.slice(0, 80) : 'Time Axis Album',
      tagline: typeof settings.tagline === 'string' ? settings.tagline.slice(0, 200) : '',
      theme: typeof settings.theme === 'string' ? settings.theme : 'twilight',
      layout: typeof settings.layout === 'string' ? settings.layout : 'starlight',
      featuredPhotoId,
    },
    stats: {
      photos: photos.length,
      worlds: worlds.size,
      years: minYear && maxYear ? maxYear - minYear + 1 : 0,
      bytes,
      firstYear: minYear,
      lastYear: maxYear,
    },
    photos,
  };
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求内容过大。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求内容不是有效的 JSON。'));
      }
    });
    req.on('error', reject);
  });
}

function devicePlatform(ua) {
  const agent = String(ua || '');
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent)) return 'iPad';
  if (/Android/i.test(agent)) return 'Android';
  if (/Windows/i.test(agent)) return 'Windows';
  if (/Macintosh/i.test(agent)) return 'Mac';
  return '浏览器';
}

function deviceLabel(ua) {
  const agent = String(ua || '');
  const platform = devicePlatform(agent);
  const browser = /CriOS|Chrome\//i.test(agent)
    ? 'Chrome'
    : /FxiOS|Firefox\//i.test(agent)
      ? 'Firefox'
      : /EdgiOS|Edg\//i.test(agent)
        ? 'Edge'
        : /Safari\//i.test(agent)
          ? 'Safari'
          : '浏览器';
  return `${platform} · ${browser}`;
}

class MobileSyncService {
  constructor(options) {
    this.distDir = options.distDir;
    this.getRoot = options.getRoot;
    this.getAlbum = options.getAlbum;
    this.getPreviewDir = options.getPreviewDir;
    this.getSettings = options.getSettings;
    this.updateSettings = options.updateSettings;
    this.onStatus = options.onStatus || (() => {});
    this.onCast = options.onCast || (() => {});
    this.appName = options.appName || 'VRchat时间轴纪念相册';
    this.version = options.version || '1.0.0';
    this.server = null;
    this.port = DEFAULT_PORT;
    this.token = '';
    this.sessionTokens = new Set();
    // Expiry + device mapping stay alongside the token set so a stolen cookie
    // stops working after SESSION_MAX_AGE and one device can be revoked alone.
    this.sessionTokenExpiry = new Map();
    this.sessionTokenDevices = new Map();
    this.pairFailuresByIp = new Map();
    this.startedAt = null;
    this.sessions = new Map();
    this.blockedDevices = new Set();
    this.heartbeat = null;
    this.lastCast = null;
    this.lastError = null;
    this.libraryName = null;
    this.albumVersion = Date.now();
    // Reading library.json for every thumbnail would be wasteful while the
    // phone scrolls a large timeline; save events invalidate this cache.
    this.albumCache = null;
    this.albumCacheRoot = null;
    this.albumCacheAt = 0;
    this.photoIndex = null;
  }

  settings() {
    const raw = this.getSettings ? this.getSettings() : {};
    return {
      enabled: raw && raw.enabled === true,
      port: Number(raw && raw.port) > 0 ? Number(raw.port) : DEFAULT_PORT,
      preferredIp: typeof (raw && raw.preferredIp) === 'string' ? raw.preferredIp : '',
      receiveMode: normalizeMode(raw && raw.receiveMode),
    };
  }

  mode() {
    return this.settings().receiveMode;
  }

  addresses() {
    return lanAddresses();
  }

  activeAddress() {
    const settings = this.settings();
    const list = this.addresses();
    const preferred = list.find((entry) => entry.address === settings.preferredIp);
    return (preferred || list[0] || {}).address || '127.0.0.1';
  }

  pairUrl(address) {
    const ip = address || this.activeAddress();
    return `http://${ip}:${this.port}/m/${this.token}`;
  }

  async qrDataUrl(address) {
    if (!this.token) return null;
    const url = this.pairUrl(address);
    return QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 640,
      color: { dark: '#0b0918', light: '#ffffff' },
    });
  }

  status() {
    const settings = this.settings();
    const devices = Array.from(this.sessions.values())
      .filter((session) => session.heartbeatAt)
      .map((session) => ({
        id: session.id,
        name: session.name,
        platform: session.platform,
        ip: session.ip,
        connectedAt: session.connectedAt,
        lastSeen: session.lastSeen,
      }))
      .sort((a, b) => Date.parse(b.connectedAt) - Date.parse(a.connectedAt));
    return {
      running: Boolean(this.server),
      port: this.port,
      startedAt: this.startedAt,
      deviceCount: devices.length,
      devices,
      receiveMode: settings.receiveMode,
      preferredIp: settings.preferredIp,
      activeIp: this.activeAddress(),
      lanIps: this.addresses(),
      lastCast: this.lastCast,
      lastError: this.lastError,
      hasLibrary: Boolean(this.getRoot && this.getRoot()),
      libraryName: this.libraryName,
      url: this.token ? this.pairUrl(this.activeAddress()) : null,
    };
  }

  pushStatus() {
    const status = this.status();
    this.onStatus(status);
    this.broadcastEvent('status', {
      running: status.running,
      deviceCount: status.deviceCount,
      receiveMode: status.receiveMode,
      libraryName: status.libraryName || undefined,
    });
    return status;
  }

  async start(options = {}) {
    const settings = this.settings();
    const requested = options.port !== undefined ? Number(options.port) : Number(settings.port);
    const port = Number.isFinite(requested) && requested >= 0 ? requested : DEFAULT_PORT;
    if (this.server && this.port === port) {
      return { ok: true, status: this.status() };
    }
    if (this.server) await this.stop({ silent: true });

    this.port = port;
    this.token = crypto.randomBytes(18).toString('base64url');
    this.lastError = null;
    this.blockedDevices.clear();
    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((error) => {
        this.lastError = error && error.message ? error.message : String(error);
        try {
          if (!res.headersSent) this.sendJson(res, 500, { ok: false, error: this.lastError });
          else res.end();
        } catch {
          // The socket may already be gone.
        }
      });
    });
    server.on('clientError', (_error, socket) => {
      try {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      } catch {
        // Ignore broken sockets.
      }
    });

    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    } catch (error) {
      this.server = null;
      this.token = '';
      this.lastError =
        error && error.code === 'EADDRINUSE'
          ? `端口 ${port} 已被占用，请在手机同步里换一个端口。`
          : error && error.message
            ? error.message
            : '手机同步服务启动失败。';
      return { ok: false, error: this.lastError, status: this.status() };
    }

    this.server = server;
    this.port = server.address()?.port || port;
    this.startedAt = new Date().toISOString();
    this.albumCache = null;
    this.photoIndex = null;
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      for (const session of this.sessions.values()) {
        try {
          session.res.write(`: ping ${now}\n\n`);
          session.lastSeen = new Date().toISOString();
        } catch {
          // Broken stream; the close handler will clean it up.
        }
      }
    }, 25_000);
    if (this.heartbeat.unref) this.heartbeat.unref();
    return { ok: true, status: this.pushStatus() };
  }

  async stop(options = {}) {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const session of this.sessions.values()) {
      try {
        session.res.write('event: offline\ndata: {}\n\n');
        session.res.end();
      } catch {
        // Ignore.
      }
    }
    this.sessions.clear();
    // Every restart rotates the QR token and invalidates all sessions.
    this.sessionTokens.clear();
    this.sessionTokenExpiry.clear();
    this.sessionTokenDevices.clear();
    this.pairFailuresByIp.clear();
    if (!this.server) return { ok: true, status: this.status() };
    const server = this.server;
    this.server = null;
    this.token = '';
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 1200);
    });
    const status = this.status();
    if (!options.silent) this.pushStatus();
    return { ok: true, status };
  }

  async setReceiveMode(value, source = 'desktop') {
    const mode = normalizeMode(value);
    if (this.updateSettings) {
      await this.updateSettings({ receiveMode: mode });
    }
    this.broadcastEvent('mode', { mode, source });
    this.pushStatus();
    return { ok: true, mode };
  }

  async notifyAlbumChanged() {
    this.albumVersion = Date.now();
    this.albumCache = null;
    this.albumCacheAt = 0;
    this.photoIndex = null;
    this.broadcastEvent('album', { at: this.albumVersion });
    this.pushStatus();
  }

  async loadAlbum(options = {}) {
    const root = this.getRoot ? this.getRoot() : null;
    if (!root) return { root: null, album: null, libraryName: null };
    const now = Date.now();
    if (
      !options.fresh &&
      this.albumCache &&
      this.albumCacheRoot === root &&
      now - this.albumCacheAt < 2500
    ) {
      return this.albumCache;
    }
    let album = null;
    let libraryName = null;
    if (this.getAlbum) {
      album = await this.getAlbum(root);
    }
    if (!album) {
      const wrapper = await repository.readLibrary(root);
      album = wrapper ? wrapper.album : null;
      libraryName = wrapper && wrapper.library ? wrapper.library.name : null;
    } else {
      const wrapper = await repository.readLibrary(root).catch(() => null);
      libraryName = wrapper && wrapper.library ? wrapper.library.name : null;
    }
    this.libraryName = libraryName || baseName(root);
    this.albumCache = { root, album, libraryName: this.libraryName };
    this.albumCacheRoot = root;
    this.albumCacheAt = now;
    this.photoIndex = new Map();
    const photos = album && Array.isArray(album.photos) ? album.photos : [];
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      if (photo) this.photoIndex.set(photoIdFor(photo, index), photo);
    }
    return this.albumCache;
  }

  findPhoto(album, id) {
    if (this.photoIndex && this.photoIndex.has(id)) return this.photoIndex.get(id);
    if (!album || !Array.isArray(album.photos)) return null;
    for (let index = 0; index < album.photos.length; index += 1) {
      const photo = album.photos[index];
      if (photo && photoIdFor(photo, index) === id) return photo;
    }
    return null;
  }

  async handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      this.sendJson(res, 400, { ok: false, error: '请求路径不合法。' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    // X-Frame-Options covers legacy WebViews; the CSP header covers the rest.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname === '/') {
      res.writeHead(302, { Location: '/m' });
      res.end();
      return;
    }

    if (pathname === '/m/') {
      res.writeHead(301, { Location: '/m' });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/m/')) {
      await this.handlePair(req, res, pathname.slice(3));
      return;
    }

    if (pathname === '/m') {
      await this.serveIndex(res);
      return;
    }

    if (pathname === '/api/mobile/ping') {
      this.sendJson(res, 200, {
        ok: true,
        app: this.appName,
        version: this.version,
        running: Boolean(this.server),
        requiresPairing: true,
      });
      return;
    }

    if (pathname.startsWith('/api/mobile/')) {
      await this.handleApi(req, res, url, pathname);
      return;
    }

    await this.serveStatic(req, res, pathname);
  }

  async handlePair(req, res, token) {
    const supplied = String(token || '').replace(/\/+$/, '');
    const ip = clientIp(req);
    // Check the secret before the rate limit: a LAN flood of wrong guesses must
    // never lock the legitimate phone out of pairing.
    const valid = Boolean(this.server) && tokensEqual(supplied, this.token);
    if (!valid) {
      const limited = this.recordPairFailure(ip);
      if (limited) {
        res.setHeader('retry-after', '5');
        this.sendHtml(
          res,
          429,
          '<!doctype html><html lang="zh-CN"><body>尝试过于频繁，请稍后再试。</body></html>',
        );
        return;
      }
      this.sendHtml(
        res,
        403,
        `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>配对已过期</title>
        <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0918;color:#f4ecff;font-family:system-ui,sans-serif;text-align:center;padding:24px}
        h1{font-size:20px;margin:0 0 10px}p{color:#9c94b8;font-size:14px;line-height:1.7}</style></head>
        <body><main><h1>配对链接已过期</h1><p>请在电脑上重新开启手机同步，<br />再扫描新的二维码。</p></main></body></html>`,
      );
      return;
    }
    const deviceId = crypto.randomBytes(12).toString('base64url');
    // Issue a per-pairing session token. The long-lived QR token is exchanged
    // for it once and never stored on the phone in cookie form.
    const sessionToken = this.issueSessionToken(deviceId);
    this.clearPairFailures(ip);
    res.setHeader('Set-Cookie', [
      cookie(COOKIE_NAME, sessionToken),
      cookie(DEVICE_COOKIE, deviceId),
    ]);
    res.writeHead(302, { Location: '/m' });
    res.end();
  }

  recordPairFailure(ip) {
    const now = Date.now();
    const recent = (this.pairFailuresByIp.get(ip) || []).filter(
      (stamp) => now - stamp < PAIR_FAILURE_WINDOW_MS,
    );
    recent.push(now);
    this.pairFailuresByIp.set(ip, recent);
    if (this.pairFailuresByIp.size > 1024) {
      for (const [key, stamps] of this.pairFailuresByIp) {
        if (!stamps.some((stamp) => now - stamp < PAIR_FAILURE_WINDOW_MS)) {
          this.pairFailuresByIp.delete(key);
        }
      }
      // Hard cap even when every entry is recent (IPv6 rotation).
      while (this.pairFailuresByIp.size > 1024) {
        const oldest = this.pairFailuresByIp.keys().next().value;
        if (!oldest) break;
        this.pairFailuresByIp.delete(oldest);
      }
    }
    return recent.length > PAIR_FAILURE_LIMIT;
  }

  clearPairFailures(ip) {
    this.pairFailuresByIp.delete(ip);
  }

  issueSessionToken(deviceId) {
    const token = crypto.randomBytes(24).toString('base64url');
    this.sessionTokens.add(token);
    this.sessionTokenExpiry.set(token, Date.now() + SESSION_MAX_AGE * 1000);
    this.sessionTokenDevices.set(token, deviceId);
    this.pruneSessionTokens();
    return token;
  }

  pruneSessionTokens(now = Date.now()) {
    for (const token of this.sessionTokens) {
      const expiresAt = this.sessionTokenExpiry.get(token);
      if (!expiresAt || expiresAt <= now) this.revokeSessionToken(token);
    }
    while (this.sessionTokens.size > MAX_SESSION_TOKENS) {
      const oldest = this.sessionTokens.values().next().value;
      if (!oldest) break;
      this.revokeSessionToken(oldest);
    }
  }

  revokeSessionToken(token) {
    this.sessionTokens.delete(token);
    this.sessionTokenExpiry.delete(token);
    this.sessionTokenDevices.delete(token);
  }

  /** Revoke only the pairing sessions issued to one phone. */
  revokeDeviceSessions(deviceId) {
    if (!deviceId) return 0;
    let revoked = 0;
    for (const [token, id] of this.sessionTokenDevices) {
      if (id === deviceId) {
        this.revokeSessionToken(token);
        revoked += 1;
      }
    }
    return revoked;
  }

  authToken(req, url) {
    // Query-string tokens are rejected: the pairing token must never travel in
    // a URL that proxies, browsers or logs could retain.
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
    const header = req.headers['x-mobile-token'];
    if (typeof header === 'string' && header) return header;
    if (url.searchParams.has('token')) return '';
    return '';
  }

  authorized(req, url) {
    if (!this.token) return false;
    this.pruneSessionTokens();
    const supplied = this.authToken(req, url);
    if (!supplied) return false;
    // Only cookies/headers carrying a paired-device session token authenticate.
    // The long-lived QR token itself is not an API credential.
    return this.sessionTokens.has(supplied);
  }

  sessionFor(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    let deviceId = cookies[DEVICE_COOKIE];
    if (!deviceId || deviceId.length < 8) {
      deviceId = crypto.randomBytes(12).toString('base64url');
      res.setHeader('Set-Cookie', cookie(DEVICE_COOKIE, deviceId));
    }
    let session = this.sessions.get(deviceId);
    if (!session) {
      session = {
        id: deviceId,
        name: deviceLabel(req.headers['user-agent']),
        platform: devicePlatform(req.headers['user-agent']),
        ip: clientIp(req),
        connectedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        heartbeatAt: null,
        res: null,
      };
      this.sessions.set(deviceId, session);
    }
    session.lastSeen = new Date().toISOString();
    if (!session.heartbeatAt) {
      const platform = devicePlatform(req.headers['user-agent']);
      session.name = deviceLabel(req.headers['user-agent']);
      session.platform = platform;
    }
    return session;
  }

  async handleApi(req, res, url, pathname) {
    if (!this.authorized(req, url)) {
      this.sendJson(res, 401, { ok: false, code: 'pairing-required', error: '请重新扫描电脑上的二维码。' });
      return;
    }

    const deviceId = parseCookies(req.headers.cookie)[DEVICE_COOKIE];
    if (deviceId && this.blockedDevices.has(deviceId)) {
      // The desktop user explicitly disconnected this phone. It must scan a
      // fresh QR code (which issues a new device id) to come back.
      this.sendJson(res, 401, {
        ok: false,
        code: 'device-blocked',
        error: '这台手机已被电脑断开连接，请重新扫描二维码。',
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/mobile/hello') {
      const session = this.sessionFor(req, res);
      const { root, libraryName } = await this.loadAlbum();
      this.sendJson(res, 200, {
        ok: true,
        server: {
          app: this.appName,
          version: this.version,
          libraryName: libraryName || '未命名相册',
          hasLibrary: Boolean(root),
          receiveMode: this.mode(),
          serverTime: new Date().toISOString(),
          deviceId: session.id,
        },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/mobile/album') {
      this.sessionFor(req, res);
      const { root, album, libraryName } = await this.loadAlbum();
      if (!root || !album) {
        this.sendJson(res, 503, { ok: false, error: '电脑端尚未连接存储库。' });
        return;
      }
      const payload = buildMobileAlbum(album, {
        version: this.version,
        libraryName,
        mode: this.mode(),
      });
      const body = JSON.stringify(payload);
      const etag = `"${crypto.createHash('sha1').update(body).digest('hex')}"`;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/mobile/events') {
      const session = this.sessionFor(req, res);
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      res.write(`event: ready\ndata: ${JSON.stringify({ deviceId: session.id })}\n\n`);
      session.res = res;
      session.heartbeatAt = new Date().toISOString();
      this.pushStatus();
      const cleanup = () => {
        if (session.res === res) {
          session.res = null;
          session.heartbeatAt = null;
        }
        this.pushStatus();
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/mobile/mode') {
      const body = await readBody(req);
      const result = await this.setReceiveMode(body.mode, 'phone');
      this.sendJson(res, 200, { ok: true, mode: result.mode });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/mobile/leave') {
      const session = this.sessionFor(req, res);
      // Leaving also invalidates this device's session token so the cookie
      // cannot be replayed after the phone closes the page.
      const cookieToken = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (cookieToken) this.revokeSessionToken(cookieToken);
      if (session.res) {
        try {
          session.res.end();
        } catch {
          // Ignore.
        }
      }
      this.sessions.delete(session.id);
      this.pushStatus();
      this.sendJson(res, 200, { ok: true });
      return;
    }

    const mediaMatch = /^\/api\/mobile\/photos\/([^/]+)\/(thumb|original)$/.exec(pathname);
    if (req.method === 'GET' && mediaMatch) {
      this.sessionFor(req, res);
      await this.servePhoto(req, res, url, decodeURIComponent(mediaMatch[1]), mediaMatch[2]);
      return;
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  async servePhoto(req, res, url, id, kind) {
    const { root, album } = await this.loadAlbum();
    if (!root || !album) {
      this.sendJson(res, 503, { ok: false, error: '存储库不可用。' });
      return;
    }
    const photo = this.findPhoto(album, id);
    if (!photo) {
      this.sendJson(res, 404, { ok: false, error: '照片不存在。' });
      return;
    }
    if (photo.missing) {
      this.sendJson(res, 410, { ok: false, error: '照片文件已缺失。' });
      return;
    }

    if (kind === 'thumb') {
      if (!photo.previewPath) {
        this.sendJson(res, 404, { ok: false, error: '这张照片还没有缩略图。' });
        return;
      }
      const previewDir = this.getPreviewDir
        ? await this.getPreviewDir(root)
        : repository.previewDir(root, await repository.readLibrary(root));
      const absolute = await repository.resolveRealInside(previewDir, photo.previewPath);
      if (!absolute) {
        this.sendJson(res, 403, { ok: false, error: '缩略图路径不合法。' });
        return;
      }
      const served = await this.serveFile(req, res, absolute, {
        cacheControl: 'private, max-age=31536000, immutable',
      });
      if (!served) this.sendJson(res, 404, { ok: false, error: '缩略图文件不存在。' });
      return;
    }

    if (!photo.libraryPath) {
      if (isRemoteUrl(photo.src)) {
        res.writeHead(302, { Location: photo.src });
        res.end();
        return;
      }
      this.sendJson(res, 404, { ok: false, error: '这张照片没有可下载的原图。' });
      return;
    }
    const absolute = await repository.resolveRealInside(root, photo.libraryPath);
    if (!absolute) {
      this.sendJson(res, 403, { ok: false, error: '原图路径不合法。' });
      return;
    }
    const download = url.searchParams.get('download') === '1';
    const served = await this.serveFile(req, res, absolute, {
      contentType: photoMimeFor(absolute),
      // Streamed originals are intentionally never cached on the phone: the
      // "live" mode must not consume phone storage.
      cacheControl: 'private, no-store',
      'content-disposition': download
        ? `attachment; filename*=UTF-8''${encodeURIComponent(
            safeFileName(photo.libraryPath, `memory-${Date.now()}.jpg`),
          )}`
        : undefined,
    });
    if (!served) this.sendJson(res, 404, { ok: false, error: '原图文件不存在。' });
  }

  async serveIndex(res) {
    const index = path.join(this.distDir, 'index.html');
    const html = await fsp.readFile(index).catch(() => null);
    if (!html) {
      this.sendHtml(
        res,
        503,
        '<!doctype html><html><body style="background:#0b0918;color:#f4ecff;font-family:system-ui;padding:32px">手机客户端资源缺失，请先重新构建桌面客户端。</body></html>',
      );
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  async serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      this.sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    const relative = pathname.replace(/^\/+/, '');
    if (!relative || relative.startsWith('api/')) {
      this.sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const absolute = path.resolve(this.distDir, relative);
    const within = path.relative(this.distDir, absolute);
    if (within.startsWith('..') || path.isAbsolute(within)) {
      this.sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }
    const immutable = relative.startsWith('assets/');
    const served = await this.serveFile(req, res, absolute, {
      cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (!served) {
      // The mobile client is a single-page app; unknown non-asset paths show
      // the shell instead of a 404.
      if (!relative.startsWith('assets/')) {
        await this.serveIndex(res);
        return;
      }
      this.sendJson(res, 404, { ok: false, error: 'Not found' });
    }
  }

  sendJson(res, status, payload) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  sendHtml(res, status, html) {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(html),
      'cache-control': 'no-store',
    });
    res.end(html);
  }

  async serveFile(req, res, absolutePath, options = {}) {
    const stat = await fsp.stat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile()) return false;

    const headers = {
      'content-type': options.contentType || mimeFor(absolutePath),
      'accept-ranges': 'bytes',
      'cache-control': options.cacheControl || 'no-cache',
    };
    if (options['content-disposition']) {
      headers['content-disposition'] = options['content-disposition'];
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
      res.end();
      return true;
    }

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : stat.size - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
          const safeEnd = Math.min(end, stat.size - 1);
          res.writeHead(206, {
            ...headers,
            'content-length': String(safeEnd - start + 1),
            'content-range': `bytes ${start}-${safeEnd}/${stat.size}`,
          });
          fs.createReadStream(absolutePath, { start, end: safeEnd }).pipe(res);
          return true;
        }
      }
    }

    res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
    fs.createReadStream(absolutePath).pipe(res);
    return true;
  }

  sendEvent(session, event, payload) {
    if (!session || !session.res) return false;
    try {
      session.res.write(`event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`);
      return true;
    } catch {
      return false;
    }
  }

  broadcastEvent(event, payload) {
    let delivered = 0;
    for (const session of this.sessions.values()) {
      if (!session.res) continue;
      if (this.sendEvent(session, event, payload)) delivered += 1;
    }
    return delivered;
  }

  async cast(photoId, options = {}) {
    const { root, album } = await this.loadAlbum({ fresh: true });
    if (!root || !album) return { ok: false, error: '存储库不可用，无法投送。', delivered: 0 };
    const photo = this.findPhoto(album, photoId);
    if (!photo) return { ok: false, error: '照片不存在。', delivered: 0 };
    const payload = buildMobileAlbum(
      { ...album, photos: [photo] },
      { version: this.version, libraryName: '', mode: this.mode() },
    ).photos[0];
    if (!payload) return { ok: false, error: '这张照片没有可投送的预览。', delivered: 0 };

    const mode = normalizeMode(options.mode || this.mode());
    const cast = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      photo: payload,
      mode,
    };
    const delivered = this.broadcastEvent('cast', cast);
    this.lastCast = {
      id: cast.id,
      at: cast.at,
      photoId: payload.id,
      note: payload.note,
      mode,
      delivered,
    };
    const result = {
      ok: delivered > 0,
      delivered,
      cast: this.lastCast,
      error: delivered > 0 ? undefined : '手机还没有连接。请先让手机扫码并保持页面打开。',
    };
    this.onCast(result);
    this.pushStatus();
    return result;
  }
}

module.exports = {
  DEFAULT_PORT,
  RECEIVE_MODES,
  MobileSyncService,
  buildMobileAlbum,
  deviceLabel,
  devicePlatform,
  lanAddresses,
  normalizeMode,
  parseCookies,
  photoMimeFor,
  safeFileName,
  scoreAddress,
  tokensEqual,
};
