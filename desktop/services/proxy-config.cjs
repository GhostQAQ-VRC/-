'use strict';

/**
 * Pure proxy-rule helpers. Kept free of Electron imports so the mapping from
 * the friendly UI setting to Chromium proxy rules can be unit tested in Node.
 */

const PROXY_MODES = ['system', 'none', 'http', 'socks5', 'pac', 'custom'];
const DEFAULT_PROXY = {
  mode: 'system',
  httpUrl: '',
  socksUrl: '',
  pacUrl: '',
  customRules: '',
  bypass: '<local>',
};

function normalizeProxy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const mode = PROXY_MODES.includes(source.mode) ? source.mode : DEFAULT_PROXY.mode;
  const text = (value, max = 500) =>
    typeof value === 'string' ? value.trim().slice(0, max) : '';
  return {
    mode,
    httpUrl: text(source.httpUrl),
    socksUrl: text(source.socksUrl),
    pacUrl: text(source.pacUrl),
    customRules: text(source.customRules, 1000),
    bypass: text(source.bypass, 500) || DEFAULT_PROXY.bypass,
  };
}

/** Extract `host:port` from a user-typed proxy endpoint. */
function endpointHostPort(value, fallbackPort) {
  let raw = String(value || '').trim();
  if (!raw) throw new Error('请填写代理地址。');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
    raw = `http://${raw}`;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('代理地址格式不正确，例如 http://127.0.0.1:7890。');
  }
  const host = url.hostname;
  if (!host) throw new Error('代理地址缺少主机名。');
  const port = url.port || String(fallbackPort);
  return `${host}:${port}`;
}

/**
 * Translate the friendly proxy setting into Electron's session.setProxy shape.
 * HTTP/SOCKS5 become fixed_servers rules, PAC becomes pac_script and custom
 * accepts Chromium's raw proxy rules.
 */
function toElectronProxy(raw) {
  const proxy = normalizeProxy(raw);
  const bypass = proxy.bypass;
  switch (proxy.mode) {
    case 'none':
      return { mode: 'direct', config: { mode: 'direct' } };
    case 'system':
      return { mode: 'system', config: { mode: 'system' } };
    case 'http': {
      const hostPort = endpointHostPort(proxy.httpUrl, 8080);
      return {
        mode: 'http',
        config: {
          mode: 'fixed_servers',
          proxyRules: `http=${hostPort};https=${hostPort}`,
          proxyBypassRules: bypass,
        },
      };
    }
    case 'socks5': {
      const hostPort = endpointHostPort(proxy.socksUrl || proxy.httpUrl, 1080);
      return {
        mode: 'socks5',
        config: {
          mode: 'fixed_servers',
          proxyRules: `socks5=${hostPort}`,
          proxyBypassRules: bypass,
        },
      };
    }
    case 'pac': {
      const pac = proxy.pacUrl;
      if (!/^https?:\/\//i.test(pac)) {
        throw new Error('PAC 地址需要以 http:// 或 https:// 开头。');
      }
      return {
        mode: 'pac',
        config: { mode: 'pac_script', pacScript: pac, proxyBypassRules: bypass },
      };
    }
    case 'custom': {
      if (!proxy.customRules) {
        throw new Error('请填写自定义代理规则，例如 http=127.0.0.1:7890;https=127.0.0.1:7890。');
      }
      return {
        mode: 'custom',
        config: {
          mode: 'fixed_servers',
          proxyRules: proxy.customRules,
          proxyBypassRules: bypass,
        },
      };
    }
    default:
      return { mode: 'system', config: { mode: 'system' } };
  }
}

module.exports = {
  DEFAULT_PROXY,
  PROXY_MODES,
  endpointHostPort,
  normalizeProxy,
  toElectronProxy,
};
