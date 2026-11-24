'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PROXY,
  endpointHostPort,
  normalizeProxy,
  toElectronProxy,
} = require('../proxy-config.cjs');

test('normalizeProxy trims values and rejects unknown modes', () => {
  assert.deepEqual(normalizeProxy(null), DEFAULT_PROXY);
  const proxy = normalizeProxy({
    mode: 'nope',
    httpUrl: '  http://127.0.0.1:7890  ',
    bypass: '   ',
  });
  assert.equal(proxy.mode, 'system');
  assert.equal(proxy.httpUrl, 'http://127.0.0.1:7890');
  assert.equal(proxy.bypass, DEFAULT_PROXY.bypass);
});

test('endpointHostPort accepts plain host:port and adds a default scheme', () => {
  assert.equal(endpointHostPort('127.0.0.1:7890', 8080), '127.0.0.1:7890');
  assert.equal(endpointHostPort('http://127.0.0.1:7891/', 8080), '127.0.0.1:7891');
  assert.equal(endpointHostPort('proxy.local', 8080), 'proxy.local:8080');
  assert.equal(endpointHostPort('socks5://[::1]:1080', 1080), '[::1]:1080');
  assert.throws(() => endpointHostPort('', 8080), /请填写代理地址/);
});

test('HTTP proxy maps to fixed_servers for both http and https', () => {
  const mapped = toElectronProxy({
    mode: 'http',
    httpUrl: 'http://127.0.0.1:7890',
    bypass: '<local>,localhost',
  });
  assert.equal(mapped.mode, 'http');
  assert.equal(mapped.config.mode, 'fixed_servers');
  assert.equal(
    mapped.config.proxyRules,
    'http=127.0.0.1:7890;https=127.0.0.1:7890',
  );
  assert.equal(mapped.config.proxyBypassRules, '<local>,localhost');
});

test('SOCKS5 and custom proxies keep Chromium rule syntax', () => {
  const socks = toElectronProxy({ mode: 'socks5', socksUrl: 'socks5://127.0.0.1:1080' });
  assert.equal(socks.config.proxyRules, 'socks5=127.0.0.1:1080');

  const custom = toElectronProxy({
    mode: 'custom',
    customRules: 'http=10.0.0.2:3128;https=10.0.0.2:3128',
  });
  assert.equal(custom.config.proxyRules, 'http=10.0.0.2:3128;https=10.0.0.2:3128');
  assert.throws(() => toElectronProxy({ mode: 'custom', customRules: '' }), /自定义代理规则/);
});

test('PAC, system and direct modes map correctly', () => {
  const pac = toElectronProxy({
    mode: 'pac',
    pacUrl: 'https://example.com/proxy.pac',
    bypass: 'localhost',
  });
  assert.equal(pac.config.mode, 'pac_script');
  assert.equal(pac.config.pacScript, 'https://example.com/proxy.pac');
  assert.equal(pac.config.proxyBypassRules, 'localhost');
  assert.throws(() => toElectronProxy({ mode: 'pac', pacUrl: 'proxy.pac' }), /PAC 地址/);

  assert.equal(toElectronProxy({ mode: 'system' }).config.mode, 'system');
  assert.equal(toElectronProxy({ mode: 'none' }).config.mode, 'direct');
});
