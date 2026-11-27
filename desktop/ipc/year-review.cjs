'use strict';

const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');
const { YearReviewService } = require('../services/year-review.cjs');

function createYearReviewService(options = {}) {
  const getWindow = options.getWindow || (() => null);
  const service = new YearReviewService({
    getRoot: options.getRoot,
    getAlbum: options.getAlbum,
    getPreviewDir: options.getPreviewDir,
  });

  function register() {
    ipcMain.handle('review:years', async () => ({
      ok: true,
      years: await service.listYears(),
    }));

    ipcMain.handle('review:export', async (_event, year) => {
      const safeYear = Math.trunc(Number(year));
      if (!Number.isFinite(safeYear) || safeYear < 1970 || safeYear > 2100) {
        return { ok: false, error: '年份无效。' };
      }
      const years = await service.listYears();
      if (!years.includes(safeYear)) {
        return { ok: false, error: `${safeYear} 年还没有照片。` };
      }
      const picked = await dialog.showSaveDialog(getWindow() || undefined, {
        title: `${safeYear} 年度回顾`,
        defaultPath: path.join(
          app.getPath('documents'),
          `hoshikuzu-year-review-${safeYear}.html`,
        ),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      return service.exportYear(safeYear, picked.filePath);
    });
  }

  return { service, register };
}

module.exports = { createYearReviewService };
