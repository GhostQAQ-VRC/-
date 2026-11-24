'use strict';

const { app, ipcMain, shell } = require('electron');
const network = require('../services/network.cjs');
const {
  isGithubUrl,
  normalizeRelease,
} = require('../services/update-check.cjs');

const RELEASE_API =
  'https://api.github.com/repos/GhostQAQ-VRC/-/releases/latest';
const CACHE_MS = 5 * 60 * 1000;

function createUpdateService(options = {}) {
  const broadcast = options.broadcast || (() => {});
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;

  async function fetchLatest() {
    const session = network.networkSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await session.fetch(RELEASE_API, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': `HoshikuzuAlbum/${app.getVersion()} (update check)`,
        },
        signal: controller.signal,
      });
      if (response.status === 404) {
        return {
          ok: true,
          currentVersion: app.getVersion(),
          latestVersion: '',
          hasUpdate: false,
          releaseUrl: 'https://github.com/GhostQAQ-VRC/-/releases',
        };
      }
      if (!response.ok) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        return {
          ok: false,
          currentVersion: app.getVersion(),
          error:
            response.status === 403 && remaining === '0'
              ? 'GitHub 更新接口暂时达到速率限制，请稍后再试。'
              : `GitHub 更新接口返回 HTTP ${response.status}`,
        };
      }
      const payload = await response.json();
      return normalizeRelease(payload, app.getVersion());
    } catch (error) {
      return {
        ok: false,
        currentVersion: app.getVersion(),
        error:
          error.name === 'AbortError'
            ? '检查更新超时，请检查网络或代理设置。'
            : `无法连接 GitHub（${error.message}）。如需代理，请到站点设置 → 网络代理配置。`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function check(options = {}) {
    const force = options.force === true;
    if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
    if (inFlight) return inFlight;

    inFlight = fetchLatest()
      .then((result) => {
        cached = result;
        cachedAt = Date.now();
        if (result.ok && result.hasUpdate) {
          broadcast('update:available', result);
        }
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function register() {
    ipcMain.handle('update:check', () => check({ force: true }));
    ipcMain.handle('update:open', async (_event, url) => {
      if (typeof url !== 'string' || !isGithubUrl(url)) {
        return { ok: false, error: '只允许打开本仓库的 GitHub Release 地址。' };
      }
      try {
        await shell.openExternal(url);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
  }

  function startAuto() {
    // Smoke tests must stay offline and deterministic.
    if (process.env.HOSHIKUZU_SMOKE === '1') return;
    setTimeout(() => {
      void check({ force: false }).catch(() => {});
    }, 4500);
  }

  return { check, register, startAuto };
}

module.exports = { createUpdateService };
