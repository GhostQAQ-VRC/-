'use strict';

const path = require('node:path');
const { app, ipcMain } = require('electron');
const config = require('../config.cjs');
const { MobileSyncService, DEFAULT_PORT, normalizeMode } = require('../services/mobile-sync.cjs');

const DIST_DIR = path.join(__dirname, '..', '..', 'dist');

function createMobileService(options) {
  const broadcast = options.broadcast || (() => {});
  const getRoot = options.getRoot;
  const getAlbum = options.getAlbum;
  const getPreviewDir = options.getPreviewDir;

  const service = new MobileSyncService({
    distDir: DIST_DIR,
    getRoot,
    getAlbum,
    getPreviewDir: (root) => getPreviewDir(root),
    getSettings: () => config.readConfigSync().mobile,
    updateSettings: (patch) => config.writeConfig({ mobile: patch }),
    appName: 'VRchat时间轴纪念相册',
    version: app.getVersion(),
    onStatus: (status) => broadcast('mobile:status', status),
    onCast: (result) => broadcast('mobile:cast', result),
  });

  function settingsView() {
    const cfg = config.readConfigSync();
    const mobile = cfg.mobile || {};
    return {
      enabled: mobile.enabled === true,
      port: Number(mobile.port) > 0 ? Number(mobile.port) : DEFAULT_PORT,
      preferredIp: typeof mobile.preferredIp === 'string' ? mobile.preferredIp : '',
      receiveMode: normalizeMode(mobile.receiveMode),
      status: service.status(),
    };
  }

  async function startAndPersist(port) {
    const result = await service.start({ port });
    if (!result.ok) {
      await config.writeConfig({ mobile: { enabled: false } });
      return { ...result, config: settingsView() };
    }
    await config.writeConfig({ mobile: { enabled: true, port: service.port } });
    return { ...result, config: settingsView() };
  }

  ipcMain.handle('mobile:get-config', () => settingsView());

  ipcMain.handle('mobile:set-config', async (_event, patch = {}) => {
    const current = config.readConfigSync().mobile || {};
    const next = { ...current };
    if (Number.isFinite(Number(patch.port)) && Number(patch.port) > 0) {
      next.port = Math.min(65535, Math.max(1024, Math.round(Number(patch.port))));
    }
    if (typeof patch.preferredIp === 'string') next.preferredIp = patch.preferredIp;
    if (patch.receiveMode) next.receiveMode = normalizeMode(patch.receiveMode);
    await config.writeConfig({ mobile: next });

    if (patch.receiveMode) {
      await service.setReceiveMode(next.receiveMode, 'desktop');
    }

    let result = { ok: true };
    if (patch.enabled === true) {
      result = await startAndPersist(next.port);
    } else if (patch.enabled === false) {
      await service.stop();
      await config.writeConfig({ mobile: { enabled: false } });
      result = { ok: true, status: service.status() };
    } else if (service.server && next.port !== service.port) {
      // A port change needs a listener restart; the QR token rotates with it.
      result = await startAndPersist(next.port);
    } else {
      result.status = service.status();
    }
    return { ...result, config: settingsView() };
  });

  ipcMain.handle('mobile:start', async () => {
    const mobile = config.readConfigSync().mobile || {};
    return startAndPersist(Number(mobile.port) || DEFAULT_PORT);
  });

  ipcMain.handle('mobile:stop', async () => {
    const result = await service.stop();
    await config.writeConfig({ mobile: { enabled: false } });
    return { ...result, config: settingsView() };
  });

  ipcMain.handle('mobile:status', () => settingsView());

  ipcMain.handle('mobile:qr', async (_event, payload = {}) => {
    if (!service.server) return { ok: false, error: '手机同步还没有开启。', config: settingsView() };
    const ip = typeof payload.ip === 'string' && payload.ip ? payload.ip : undefined;
    try {
      const dataUrl = await service.qrDataUrl(ip);
      return {
        ok: true,
        dataUrl,
        url: service.pairUrl(ip),
        ip: ip || service.activeAddress(),
        expiresAt: null,
      };
    } catch (error) {
      return { ok: false, error: error.message || '二维码生成失败。', config: settingsView() };
    }
  });

  ipcMain.handle('mobile:rotate', async () => {
    if (!service.server) return { ok: false, error: '手机同步还没有开启。', config: settingsView() };
    const mobile = config.readConfigSync().mobile || {};
    await service.stop({ silent: true });
    return startAndPersist(Number(mobile.port) || DEFAULT_PORT);
  });

  ipcMain.handle('mobile:cast', async (_event, payload = {}) => {
    if (!service.server) {
      return { ok: false, error: '请先开启手机同步。', delivered: 0, config: settingsView() };
    }
    const ids = Array.isArray(payload.ids)
      ? payload.ids.filter((id) => typeof id === 'string' && id)
      : typeof payload.id === 'string' && payload.id
        ? [payload.id]
        : [];
    if (ids.length === 0) {
      return { ok: false, error: '没有选择要投送的照片。', delivered: 0, config: settingsView() };
    }
    const results = [];
    let delivered = 0;
    for (const id of ids) {
      const result = await service.cast(id, { mode: payload.mode });
      results.push(result);
      delivered += result.delivered || 0;
      if (!result.ok) break;
    }
    return {
      ok: delivered > 0,
      delivered,
      results,
      error: delivered > 0 ? undefined : results[0]?.error,
      config: settingsView(),
    };
  });

  ipcMain.handle('mobile:disconnect', async (_event, payload = {}) => {
    const id = typeof payload.id === 'string' ? payload.id : '';
    const session = service.sessions.get(id);
    if (session) {
      service.blockedDevices.add(id);
      try {
        session.res?.end();
      } catch {
        // Ignore.
      }
      service.sessions.delete(id);
      service.pushStatus();
    }
    return { ok: true, config: settingsView() };
  });

  async function startAuto() {
    const mobile = config.readConfigSync().mobile || {};
    if (mobile.enabled !== true) return;
    const root = getRoot ? getRoot() : null;
    if (!root) return;
    const result = await startAndPersist(Number(mobile.port) || DEFAULT_PORT);
    if (!result.ok) {
      broadcast('mobile:status', { ...service.status(), lastError: result.error });
    }
  }

  async function notifyAlbumChanged() {
    if (!service.server) return;
    await service.notifyAlbumChanged().catch(() => {});
  }

  async function dispose() {
    await service.stop({ silent: true }).catch(() => {});
  }

  return {
    service,
    settingsView,
    startAuto,
    notifyAlbumChanged,
    dispose,
    register() {
      // Handlers are registered in createMobileService; this mirrors the other
      // services' lifecycle API and keeps bootstrap readable.
    },
  };
}

module.exports = { createMobileService };
