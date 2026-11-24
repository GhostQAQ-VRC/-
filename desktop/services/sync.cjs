'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { dialog, ipcMain } = require('electron');
const config = require('../config.cjs');
const repository = require('../library/repository.cjs');
const core = require('./sync-core.cjs');

const SECRET_KEYS = {
  webdavPassword: 'syncWebdavPassword',
  googleClientSecret: 'syncGoogleClientSecret',
  googleAccessToken: 'syncGoogleAccessToken',
  googleRefreshToken: 'syncGoogleRefreshToken',
  baiduSecretKey: 'syncBaiduSecretKey',
  baiduAccessToken: 'syncBaiduAccessToken',
  baiduRefreshToken: 'syncBaiduRefreshToken',
  websiteToken: 'syncWebsiteToken',
};

function clean(value, max = 400) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cloudReady(cloud, secrets) {
  const provider = cloud.provider || 'folder';
  if (core.FOLDER_PROVIDER_IDS.has(provider)) return Boolean(cloud.folderRoot);
  if (provider === 'webdav') return Boolean(cloud.webdavUrl);
  if (provider === 'google') {
    return Boolean(
      secrets.googleAccessToken ||
        (secrets.googleRefreshToken && cloud.googleClientId && secrets.googleClientSecret),
    );
  }
  if (provider === 'baidu') {
    return Boolean(
      cloud.baiduAppName &&
        (secrets.baiduAccessToken ||
          (secrets.baiduRefreshToken && cloud.baiduAppKey && secrets.baiduSecretKey)),
    );
  }
  return false;
}

function websiteReady(website) {
  return Boolean(website.endpoint);
}

class SyncService {
  constructor(options) {
    this.broadcast = options.broadcast || (() => {});
    this.getWindow = options.getWindow || (() => null);
    this.getRoot = options.getRoot || (() => null);
    this.running = null;
    this.canceled = false;
    this.controller = null;
  }

  register() {
    ipcMain.handle('sync:get-config', () => this.getConfig());
    ipcMain.handle('sync:set-config', (_event, patch) => this.setConfig(patch || {}));
    ipcMain.handle('sync:choose-folder', () => this.chooseFolder());
    ipcMain.handle('sync:test', (_event, payload) => this.test(payload || {}));
    ipcMain.handle('sync:start', (_event, payload) => this.start(payload || {}));
    ipcMain.handle('sync:cancel', () => {
      this.cancel();
      return { ok: true };
    });
    ipcMain.handle('sync:status', () => this.status());
    ipcMain.handle('sync:reset-manifest', () => this.resetManifest());
    this.markInterrupted().catch(() => {});
  }

  async markInterrupted() {
    const state = config.readConfigSync().sync?.state;
    if (!state) return;
    for (const target of ['cloud', 'website']) {
      if (state[target]?.status === 'running') {
        await config.writeConfig({
          sync: {
            state: {
              [target]: {
                ...state[target],
                status: 'idle',
                message: '上次同步未完成，请重新开始。',
              },
            },
          },
        });
      }
    }
  }

  secretValues() {
    return {
      webdavPassword: config.readSecret(SECRET_KEYS.webdavPassword) || '',
      googleClientSecret: config.readSecret(SECRET_KEYS.googleClientSecret) || '',
      googleAccessToken: config.readSecret(SECRET_KEYS.googleAccessToken) || '',
      googleRefreshToken: config.readSecret(SECRET_KEYS.googleRefreshToken) || '',
      baiduSecretKey: config.readSecret(SECRET_KEYS.baiduSecretKey) || '',
      baiduAccessToken: config.readSecret(SECRET_KEYS.baiduAccessToken) || '',
      baiduRefreshToken: config.readSecret(SECRET_KEYS.baiduRefreshToken) || '',
      websiteToken: config.readSecret(SECRET_KEYS.websiteToken) || '',
    };
  }

  secretFlags() {
    return {
      hasWebdavPassword: config.hasSecret(SECRET_KEYS.webdavPassword),
      hasGoogleClientSecret: config.hasSecret(SECRET_KEYS.googleClientSecret),
      hasGoogleAccessToken: config.hasSecret(SECRET_KEYS.googleAccessToken),
      hasGoogleRefreshToken: config.hasSecret(SECRET_KEYS.googleRefreshToken),
      hasBaiduSecretKey: config.hasSecret(SECRET_KEYS.baiduSecretKey),
      hasBaiduAccessToken: config.hasSecret(SECRET_KEYS.baiduAccessToken),
      hasBaiduRefreshToken: config.hasSecret(SECRET_KEYS.baiduRefreshToken),
      hasWebsiteToken: config.hasSecret(SECRET_KEYS.websiteToken),
    };
  }

  publicSettings() {
    const sync = config.readConfigSync().sync || {};
    const cloud = {
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
      ...(sync.cloud || {}),
    };
    const website = {
      endpoint: '',
      includePreviewImages: true,
      maxPayloadMb: 80,
      ...(sync.website || {}),
    };
    return {
      providers: core.CLOUD_PROVIDERS,
      cloud: { ...cloud, ...this.secretFlags() },
      website,
      state: {
        cloud: {
          lastSyncAt: null,
          status: 'idle',
          message: '尚未同步',
          uploaded: 0,
          skipped: 0,
          failed: 0,
          bytes: 0,
          ...(sync.state?.cloud || {}),
        },
        website: {
          lastSyncAt: null,
          status: 'idle',
          message: '尚未同步',
          uploaded: 0,
          skipped: 0,
          failed: 0,
          bytes: 0,
          ...(sync.state?.website || {}),
        },
      },
    };
  }

  status() {
    const settings = this.publicSettings();
    const secrets = this.secretValues();
    const cloudConfigured = cloudReady(settings.cloud, secrets);
    const websiteConfigured = websiteReady(settings.website);
    const label =
      core.CLOUD_PROVIDERS.find((provider) => provider.id === settings.cloud.provider)?.label ||
      settings.cloud.provider;
    const cloudState = settings.state.cloud;
    const websiteState = settings.state.website;
    const lastSyncAt =
      [cloudState.lastSyncAt, websiteState.lastSyncAt]
        .filter(Boolean)
        .sort()
        .pop() || null;
    const parts = [];
    if (cloudConfigured) parts.push(`云盘：${label}`);
    if (websiteConfigured) parts.push('网站：已配置');
    if (!parts.length) parts.push('尚未配置云同步');
    if (this.running) parts.push(`正在同步${this.running === 'cloud' ? '云盘' : '网站'}`);
    return {
      enabled: cloudConfigured || websiteConfigured,
      provider: cloudConfigured ? settings.cloud.provider : 'none',
      lastSyncAt,
      message: parts.join(' · '),
      cloud: cloudState,
      website: websiteState,
      running: this.running,
    };
  }

  async getConfig() {
    const settings = this.publicSettings();
    const root = this.getRoot();
    let manifest = { count: 0, updatedAt: null };
    if (root) {
      try {
        const data = await core.readManifest(root);
        manifest = {
          count: Object.keys(data.entries || {}).length,
          updatedAt: data.updatedAt || null,
        };
      } catch {
        // Missing manifest is fine.
      }
    }
    return { ...settings, manifest, status: this.status() };
  }

  async setConfig(patch) {
    const current = config.readConfigSync().sync || {};
    const nextCloud = { ...(current.cloud || {}) };
    const nextWebsite = { ...(current.website || {}) };
    const cloudPatch = patch.cloud && typeof patch.cloud === 'object' ? patch.cloud : null;
    const websitePatch = patch.website && typeof patch.website === 'object' ? patch.website : null;

    if (cloudPatch) {
      if (typeof cloudPatch.provider === 'string') {
        const provider = core.CLOUD_PROVIDERS.find((item) => item.id === cloudPatch.provider);
        if (provider) nextCloud.provider = provider.id;
      }
      if (cloudPatch.folderRoot !== undefined) nextCloud.folderRoot = clean(cloudPatch.folderRoot, 1000);
      if (cloudPatch.baseFolder !== undefined) nextCloud.baseFolder = clean(cloudPatch.baseFolder, 160);
      if (cloudPatch.webdavUrl !== undefined) nextCloud.webdavUrl = clean(cloudPatch.webdavUrl, 1000);
      if (cloudPatch.webdavUsername !== undefined) {
        nextCloud.webdavUsername = clean(cloudPatch.webdavUsername, 200);
      }
      if (cloudPatch.googleClientId !== undefined) {
        nextCloud.googleClientId = clean(cloudPatch.googleClientId, 300);
      }
      if (cloudPatch.baiduAppKey !== undefined) nextCloud.baiduAppKey = clean(cloudPatch.baiduAppKey, 200);
      if (cloudPatch.baiduAppName !== undefined) {
        nextCloud.baiduAppName = clean(cloudPatch.baiduAppName, 120);
      }
      if (cloudPatch.skipExisting !== undefined) nextCloud.skipExisting = cloudPatch.skipExisting !== false;
      if (cloudPatch.uploadMetadata !== undefined) {
        nextCloud.uploadMetadata = cloudPatch.uploadMetadata !== false;
      }
    }

    if (websitePatch) {
      if (websitePatch.endpoint !== undefined) nextWebsite.endpoint = clean(websitePatch.endpoint, 1000);
      if (websitePatch.includePreviewImages !== undefined) {
        nextWebsite.includePreviewImages = websitePatch.includePreviewImages !== false;
      }
      if (websitePatch.maxPayloadMb !== undefined) {
        const value = Number(websitePatch.maxPayloadMb);
        if (Number.isFinite(value)) nextWebsite.maxPayloadMb = Math.min(1024, Math.max(1, Math.round(value)));
      }
    }

    await config.writeConfig({ sync: { cloud: nextCloud, website: nextWebsite } });

    const secretInputs = [
      ['webdavPassword', cloudPatch],
      ['googleClientSecret', cloudPatch],
      ['googleAccessToken', cloudPatch],
      ['googleRefreshToken', cloudPatch],
      ['baiduSecretKey', cloudPatch],
      ['baiduAccessToken', cloudPatch],
      ['baiduRefreshToken', cloudPatch],
      ['websiteToken', websitePatch],
    ];
    for (const [field, source] of secretInputs) {
      if (!source) continue;
      const secretName = SECRET_KEYS[field];
      const clearKey = `clear${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      if (source[clearKey] === true) {
        await config.deleteSecret(secretName).catch(() => {});
        continue;
      }
      const value = source[field];
      if (typeof value === 'string' && value.trim()) {
        await config.writeSecret(secretName, value.trim());
      }
    }
    return this.getConfig();
  }

  async chooseFolder() {
    const result = await dialog.showOpenDialog(this.getWindow(), {
      title: '选择云盘客户端的同步文件夹',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  }

  async test(payload) {
    const target = payload.target === 'website' ? 'website' : 'cloud';
    const settings = this.publicSettings();
    const secrets = this.secretValues();
    const root = this.getRoot();
    try {
      if (target === 'website') {
        const wrapper = root ? await repository.readLibrary(root) : null;
        const result = await core.testWebsiteConnection({
          settings: {
            ...settings.website,
            libraryId: wrapper?.library?.id || null,
            libraryName: wrapper?.library?.name || null,
          },
          token: secrets.websiteToken,
          fetchImpl: globalThis.fetch,
        });
        return result;
      }
      if (!root) return { ok: false, message: '存储库不可用，请先选择文件夹。' };
      const provider = core.createCloudProvider(settings.cloud, secrets, {
        fetchImpl: globalThis.fetch,
        setSecret: async (name, value) => {
          await config.writeSecret(name, value);
        },
      });
      const result = await provider.test();
      return { ok: true, message: result.message || '连接成功' };
    } catch (error) {
      return { ok: false, message: error?.message || '连接测试失败。' };
    }
  }

  async start(payload) {
    const target = payload.target === 'website' ? 'website' : 'cloud';
    if (this.running) {
      return { ok: false, error: '已有同步任务正在进行。' };
    }
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用，请先选择文件夹。' };
    const wrapper = await repository.readLibrary(root);
    if (!wrapper) return { ok: false, error: '存储库元数据缺失。' };
    const providedAlbum =
      payload.album && typeof payload.album === 'object' && Array.isArray(payload.album.photos)
        ? payload.album
        : null;
    const album = providedAlbum || wrapper.album;
    const settings = this.publicSettings();
    const secrets = this.secretValues();
    if (target === 'cloud' && !cloudReady(settings.cloud, secrets)) {
      return { ok: false, error: '请先完成云盘设置并保存。' };
    }
    if (target === 'website' && !websiteReady(settings.website)) {
      return { ok: false, error: '请先填写网站同步地址并保存。' };
    }
    if (target === 'cloud' && core.FOLDER_PROVIDER_IDS.has(settings.cloud.provider)) {
      const folderRoot = String(settings.cloud.folderRoot || '');
      if (folderRoot) {
        const relative = path.relative(root, path.resolve(folderRoot));
        if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
          return {
            ok: false,
            error: '云盘同步文件夹不能位于存储库内部，否则同步副本会被再次扫描。',
          };
        }
      }
    }

    this.running = target;
    this.canceled = false;
    this.controller = new AbortController();
    const controller = this.controller;
    const full = payload.full === true;
    const setState = (patch) => this.updateState(target, patch).catch(() => {});
    setState({ status: 'running', message: target === 'cloud' ? '正在同步云盘…' : '正在同步网站…' });
    this.broadcast('sync:state', { target, state: { ...this.status()[target], status: 'running' } });
    void this.run(target, {
      root,
      album,
      settings,
      secrets,
      full,
      signal: controller.signal,
    });

    return { ok: true, started: true, target };
  }

  async run(target, { root, album, settings, secrets, full, signal }) {
    const onProgress = (payload) => this.broadcast('sync:progress', payload);
    try {
      let result;
      if (target === 'cloud') {
        result = await core.runCloudSync({
          root,
          album,
          settings: settings.cloud,
          secrets,
          full,
          signal,
          onProgress,
          shouldCancel: () => this.canceled,
          fetchImpl: globalThis.fetch,
          setSecret: async (name, value) => {
            await config.writeSecret(name, value);
          },
        });
      } else {
        const wrapper = await repository.readLibrary(root);
        const previewDir = repository.previewDir(root, wrapper);
        result = await core.runWebsiteSync({
          root,
          album: {
            ...album,
            libraryId: wrapper?.library?.id || null,
            libraryName: wrapper?.library?.name || null,
          },
          settings: settings.website,
          token: secrets.websiteToken,
          previewDir,
          signal,
          onProgress,
          shouldCancel: () => this.canceled,
          fetchImpl: globalThis.fetch,
        });
      }

      const state = {
        lastSyncAt: result.lastSyncAt || new Date().toISOString(),
        status: result.canceled
          ? 'canceled'
          : result.failed > 0 || result.ok === false
            ? 'partial'
            : 'success',
        message: result.canceled
          ? '同步已取消'
          : result.failed > 0
            ? `完成，但有 ${result.failed} 项失败`
            : target === 'cloud'
              ? `云盘同步完成：${result.uploaded} 张上传，${result.skipped} 张跳过`
              : result.message || '网站同步完成',
        uploaded: result.uploaded ?? result.photos ?? 0,
        skipped: result.skipped ?? 0,
        failed: result.failed ?? 0,
        bytes: result.bytes ?? 0,
        errors: result.errors || [],
      };
      await this.updateState(target, state);
      await this.touchLibrarySync(
        root,
        target === 'cloud' ? settings.cloud.provider : 'website',
        state.lastSyncAt,
      );
      this.broadcast('sync:done', { target, ok: result.ok !== false, ...result, state });
    } catch (error) {
      const canceled = this.canceled || error?.name === 'AbortError' || signal.aborted;
      const previousState = config.readConfigSync().sync?.state?.[target] || {};
      const state = {
        lastSyncAt: previousState.lastSyncAt || null,
        status: canceled ? 'canceled' : 'error',
        message: canceled ? '同步已取消' : error?.message || '同步失败',
        uploaded: 0,
        skipped: 0,
        failed: 1,
        bytes: 0,
        errors: canceled ? [] : [error?.message || '同步失败'],
      };
      await this.updateState(target, state);
      this.broadcast('sync:done', {
        target,
        ok: false,
        canceled,
        uploaded: 0,
        skipped: 0,
        failed: 1,
        bytes: 0,
        errors: state.errors,
        error: state.message,
        state,
      });
    } finally {
      this.running = null;
      this.controller = null;
      this.canceled = false;
      this.broadcast('sync:status', this.status());
    }
  }

  cancel() {
    this.canceled = true;
    this.controller?.abort();
  }

  async updateState(target, patch) {
    const current = config.readConfigSync().sync?.state?.[target] || {};
    await config.writeConfig({
      sync: {
        state: {
          [target]: { ...current, ...patch },
        },
      },
    });
  }

  async touchLibrarySync(root, provider, lastSyncAt) {
    try {
      const wrapper = await repository.readLibrary(root);
      if (!wrapper) return;
      wrapper.sync = {
        ...(wrapper.sync || {}),
        enabled: true,
        provider,
        lastSyncAt,
      };
      await repository.writeLibrary(root, wrapper, { backup: false });
    } catch {
      // Sync bookkeeping must not fail the actual upload.
    }
  }

  async resetManifest() {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    await core.resetManifest(root);
    const next = await this.getConfig();
    this.broadcast('sync:config', next);
    return { ok: true, config: next };
  }

  dispose() {
    this.cancel();
  }
}

function createSyncService(options) {
  return new SyncService(options);
}

module.exports = { createSyncService, SyncService };
