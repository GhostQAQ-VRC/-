'use strict';

const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { app, dialog, ipcMain, shell } = require('electron');

const config = require('../config.cjs');
const repository = require('../library/repository.cjs');
const ingest = require('../library/ingest.cjs');
const ai = require('../services/ai.cjs');
const { TransferService } = require('../services/transfer.cjs');
const { EasyTierManager, elevateApp, isElevated } = require('../services/easytier.cjs');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

function localIpv4Addresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue;
      if (entry.family === 'IPv4' || entry.family === 4) addresses.push(entry.address);
    }
  }
  return Array.from(new Set(addresses));
}

function aiSettingsView() {
  const cfg = config.readConfigSync();
  return {
    ...cfg.ai,
    hasApiKey: config.hasSecret('aiApiKey'),
  };
}

function easyTierSettingsView(manager) {
  const cfg = config.readConfigSync();
  return {
    ...cfg.easytier,
    networkSecret: config.readSecret('easytierSecret') || '',
    hasSecret: config.hasSecret('easytierSecret'),
    detection: manager.lastDetection,
    status: manager.status(),
    license: 'LGPL-3.0',
    licenseUrl: 'https://github.com/EasyTier/EasyTier/blob/main/LICENSE',
  };
}

function transferSettingsView(service, manager) {
  const cfg = config.readConfigSync();
  return {
    ...cfg.transfer,
    token: config.readSecret('transferToken') || '',
    status: service.status(),
    localIps: localIpv4Addresses(),
    virtualIp: manager.lastStatus?.selfIp || null,
    directCount: manager.lastStatus?.directCount || 0,
    relayCount: manager.lastStatus?.relayCount || 0,
  };
}

function createAdvancedServices(options) {
  const broadcast = options.broadcast;
  const getWindow = options.getWindow;
  const getRoot = options.getRoot;
  const getPreviewMaxEdge = options.getPreviewMaxEdge;
  const componentsDir = path.join(config.configDir(), 'components', 'easytier');

  const aiBatch = { running: false, canceled: false };

  const manager = new EasyTierManager({
    componentsDir,
    getSettings: () => config.readConfigSync().easytier,
    getSecret: () => config.readSecret('easytierSecret') || '',
    onLog: (entry) => broadcast('easytier:log', entry),
    onStatus: (status) => broadcast('easytier:status', status),
  });

  const transfer = new TransferService({
    getRoot,
    importReceived: (root, tempPath, name, maxEdge) =>
      ingest.importReceivedFile(root, tempPath, name, { previewMaxEdge: maxEdge }),
    getPreviewMaxEdge,
    appName: 'VRchat时间轴纪念相册',
    version: app.getVersion(),
    onIncoming: (draft) => broadcast('transfer:incoming', draft),
    onProgress: (progress) => broadcast('transfer:progress', progress),
  });

  async function currentAiKey(provided) {
    if (typeof provided === 'string' && provided.trim()) return provided.trim();
    return config.readSecret('aiApiKey') || '';
  }

  async function resolveAiRequest(payload = {}) {
    const cfg = config.readConfigSync().ai;
    const protocol = payload.protocol || cfg.protocol;
    const baseUrl = payload.baseUrl || cfg.baseUrl;
    const apiKey = await currentAiKey(payload.apiKey);
    if (!baseUrl) throw new Error('请填写 API Base URL。');
    return { protocol, baseUrl, apiKey };
  }

  async function runAiBatch(items, mode = 'summary') {
    const cfg = config.readConfigSync();
    const settings = cfg.ai;
    const apiKey = config.readSecret('aiApiKey') || '';
    const root = getRoot();
    let done = 0;
    let failed = 0;
    let worldIds = 0;
    let rotated = 0;

    if (!settings.primaryModel && !settings.backupModel) {
      aiBatch.running = false;
      broadcast('ai:batch-done', {
        ok: false,
        canceled: false,
        total: items.length,
        done: 0,
        failed: items.length,
        mode,
        worldIds: 0,
        rotated: 0,
        error: '请先在高级设置中选择主模型或备用模型。',
      });
      return;
    }

    for (let index = 0; index < items.length; index += 1) {
      if (aiBatch.canceled) break;
      const item = items[index];
      broadcast('ai:batch-progress', {
        current: index + 1,
        total: items.length,
        id: item.id,
        state: 'running',
        mode,
      });
      let result;
      if (!root) {
        result = { ok: false, error: '存储库不可用。' };
      } else if (mode === 'worldId') {
        result = await ai
          .recognizeWorldId({
            root,
            item,
            settings,
            apiKey,
          })
          .catch((error) => ({ ok: false, error: error.message }));
      } else if (mode === 'orientation') {
        result = await ai
          .detectOrientation({
            root,
            item,
            settings,
            apiKey,
          })
          .catch((error) => ({ ok: false, error: error.message }));
      } else {
        result = await ai
          .summarizePhoto({
            root,
            item,
            settings,
            apiKey,
            context: {
              capturedAt: item.capturedAt,
              worldName: item.worldName,
              note: item.note,
            },
          })
          .catch((error) => ({ ok: false, error: error.message }));
      }
      if (result.ok) done += 1;
      else failed += 1;
      if (result.ok && result.worldId) worldIds += 1;
      if (result.ok && mode === 'orientation' && result.rotation) rotated += 1;
      broadcast('ai:batch-result', {
        id: item.id,
        mode,
        state: result.ok ? 'done' : 'error',
        summary: result.summary,
        tags: result.tags,
        model: result.model,
        usedBackup: result.usedBackup,
        worldId: result.worldId,
        worldName: result.worldName,
        confidence: result.confidence,
        rotation: result.rotation,
        orientationType: result.type,
        head: result.head,
        error: result.error,
        generatedAt: new Date().toISOString(),
      });
      await delay(140);
    }

    const canceled = aiBatch.canceled;
    aiBatch.running = false;
    broadcast('ai:batch-done', {
      ok: failed === 0,
      canceled,
      total: items.length,
      done,
      failed,
      mode,
      worldIds,
      rotated,
    });
  }

  function register() {
    const window = () => getWindow() || undefined;

    // ---- AI ----
    ipcMain.handle('ai:get-config', () => aiSettingsView());

    ipcMain.handle('ai:set-config', async (_event, patch = {}) => {
      const allowed = [
        'protocol',
        'baseUrl',
        'primaryModel',
        'backupModel',
        'showAllModels',
        'allowUnverifiedVision',
      ];
      const next = {};
      const current = config.readConfigSync().ai;
      for (const key of allowed) {
        if (patch[key] !== undefined) next[key] = patch[key];
      }
      if (
        (patch.protocol && patch.protocol !== current.protocol) ||
        (patch.baseUrl && patch.baseUrl !== current.baseUrl)
      ) {
        next.models = [];
        next.modelsAt = null;
      }
      await config.writeConfig({ ai: next });
      if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
        await config.writeSecret('aiApiKey', patch.apiKey.trim());
      }
      if (patch.clearKey === true) {
        await config.deleteSecret('aiApiKey');
      }
      return aiSettingsView();
    });

    ipcMain.handle('ai:test', async (_event, payload = {}) => {
      try {
        const request = await resolveAiRequest(payload);
        return await ai.testConnection({
          ...request,
          allowEmptyKey: request.protocol === 'ollama',
          timeoutMs: 25000,
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });

    ipcMain.handle('ai:list-models', async (_event, payload = {}) => {
      try {
        const request = await resolveAiRequest(payload);
        const result = await ai.listModels({
          ...request,
          allowEmptyKey: request.protocol === 'ollama',
          timeoutMs: 40000,
          probeVision: true,
        });
        await config.writeConfig({
          ai: {
            models: result.models,
            modelsAt: new Date().toISOString(),
          },
        });
        return result;
      } catch (error) {
        return { ok: false, error: error.message, models: [] };
      }
    });

    ipcMain.handle('ai:generate', async (_event, payload = {}) => {
      try {
        const root = getRoot();
        if (!root) return { ok: false, error: '存储库不可用。' };
        if (!payload.item?.id) return { ok: false, error: '缺少照片信息。' };
        const settings = config.readConfigSync().ai;
        const apiKey = config.readSecret('aiApiKey') || '';
        const result = await ai.summarizePhoto({
          root,
          item: payload.item,
          settings,
          apiKey,
          context: payload.context || {},
        });
        return {
          ...result,
          id: payload.item.id,
          state: result.ok ? 'done' : 'error',
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });

    ipcMain.handle('ai:recognize-world-id', async (_event, payload = {}) => {
      try {
        const root = getRoot();
        if (!root) return { ok: false, error: '存储库不可用。' };
        if (!payload.item?.id) return { ok: false, error: '缺少照片信息。' };
        const settings = config.readConfigSync().ai;
        const apiKey = config.readSecret('aiApiKey') || '';
        const result = await ai.recognizeWorldId({
          root,
          item: payload.item,
          settings,
          apiKey,
        });
        return {
          ...result,
          id: payload.item.id,
          state: result.ok ? 'done' : 'error',
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });

    ipcMain.handle('ai:detect-orientation', async (_event, payload = {}) => {
      try {
        const root = getRoot();
        if (!root) return { ok: false, error: '存储库不可用。' };
        if (!payload.item?.id) return { ok: false, error: '缺少照片信息。' };
        const settings = config.readConfigSync().ai;
        const apiKey = config.readSecret('aiApiKey') || '';
        const result = await ai.detectOrientation({
          root,
          item: payload.item,
          settings,
          apiKey,
        });
        return {
          ...result,
          id: payload.item.id,
          state: result.ok ? 'done' : 'error',
          generatedAt: new Date().toISOString(),
        };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });

    ipcMain.handle('ai:start-batch', async (_event, payload = {}) => {
      if (aiBatch.running) return { ok: false, error: '已有 AI 任务在运行。' };
      const items = Array.isArray(payload.items) ? payload.items.filter((item) => item?.id) : [];
      if (items.length === 0) {
        return {
          ok: false,
          error:
            payload.mode === 'worldId'
              ? '没有需要识别 World ID 的照片。'
              : payload.mode === 'orientation'
                ? '没有需要检测方向的 16:9 横图。'
                : '没有可生成总结的照片。',
        };
      }
      const mode =
        payload.mode === 'worldId'
          ? 'worldId'
          : payload.mode === 'orientation'
            ? 'orientation'
            : 'summary';
      aiBatch.running = true;
      aiBatch.canceled = false;
      void runAiBatch(items, mode);
      return { ok: true, total: items.length, mode };
    });

    ipcMain.handle('ai:cancel-batch', () => {
      aiBatch.canceled = true;
      return { ok: true };
    });

    // ---- EasyTier ----
    ipcMain.handle('easytier:get-config', async () => {
      if (!manager.lastDetection) await manager.detect();
      return easyTierSettingsView(manager);
    });

    ipcMain.handle('easytier:detect', async () => {
      const detection = await manager.detect();
      if (detection.found) {
        await config.writeConfig({
          easytier: {
            corePath: detection.corePath,
            cliPath: detection.cliPath || '',
          },
        });
      }
      return { ...detection, status: manager.status() };
    });

    ipcMain.handle('easytier:set-config', async (_event, patch = {}) => {
      const allowed = [
        'corePath',
        'cliPath',
        'networkName',
        'peers',
        'ipv4',
        'listenerPort',
        'rpcPort',
        'autoStart',
        'noTun',
        'customArgs',
      ];
      const next = {};
      for (const key of allowed) {
        if (patch[key] !== undefined) next[key] = patch[key];
      }
      if (Array.isArray(next.peers)) {
        next.peers = next.peers.map((peer) => String(peer || '').trim()).filter(Boolean);
      }
      await config.writeConfig({ easytier: next });
      if (typeof patch.networkSecret === 'string' && patch.networkSecret.trim()) {
        await config.writeSecret('easytierSecret', patch.networkSecret.trim());
      }
      if (patch.clearSecret === true) {
        await config.deleteSecret('easytierSecret');
      }
      if (!manager.lastDetection) await manager.detect();
      return easyTierSettingsView(manager);
    });

    ipcMain.handle('easytier:choose-core', async () => {
      const picked = await dialog.showOpenDialog(window(), {
        title: '选择 easytier-core.exe',
        properties: ['openFile'],
        filters: [{ name: 'EasyTier Core', extensions: ['exe'] }],
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      const corePath = picked.filePaths[0];
      const cliPath = path.join(path.dirname(corePath), 'easytier-cli.exe');
      await config.writeConfig({
        easytier: {
          corePath,
          cliPath: require('node:fs').existsSync(cliPath) ? cliPath : '',
        },
      });
      manager.lastDetection = null;
      const detection = await manager.detect();
      return { ok: true, detection, config: easyTierSettingsView(manager) };
    });

    ipcMain.handle('easytier:download', async () => {
      const confirm = await dialog.showMessageBox(window(), {
        type: 'question',
        title: '下载 EasyTier 组件',
        message: '从官方 GitHub 下载 Windows x86_64 组件包',
        detail:
          '约 31MB，包含 easytier-core / easytier-cli 与驱动文件。\n许可证：LGPL-3.0；源码：github.com/EasyTier/EasyTier\n需要联网，下载后会校验 SHA-256（若官方提供）。',
        buttons: ['下载组件', '取消'],
        defaultId: 1,
        cancelId: 1,
      });
      if (confirm.response !== 0) return { ok: false, canceled: true };
      try {
        const result = await manager.download((progress) =>
          broadcast('easytier:download-progress', progress),
        );
        await config.writeConfig({
          easytier: {
            corePath: result.corePath,
            cliPath: result.cliPath || '',
          },
        });
        return { ...result, config: easyTierSettingsView(manager) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });

    ipcMain.handle('easytier:start', async () => {
      const result = await manager.start();
      broadcast('easytier:status', manager.status());
      return result;
    });

    ipcMain.handle('easytier:stop', async () => {
      const result = await manager.stop();
      broadcast('easytier:status', manager.status());
      return result;
    });

    ipcMain.handle('easytier:status', async () => {
      const status = await manager.queryStatus();
      if (status.ok) manager.lastStatus = status;
      return {
        query: status,
        status: manager.status(),
        detection: manager.lastDetection,
        elevated: await isElevated(),
      };
    });

    ipcMain.handle('easytier:test', async () => {
      const result = await manager.test();
      if (result.status) manager.lastStatus = result.status;
      return result;
    });

    ipcMain.handle('easytier:logs', () => manager.logs());

    ipcMain.handle('easytier:toml', () => ({
      text: manager.toml(),
      license: 'LGPL-3.0',
      licenseUrl: 'https://github.com/EasyTier/EasyTier/blob/main/LICENSE',
    }));

    ipcMain.handle('easytier:open-folder', async () => {
      const detection = manager.lastDetection || (await manager.detect());
      if (!detection.corePath) return { ok: false, error: '尚未找到 EasyTier 组件。' };
      const error = await shell.openPath(path.dirname(detection.corePath));
      return error ? { ok: false, error } : { ok: true };
    });

    ipcMain.handle('easytier:elevate', async () => {
      const relaunchArgs = app.isPackaged ? [] : process.argv.slice(1);
      await elevateApp(relaunchArgs);
      setTimeout(() => app.quit(), 400);
      return { ok: true, quitting: true };
    });

    // ---- Transfer ----
    ipcMain.handle('transfer:get-config', () =>
      transferSettingsView(transfer, manager),
    );

    ipcMain.handle('transfer:set-config', async (_event, patch = {}) => {
      const next = {};
      if (patch.lastTarget !== undefined) next.lastTarget = String(patch.lastTarget || '');
      if (patch.receiver && typeof patch.receiver === 'object') {
        next.receiver = {
          enabled:
            patch.receiver.enabled === undefined
              ? undefined
              : patch.receiver.enabled === true,
          port:
            patch.receiver.port === undefined
              ? undefined
              : Math.max(1, Math.min(65535, Number(patch.receiver.port) || 7878)),
        };
      }
      await config.writeConfig({ transfer: next });

      if (patch.regenerateToken === true) {
        await config.writeSecret('transferToken', randomToken());
      }
      if (typeof patch.token === 'string' && patch.token.trim()) {
        await config.writeSecret('transferToken', patch.token.trim());
      }

      const receiverEnabled =
        patch.receiver?.enabled ??
        config.readConfigSync().transfer.receiver.enabled;
      const receiverTouched =
        Boolean(patch.receiver) ||
        patch.regenerateToken === true ||
        typeof patch.token === 'string';

      if (receiverTouched) {
        if (receiverEnabled) {
          const root = getRoot();
          if (!root) {
            await config.writeConfig({ transfer: { receiver: { enabled: false } } });
            await transfer.stopReceiver();
          } else {
            let token = config.readSecret('transferToken') || '';
            if (!token) {
              token = randomToken();
              await config.writeSecret('transferToken', token);
            }
            const started = await transfer.startReceiver({
              port: config.readConfigSync().transfer.receiver.port,
              token,
            });
            if (!started.ok) {
              await config.writeConfig({ transfer: { receiver: { enabled: false } } });
            }
          }
        } else {
          await transfer.stopReceiver();
        }
      }

      return transferSettingsView(transfer, manager);
    });

    ipcMain.handle('transfer:start-receiver', async () => {
      const root = getRoot();
      if (!root) return { ok: false, error: '请先选择存储库。' };
      let token = config.readSecret('transferToken') || '';
      if (!token) {
        token = randomToken();
        await config.writeSecret('transferToken', token);
      }
      const cfg = config.readConfigSync();
      const started = await transfer.startReceiver({
        port: cfg.transfer.receiver.port,
        token,
      });
      if (started.ok) {
        await config.writeConfig({ transfer: { receiver: { enabled: true } } });
      }
      return { ...started, config: transferSettingsView(transfer, manager) };
    });

    ipcMain.handle('transfer:stop-receiver', async () => {
      const result = await transfer.stopReceiver();
      await config.writeConfig({ transfer: { receiver: { enabled: false } } });
      return { ...result, config: transferSettingsView(transfer, manager) };
    });

    ipcMain.handle('transfer:status', () => transferSettingsView(transfer, manager));

    ipcMain.handle('transfer:test-target', (_event, payload = {}) =>
      transfer.testTarget({
        target: payload.target,
        token: payload.token || config.readSecret('transferToken') || '',
      }),
    );

    ipcMain.handle('transfer:send', async (_event, payload = {}) => {
      const result = await transfer.send({
        target: payload.target,
        token: payload.token,
        items: payload.items,
      });
      if (payload.target) {
        await config.writeConfig({ transfer: { lastTarget: String(payload.target) } });
      }
      return result;
    });

    ipcMain.handle('transfer:regenerate-token', async () => {
      const token = randomToken();
      await config.writeSecret('transferToken', token);
      const cfg = config.readConfigSync();
      if (cfg.transfer.receiver.enabled) {
        await transfer.startReceiver({ port: cfg.transfer.receiver.port, token });
      }
      return transferSettingsView(transfer, manager);
    });
  }

  async function startAuto() {
    const cfg = await config.readConfig();
    if (cfg.easytier.autoStart) {
      const result = await manager.start();
      if (!result.ok) {
        broadcast('easytier:log', {
          at: new Date().toISOString(),
          stream: 'error',
          text: result.error || 'EasyTier 自动启动失败。',
        });
      }
    }
    if (cfg.transfer.receiver.enabled) {
      const root = getRoot();
      if (root) {
        let token = config.readSecret('transferToken') || '';
        if (!token) {
          token = randomToken();
          await config.writeSecret('transferToken', token);
        }
        const started = await transfer.startReceiver({
          port: cfg.transfer.receiver.port,
          token,
        });
        if (!started.ok) {
          await config.writeConfig({ transfer: { receiver: { enabled: false } } });
        }
      }
    }
  }

  async function stopAll() {
    await manager.stop().catch(() => {});
    await transfer.stopReceiver().catch(() => {});
  }

  return {
    manager,
    transfer,
    register,
    startAuto,
    stopAll,
  };
}

module.exports = {
  createAdvancedServices,
  localIpv4Addresses,
  randomToken,
};
