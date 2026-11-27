'use strict';

const { ipcMain } = require('electron');
const { DuplicateService } = require('../services/duplicates.cjs');

function createDuplicateService(options = {}) {
  const broadcast = options.broadcast || (() => {});
  const service = new DuplicateService({
    getRoot: options.getRoot,
    onProgress: (progress) => broadcast('duplicates:progress', progress),
  });

  function register() {
    ipcMain.handle('duplicates:scan', () => service.scan());
    ipcMain.handle('duplicates:cancel', () => service.cancel());
    ipcMain.handle('duplicates:trash', (_event, items) => service.trash(items));
  }

  return {
    service,
    register,
    async dispose() {
      service.cancel();
    },
  };
}

module.exports = { createDuplicateService };
