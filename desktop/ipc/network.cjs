'use strict';

const { ipcMain } = require('electron');
const config = require('../config.cjs');
const network = require('../services/network.cjs');
const { VRChatService, normalizeApiBase } = require('../services/vrchat.cjs');

function proxyView() {
  const cfg = config.readConfigSync();
  return network.normalizeProxy(cfg.proxy);
}

function vrchatView() {
  const cfg = config.readConfigSync();
  return {
    username: cfg.vrchat?.username || '',
    apiBase: normalizeApiBase(cfg.vrchat?.apiBase),
    hasPassword: config.hasSecret('vrchatPassword'),
  };
}

function networkConfigView() {
  return {
    proxy: proxyView(),
    vrchat: vrchatView(),
    modes: network.PROXY_MODES,
  };
}

function createNetworkService(options = {}) {
  const broadcast = options.broadcast || (() => {});
  const client = new VRChatService({
    getConfig: () => config.readConfigSync(),
  });

  function register() {
    ipcMain.handle('network:get-config', () => networkConfigView());

    ipcMain.handle('network:set-proxy', async (_event, patch) => {
      const current = config.readConfigSync();
      const merged = network.normalizeProxy({ ...current.proxy, ...(patch || {}) });
      try {
        // Validate the rules before persisting a configuration that cannot run.
        network.toElectronProxy(merged);
      } catch (error) {
        return {
          ok: false,
          config: networkConfigView(),
          error: error.message,
        };
      }
      await config.writeConfig({ proxy: merged });
      try {
        const applied = await network.applyProxy(merged);
        return { ok: true, config: networkConfigView(), applied: applied.mode };
      } catch (error) {
        return {
          ok: false,
          config: networkConfigView(),
          error: `代理已保存，但应用失败：${error.message}`,
        };
      }
    });

    ipcMain.handle('network:test', async (_event, payload) => {
      const current = config.readConfigSync();
      const merged = network.normalizeProxy({ ...current.proxy, ...(payload?.proxy || {}) });
      try {
        return await network.testProxy(merged, { url: payload?.url });
      } finally {
        // Testing an unsaved draft must not leave the running sessions on it.
        try {
          await network.applyProxy(current.proxy);
        } catch {
          // Ignore restore failures; the saved config is retried on next launch.
        }
      }
    });

    ipcMain.handle('vrchat:get-config', () => ({
      ...vrchatView(),
      status: undefined,
      progress: client.progress,
      apiBase: normalizeApiBase(config.readConfigSync().vrchat?.apiBase),
    }));

    ipcMain.handle('vrchat:set-config', async (_event, patch) => {
      const next = {};
      if (patch && typeof patch.apiBase === 'string') {
        next.apiBase = normalizeApiBase(patch.apiBase);
      }
      if (patch && typeof patch.username === 'string') {
        next.username = patch.username.trim().slice(0, 80);
      }
      if (Object.keys(next).length) {
        await config.writeConfig({ vrchat: next });
      }
      return { ok: true, config: vrchatView() };
    });

    ipcMain.handle('vrchat:status', async () => {
      const status = await client.status();
      return { ...status, progress: client.progress };
    });

    ipcMain.handle('vrchat:login', async (_event, payload) => {
      const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
      let password = typeof payload?.password === 'string' ? payload.password : '';
      if (!password && config.hasSecret('vrchatPassword')) {
        password = config.readSecret('vrchatPassword') || '';
      }
      const result = await client.login({
        username: username || vrchatView().username,
        password,
        totp: payload?.totp,
      });
      if (result.ok || result.requires2fa) {
        await config.writeConfig({
          vrchat: { username: username || vrchatView().username },
        });
      }
      if (
        payload?.remember &&
        typeof payload?.password === 'string' &&
        payload.password &&
        (result.ok || result.requires2fa)
      ) {
        try {
          await config.writeSecret('vrchatPassword', payload.password);
        } catch {
          // Remembering the password is optional; the cookie jar still works.
        }
      }
      return { ...result, config: vrchatView() };
    });

    ipcMain.handle('vrchat:verify-2fa', async (_event, payload) => {
      const result = await client.verify2fa(payload?.code, payload?.method);
      return { ...result, config: vrchatView() };
    });

    ipcMain.handle('vrchat:logout', async () => {
      await client.logout();
      try {
        await config.deleteSecret('vrchatPassword');
      } catch {
        // Ignore a missing secret.
      }
      return { ok: true, config: vrchatView() };
    });

    ipcMain.handle('vrchat:fetch-covers', async (_event, payload) => {
      const ids = Array.isArray(payload?.ids) ? payload.ids : [];
      const result = await client.fetchCovers(ids, {
        onProgress: (progress) => broadcast('vrchat:cover-progress', progress),
      });
      return { ...result, config: vrchatView() };
    });

    ipcMain.handle('vrchat:cancel-covers', () => client.cancelCovers());
  }

  return {
    register,
    client,
    async startAuto() {
      // Re-apply the saved proxy on every launch so official API calls and
      // renderer network requests share the same route.
      try {
        await network.applyProxy(config.readConfigSync().proxy);
      } catch (error) {
        console.error('[network] proxy apply failed', error.message);
      }
    },
  };
}

module.exports = { createNetworkService };
