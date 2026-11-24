'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildLaunchArgs,
  buildToml,
  detectComponents,
  parseNodeOutput,
  parsePeerOutput,
  selectReleaseAsset,
  splitCustomArgs,
} = require('../easytier.cjs');

test('launch args include network, peers, listeners and rpc', () => {
  const args = buildLaunchArgs(
    {
      networkName: 'photo-net',
      peers: ['tcp://1.2.3.4:11010', 'udp://[2001:db8::1]:11010'],
      ipv4: '10.144.144.2',
      listenerPort: 11010,
      rpcPort: 15888,
      noTun: true,
      customArgs: '--latency-first "--mtu 1400"',
    },
    'secret-value',
  );
  assert.deepEqual(args.slice(0, 4), [
    '--network-name',
    'photo-net',
    '--network-secret',
    'secret-value',
  ]);
  assert.ok(args.includes('-i'));
  assert.ok(args.includes('10.144.144.2'));
  assert.equal(args.filter((value) => value === '-p').length, 2);
  assert.ok(args.includes('tcp://0.0.0.0:11010'));
  assert.ok(args.includes('udp://0.0.0.0:11010'));
  assert.ok(args.includes('--rpc-portal'));
  assert.ok(args.includes('--no-tun'));
  assert.ok(args.includes('--latency-first'));
});

test('empty virtual IP uses DHCP', () => {
  const args = buildLaunchArgs(
    { networkName: 'net', peers: [], ipv4: '', listenerPort: 11010, rpcPort: 15888 },
    'secret',
  );
  assert.ok(args.includes('-d'));
  assert.equal(args.includes('-i'), false);
});

test('TOML contains network identity, peers and flags', () => {
  const toml = buildToml(
    {
      networkName: 'photo-net',
      peers: ['tcp://1.2.3.4:11010'],
      ipv4: '10.144.144.2',
      listenerPort: 11010,
      rpcPort: 15888,
    },
    'secret',
  );
  assert.match(toml, /\[network_identity\]/);
  assert.match(toml, /network_name = "photo-net"/);
  assert.match(toml, /network_secret = "secret"/);
  assert.match(toml, /\[\[peer\]\]/);
  assert.match(toml, /uri = "tcp:\/\/1\.2\.3\.4:11010"/);
  assert.match(toml, /\[flags\]/);
});

test('peer output parses JSON and table fallbacks', () => {
  const json = parsePeerOutput(
    JSON.stringify({
      peers: [
        { ipv4: '10.144.144.2', hostname: 'bob', cost: 1, lat_ms: 12 },
        { ipv4: '10.144.144.3', hostname: 'carol', cost: 2, lat_ms: 80 },
      ],
    }),
  );
  assert.equal(json.peers.length, 2);
  assert.equal(json.directCount, 1);
  assert.equal(json.relayCount, 1);

  const table = parsePeerOutput(
    ['ipv4 hostname cost lat', '10.144.144.2 bob 1 12', '10.144.144.3 carol 2 80'].join('\n'),
  );
  assert.equal(table.peers.length, 2);
  assert.equal(table.directCount, 1);
});

test('node output finds virtual ipv4', () => {
  assert.equal(
    parseNodeOutput(JSON.stringify({ node: { virtual_ipv4: '10.144.144.2/24' } })),
    '10.144.144.2',
  );
  assert.equal(parseNodeOutput('ipv4: 10.144.144.3'), '10.144.144.3');
});

test('release asset selection prefers windows x86_64 zip', () => {
  const selected = selectReleaseAsset([
    { name: 'easytier-windows-arm64-v2.6.4.zip', browser_download_url: 'a', size: 1 },
    {
      name: 'easytier-windows-x86_64-v2.6.4.zip',
      browser_download_url: 'b',
      size: 31657720,
      digest: 'sha256:abc',
    },
  ]);
  assert.equal(selected.url, 'b');
  assert.equal(selected.version, '2.6.4');
  assert.equal(selected.digest, 'sha256:abc');
  assert.equal(selectReleaseAsset([]), null);
});

test('custom args split respects quotes', () => {
  assert.deepEqual(splitCustomArgs('--a "b c" --d'), ['--a', 'b c', '--d']);
});

test('detectComponents finds the nested folder used by the official zip', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'easytier-detect-'));
  const nested = path.join(base, 'easytier-windows-x86_64');
  try {
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'easytier-core.exe'), '');
    await fs.writeFile(path.join(nested, 'easytier-cli.exe'), '');
    const detection = await detectComponents({ componentsDir: base });
    assert.equal(detection.found, true);
    assert.equal(path.dirname(detection.corePath), nested);
    assert.equal(path.dirname(detection.cliPath), nested);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
