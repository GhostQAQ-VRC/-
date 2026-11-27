'use strict';

const { dialog, ipcMain } = require('electron');
const config = require('../config.cjs');
const { AutoImportService } = require('../services/auto-import.cjs');

function createAutoImportService(options = {}) {
  const broadcast = options.broadcast || (() => {});
  const getWindow = options.getWindow || (() => null);

  const service = new AutoImportService({
    getRoot: options.getRoot,
    getSettings: () => config.readConfigSync().autoImport,
    updateSettings: (patch) => config.writeConfig({ autoImport: patch }),
    getPreviewMaxEdge: options.getPreviewMaxEdge,
    onImported: (draft) => {
      options.onDraft?.(draft);
      broadcast('library:imported', draft);
    },
    onStatus: (status) => broadcast('autoimport:status', status),
  });

  function view() {
    const cfg = config.readConfigSync().autoImport || {};
    return {
      enabled: cfg.enabled === true,
      folder: typeof cfg.folder === 'string' ? cfg.folder : '',
      lastScanAt: cfg.lastScanAt || null,
      status: service.status(),
    };
  }

  function register() {
    ipcMain.handle('autoimport:get-config', () => view());

    ipcMain.handle('autoimport:set-config', async (_event, patch = {}) => {
      const result = await service.update(patch);
      return { ...result, config: view() };
    });

    ipcMain.handle('autoimport:choose-folder', async () => {
      const picked = await dialog.showOpenDialog(getWindow() || undefined, {
        title: '选择要自动导入的截图文件夹',
        properties: ['openDirectory'],
      });
      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, canceled: true, config: view() };
      }
      const result = await service.update({ folder: picked.filePaths[0] });
      return { ...result, canceled: false, config: view() };
    });

    ipcMain.handle('autoimport:scan-now', async () => {
      const result = await service.scanNow();
      return { ...result, config: view() };
    });

    ipcMain.handle('autoimport:status', () => view());
  }

  async function startAuto() {
    const cfg = config.readConfigSync().autoImport || {};
    if (cfg.enabled !== true) return;
    const result = await service.start();
    if (result && result.ok === false) {
      broadcast('autoimport:status', { ...service.status(), lastError: result.error });
    }
  }

  async function dispose() {
    service.dispose();
  }

  return { service, view, register, startAuto, dispose };
}

module.exports = { createAutoImportService };
