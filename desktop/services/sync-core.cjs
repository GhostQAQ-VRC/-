'use strict';

/**
 * Pure cloud-sync engine (no Electron imports) so it can be unit-tested with a
 * temporary library and a local HTTP server.
 *
 * Cloud providers copy original files into date folders:
 *   <baseFolder>/<YYYY-MM-DD>/<original-name>
 * Originals are opened read-only; the sync never writes into the library.
 */

const path = require('node:path');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { CACHE_DIR } = require('../library/constants.cjs');
const repository = require('../library/repository.cjs');
const { quickContentHash } = require('../library/quick-hash.cjs');

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const BAIDU_CHUNK_BYTES = 4 * 1024 * 1024;

const CLOUD_PROVIDERS = [
  {
    id: 'folder',
    kind: 'folder',
    label: '云盘同步文件夹（通用）',
    description:
      '选择 Google Drive / 123云盘 / 百度网盘等客户端在本机建立的同步目录，程序会把原图复制到日期文件夹，由云盘客户端上传。无需 API 凭据。',
  },
  {
    id: 'gdrive-folder',
    kind: 'folder',
    label: 'Google Drive（同步文件夹）',
    description:
      '使用 Google Drive 桌面客户端的本地同步目录。安装客户端并登录后选择该目录即可。',
  },
  {
    id: '123pan-folder',
    kind: 'folder',
    label: '123云盘（同步文件夹）',
    description:
      '使用 123云盘客户端的本地同步目录。程序只写入日期文件夹，不会改动云端已有文件。',
  },
  {
    id: 'baidu-folder',
    kind: 'folder',
    label: '百度网盘（同步文件夹）',
    description:
      '使用百度网盘客户端的本地同步空间目录。适合不想配置开放平台 API 的情况。',
  },
  {
    id: 'webdav',
    kind: 'webdav',
    label: 'WebDAV / NAS',
    description:
      '支持 Basic Auth 的 WebDAV（坚果云、Nextcloud、Alist、群晖等）。每张照片直接上传到日期文件夹。',
  },
  {
    id: 'google',
    kind: 'google',
    label: 'Google Drive API',
    description:
      '直接调用 Google Drive v3 上传原图。需要 OAuth Access Token（可选 Refresh Token / Client ID / Secret 自动续期）。',
  },
  {
    id: 'baidu',
    kind: 'baidu',
    label: '百度网盘 API',
    description:
      '直接调用百度网盘开放平台上传原图（/apps/<应用目录>/…）。需要 AppKey、SecretKey 与 Access/Refresh Token。',
  },
];

const FOLDER_PROVIDER_IDS = new Set(
  CLOUD_PROVIDERS.filter((provider) => provider.kind === 'folder').map((provider) => provider.id),
);

function nowIso() {
  return new Date().toISOString();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizeSegments(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[<>:"|?*\u0000-\u001f]/g, '-').slice(0, 80))
    .filter(Boolean);
}

function safeFileName(value) {
  const base = path.basename(String(value || 'photo'));
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return cleaned || 'photo';
}

function safeDateKey(value) {
  const text = String(value || '');
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (match) return match[1];
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return 'unknown-date';
}

function encodeRelative(relativePath) {
  return String(relativePath || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function createHttpClient(fetchImpl, parentSignal) {
  return async function request(url, options = {}, timeoutMs = 120000) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('请求超时'));
    }, timeoutMs);
    const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort(parentSignal.reason);
      else parentSignal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', onAbort);
    }
  };
}

async function responseInfo(response) {
  const text = await response.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

function snippet(text, max = 220) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function isAuthError(error) {
  return Boolean(error && (error.status === 401 || error.status === 403 || error.fatalAuth));
}

class SyncError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'SyncError';
    this.status = options.status;
    this.fatalAuth = options.fatalAuth === true;
  }
}

async function readManifest(root) {
  const file = path.join(root, CACHE_DIR, 'sync', 'manifest.json');
  try {
    const parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
      return { version: 1, entries: parsed.entries, updatedAt: parsed.updatedAt || null };
    }
  } catch {
    // Missing/corrupt manifest simply means a full upload.
  }
  return { version: 1, entries: {}, updatedAt: null };
}

async function writeManifest(root, manifest) {
  const dir = path.join(root, CACHE_DIR, 'sync');
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, 'manifest.json');
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const payload = { ...manifest, version: 1, updatedAt: nowIso() };
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  try {
    await fsp.rename(tmp, target);
  } catch {
    await fsp.rm(target, { force: true });
    await fsp.rename(tmp, target);
  }
  return payload;
}

async function resetManifest(root) {
  await fsp.rm(path.join(root, CACHE_DIR, 'sync', 'manifest.json'), { force: true });
}

function manifestScope(settings) {
  const provider = settings.provider || 'folder';
  if (FOLDER_PROVIDER_IDS.has(provider)) {
    return `${provider}|${settings.folderRoot || ''}|${settings.baseFolder || ''}`;
  }
  if (provider === 'webdav') {
    return `webdav|${settings.webdavUrl || ''}|${settings.baseFolder || ''}`;
  }
  if (provider === 'google') {
    return `google|${settings.baseFolder || ''}`;
  }
  if (provider === 'baidu') {
    return `baidu|${settings.baiduAppName || ''}|${settings.baseFolder || ''}`;
  }
  return `${provider}|${settings.baseFolder || ''}`;
}

/* ------------------------------------------------------------------ *
 * Folder provider (Google Drive / 123 / Baidu desktop sync folders)
 * ------------------------------------------------------------------ */

class FolderProvider {
  constructor(settings) {
    this.id = settings.provider;
    this.root = String(settings.folderRoot || '').trim();
    this.baseSegments = normalizeSegments(settings.baseFolder || 'Hoshikuzu Album');
  }

  assertReady() {
    if (!this.root) throw new SyncError('请选择云盘客户端的本地同步文件夹。');
  }

  async test() {
    this.assertReady();
    await fsp.mkdir(this.root, { recursive: true });
    const probe = path.join(this.root, `.hoshikuzu-sync-test-${process.pid}`);
    await fsp.writeFile(probe, 'ok', 'utf8');
    await fsp.rm(probe, { force: true });
    return { ok: true, message: `可写入 ${this.root}` };
  }

  async ensureBaseFolder() {
    this.assertReady();
    const dir = path.join(this.root, ...this.baseSegments);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  async ensureDateFolder(date) {
    const base = await this.ensureBaseFolder();
    const dir = path.join(base, safeDateKey(date));
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  async uploadFile(absPath, remoteName, folder) {
    const target = path.join(folder, safeFileName(remoteName));
    const relative = path.relative(this.root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new SyncError('远程文件名不合法。');
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    await fsp.copyFile(absPath, tmp);
    try {
      await fsp.rm(target, { force: true });
      await fsp.rename(tmp, target);
    } catch (error) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
    const stat = await fsp.stat(target);
    return { remoteId: null, name: path.basename(target), size: stat.size };
  }
}

/* ------------------------------------------------------------------ *
 * WebDAV
 * ------------------------------------------------------------------ */

class WebDavProvider {
  constructor(settings, secrets, ctx) {
    this.id = 'webdav';
    this.baseUrl = String(settings.webdavUrl || '').trim().replace(/\/+$/, '');
    this.username = String(settings.webdavUsername || '').trim();
    this.password = secrets.webdavPassword || '';
    this.baseSegments = normalizeSegments(settings.baseFolder || 'Hoshikuzu Album');
    this.request = createHttpClient(ctx.fetchImpl, ctx.signal);
  }

  assertReady() {
    if (!/^https?:\/\//i.test(this.baseUrl)) {
      throw new SyncError('WebDAV 地址需要以 http:// 或 https:// 开头。');
    }
  }

  authHeaders(extra = {}) {
    const headers = { ...extra };
    if (this.username || this.password) {
      headers.authorization = `Basic ${Buffer.from(
        `${this.username}:${this.password}`,
        'utf8',
      ).toString('base64')}`;
    }
    return headers;
  }

  urlFor(segments = [], name = '') {
    const parts = [...segments, ...(name ? [name] : [])].map((segment) =>
      encodeURIComponent(segment),
    );
    return `${this.baseUrl}/${parts.join('/')}${name ? '' : '/'}`;
  }

  async test() {
    this.assertReady();
    const response = await this.request(this.urlFor([]), {
      method: 'PROPFIND',
      headers: this.authHeaders({ depth: '0' }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new SyncError('WebDAV 认证失败，请检查用户名与密码。', { status: response.status });
    }
    if (response.status === 207 || response.status === 200) {
      return { ok: true, message: 'WebDAV 连接正常' };
    }
    if (response.status === 404 || response.status === 405) {
      return { ok: true, message: '服务器可访问，基础目录将在同步时创建。' };
    }
    throw new SyncError(`WebDAV 返回 HTTP ${response.status}。`, { status: response.status });
  }

  async ensureSegments(segments) {
    for (let index = 1; index <= segments.length; index += 1) {
      const url = this.urlFor(segments.slice(0, index));
      const response = await this.request(url, {
        method: 'MKCOL',
        headers: this.authHeaders(),
      });
      if (response.status === 401 || response.status === 403) {
        throw new SyncError('WebDAV 认证失败。', {
          status: response.status,
          fatalAuth: true,
        });
      }
      // 201 created, 405 already exists, 301/302 path exists behind a redirect.
      if (![201, 204, 405, 301, 302].includes(response.status)) {
        throw new SyncError(`无法创建 WebDAV 文件夹（HTTP ${response.status}）。`, {
          status: response.status,
        });
      }
    }
    return this.urlFor(segments);
  }

  async ensureBaseFolder() {
    this.assertReady();
    return this.ensureSegments(this.baseSegments);
  }

  async ensureDateFolder(date) {
    return this.ensureSegments([...this.baseSegments, safeDateKey(date)]);
  }

  async uploadFile(absPath, remoteName, folderUrl) {
    const stat = await fsp.stat(absPath);
    if (stat.size > MAX_UPLOAD_BYTES) {
      throw new SyncError(`文件超过 ${formatBytes(MAX_UPLOAD_BYTES)}，已跳过。`);
    }
    const body = await fsp.readFile(absPath);
    const url = `${String(folderUrl).replace(/\/+$/, '')}/${encodeURIComponent(
      safeFileName(remoteName),
    )}`;
    const response = await this.request(
      url,
      {
        method: 'PUT',
        headers: this.authHeaders({
          'content-type': 'application/octet-stream',
          'content-length': String(body.length),
        }),
        body,
      },
      180000,
    );
    if (response.status === 401 || response.status === 403) {
      throw new SyncError('WebDAV 认证失败。', {
        status: response.status,
        fatalAuth: true,
      });
    }
    if (![200, 201, 204, 207].includes(response.status)) {
      throw new SyncError(`WebDAV 上传失败（HTTP ${response.status}）。`, {
        status: response.status,
      });
    }
    return { remoteId: null, name: safeFileName(remoteName), size: body.length };
  }
}

/* ------------------------------------------------------------------ *
 * Google Drive v3
 * ------------------------------------------------------------------ */

class GoogleDriveProvider {
  constructor(settings, secrets, ctx) {
    this.id = 'google';
    this.clientId = String(settings.googleClientId || '').trim();
    this.baseFolder = normalizeSegments(settings.baseFolder || 'Hoshikuzu Album');
    this.baseUrl = String(settings.googleBaseUrl || 'https://www.googleapis.com').replace(/\/+$/, '');
    this.uploadUrl = String(
      settings.googleUploadBaseUrl || 'https://www.googleapis.com/upload/drive/v3',
    ).replace(/\/+$/, '');
    this.oauthUrl = String(settings.googleOAuthUrl || 'https://oauth2.googleapis.com/token');
    this.accessToken = secrets.googleAccessToken || '';
    this.refreshToken = secrets.googleRefreshToken || '';
    this.clientSecret = secrets.googleClientSecret || '';
    this.request = createHttpClient(ctx.fetchImpl, ctx.signal);
    this.setSecret = ctx.setSecret || (async () => {});
    this.folderCache = new Map();
  }

  assertReady() {
    if (!this.accessToken && !(this.refreshToken && this.clientId && this.clientSecret)) {
      throw new SyncError('请填写 Google Access Token，或填写 Client ID/Secret + Refresh Token 自动续期。');
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.clientId || !this.clientSecret) {
      throw new SyncError('Google Access Token 已过期，请重新填写或配置 Refresh Token。', {
        status: 401,
        fatalAuth: true,
      });
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await this.request(this.oauthUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const info = await responseInfo(response);
    if (!response.ok || !info.json?.access_token) {
      throw new SyncError(
        `Google Token 续期失败：${snippet(info.json?.error_description || info.text)}`,
        { status: 401, fatalAuth: true },
      );
    }
    this.accessToken = info.json.access_token;
    await this.setSecret('syncGoogleAccessToken', this.accessToken);
    if (info.json.refresh_token) {
      this.refreshToken = info.json.refresh_token;
      await this.setSecret('syncGoogleRefreshToken', this.refreshToken);
    }
  }

  async ensureToken() {
    if (!this.accessToken) await this.refreshAccessToken();
  }

  async api(url, options = {}, retried = false) {
    await this.ensureToken();
    const response = await this.request(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (response.status === 401 && !retried) {
      await this.refreshAccessToken();
      return this.api(url, options, true);
    }
    if (!response.ok) {
      const info = await responseInfo(response);
      throw new SyncError(
        `Google Drive 请求失败（HTTP ${response.status}）：${snippet(
          info.json?.error?.message || info.text,
        )}`,
        { status: response.status, fatalAuth: response.status === 401 },
      );
    }
    return response;
  }

  async test() {
    this.assertReady();
    const response = await this.api(
      `${this.baseUrl}/drive/v3/about?fields=user,storageQuota`,
    );
    const info = await responseInfo(response);
    const email = info.json?.user?.emailAddress || info.json?.user?.displayName;
    return { ok: true, message: email ? `已连接 Google Drive：${email}` : 'Google Drive 连接正常' };
  }

  async ensureFolderPath(segments) {
    let parent = 'root';
    for (const segment of segments) {
      const cacheKey = `${parent}/${segment}`;
      if (this.folderCache.has(cacheKey)) {
        parent = this.folderCache.get(cacheKey);
        continue;
      }
      const escaped = String(segment).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const q = `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parent}' in parents`;
      const params = new URLSearchParams({
        q,
        fields: 'files(id,name)',
        pageSize: '10',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      const found = await this.api(`${this.baseUrl}/drive/v3/files?${params.toString()}`);
      const foundInfo = await responseInfo(found);
      let folderId = foundInfo.json?.files?.[0]?.id;
      if (!folderId) {
        const created = await this.api(
          `${this.baseUrl}/drive/v3/files?fields=id&supportsAllDrives=true`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: segment,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [parent],
            }),
          },
        );
        const createdInfo = await responseInfo(created);
        folderId = createdInfo.json?.id;
        if (!folderId) throw new SyncError('无法创建 Google Drive 文件夹。');
      }
      this.folderCache.set(cacheKey, folderId);
      parent = folderId;
    }
    return parent;
  }

  async ensureBaseFolder() {
    this.assertReady();
    return this.ensureFolderPath(this.baseFolder);
  }

  async ensureDateFolder(date) {
    return this.ensureFolderPath([...this.baseFolder, safeDateKey(date)]);
  }

  async uploadFile(absPath, remoteName, folderId, retried = false) {
    const stat = await fsp.stat(absPath);
    if (stat.size > MAX_UPLOAD_BYTES) {
      throw new SyncError(`文件超过 ${formatBytes(MAX_UPLOAD_BYTES)}，已跳过。`);
    }
    const buffer = await fsp.readFile(absPath);
    await this.ensureToken();
    const start = await this.request(
      `${this.uploadUrl}/files?uploadType=resumable&fields=id,name,size&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
          'x-upload-content-type': 'application/octet-stream',
          'x-upload-content-length': String(buffer.length),
        },
        body: JSON.stringify({ name: safeFileName(remoteName), parents: [folderId] }),
      },
    );
    if (start.status === 401 && !retried) {
      await this.refreshAccessToken();
      return this.uploadFile(absPath, remoteName, folderId, true);
    }
    if (!start.ok) {
      const info = await responseInfo(start);
      throw new SyncError(
        `Google Drive 上传初始化失败（HTTP ${start.status}）：${snippet(
          info.json?.error?.message || info.text,
        )}`,
        { status: start.status, fatalAuth: start.status === 401 },
      );
    }
    const location = start.headers.get('location');
    if (!location) throw new SyncError('Google Drive 未返回上传地址。');
    const put = await this.request(location, {
      method: 'PUT',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(buffer.length),
      },
      body: buffer,
    });
    if (put.status === 401 && !retried) {
      await this.refreshAccessToken();
      return this.uploadFile(absPath, remoteName, folderId, true);
    }
    if (!put.ok) {
      const info = await responseInfo(put);
      throw new SyncError(
        `Google Drive 上传失败（HTTP ${put.status}）：${snippet(
          info.json?.error?.message || info.text,
        )}`,
        { status: put.status, fatalAuth: put.status === 401 },
      );
    }
    const info = await responseInfo(put);
    return {
      remoteId: info.json?.id || null,
      name: info.json?.name || safeFileName(remoteName),
      size: Number(info.json?.size) || buffer.length,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Baidu Netdisk open API
 * ------------------------------------------------------------------ */

class BaiduPanProvider {
  constructor(settings, secrets, ctx) {
    this.id = 'baidu';
    this.appKey = String(settings.baiduAppKey || '').trim();
    this.appName = String(settings.baiduAppName || '').trim().replace(/^\/+|\/+$/g, '');
    this.baseFolder = normalizeSegments(settings.baseFolder || 'Hoshikuzu Album');
    this.baseUrl = String(settings.baiduBaseUrl || 'https://pan.baidu.com').replace(/\/+$/, '');
    this.oauthUrl = String(
      settings.baiduOAuthUrl || 'https://openapi.baidu.com/oauth/2.0/token',
    );
    this.accessToken = secrets.baiduAccessToken || '';
    this.refreshToken = secrets.baiduRefreshToken || '';
    this.secretKey = secrets.baiduSecretKey || '';
    this.request = createHttpClient(ctx.fetchImpl, ctx.signal);
    this.setSecret = ctx.setSecret || (async () => {});
    this.uploadServer = '';
  }

  assertReady() {
    if (!this.appName) {
      throw new SyncError('请填写百度网盘开放平台的应用目录名（/apps/<应用目录名>）。');
    }
    if (!this.accessToken && !(this.refreshToken && this.appKey && this.secretKey)) {
      throw new SyncError('请填写百度网盘 Access Token，或填写 AppKey/SecretKey + Refresh Token。');
    }
  }

  async refreshAccessToken() {
    if (!this.refreshToken || !this.appKey || !this.secretKey) {
      throw new SyncError('百度网盘 Access Token 已过期，请重新填写或配置 Refresh Token。', {
        status: 401,
        fatalAuth: true,
      });
    }
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.appKey,
      client_secret: this.secretKey,
    });
    const response = await this.request(`${this.oauthUrl}?${params.toString()}`);
    const info = await responseInfo(response);
    if (!response.ok || !info.json?.access_token) {
      throw new SyncError(
        `百度网盘 Token 续期失败：${snippet(info.json?.error_description || info.text)}`,
        { status: 401, fatalAuth: true },
      );
    }
    this.accessToken = info.json.access_token;
    await this.setSecret('syncBaiduAccessToken', this.accessToken);
    if (info.json.refresh_token) {
      this.refreshToken = info.json.refresh_token;
      await this.setSecret('syncBaiduRefreshToken', this.refreshToken);
    }
  }

  async ensureToken() {
    if (!this.accessToken) await this.refreshAccessToken();
  }

  remotePath(segments) {
    return `/apps/${this.appName}/${segments.join('/')}`;
  }

  async formRequest(method, params, retried = false) {
    await this.ensureToken();
    const query = new URLSearchParams({
      method,
      access_token: this.accessToken,
    });
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null) body.set(key, String(value));
    }
    const response = await this.request(
      `${this.baseUrl}/rest/2.0/xpan/file?${query.toString()}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
      120000,
    );
    const info = await responseInfo(response);
    const errno = Number(info.json?.errno ?? 0);
    const authError = [110, 111, -6].includes(errno) || response.status === 401;
    if (authError && !retried) {
      await this.refreshAccessToken();
      return this.formRequest(method, params, true);
    }
    return { ...info, errno, authError };
  }

  async test() {
    this.assertReady();
    await this.ensureToken();
    const response = await this.request(
      `${this.baseUrl}/rest/2.0/xpan/nas?method=uinfo&access_token=${encodeURIComponent(
        this.accessToken,
      )}`,
    );
    const info = await responseInfo(response);
    if (!response.ok || Number(info.json?.errno ?? 0) !== 0) {
      throw new SyncError(
        `百度网盘连接失败：${snippet(info.json?.errmsg || info.text)}`,
        { status: response.status },
      );
    }
    const name = info.json?.netdisk_name || info.json?.baidu_name || '';
    return { ok: true, message: name ? `已连接百度网盘：${name}` : '百度网盘连接正常' };
  }

  async ensureFolderSegments(segments) {
    let current = [];
    for (const segment of segments) {
      current = [...current, segment];
      const remotePath = this.remotePath(current);
      const result = await this.formRequest('create', {
        path: remotePath,
        isdir: 1,
        size: 0,
      });
      if (result.errno !== 0 && result.errno !== -8) {
        throw new SyncError(
          `无法创建百度网盘文件夹 ${remotePath}（errno ${result.errno}）。`,
          { status: 401, fatalAuth: result.authError },
        );
      }
    }
    return this.remotePath(segments);
  }

  async ensureBaseFolder() {
    this.assertReady();
    await this.ensureFolderSegments([]);
    return this.ensureFolderSegments(this.baseFolder);
  }

  async ensureDateFolder(date) {
    return this.ensureFolderSegments([...this.baseFolder, safeDateKey(date)]);
  }

  async getUploadServer(remotePath, uploadId) {
    if (this.uploadServer) return this.uploadServer;
    const params = new URLSearchParams({
      method: 'locateupload',
      appid: '250528',
      access_token: this.accessToken,
      path: remotePath,
      uploadid: uploadId,
      upload_version: '2.0',
    });
    const response = await this.request(
      `https://d.pcs.baidu.com/rest/2.0/pcs/file?${params.toString()}`,
    );
    const info = await responseInfo(response);
    const server =
      info.json?.servers?.[0]?.server ||
      info.json?.bak_servers?.[0]?.server ||
      (info.json?.host ? `https://${info.json.host}` : '');
    if (!server) {
      throw new SyncError(
        `百度网盘未返回上传服务器：${snippet(info.json?.error_msg || info.text)}`,
      );
    }
    this.uploadServer = String(server).replace(/\/+$/, '');
    return this.uploadServer;
  }

  async uploadFile(absPath, remoteName, folderPath) {
    const stat = await fsp.stat(absPath);
    if (stat.size > MAX_UPLOAD_BYTES) {
      throw new SyncError(`文件超过 ${formatBytes(MAX_UPLOAD_BYTES)}，已跳过。`);
    }
    const buffer = await fsp.readFile(absPath);
    const chunks = [];
    for (let offset = 0; offset < buffer.length; offset += BAIDU_CHUNK_BYTES) {
      chunks.push(buffer.subarray(offset, offset + BAIDU_CHUNK_BYTES));
    }
    if (chunks.length === 0) chunks.push(Buffer.alloc(0));
    const blockList = chunks.map((chunk) =>
      crypto.createHash('md5').update(chunk).digest('hex'),
    );
    const wholeMd5 = crypto.createHash('md5').update(buffer).digest('hex');
    const sliceMd5 = crypto
      .createHash('md5')
      .update(buffer.subarray(0, 256 * 1024))
      .digest('hex');
    const targetPath = `${folderPath}/${safeFileName(remoteName)}`;

    const pre = await this.formRequest('precreate', {
      path: targetPath,
      size: buffer.length,
      isdir: 0,
      block_list: JSON.stringify(blockList),
      autoinit: 1,
      rtype: 3,
      'content-md5': wholeMd5,
      'slice-md5': sliceMd5,
    });
    if (pre.errno !== 0 || !pre.json?.uploadid) {
      throw new SyncError(
        `百度网盘预上传失败（errno ${pre.errno}）：${snippet(
          pre.json?.errmsg || pre.text,
        )}`,
        { status: 401, fatalAuth: pre.authError },
      );
    }
    const uploadId = pre.json.uploadid;
    const needed = Array.isArray(pre.json.block_list) && pre.json.block_list.length
      ? pre.json.block_list.map(Number)
      : chunks.map((_, index) => index);
    const server = await this.getUploadServer(targetPath, uploadId);

    for (const index of needed) {
      const chunk = chunks[index];
      if (!chunk) continue;
      const query = new URLSearchParams({
        method: 'upload',
        access_token: this.accessToken,
        type: 'tmpfile',
        path: targetPath,
        uploadid: uploadId,
        partseq: String(index),
      });
      const form = new FormData();
      form.append('file', new Blob([chunk]), 'blob');
      const response = await this.request(
        `${server}/rest/2.0/pcs/superfile2?${query.toString()}`,
        { method: 'POST', body: form },
        180000,
      );
      const info = await responseInfo(response);
      if (!response.ok || Number(info.json?.errno ?? 0) !== 0) {
        throw new SyncError(
          `百度网盘分片上传失败（errno ${info.json?.errno ?? response.status}）。`,
          { status: response.status, fatalAuth: response.status === 401 },
        );
      }
    }

    const created = await this.formRequest('create', {
      path: targetPath,
      size: buffer.length,
      isdir: 0,
      block_list: JSON.stringify(blockList),
      uploadid: uploadId,
      rtype: 3,
    });
    if (created.errno !== 0) {
      throw new SyncError(
        `百度网盘创建文件失败（errno ${created.errno}）：${snippet(
          created.json?.errmsg || created.text,
        )}`,
        { status: 401, fatalAuth: created.authError },
      );
    }
    return {
      remoteId: created.json?.fs_id ? String(created.json.fs_id) : null,
      name: safeFileName(remoteName),
      size: buffer.length,
    };
  }
}

function createCloudProvider(settings, secrets, ctx) {
  const provider = settings.provider || 'folder';
  if (FOLDER_PROVIDER_IDS.has(provider)) return new FolderProvider(settings);
  if (provider === 'webdav') return new WebDavProvider(settings, secrets, ctx);
  if (provider === 'google') return new GoogleDriveProvider(settings, secrets, ctx);
  if (provider === 'baidu') return new BaiduPanProvider(settings, secrets, ctx);
  throw new SyncError(`不支持的云盘类型：${provider}`);
}

/* ------------------------------------------------------------------ *
 * Shared plan builder
 * ------------------------------------------------------------------ */

async function buildCloudPlan(root, album) {
  const dates = new Map();
  const seen = new Set();
  let libraryPhotos = 0;
  let skipped = 0;
  const photos = Array.isArray(album?.photos) ? album.photos : [];
  for (const photo of photos) {
    if (photo.mediaKind !== 'library' || !photo.libraryPath || photo.missing) continue;
    libraryPhotos += 1;
    const absolute = await repository.resolveRealInside(root, photo.libraryPath);
    if (!absolute) {
      skipped += 1;
      continue;
    }
    let stat;
    try {
      stat = await fsp.stat(absolute);
    } catch {
      skipped += 1;
      continue;
    }
    if (!stat.isFile()) {
      skipped += 1;
      continue;
    }
    const hash = photo.contentHash || (await quickContentHash(absolute, stat.size));
    const date = safeDateKey(photo.capturedAt || new Date(stat.mtimeMs).toISOString());
    const key = `${date}|${hash}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    if (!dates.has(date)) dates.set(date, []);
    dates.get(date).push({
      absolute,
      relative: photo.libraryPath,
      hash,
      date,
      size: stat.size,
      name: safeFileName(photo.libraryPath),
      capturedAt: photo.capturedAt,
    });
  }

  // Avoid two different photos with the same basename in one date folder.
  for (const [date, files] of dates) {
    const used = new Map();
    const sorted = [...files].sort((a, b) =>
      String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')),
    );
    for (const file of sorted) {
      const current = used.get(file.name) || 0;
      if (current > 0) {
        const parsed = path.parse(file.name);
        let next = `${parsed.name}~${file.hash.slice(0, 6)}${parsed.ext}`;
        let index = 1;
        while (used.has(next)) {
          next = `${parsed.name}~${file.hash.slice(0, 6)}-${index}${parsed.ext}`;
          index += 1;
        }
        file.name = next;
      }
      used.set(file.name, (used.get(file.name) || 0) + 1);
    }
    dates.set(date, sorted);
  }

  return {
    dates: new Map([...dates.entries()].sort(([a], [b]) => a.localeCompare(b))),
    libraryPhotos,
    skipped,
  };
}

/**
 * Upload originals grouped into <baseFolder>/<YYYY-MM-DD>/ folders.
 */
async function runCloudSync(options) {
  const {
    root,
    album,
    settings,
    secrets = {},
    fetchImpl = globalThis.fetch,
    onProgress = () => {},
    shouldCancel = () => false,
    signal,
    full = false,
  } = options;
  if (!root) throw new SyncError('存储库不可用，请先选择文件夹。');
  if (typeof fetchImpl !== 'function') throw new SyncError('当前环境不支持网络请求。');
  const provider = createCloudProvider(settings, secrets, {
    fetchImpl,
    signal,
    setSecret: options.setSecret,
  });
  provider.assertReady?.();
  const plan = await buildCloudPlan(root, album);
  const totalFiles = [...plan.dates.values()].reduce((sum, files) => sum + files.length, 0);
  const totalBytes = [...plan.dates.values()]
    .flat()
    .reduce((sum, file) => sum + file.size, 0);
  const scope = manifestScope(settings);
  const manifest = await readManifest(root);
  const errors = [];
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;
  let canceled = false;

  const emit = (payload) => onProgress({ target: 'cloud', ...payload });
  emit({
    phase: 'discover',
    current: 0,
    total: totalFiles,
    bytes: totalBytes,
    bytesDone: 0,
    dates: plan.dates.size,
    message: `发现 ${plan.dates.size} 个日期、${totalFiles} 张原图`,
  });

  const baseFolder = await provider.ensureBaseFolder();
  const dateNames = [...plan.dates.keys()];
  for (let dateIndex = 0; dateIndex < dateNames.length; dateIndex += 1) {
    if (shouldCancel() || signal?.aborted) {
      canceled = true;
      break;
    }
    const date = dateNames[dateIndex];
    emit({
      phase: 'folders',
      current: dateIndex + 1,
      total: dateNames.length,
      date,
      message: `建立日期文件夹 ${date}`,
    });
    const folder = await provider.ensureDateFolder(date);
    const files = plan.dates.get(date) || [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      if (shouldCancel() || signal?.aborted) {
        canceled = true;
        break;
      }
      const file = files[fileIndex];
      const entryKey = `${scope}|${date}|${file.hash}`;
      const previous = manifest.entries[entryKey];
      if (!full && settings.skipExisting !== false && previous && Number(previous.size) === file.size) {
        skipped += 1;
        emit({
          phase: 'upload',
          current: uploaded + skipped + failed,
          total: totalFiles,
          date,
          file: file.name,
          bytes: totalBytes,
          bytesDone: bytes,
          uploaded,
          skipped,
          failed,
          message: `跳过已同步 ${file.name}`,
        });
        continue;
      }
      emit({
        phase: 'upload',
        current: uploaded + skipped + failed,
        total: totalFiles,
        date,
        file: file.name,
        bytes: totalBytes,
        bytesDone: bytes,
        uploaded,
        skipped,
        failed,
        message: `上传 ${file.name}`,
      });
      try {
        const result = await provider.uploadFile(file.absolute, file.name, folder, file.size);
        manifest.entries[entryKey] = {
          name: file.name,
          size: file.size,
          date,
          remoteId: result?.remoteId || null,
          syncedAt: nowIso(),
        };
        uploaded += 1;
        bytes += file.size;
      } catch (error) {
        failed += 1;
        if (errors.length < 50) {
          errors.push(`${date}/${file.name}：${error.message || '上传失败'}`);
        }
        if (isAuthError(error)) {
          emit({
            phase: 'error',
            date,
            file: file.name,
            message: error.message,
            uploaded,
            skipped,
            failed,
            bytesDone: bytes,
            total: totalFiles,
            bytes: totalBytes,
          });
          await writeManifest(root, manifest).catch(() => {});
          throw error;
        }
      }
      emit({
        phase: 'upload',
        current: uploaded + skipped + failed,
        total: totalFiles,
        date,
        file: file.name,
        bytes: totalBytes,
        bytesDone: bytes,
        uploaded,
        skipped,
        failed,
        message: `已处理 ${file.name}`,
      });
    }
    await writeManifest(root, manifest);
    if (canceled) break;
  }

  if (settings.uploadMetadata !== false && !canceled) {
    emit({
      phase: 'metadata',
      current: totalFiles,
      total: totalFiles,
      bytes: totalBytes,
      bytesDone: bytes,
      uploaded,
      skipped,
      failed,
      message: '上传相册元数据',
    });
    try {
      const syncDir = path.join(root, CACHE_DIR, 'sync');
      await fsp.mkdir(syncDir, { recursive: true });
      const temp = path.join(syncDir, `album-${process.pid}-${Date.now()}.json`);
      await fsp.writeFile(temp, JSON.stringify(album, null, 2), 'utf8');
      try {
        await provider.uploadFile(temp, 'hoshikuzu-album.json', baseFolder);
      } finally {
        await fsp.rm(temp, { force: true }).catch(() => {});
      }
    } catch (error) {
      failed += 1;
      if (errors.length < 50) errors.push(`元数据：${error.message || '上传失败'}`);
      if (isAuthError(error)) {
        await writeManifest(root, manifest).catch(() => {});
        throw error;
      }
    }
  }

  await writeManifest(root, manifest);
  emit({
    phase: 'done',
    current: totalFiles,
    total: totalFiles,
    bytes: totalBytes,
    bytesDone: bytes,
    uploaded,
    skipped,
    failed,
    dates: plan.dates.size,
    canceled,
    message: canceled ? '同步已取消' : `云盘同步完成：${uploaded} 张上传`,
  });
  return {
    ok: !canceled && failed === 0,
    canceled,
    partial: failed > 0 && uploaded > 0,
    uploaded,
    skipped,
    failed,
    bytes,
    dates: plan.dates.size,
    libraryPhotos: plan.libraryPhotos,
    errors,
    lastSyncAt: nowIso(),
  };
}

/* ------------------------------------------------------------------ *
 * Website sync
 * ------------------------------------------------------------------ */

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new SyncError('网站同步地址需要以 http:// 或 https:// 开头。');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SyncError('网站同步地址只支持 http/https。');
  }
  return url.toString();
}

function websiteHeaders(token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function postWebsite(endpoint, token, payload, options = {}) {
  const { fetchImpl = globalThis.fetch, signal, timeoutMs = 180000 } = options;
  if (typeof fetchImpl !== 'function') throw new SyncError('当前环境不支持网络请求。');
  const request = createHttpClient(fetchImpl, signal);
  const body = JSON.stringify(payload);
  const response = await request(
    endpoint,
    {
      method: 'POST',
      headers: websiteHeaders(token),
      body,
    },
    timeoutMs,
  );
  const info = await responseInfo(response);
  if (!response.ok) {
    throw new SyncError(
      `网站返回 HTTP ${response.status}：${snippet(
        info.json?.message || info.json?.error || info.text,
      )}`,
      { status: response.status, fatalAuth: response.status === 401 },
    );
  }
  return {
    ok: true,
    status: response.status,
    json: info.json,
    text: info.text,
    bytes: Buffer.byteLength(body, 'utf8'),
  };
}

async function testWebsiteConnection({ settings, token, fetchImpl, signal }) {
  const endpoint = normalizeEndpoint(settings.endpoint);
  const result = await postWebsite(
    endpoint,
    token,
    {
      format: 'hoshikuzu-album-sync',
      version: 1,
      kind: 'probe',
      sentAt: nowIso(),
      library: { id: settings.libraryId || null, name: settings.libraryName || null },
    },
    { fetchImpl, signal, timeoutMs: 30000 },
  );
  return {
    ok: true,
    message:
      result.json?.message ||
      `网站可访问（HTTP ${result.status}）`,
  };
}

/**
 * Build a web-compatible album where library thumbnails become data URLs and
 * POST it to the configured website endpoint.
 */
async function runWebsiteSync(options) {
  const {
    root,
    album,
    settings,
    token = '',
    previewDir,
    fetchImpl = globalThis.fetch,
    onProgress = () => {},
    shouldCancel = () => false,
    signal,
  } = options;
  if (!root) throw new SyncError('存储库不可用，请先选择文件夹。');
  const endpoint = normalizeEndpoint(settings.endpoint);
  const maxPayloadBytes =
    Math.min(1024, Math.max(1, Number(settings.maxPayloadMb) || 80)) * 1024 * 1024;
  const includePreviewImages = settings.includePreviewImages !== false;
  const photos = Array.isArray(album?.photos) ? album.photos : [];
  const emit = (payload) => onProgress({ target: 'website', ...payload });
  emit({
    phase: 'collect',
    current: 0,
    total: photos.length,
    message: `准备 ${photos.length} 张照片的数据`,
  });

  const webPhotos = [];
  let inlineBytes = 0;
  let previews = 0;
  let skippedPhotos = 0;
  let canceled = false;

  for (let index = 0; index < photos.length; index += 1) {
    if (shouldCancel() || signal?.aborted) {
      canceled = true;
      break;
    }
    const photo = photos[index];
    if (photo.isSample) {
      skippedPhotos += 1;
      continue;
    }
    const next = { ...photo };
    if (next.mediaKind === 'library' || next.libraryPath) {
      next.mediaKind = 'embedded';
      next.isRemote = false;
      next.isUploaded = true;
      next.libraryPath = undefined;
      next.previewPath = undefined;
      next.src = '';
      if (includePreviewImages && photo.previewPath && previewDir) {
        const name = path.basename(photo.previewPath);
        if (/^[0-9a-f]{40}(?:_\d{3,4}_q\d{2,3})?\.webp$/i.test(name)) {
          const buffer = await fsp.readFile(path.join(previewDir, name)).catch(() => null);
          if (buffer) {
            next.src = `data:image/webp;base64,${buffer.toString('base64')}`;
            inlineBytes += next.src.length;
            previews += 1;
            if (inlineBytes > maxPayloadBytes) {
              throw new SyncError(
                `预览图片超过 ${settings.maxPayloadMb || 80}MB 上限，请提高上限或减少照片。`,
              );
            }
          }
        }
      }
    }
    webPhotos.push(next);
    if ((index + 1) % 20 === 0 || index + 1 === photos.length) {
      emit({
        phase: 'collect',
        current: index + 1,
        total: photos.length,
        previews,
        bytes: inlineBytes,
        message: `已准备 ${index + 1} / ${photos.length} 张`,
      });
    }
  }

  if (canceled) {
    emit({ phase: 'done', canceled: true, current: webPhotos.length, total: photos.length });
    return {
      ok: false,
      canceled: true,
      photos: webPhotos.length,
      previews,
      skipped: skippedPhotos,
      bytes: inlineBytes,
      message: '同步已取消',
    };
  }

  const payload = {
    format: 'hoshikuzu-album-sync',
    version: 1,
    kind: 'album',
    exportedAt: nowIso(),
    library: {
      id: album?.libraryId || null,
      name: album?.libraryName || null,
    },
    stats: {
      photos: webPhotos.length,
      previews,
      skipped: skippedPhotos,
      inlineBytes,
    },
    album: {
      ...album,
      photos: webPhotos,
    },
  };
  const estimatedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (estimatedBytes > maxPayloadBytes) {
    throw new SyncError(
      `即将上传的数据约 ${formatBytes(estimatedBytes)}，超过 ${settings.maxPayloadMb || 80}MB 上限。请提高上限或关闭“内嵌缩略图”。`,
    );
  }
  emit({
    phase: 'upload',
    current: webPhotos.length,
    total: photos.length,
    bytes: estimatedBytes,
    previews,
    message: `上传网站数据（约 ${formatBytes(estimatedBytes)}）`,
  });
  const result = await postWebsite(endpoint, token, payload, {
    fetchImpl,
    signal,
    timeoutMs: 240000,
  });
  emit({
    phase: 'done',
    current: webPhotos.length,
    total: photos.length,
    bytes: result.bytes,
    previews,
    message: '网站同步完成',
  });
  return {
    ok: true,
    canceled: false,
    photos: webPhotos.length,
    previews,
    skipped: skippedPhotos,
    bytes: result.bytes,
    message:
      result.json?.message ||
      result.json?.url ||
      `网站已接收 ${webPhotos.length} 张照片的数据`,
    lastSyncAt: nowIso(),
  };
}

module.exports = {
  BAIDU_CHUNK_BYTES,
  CLOUD_PROVIDERS,
  FOLDER_PROVIDER_IDS,
  GoogleDriveProvider,
  BaiduPanProvider,
  FolderProvider,
  SyncError,
  WebDavProvider,
  buildCloudPlan,
  createCloudProvider,
  formatBytes,
  manifestScope,
  normalizeSegments,
  readManifest,
  resetManifest,
  runCloudSync,
  runWebsiteSync,
  safeDateKey,
  safeFileName,
  testWebsiteConnection,
  writeManifest,
};
