'use strict';

const { ipcMain } = require('electron');
const { PlayerLibrary } = require('../services/players.cjs');

function avatarUrl(file) {
  return file ? `hoshikuzu-media://player/avatars/${encodeURIComponent(file)}` : '';
}

function decoratePlayer(player) {
  if (!player) return player;
  return {
    ...player,
    avatarUrl: player.avatar ? avatarUrl(player.avatar.file) : '',
    avatarHistory: Array.isArray(player.avatarHistory)
      ? player.avatarHistory.map((avatar) => ({
          ...avatar,
          avatarUrl: avatarUrl(avatar.file),
        }))
      : [],
  };
}

function createPlayersService(options = {}) {
  const broadcast = options.broadcast || (() => {});
  const service = new PlayerLibrary({
    getRoot: options.getRoot,
    getClient: options.getClient,
    onStatus: (status) => broadcast('players:status', status),
    onChanged: (change) => broadcast('players:changed', change),
  });

  async function view() {
    const result = await service.view();
    return {
      ...result,
      me: result.me ? decoratePlayer(result.me) : null,
      players: result.players.map(decoratePlayer),
    };
  }

  function register() {
    ipcMain.handle('players:list', () => view());

    ipcMain.handle('players:status', async () => {
      const list = await view();
      return { ok: list.ok, status: list.status };
    });

    ipcMain.handle('players:sync', async () => {
      const result = await service.syncFriends();
      return { ...result, status: service.status() };
    });

    ipcMain.handle('players:add', async (_event, payload = {}) => {
      const result = await service.add(payload);
      return {
        ...result,
        player: result.player ? decoratePlayer(result.player) : null,
      };
    });

    ipcMain.handle('players:update', async (_event, id, patch = {}) => {
      const result = await service.update(id, patch);
      return {
        ...result,
        player: result.player ? decoratePlayer(result.player) : null,
      };
    });

    ipcMain.handle('players:remove', (_event, id) => service.remove(id));

    ipcMain.handle('players:refresh', async (_event, id) => {
      const result = await service.refresh(id);
      return {
        ...result,
        player: result.player ? decoratePlayer(result.player) : null,
      };
    });
  }

  function handleLogin() {
    void service.syncFriends().catch((error) => {
      console.error('[players] friend sync after login failed', error.message);
    });
  }

  function startAuto() {
    void service.syncFriends().catch((error) => {
      console.error('[players] startup friend sync failed', error.message);
    });
  }

  async function ingestRefs(refs) {
    return service.ingestRefs(refs);
  }

  return { service, view, register, handleLogin, startAuto, ingestRefs };
}

module.exports = { avatarUrl, createPlayersService, decoratePlayer };
