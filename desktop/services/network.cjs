'use strict';

const { session } = require('electron');
const {
  DEFAULT_PROXY,
  PROXY_MODES,
  endpointHostPort,
  normalizeProxy,
  toElectronProxy,
} = require('./proxy-config.cjs');

const VRC_PARTITION = 'persist:hoshikuzu-vrchat';

function targetSessions() {
  const list = [];
  try {
    list.push(session.defaultSession);
  } catch {
    // Session may not exist in very early startup.
  }
  try {
    list.push(session.fromPartition(VRC_PARTITION));
  } catch {
    // Ignore; the VRChat service will create it on first use.
  }
  return list.filter(Boolean);
}

async function applyProxy(raw) {
  const { mode, config } = toElectronProxy(raw);
  const applied = [];
  for (const ses of targetSessions()) {
    await ses.setProxy(config);
    try {
      // Drop keep-alive sockets so the new proxy takes effect immediately.
      await ses.closeAllConnections();
    } catch {
      // Older Electron builds may not expose closeAllConnections.
    }
    applied.push(ses);
  }
  return { mode, sessions: applied.length };
}

function networkSession() {
  return session.fromPartition(VRC_PARTITION);
}

function abortableTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, ms));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function testProxy(raw, options = {}) {
  const target = options.url || 'https://api.vrchat.cloud/api/1/config';
  let applied;
  try {
    applied = await applyProxy(raw);
  } catch (error) {
    return { ok: false, error: error.message, mode: options.mode || null };
  }
  const ses = networkSession();
  let resolved = '';
  try {
    resolved = await ses.resolveProxy(target);
  } catch {
    resolved = '';
  }
  const timeout = abortableTimeout(12_000);
  try {
    const response = await ses.fetch(target, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'HoshikuzuAlbum/1.0.0 (network test)',
      },
      signal: timeout.signal,
    });
    return {
      ok: response.ok || response.status < 500,
      status: response.status,
      mode: applied.mode,
      proxy: resolved,
      message:
        response.ok || response.status < 500
          ? `连接成功（HTTP ${response.status}）`
          : `目标返回 HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      mode: applied.mode,
      proxy: resolved,
      error:
        error.name === 'AbortError'
          ? '连接超时（12 秒），请检查代理地址或 PAC 规则。'
          : `无法连接目标：${error.message}`,
    };
  } finally {
    timeout.clear();
  }
}

module.exports = {
  DEFAULT_PROXY,
  PROXY_MODES,
  VRC_PARTITION,
  applyProxy,
  endpointHostPort,
  networkSession,
  normalizeProxy,
  testProxy,
  toElectronProxy,
};
