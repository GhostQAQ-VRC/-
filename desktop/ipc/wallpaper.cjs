'use strict';

const { ipcMain } = require('electron');
const { setWallpaper } = require('../services/wallpaper.cjs');

function createWallpaperService(options = {}) {
  const getRoot = options.getRoot;

  function register() {
    ipcMain.handle('wallpaper:set', async (_event, payload = {}) => {
      const root = getRoot ? getRoot() : null;
      if (!root) return { ok: false, error: '存储库不可用。' };
      const libraryPath =
        typeof payload.libraryPath === 'string' ? payload.libraryPath : '';
      if (!libraryPath) return { ok: false, error: '请先选择一张存储库照片。' };
      try {
        return await setWallpaper(root, libraryPath);
      } catch (error) {
        return {
          ok: false,
          error: error && error.message ? error.message : '设置壁纸失败。',
        };
      }
    });
  }

  return { register };
}

module.exports = { createWallpaperService };
