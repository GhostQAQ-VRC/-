'use strict';

const { app } = require('electron');
const sharp = require('sharp');
const network = require('./network.cjs');
const { MAX_INPUT_PIXELS } = require('../library/constants.cjs');

const DEFAULT_API_BASE = 'https://api.vrchat.cloud';
const WORLD_ID_PATTERN =
  /^wrld_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COVER_HOST_PATTERN = /(^|\.)vrchat\.(cloud|com)$/i;
const NETWORK_HINT =
  '无法连接 VRChat 官方 API。请检查网络；如果在中国大陆，请到「站点设置 → 网络代理」配置系统代理、HTTP、SOCKS5 或 PAC。';

function userAgent() {
  // HTTP header values must stay ASCII; keep the product name in Latin letters.
  return `HoshikuzuAlbum/${app.getVersion()} (VRchat Timeline Album; local client)`;
}

function normalizeApiBase(value) {
  const base = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (!base) return DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(base)) return DEFAULT_API_BASE;
  return base;
}

function summarizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    displayName:
      typeof raw.displayName === 'string'
        ? raw.displayName
        : typeof raw.username === 'string'
          ? raw.username
          : '',
    username: typeof raw.username === 'string' ? raw.username : '',
  };
}

function vrcError(payload, status) {
  const message =
    payload && payload.error && typeof payload.error.message === 'string'
      ? payload.error.message
      : '';
  if (status === 401) {
    return message || 'VRChat 登录状态无效，请重新登录官方账号。';
  }
  if (status === 403) return message || 'VRChat 拒绝了这个请求（403）。';
  if (status === 404) return 'VRChat 没有找到这个内容（404）。';
  if (status === 429) return 'VRChat 请求过于频繁（429），请稍等几分钟再试。';
  return message || `VRChat 返回 HTTP ${status}`;
}

class VRChatService {
  constructor(options = {}) {
    this.getConfig = options.getConfig || (() => ({}));
    this.progress = { total: 0, current: 0, running: false, canceled: false };
  }

  session() {
    return network.networkSession();
  }

  apiBase() {
    const cfg = this.getConfig();
    return normalizeApiBase(cfg.vrchat && cfg.vrchat.apiBase);
  }

  async request(path, options = {}) {
    const {
      method = 'GET',
      body,
      basic,
      timeout = 20000,
      responseType = 'json',
    } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeout));
    const headers = {
      'user-agent': userAgent(),
      accept: 'application/json',
      'x-client-version': `HoshikuzuAlbum/${app.getVersion()}`,
    };
    if (basic) headers.authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
    if (body !== undefined && body !== null) headers['content-type'] = 'application/json';
    try {
      const response = await this.session().fetch(`${this.apiBase()}/api/1${path}`, {
        method,
        headers,
        body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (responseType === 'buffer') {
        const buffer = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
        return { response, buffer };
      }
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { response, json, text };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('连接 VRChat 官方 API 超时。请检查代理或稍后重试。');
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }
      const networkError = new Error(NETWORK_HINT);
      networkError.code = 'NETWORK';
      networkError.cause = error;
      throw networkError;
    } finally {
      clearTimeout(timer);
    }
  }

  async login({ username, password, totp }) {
    const name = typeof username === 'string' ? username.trim() : '';
    const secret = typeof password === 'string' ? password : '';
    if (!name || !secret) {
      return { ok: false, error: '请填写 VRChat 账号与密码（或使用已保存的密码）。' };
    }
    try {
      const { response, json } = await this.request('/auth/user', {
        basic: `${name}:${secret}`,
      });
      if (response.status === 200) {
        if (Array.isArray(json?.requiresTwoFactorAuth) && json.requiresTwoFactorAuth.length) {
          const methods = json.requiresTwoFactorAuth.filter(
            (item) => item === 'totp' || item === 'emailotp' || item === 'otp',
          );
          if (!totp) {
            return {
              ok: false,
              requires2fa: true,
              methods: methods.length ? methods : ['totp'],
              error: '该账号开启了两步验证，请输入验证器 App 的 6 位动态码。',
            };
          }
          return this.verify2fa(
            totp,
            methods.includes('emailotp') && !methods.includes('totp') ? 'emailotp' : 'totp',
          );
        }
        if (!json || (!json.id && !json.displayName)) {
          return {
            ok: false,
            error: 'VRChat 返回了不完整的登录结果，请检查 API 地址或稍后重试。',
          };
        }
        return { ok: true, user: summarizeUser(json), username: name };
      }
      return { ok: false, error: vrcError(json, response.status), status: response.status };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  }

  async verify2fa(code, method = 'totp') {
    const value = typeof code === 'string' ? code.trim() : '';
    if (!/^\d{6,8}$/.test(value)) {
      return { ok: false, requires2fa: true, error: '请输入 6 位动态验证码。' };
    }
    const route = method === 'emailotp' ? 'emailotp' : 'totp';
    try {
      const { response, json } = await this.request(
        `/auth/twofactorauth/${route}/verify`,
        { method: 'POST', body: { code: value } },
      );
      if (response.status === 200 && json && json.verified !== false) {
        const status = await this.status();
        return {
          ok: status.loggedIn,
          user: status.user,
          requires2fa: !status.loggedIn,
          error: status.loggedIn ? undefined : status.error || '两步验证后仍未取得登录状态。',
        };
      }
      return {
        ok: false,
        requires2fa: true,
        error: response.status === 401 ? '验证码不正确，请重新输入。' : vrcError(json, response.status),
      };
    } catch (error) {
      return { ok: false, error: error.message, code: error.code };
    }
  }

  async status() {
    try {
      const { response, json } = await this.request('/auth/user', { timeout: 15000 });
      if (response.status === 200 && json && (json.id || json.displayName)) {
        if (Array.isArray(json.requiresTwoFactorAuth) && json.requiresTwoFactorAuth.length) {
          return {
            loggedIn: false,
            pending2fa: true,
            methods: json.requiresTwoFactorAuth,
            error: '登录尚未完成两步验证。',
          };
        }
        return { loggedIn: true, user: summarizeUser(json), apiBase: this.apiBase() };
      }
      return {
        loggedIn: false,
        status: response.status,
        error: response.status === 401 ? undefined : vrcError(json, response.status),
        apiBase: this.apiBase(),
      };
    } catch (error) {
      return {
        loggedIn: false,
        error: error.message,
        code: error.code,
        apiBase: this.apiBase(),
      };
    }
  }

  async logout() {
    try {
      await this.request('/logout', { method: 'PUT', timeout: 10000 });
    } catch {
      // Clearing the local cookie jar is enough even if the API is unreachable.
    }
    try {
      await this.session().clearStorageData({ storages: ['cookies'] });
    } catch {
      // Ignore.
    }
    return { ok: true };
  }

  async fetchWorld(worldId) {
    const id = String(worldId || '').trim().toLowerCase();
    if (!WORLD_ID_PATTERN.test(id)) {
      throw new Error('World ID 格式不正确。');
    }
    const { response, json } = await this.request(`/worlds/${encodeURIComponent(id)}`);
    if (response.status !== 200 || !json || !json.id) {
      const error = new Error(vrcError(json, response.status));
      error.status = response.status;
      throw error;
    }
    return {
      id: json.id,
      name: typeof json.name === 'string' ? json.name : '',
      author: typeof json.authorName === 'string' ? json.authorName : '',
      thumbnailUrl:
        typeof json.thumbnailImageUrl === 'string' ? json.thumbnailImageUrl : '',
      description: typeof json.description === 'string' ? json.description : '',
      capacity: typeof json.capacity === 'number' ? json.capacity : undefined,
      fetchedAt: new Date().toISOString(),
    };
  }

  async downloadCover(url) {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return '';
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      return '';
    }
    // Only ever fetch image files from VRChat's own domains.
    if (!COVER_HOST_PATTERN.test(host)) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await this.session().fetch(url, {
        headers: { 'user-agent': userAgent(), accept: 'image/*' },
        signal: controller.signal,
      });
      // Redirects must stay on VRChat-controlled domains.
      try {
        const finalHost = new URL(response.url || url).hostname;
        if (!COVER_HOST_PATTERN.test(finalHost)) return '';
      } catch {
        return '';
      }
      if (!response.ok) return '';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) return '';
      const output = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
      return `data:image/webp;base64,${output.toString('base64')}`;
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchCovers(ids, options = {}) {
    if (this.progress.running) {
      return { ok: false, error: '已有封面拉取任务正在进行。' };
    }
    const unique = Array.from(
      new Set(
        (Array.isArray(ids) ? ids : [])
          .map((id) => String(id || '').trim().toLowerCase())
          .filter((id) => WORLD_ID_PATTERN.test(id)),
      ),
    ).slice(0, 500);
    if (unique.length === 0) {
      return { ok: false, error: '世界资料库里还没有可查询的 World ID。' };
    }

    const status = await this.status();
    if (!status.loggedIn) {
      return {
        ok: false,
        error: status.error || '请先登录 VRChat 官方账号，再拉取世界封面。',
        needsLogin: true,
      };
    }

    this.progress = { total: unique.length, current: 0, running: true, canceled: false };
    const results = [];
    try {
      for (const id of unique) {
        if (this.progress.canceled) break;
        this.progress.current += 1;
        const index = this.progress.current;
        try {
          const world = await this.fetchWorld(id);
          let thumbnail = world.thumbnailUrl ? await this.downloadCover(world.thumbnailUrl) : '';
          if (!thumbnail && world.thumbnailUrl) thumbnail = world.thumbnailUrl;
          results.push({
            id: world.id,
            ok: true,
            name: world.name,
            author: world.author,
            thumbnail,
            remoteThumbnail: !thumbnail.startsWith('data:'),
            description: world.description,
            capacity: world.capacity,
            fetchedAt: world.fetchedAt,
          });
          options.onProgress?.({
            current: index,
            total: unique.length,
            id: world.id,
            name: world.name,
            ok: true,
          });
        } catch (error) {
          if (error.status === 401) {
            this.progress.running = false;
            return {
              ok: false,
              error: 'VRChat 登录已失效，请重新登录后再拉取。',
              needsLogin: true,
              results,
            };
          }
          results.push({ id, ok: false, error: error.message });
          options.onProgress?.({
            current: index,
            total: unique.length,
            id,
            name: '',
            ok: false,
            error: error.message,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      return {
        ok: true,
        canceled: this.progress.canceled,
        results,
        updatedAt: new Date().toISOString(),
      };
    } finally {
      this.progress.running = false;
    }
  }

  cancelCovers() {
    this.progress.canceled = true;
    return { ok: true };
  }
}

module.exports = {
  DEFAULT_API_BASE,
  VRChatService,
  WORLD_ID_PATTERN,
  normalizeApiBase,
  userAgent,
};
