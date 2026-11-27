'use strict';

const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');
const config = require('../config.cjs');
const { AutoBackupService } = require('../services/auto-backup.cjs');

function createAutoBackupService(options = {}) {
  const broadcast = options.broadcast || (() => {});
  const getWindow = options.getWindow || (() => null);
  const defaultFolder = () => path.join(app.getPath('documents'), 'Hoshikuzu Backups');

  const service = new AutoBackupService({
    getRoot: options.getRoot,
    getSettings: () => config.readConfigSync().autoBackup,
    updateSettings: (patch) => config.writeConfig({ autoBackup: patch }),
    defaultFolder,
    onStatus: (status) => broadcast('backup:auto-status', status),
  });

  function view() {
    return service.status();
  }

  function register() {
    ipcMain.handle('backup:auto-get', () => view());

    ipcMain.handle('backup:auto-set', async (_event, patch = {}) => {
      const result = await service.update(patch);
      return { ...result, config: view() };
    });

    ipcMain.handle('backup:auto-choose-folder', async () => {
      const picked = await dialog.showOpenDialog(getWindow() || undefined, {
        title: '选择自动备份文件夹',
        defaultPath: service.effectiveFolder(),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled || !picked.filePaths[0]) {
        return { ok: false, canceled: true, config: view() };
      }
      const result = await service.update({ folder: picked.filePaths[0] });
      return { ...result, canceled: false, config: view() };
    });

    ipcMain.handle('backup:auto-run-now', async () => {
      const result = await service.runNow('manual');
      return { ...result, config: view() };
    });

    ipcMain.handle('backup:auto-status', () => view());
  }

  function startAuto() {
    service.start();
  }

  function dispose() {
    service.stop();
  }

  return { service, view, register, startAuto, dispose };
}

module.exports = { createAutoBackupService };
