'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = require('../library/repository.cjs');

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_PORT = 7878;

function tokensEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请填写好友地址（虚拟 IP:端口）。');
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('好友地址格式不正确。');
  }
  if (url.protocol !== 'http:') {
    throw new Error('图片传输只支持 http:// 虚拟网地址。');
  }
  return {
    hostname: url.hostname,
    port: Number(url.port || DEFAULT_PORT),
    base: `http://${url.hostname}:${Number(url.port || DEFAULT_PORT)}`,
  };
}

function tokenHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function readJsonResponse(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      resolve({ status: response.statusCode || 0, json, text });
    });
    response.on('error', reject);
  });
}

function pingTarget(target, token, timeoutMs = 10000) {
  const parsed = parseTarget(target);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: '/api/ping',
        method: 'GET',
        headers: { Accept: 'application/json', ...tokenHeader(token) },
        timeout: timeoutMs,
      },
      async (response) => {
        try {
          const result = await readJsonResponse(response);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on('timeout', () => request.destroy(new Error('连接超时。')));
    request.on('error', (error) =>
      reject(new Error(`无法连接 ${parsed.base}：${error.message}`)),
    );
    request.end();
  });
}

function uploadFile({ target, token, filePath, fileName, size, onProgress }) {
  const parsed = parseTarget(target);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `/api/upload?name=${encodeURIComponent(fileName)}`,
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(size),
          ...tokenHeader(token),
        },
        timeout: 300000,
      },
      async (response) => {
        try {
          resolve(await readJsonResponse(response));
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on('timeout', () => request.destroy(new Error('上传超时。')));
    request.on('error', reject);

    const stream = fs.createReadStream(filePath);
    let sent = 0;
    stream.on('data', (chunk) => {
      sent += chunk.length;
      if (typeof onProgress === 'function') onProgress(sent, size);
    });
    stream.on('error', reject);
    stream.pipe(request);
  });
}

class TransferService {
  constructor(options) {
    this.getRoot = options.getRoot;
    this.importReceived = options.importReceived;
    this.getPreviewMaxEdge = options.getPreviewMaxEdge;
    this.onIncoming = options.onIncoming || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.appName = options.appName || 'VRchat时间轴纪念相册';
    this.version = options.version || '1.0.0';
    this.server = null;
    this.token = '';
    this.port = DEFAULT_PORT;
    this.startedAt = null;
    this.rate = new Map();
    this.queue = Promise.resolve();
  }

  status() {
    return {
      running: Boolean(this.server),
      port: this.port,
      startedAt: this.startedAt,
      requiresToken: Boolean(this.token),
    };
  }

  async startReceiver(options = {}) {
    if (this.server) await this.stopReceiver();
    const port = Number(options.port || DEFAULT_PORT);
    const token = String(options.token || '');
    if (!token) {
      return { ok: false, error: '请先生成或填写分享码，再开启接收端。' };
    }

    this.token = token;
    this.port = port;
    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
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
      return {
        ok: false,
        error:
          error.code === 'EADDRINUSE'
            ? `端口 ${port} 已被占用，请换一个端口。`
            : error.message,
      };
    }

    this.server = server;
    this.startedAt = new Date().toISOString();
    this.port = server.address()?.port || port;
    return { ok: true, status: this.status() };
  }

  async stopReceiver() {
    if (!this.server) return { ok: true };
    const server = this.server;
    this.server = null;
    this.startedAt = null;
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 1200);
    });
    return { ok: true };
  }

  sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    res.end(body);
  }

  clientIp(req) {
    return req.socket.remoteAddress || 'unknown';
  }

  allow(ip) {
    const now = Date.now();
    // Bound the per-IP map: an IPv6 client can present a fresh address on
    // every request, so entries must expire instead of accumulating forever.
    if (this.rate.size > 2048) {
      for (const [key, stamps] of this.rate) {
        const recent = stamps.filter((stamp) => now - stamp < 60000);
        if (recent.length) this.rate.set(key, recent);
        else this.rate.delete(key);
      }
      while (this.rate.size > 2048) {
        const oldest = this.rate.keys().next().value;
        if (!oldest) break;
        this.rate.delete(oldest);
      }
    }
    const recent = (this.rate.get(ip) || []).filter((stamp) => now - stamp < 60000);
    if (recent.length >= 120) {
      this.rate.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.rate.set(ip, recent);
    return true;
  }

  requestToken(req) {
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
      return auth.replace(/^Bearer\s+/i, '');
    }
    const header = req.headers['x-transfer-token'];
    return typeof header === 'string' ? header : '';
  }

  async handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const ip = this.clientIp(req);
    if (!this.allow(ip)) {
      this.sendJson(res, 429, { ok: false, error: '请求过于频繁，请稍后再试。' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/ping') {
      const authorized = tokensEqual(this.requestToken(req), this.token);
      let libraryName = null;
      if (authorized) {
        try {
          const root = this.getRoot();
          const wrapper = root ? await repository.readLibrary(root) : null;
          libraryName = wrapper?.library?.name || null;
        } catch {
          libraryName = null;
        }
      }
      this.sendJson(res, 200, {
        ok: true,
        app: this.appName,
        version: this.version,
        requiresToken: true,
        authorized,
        libraryName,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      // Same information as ping but behind the token: unauthenticated LAN
      // scanners must not be able to confirm this is a photo receiver.
      if (!tokensEqual(this.requestToken(req), this.token)) {
        this.sendJson(res, 401, { ok: false, error: '分享码不正确。' });
        return;
      }
      this.sendJson(res, 200, { ok: true, uptime: this.startedAt });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (!tokensEqual(this.requestToken(req), this.token)) {
        this.sendJson(res, 401, { ok: false, error: '分享码不正确。' });
        return;
      }
      const declared = Number(req.headers['content-length'] || 0);
      if (!declared || declared <= 0) {
        this.sendJson(res, 411, { ok: false, error: '缺少文件长度。' });
        return;
      }
      if (declared > MAX_UPLOAD_BYTES) {
        this.sendJson(res, 413, { ok: false, error: '单张图片超过 4GB 安全上限。' });
        return;
      }

      const root = this.getRoot();
      if (!root) {
        this.sendJson(res, 503, { ok: false, error: '接收端尚未连接存储库。' });
        return;
      }

      const name = url.searchParams.get('name') || `received-${Date.now()}.jpg`;
      const tempDir = path.join(os.tmpdir(), `vrchat-album-recv-${process.pid}`);
      await fsp.mkdir(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, `${crypto.randomUUID()}.bin`);

      try {
        await this.streamToFile(req, tempPath, declared);
      } catch (error) {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
        this.sendJson(res, 400, { ok: false, error: error.message });
        return;
      }

      const task = this.queue.then(async () => {
        try {
          const maxEdge = await this.getPreviewMaxEdge(root);
          const result = await this.importReceived(root, tempPath, name, maxEdge);
          if (result.draft) this.onIncoming(result.draft);
          return result;
        } finally {
          await fsp.rm(tempPath, { force: true }).catch(() => {});
        }
      });
      this.queue = task.then(
        () => undefined,
        () => undefined,
      );

      try {
        const result = await task;
        this.sendJson(res, 200, {
          ok: true,
          duplicate: Boolean(result.duplicate),
          hash: result.hash,
          seed: result.draft?.libraryPath
            ? {
                id: result.draft.contentHash ? `photo_${result.draft.contentHash}` : undefined,
                contentHash: result.draft.contentHash,
                libraryPath: result.draft.libraryPath,
                previewPath: result.draft.previewPath,
              }
            : undefined,
        });
      } catch (error) {
        this.sendJson(res, 500, { ok: false, error: error.message || '接收失败。' });
      }
      return;
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  async streamToFile(req, tempPath, declared) {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(tempPath);
      let received = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        req.destroy();
        reject(error);
      };
      req.on('data', (chunk) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) {
          fail(new Error('上传超过 4GB 安全上限。'));
        }
      });
      req.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        if (received !== declared) {
          fail(new Error('上传中断，文件不完整。'));
          return;
        }
        settled = true;
        resolve();
      });
      req.pipe(output);
    });
  }

  async testTarget(options) {
    try {
      const result = await pingTarget(options.target, options.token);
      if (result.status !== 200 || !result.json?.ok) {
        return {
          ok: false,
          error: result.json?.error || `对方返回 HTTP ${result.status}。`,
        };
      }
      if (result.json.requiresToken && !result.json.authorized) {
        return {
          ok: false,
          error: '已连接接收端，但分享码不正确。',
          requiresToken: true,
        };
      }
      return {
        ok: true,
        libraryName: result.json.libraryName || null,
        app: result.json.app,
        version: result.json.version,
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async send(options) {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。', results: [] };
    const items = Array.isArray(options.items) ? options.items : [];
    if (items.length === 0) {
      return { ok: false, error: '请至少选择一张照片。', results: [] };
    }
    const token = String(options.token || '');
    if (!token) return { ok: false, error: '请填写对方的分享码。', results: [] };

    const results = [];
    let sent = 0;
    let failed = 0;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const label = item.name || path.basename(item.libraryPath || '') || `照片 ${index + 1}`;
      try {
        const absolute = await repository.resolveRealInside(root, item.libraryPath);
        if (!absolute) throw new Error('文件路径不合法或不在存储库内。');
        const stat = await fsp.stat(absolute);
        if (!stat.isFile()) throw new Error('文件不存在。');

        this.onProgress({
          direction: 'send',
          index,
          total: items.length,
          file: label,
          sent: 0,
          bytes: stat.size,
          percent: 0,
        });

        const response = await uploadFile({
          target: options.target,
          token,
          filePath: absolute,
          fileName: item.name || path.basename(absolute),
          size: stat.size,
          onProgress: (bytes, size) => {
            this.onProgress({
              direction: 'send',
              index,
              total: items.length,
              file: label,
              sent: bytes,
              bytes: size,
              percent: size ? Math.min(100, Math.round((bytes / size) * 100)) : 0,
            });
          },
        });

        if (response.status === 200 && response.json?.ok) {
          results.push({
            id: item.id,
            file: label,
            ok: true,
            duplicate: Boolean(response.json.duplicate),
          });
          sent += 1;
        } else {
          throw new Error(response.json?.error || `HTTP ${response.status}`);
        }
      } catch (error) {
        failed += 1;
        results.push({ id: item.id, file: label, ok: false, error: error.message });
      }
    }

    return {
      ok: failed === 0,
      sent,
      failed,
      results,
      error: failed ? `${failed} 张发送失败。` : undefined,
    };
  }
}

module.exports = {
  DEFAULT_PORT,
  MAX_UPLOAD_BYTES,
  TransferService,
  parseTarget,
  pingTarget,
  tokensEqual,
  uploadFile,
};
