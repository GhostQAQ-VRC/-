'use strict';

const { ipcMain } = require('electron');
const { HealthService } = require('../services/health.cjs');

function createHealthService(options = {}) {
  const service = new HealthService({ getRoot: options.getRoot });

  function register() {
    ipcMain.handle('health:scan', () => service.scan());
    ipcMain.handle('health:clean-previews', () => service.cleanOrphanPreviews());
    ipcMain.handle('health:empty-trash', () => service.emptyTrash());
  }

  return { service, register };
}

module.exports = { createHealthService };
