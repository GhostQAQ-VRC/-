'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const unzipper = require('unzipper');

const RELEASE_API = 'https://api.github.com/repos/EasyTier/EasyTier/releases/latest';
const RELEASE_PAGE = 'https://github.com/EasyTier/EasyTier/releases';
const LICENSE_NAME = 'LGPL-3.0';
const LICENSE_URL = 'https://github.com/EasyTier/EasyTier/blob/main/LICENSE';

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        {
          timeout: options.timeout ?? 8000,
          cwd: options.cwd,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          resolve({
            ok: !error,
            code: error?.code ?? 0,
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
            error: error ? error.message : undefined,
          });
        },
      );
    } catch (error) {
      resolve({
        ok: false,
        code: error?.code ?? 0,
        stdout: '',
        stderr: '',
        error: error?.message || String(error),
      });
    }
  });
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function candidateDirectories(settings, componentsDir) {
  const list = [];
  if (settings?.corePath) list.push(path.dirname(settings.corePath));
  if (componentsDir) list.push(componentsDir);
  if (process.env.LOCALAPPDATA) {
    list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'EasyTier'));
    list.push(path.join(process.env.LOCALAPPDATA, 'EasyTier'));
  }
  if (process.env.ProgramFiles) list.push(path.join(process.env.ProgramFiles, 'EasyTier'));
  if (process.env['ProgramFiles(x86)']) {
    list.push(path.join(process.env['ProgramFiles(x86)'], 'EasyTier'));
  }
  return Array.from(new Set(list.filter(Boolean)));
}

async function findInPath(name) {
  if (process.platform !== 'win32') {
    return run('which', [name], { timeout: 4000 });
  }
  return run('where', [name], { timeout: 4000 });
}

async function detectComponents(options = {}) {
  const settings = options.settings || {};
  const componentsDir = options.componentsDir;
  const cores = [];
  const clis = [];

  if (settings.corePath) cores.push(settings.corePath);
  if (settings.cliPath) clis.push(settings.cliPath);

  for (const directory of candidateDirectories(settings, componentsDir)) {
    cores.push(path.join(directory, 'easytier-core.exe'));
    clis.push(path.join(directory, 'easytier-cli.exe'));
  }

  const whichCore = await findInPath('easytier-core');
  for (const line of whichCore.stdout.split(/\r?\n/)) {
    if (line.trim()) cores.push(line.trim());
  }

  let corePath = null;
  for (const candidate of cores) {
    if (candidate && (await exists(candidate))) {
      corePath = candidate;
      break;
    }
  }

  let cliPath = null;
  if (corePath) {
    const sibling = path.join(path.dirname(corePath), 'easytier-cli.exe');
    if (await exists(sibling)) cliPath = sibling;
  }
  for (const candidate of clis) {
    if (!cliPath && candidate && (await exists(candidate))) cliPath = candidate;
  }

  // Downloaded archives contain a versioned subfolder; search recursively.
  if (!corePath && componentsDir && (await exists(componentsDir))) {
    const nested = await findExecutables(componentsDir);
    if (nested.core) {
      corePath = nested.core;
      cliPath = nested.cli || cliPath;
    }
  }

  const wintun = corePath
    ? await exists(path.join(path.dirname(corePath), 'wintun.dll'))
    : false;

  let version = null;
  if (corePath) {
    const result = await run(corePath, ['--version'], { timeout: 6000 });
    const match = `${result.stdout} ${result.stderr}`.match(/v?\d+\.\d+\.\d+/);
    if (match) version = match[0].replace(/^v/, '');
  }

  return {
    found: Boolean(corePath),
    corePath,
    cliPath,
    wintun,
    version,
    license: LICENSE_NAME,
    licenseUrl: LICENSE_URL,
    releasePage: RELEASE_PAGE,
    elevated: await isElevated(),
  };
}

function selectReleaseAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const exact = list.find((asset) =>
    /^easytier-windows-x86_64-v[\d.]+\.zip$/i.test(String(asset?.name || '')),
  );
  const loose =
    exact ||
    list.find((asset) =>
      /windows.*(x86_64|amd64).*\.zip$/i.test(String(asset?.name || '')),
    );
  if (!loose) return null;
  const versionMatch = String(loose.name).match(/v(\d+\.\d+\.\d+)/);
  return {
    name: loose.name,
    url: loose.browser_download_url,
    size: Number(loose.size) || 0,
    digest: typeof loose.digest === 'string' ? loose.digest : null,
    version: versionMatch ? versionMatch[1] : null,
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fsSync.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function validateZipEntry(name) {
  const normalized = String(name || '').replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error('组件压缩包包含不安全的路径。');
  }
  return normalized;
}

async function extractZip(zipPath, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) validateZipEntry(entry.path);
  for (const entry of directory.files) {
    const name = validateZipEntry(entry.path);
    const destination = path.join(targetDir, name);
    const relative = path.relative(targetDir, destination);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('组件压缩包包含不安全的路径。');
    }
    if (entry.type === 'Directory') {
      await fs.mkdir(destination, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await new Promise((resolve, reject) => {
      entry
        .stream()
        .pipe(fsSync.createWriteStream(destination))
        .on('finish', resolve)
        .on('error', reject);
    });
  }
}

async function findExecutables(directory) {
  const result = { core: null, cli: null };
  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower === 'easytier-core.exe') result.core = absolute;
        else if (lower === 'easytier-cli.exe') result.cli = absolute;
      }
    }
  }
  await walk(directory);
  return result;
}

async function downloadComponents(options = {}) {
  const componentsDir = options.componentsDir;
  if (!componentsDir) throw new Error('缺少组件目录。');
  const fetchImpl = options.fetchImpl || fetch;
  const onProgress = options.onProgress || (() => {});

  const releaseResponse = await fetchImpl(RELEASE_API, {
    headers: {
      'user-agent': 'VRchat-Timeline-Album',
      accept: 'application/vnd.github+json',
    },
  });
  if (!releaseResponse.ok) {
    throw new Error(
      `无法获取 EasyTier 最新版本（HTTP ${releaseResponse.status}）。可以手动下载后选择 easytier-core.exe。`,
    );
  }
  const release = await releaseResponse.json();
  const asset = selectReleaseAsset(release.assets);
  if (!asset) throw new Error('没有找到 Windows x86_64 组件包。');

  await fs.mkdir(componentsDir, { recursive: true });
  const zipPath = path.join(componentsDir, asset.name);
  const response = await fetchImpl(asset.url, {
    headers: { 'user-agent': 'VRchat-Timeline-Album' },
  });
  if (!response.ok) throw new Error(`组件下载失败（HTTP ${response.status}）。`);

  const total = Number(response.headers.get('content-length')) || asset.size || 0;
  const reader = response.body.getReader();
  const output = fsSync.createWriteStream(zipPath);
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!output.write(Buffer.from(value))) {
        await new Promise((resolve) => output.once('drain', resolve));
      }
      onProgress({
        phase: 'download',
        received,
        total,
        percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
      });
    }
  } finally {
    await new Promise((resolve) => output.end(resolve));
  }

  if (asset.digest && asset.digest.startsWith('sha256:')) {
    const expected = asset.digest.slice(7).toLowerCase();
    const actual = await sha256File(zipPath);
    if (actual !== expected) {
      await fs.rm(zipPath, { force: true }).catch(() => {});
      throw new Error('组件 SHA-256 校验失败，已删除下载文件。');
    }
  }

  onProgress({ phase: 'extract', percent: 0 });
  await extractZip(zipPath, componentsDir);
  await fs.rm(zipPath, { force: true }).catch(() => {});
  const executables = await findExecutables(componentsDir);
  if (!executables.core) {
    throw new Error('解压后没有找到 easytier-core.exe。');
  }
  onProgress({ phase: 'done', percent: 100 });
  return {
    ok: true,
    corePath: executables.core,
    cliPath: executables.cli,
    version: asset.version,
    license: LICENSE_NAME,
    licenseUrl: LICENSE_URL,
  };
}

function splitCustomArgs(text) {
  const matches = String(text || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return matches.map((value) => value.replace(/^"|"$/g, '')).filter(Boolean);
}

function buildLaunchArgs(settings, secret) {
  const args = [];
  if (settings.networkName) args.push('--network-name', settings.networkName);
  if (secret) args.push('--network-secret', secret);
  const ipv4 = String(settings.ipv4 || '').replace(/\/\d+$/, '');
  if (ipv4) args.push('-i', ipv4);
  else args.push('-d');
  for (const peer of settings.peers || []) {
    if (String(peer || '').trim()) args.push('-p', String(peer).trim());
  }
  const port = Number(settings.listenerPort || 11010);
  args.push('-l', `tcp://0.0.0.0:${port}`, '-l', `udp://0.0.0.0:${port}`);
  const rpcPort = Number(settings.rpcPort || 15888);
  args.push('--rpc-portal', `127.0.0.1:${rpcPort}`);
  if (settings.noTun) args.push('--no-tun');
  args.push(...splitCustomArgs(settings.customArgs));
  return args;
}

function escapeToml(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildToml(settings, secret) {
  const ipv4 = String(settings.ipv4 || '').replace(/\/\d+$/, '');
  const lines = [
    'instance_name = "vrchat-timeline-album"',
    `hostname = "${escapeToml(os.hostname().slice(0, 40))}"`,
    ipv4 ? `ipv4 = "${escapeToml(ipv4)}"` : 'dhcp = true',
    `listeners = ["tcp://0.0.0.0:${Number(settings.listenerPort || 11010)}", "udp://0.0.0.0:${Number(settings.listenerPort || 11010)}"]`,
    `rpc_portal = "127.0.0.1:${Number(settings.rpcPort || 15888)}"`,
    '',
    '[network_identity]',
    `network_name = "${escapeToml(settings.networkName)}"`,
    `network_secret = "${escapeToml(secret)}"`,
  ];
  for (const peer of settings.peers || []) {
    if (!String(peer || '').trim()) continue;
    lines.push('', '[[peer]]', `uri = "${escapeToml(peer)}"`);
  }
  lines.push('', '[flags]', 'mtu = 1420');
  if (settings.noTun) lines.push('# no_tun 由 CLI 参数 --no-tun 控制');
  return `${lines.join('\n')}\n`;
}

function normalizePeer(item) {
  if (!item || typeof item !== 'object') return null;
  const ipv4 =
    item.ipv4 ||
    item.ip ||
    item.virtual_ipv4 ||
    item.virtualIpv4 ||
    item.address ||
    '';
  if (!ipv4) return null;
  const cost = Number(item.cost ?? item.hops ?? 0);
  return {
    ipv4: String(ipv4).replace(/\/\d+$/, ''),
    hostname: item.hostname || item.host || '',
    cost,
    latencyMs: Number(item.lat_ms ?? item.latency_ms ?? item.latency ?? 0),
    loss: item.loss ?? item.loss_rate ?? '',
    rx: item.rx ?? item.rx_bytes ?? '',
    tx: item.tx ?? item.tx_bytes ?? '',
    tunnel: item.tunnel ?? item.proto ?? '',
    nat: item.nat ?? item.nat_type ?? '',
    version: item.version ?? '',
    direct: cost === 1,
  };
}

function findPeerArray(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return null;
  if (Array.isArray(value)) {
    if (value.some((item) => item && typeof item === 'object' && (item.ipv4 || item.ip))) {
      return value;
    }
    for (const item of value) {
      const found = findPeerArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const child of Object.values(value)) {
    const found = findPeerArray(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function parsePeerOutput(text) {
  const raw = String(text || '').trim();
  if (!raw) return { peers: [], directCount: 0, relayCount: 0 };
  try {
    const json = JSON.parse(raw);
    const list =
      (Array.isArray(json) && json) ||
      json.peers ||
      json.peer_list ||
      json.data ||
      json.result ||
      findPeerArray(json) ||
      [];
    const peers = (Array.isArray(list) ? list : []).map(normalizePeer).filter(Boolean);
    if (peers.length > 0) {
      return {
        peers,
        directCount: peers.filter((peer) => peer.direct).length,
        relayCount: peers.filter((peer) => peer.cost >= 2).length,
      };
    }
  } catch {
    // Fall through to table parsing.
  }

  const peers = [];
  for (const line of raw.split(/\r?\n/)) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (!ip) continue;
    const rest = line.replace(ip[1], '');
    const numbers = rest.match(/\b\d+\b/g) || [];
    const cost = numbers.length > 0 ? Number(numbers[0]) : 0;
    peers.push({
      ipv4: ip[1],
      hostname: '',
      cost,
      latencyMs: 0,
      loss: '',
      rx: '',
      tx: '',
      tunnel: '',
      nat: '',
      version: '',
      direct: cost === 1,
    });
  }
  return {
    peers,
    directCount: peers.filter((peer) => peer.direct).length,
    relayCount: peers.filter((peer) => peer.cost >= 2).length,
  };
}

function parseNodeOutput(text) {
  const raw = String(text || '').trim();
  const candidates = [];
  if (raw) {
    try {
      const json = JSON.parse(raw);
      const stack = [json];
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object') continue;
        for (const [key, child] of Object.entries(value)) {
          if (
            /^(virtual_ipv4|ipv4|ip|virtual_ip|virtualIpv4)$/i.test(key) &&
            typeof child === 'string'
          ) {
            candidates.push(child.replace(/\/\d+$/, ''));
          }
          if (child && typeof child === 'object') stack.push(child);
        }
      }
    } catch {
      const matches = raw.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || [];
      candidates.push(...matches);
    }
  }
  return candidates[0] || null;
}

async function isElevated() {
  if (process.platform !== 'win32') {
    return typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  }
  const result = await run('net', ['session'], { timeout: 5000 });
  return result.ok;
}

function redact(text, secret) {
  if (!secret) return text;
  return String(text).split(secret).join('******');
}

class EasyTierManager {
  constructor(options) {
    this.componentsDir = options.componentsDir;
    this.getSettings = options.getSettings;
    this.getSecret = options.getSecret;
    this.onLog = options.onLog || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.child = null;
    this.startedAt = null;
    this.logBuffer = [];
    this.heartbeat = null;
    this.lastStatus = null;
    this.lastDetection = null;
  }

  appendLog(stream, text) {
    const secret = this.getSecret();
    for (const line of String(text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const entry = {
        at: new Date().toISOString(),
        stream,
        text: redact(line, secret).slice(0, 2000),
      };
      this.logBuffer.push(entry);
      if (this.logBuffer.length > 400) this.logBuffer.shift();
      this.onLog(entry);
    }
  }

  logs() {
    return this.logBuffer.slice(-200);
  }

  detect() {
    return detectComponents({
      settings: this.getSettings(),
      componentsDir: this.componentsDir,
    }).then((result) => {
      this.lastDetection = result;
      return result;
    });
  }

  async download(onProgress) {
    const result = await downloadComponents({
      componentsDir: this.componentsDir,
      onProgress,
    });
    this.lastDetection = await this.detect();
    return result;
  }

  status() {
    return {
      running: Boolean(this.child),
      pid: this.child ? this.child.pid : null,
      startedAt: this.startedAt,
      corePath: this.lastDetection?.corePath || this.getSettings().corePath || null,
      cliPath: this.lastDetection?.cliPath || this.getSettings().cliPath || null,
      elevated: this.lastDetection?.elevated ?? false,
      noTun: Boolean(this.getSettings().noTun),
      peers: this.lastStatus?.peers || [],
      directCount: this.lastStatus?.directCount || 0,
      relayCount: this.lastStatus?.relayCount || 0,
      selfIp: this.lastStatus?.selfIp || null,
      logs: this.logs(),
    };
  }

  async start() {
    const settings = this.getSettings();
    const secret = this.getSecret();
    if (!settings.networkName) {
      return { ok: false, error: '请填写 EasyTier 网络名称。' };
    }
    if (!secret) {
      return { ok: false, error: '请填写或生成网络密钥。' };
    }

    const detection = await this.detect();
    if (!detection.found) {
      return {
        ok: false,
        error: '没有找到 easytier-core.exe，请先检测、选择或下载组件。',
      };
    }
    if (!settings.noTun && !detection.elevated) {
      return {
        ok: false,
        needsElevation: true,
        error:
          'TUN 模式需要管理员权限（创建虚拟网卡）。请以管理员身份重启客户端，或在高级设置中改用免 TUN 模式。',
      };
    }

    await this.stop();
    const args = buildLaunchArgs(settings, secret);
    this.appendLog('info', `启动 EasyTier：${path.basename(detection.corePath)} ${args.map((arg) => (arg === secret ? '******' : arg)).join(' ')}`);

    const child = (() => {
      try {
        return spawn(detection.corePath, args, {
          cwd: path.dirname(detection.corePath),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, RUST_LOG: 'info' },
        });
      } catch (error) {
        this.appendLog('error', `无法启动 EasyTier：${error.message}`);
        return null;
      }
    })();
    if (!child) {
      return { ok: false, error: '无法启动 EasyTier 核心进程，请检查组件路径与权限。' };
    }
    this.child = child;
    this.startedAt = new Date().toISOString();

    child.stdout.on('data', (data) => this.appendLog('stdout', data.toString('utf8')));
    child.stderr.on('data', (data) => this.appendLog('stderr', data.toString('utf8')));
    child.on('error', (error) => {
      this.appendLog('error', `进程错误：${error.message}`);
    });
    child.on('exit', (code, signal) => {
      this.appendLog('info', `EasyTier 已退出（code=${code ?? '-'}, signal=${signal ?? '-'}）`);
      this.child = null;
      this.startedAt = null;
      if (this.heartbeat) {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
      }
      this.onStatus(this.status());
    });

    // Wait for the local RPC portal to come up.
    let ready = false;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (!this.child) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const query = await this.queryStatus();
      if (query.ok) {
        ready = true;
        this.lastStatus = query;
        break;
      }
    }

    if (this.child) {
      this.heartbeat = setInterval(async () => {
        if (!this.child) return;
        const status = await this.queryStatus();
        if (status.ok) {
          this.lastStatus = status;
          this.onStatus(this.status());
        }
      }, 6000);
    }

    return {
      ok: Boolean(this.child),
      warning: this.child && !ready ? '进程已启动，但暂未连上本地 RPC，请查看日志。' : undefined,
      status: this.status(),
    };
  }

  async stop() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    const child = this.child;
    this.child = null;
    this.startedAt = null;
    if (!child) return { ok: true };
    const pid = child.pid;
    this.appendLog('info', `停止 EasyTier（pid=${pid}）`);
    try {
      child.kill();
    } catch {
      // Already gone.
    }
    if (process.platform === 'win32' && pid) {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 6000 });
    }
    this.onStatus(this.status());
    return { ok: true };
  }

  async queryStatus() {
    const settings = this.getSettings();
    const detection = this.lastDetection || (await this.detect());
    if (!detection.cliPath) {
      return { ok: false, error: '没有找到 easytier-cli.exe。' };
    }
    if (!this.child) {
      return { ok: false, error: 'EasyTier 未运行。' };
    }
    const rpc = `127.0.0.1:${Number(settings.rpcPort || 15888)}`;
    const peer = await run(
      detection.cliPath,
      ['-p', rpc, '-o', 'json', 'peer', 'list'],
      { timeout: 8000 },
    );
    const node = await run(
      detection.cliPath,
      ['-p', rpc, '-o', 'json', 'node', 'info'],
      { timeout: 8000 },
    );
    if (!peer.ok && !node.ok) {
      return {
        ok: false,
        error: peer.stderr || node.stderr || peer.error || node.error || 'RPC 未就绪。',
      };
    }
    const parsedPeers = parsePeerOutput(peer.ok ? peer.stdout : '');
    const selfIp = parseNodeOutput(node.ok ? node.stdout : '');
    return {
      ok: true,
      peers: parsedPeers.peers,
      directCount: parsedPeers.directCount,
      relayCount: parsedPeers.relayCount,
      selfIp,
      rawPeers: peer.stdout,
      rawNode: node.stdout,
    };
  }

  async test() {
    const detection = await this.detect();
    if (!detection.found) {
      return {
        ok: false,
        error: '没有找到 EasyTier 组件。',
        detection,
      };
    }
    if (!this.child) {
      return {
        ok: false,
        error: 'EasyTier 尚未启动。',
        detection,
      };
    }
    const status = await this.queryStatus();
    return {
      ok: Boolean(status.ok),
      error: status.error,
      detection,
      status: this.status(),
    };
  }

  toml() {
    return buildToml(this.getSettings(), this.getSecret());
  }
}

async function elevateApp(extraArgs = []) {
  if (process.platform !== 'win32') {
    throw new Error('当前系统不支持自动提权。');
  }
  const executable = process.execPath;
  const escapedExe = executable.replace(/'/g, "''");
  const argumentList =
    extraArgs.length > 0
      ? ` -ArgumentList '${extraArgs
          .map((value) => String(value).replace(/'/g, "''"))
          .join(' ')}'`
      : '';
  const script = `Start-Process -FilePath '${escapedExe}'${argumentList} -Verb RunAs`;
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

module.exports = {
  EasyTierManager,
  LICENSE_NAME,
  LICENSE_URL,
  RELEASE_API,
  RELEASE_PAGE,
  buildLaunchArgs,
  buildToml,
  detectComponents,
  downloadComponents,
  elevateApp,
  isElevated,
  parseNodeOutput,
  parsePeerOutput,
  selectReleaseAsset,
  splitCustomArgs,
};
