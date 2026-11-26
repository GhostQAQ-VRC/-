'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  libraryPath: null,
  onboardingDismissed: false,
  window: {
    width: 1360,
    height: 900,
    x: null,
    y: null,
    maximized: false,
  },
  ai: {
    protocol: 'openai',
    baseUrl: '',
    primaryModel: '',
    backupModel: '',
    showAllModels: false,
    allowUnverifiedVision: false,
    models: [],
    modelsAt: null,
  },
  transfer: {
    provider: 'easytier',
    receiver: {
      enabled: false,
      port: 7878,
    },
    lastTarget: '',
  },
  // LAN mobile client: serves the phone UI and live album over Wi-Fi.
  mobile: {
    enabled: false,
    port: 7880,
    preferredIp: '',
    receiveMode: 'stream',
  },
  easytier: {
    corePath: '',
    cliPath: '',
    networkName: '',
    peers: [],
    ipv4: '',
    listenerPort: 11010,
    rpcPort: 15888,
    autoStart: false,
    noTun: false,
    customArgs: '',
  },
  proxy: {
    mode: 'system',
    httpUrl: '',
    socksUrl: '',
    pacUrl: '',
    customRules: '',
    bypass: '<local>',
  },
  vrchat: {
    username: '',
    apiBase: 'https://api.vrchat.cloud',
  },
  sync: {
    cloud: {
      provider: 'folder',
      folderRoot: '',
      baseFolder: 'Hoshikuzu Album',
      skipExisting: true,
      uploadMetadata: true,
      webdavUrl: '',
      webdavUsername: '',
      googleClientId: '',
      baiduAppKey: '',
      baiduAppName: '',
    },
    website: {
      endpoint: '',
      includePreviewImages: true,
      maxPayloadMb: 80,
    },
    state: {
      cloud: {
        lastSyncAt: null,
        status: 'idle',
        message: '尚未同步',
        uploaded: 0,
        skipped: 0,
        failed: 0,
        bytes: 0,
      },
      website: {
        lastSyncAt: null,
        status: 'idle',
        message: '尚未同步',
        uploaded: 0,
        skipped: 0,
        failed: 0,
        bytes: 0,
      },
    },
  },
  // Encrypted blobs only. Never expose this object to the renderer.
  secrets: {},
};

let cached = null;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    next[key] =
      isPlainObject(value) && isPlainObject(base[key])
        ? deepMerge(base[key], value)
        : Array.isArray(value)
          ? [...value]
          : value;
  }
  return next;
}

function configDir() {
  // electron-builder's portable target exposes this; keep portable config next
  // to the exe so the client remains self-contained on a USB stick.
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) return path.join(portableDir, 'data');
  return app.getPath('userData');
}

function configPath() {
  return path.join(configDir(), 'config.json');
}

function mergeConfig(raw) {
  return deepMerge(DEFAULTS, raw || {});
}

function readConfigSync() {
  if (cached) return cached;
  try {
    cached = mergeConfig(JSON.parse(fs.readFileSync(configPath(), 'utf8')));
  } catch {
    cached = mergeConfig(null);
  }
  return cached;
}

async function readConfig() {
  if (cached) return cached;
  try {
    cached = mergeConfig(JSON.parse(await fsp.readFile(configPath(), 'utf8')));
  } catch {
    cached = mergeConfig(null);
  }
  return cached;
}

async function writeConfig(patch) {
  const current = await readConfig();
  cached = mergeConfig(deepMerge(current, patch || {}));
  await fsp.mkdir(configDir(), { recursive: true });
  const target = configPath();
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cached, null, 2), 'utf8');
  try {
    await fsp.rename(tmp, target);
  } catch {
    await fsp.rm(target, { force: true });
    await fsp.rename(tmp, target);
  }
  return cached;
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readSecret(name) {
  const cfg = readConfigSync();
  const encoded = cfg.secrets && cfg.secrets[name];
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    if (!encryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    // DPAPI is user-bound; a copied portable config may fail to decrypt.
    return null;
  }
}

function hasSecret(name) {
  const value = readSecret(name);
  return typeof value === 'string' && value.length > 0;
}

async function writeSecret(name, value) {
  if (!encryptionAvailable()) {
    throw new Error('系统加密不可用，无法安全保存密钥。');
  }
  if (!value) {
    return deleteSecret(name);
  }
  const encoded = safeStorage.encryptString(String(value)).toString('base64');
  return writeConfig({ secrets: { [name]: encoded } });
}

async function deleteSecret(name) {
  return writeConfig({ secrets: { [name]: null } });
}

module.exports = {
  DEFAULTS,
  configDir,
  configPath,
  deepMerge,
  deleteSecret,
  encryptionAvailable,
  hasSecret,
  readConfig,
  readConfigSync,
  readSecret,
  writeConfig,
  writeSecret,
};
