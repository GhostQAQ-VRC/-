'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const {
  PlayerLibrary,
  isVrchatUserId,
  normalizePlayerId,
} = require('../players.cjs');

const FRIEND_A = 'usr_11111111-1111-4111-8111-111111111111';
const FRIEND_B = 'usr_22222222-2222-4222-8222-222222222222';
const STRANGER = 'usr_33333333-3333-4333-8333-333333333333';
const SELF = 'usr_99999999-9999-4999-8999-999999999999';

function remoteUser(id, name, extra = {}) {
  return {
    id,
    displayName: name,
    username: name.toLowerCase(),
    isFriend: true,
    status: 'active',
    statusDescription: '在 VRChat 里',
    currentAvatarThumbnailImageUrl: `https://api.vrchat.cloud/api/1/file/file_${id}/1/file`,
    ...extra,
  };
}

async function avatarDataUrl() {
  const buffer = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#caa9ff' },
  })
    .webp()
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

function fakeClient(options = {}) {
  const state = {
    self: options.self || remoteUser(SELF, 'Me'),
    friends: options.friends || [],
    profiles: options.profiles || {},
    requests: [],
    downloads: [],
  };
  return {
    state,
    async request(route) {
      state.requests.push(route);
      if (route === '/auth/user') {
        if (options.unauthorized) return { response: { status: 401 }, json: null };
        return { response: { status: 200 }, json: state.self };
      }
      if (route.startsWith('/auth/user/friends')) {
        return { response: { status: 200 }, json: state.friends };
      }
      if (route.startsWith('/users/')) {
        const id = decodeURIComponent(route.slice('/users/'.length));
        const profile = state.profiles[id];
        if (!profile) return { response: { status: 404 }, json: null };
        return { response: { status: 200 }, json: profile };
      }
      return { response: { status: 404 }, json: null };
    },
    async downloadCover(url) {
      state.downloads.push(url);
      return options.image || (await avatarDataUrl());
    },
  };
}

async function makeService(options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'hoshikuzu-players-'));
  const root = path.join(base, 'library');
  await fs.mkdir(root, { recursive: true });
  const client = options.client || fakeClient();
  const events = { status: [], changed: [] };
  const service = new PlayerLibrary({
    getRoot: () => root,
    getClient: () => (options.noClient ? null : client),
    onStatus: (status) => events.status.push(status),
    onChanged: (change) => events.changed.push(change),
  });
  return { base, root, service, client, events };
}

test('player ids are strict and support local manual players', () => {
  assert.equal(isVrchatUserId(FRIEND_A), true);
  assert.equal(isVrchatUserId('usr_not-a-uuid'), false);
  assert.equal(normalizePlayerId(` ${FRIEND_A.toUpperCase()} `), FRIEND_A);
  assert.equal(normalizePlayerId('local_0123456789abcdef'), 'local_0123456789abcdef');
  assert.equal(normalizePlayerId('local_short'), '');
});

test('manual and VRChat players are stored with content-addressed avatars', async () => {
  const { base, root, service, client } = await makeService({
    client: fakeClient({ profiles: { [STRANGER]: remoteUser(STRANGER, 'Stranger') } }),
  });
  try {
    const local = await service.add({ displayName: '本地朋友', note: '漫展认识' });
    assert.equal(local.ok, true);
    assert.match(local.player.id, /^local_[a-f0-9]{16}$/);
    assert.equal(local.player.isFriend, false);
    assert.equal(local.player.note, '漫展认识');

    const remote = await service.add({ id: STRANGER, note: '合照里的陌生人' });
    assert.equal(remote.ok, true, remote.error);
    assert.equal(remote.player.id, STRANGER);
    assert.equal(remote.player.displayName, 'Stranger');
    assert.equal(remote.player.note, '合照里的陌生人');
    assert.ok(remote.player.avatar);
    assert.match(remote.player.avatar.file, /^[a-f0-9]{40}\.webp$/);
    assert.equal(remote.player.avatar.kind, 'avatar');
    assert.ok(remote.player.avatarHistory.length >= 1);
    assert.equal(client.state.downloads.length, 1);
    await fs.stat(
      path.join(root, '.hoshikuzu', 'players', 'avatars', remote.player.avatar.file),
    );

    const updated = await service.update(STRANGER, { note: '已经加上好友' });
    assert.equal(updated.ok, true);
    assert.equal(updated.player.note, '已经加上好友');

    const list = await service.view();
    assert.equal(list.ok, true);
    assert.equal(list.players.length, 2);
    assert.equal(list.players[0].id, local.player.id);

    const removed = await service.remove(local.player.id);
    assert.equal(removed.ok, true);
    const after = await service.view();
    assert.equal(after.players.length, 1);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('friend sync imports friends, preserves notes, hydrates tagged strangers and removes ex-friends', async () => {
  const dataFile = path.join('library', '.hoshikuzu', 'players', 'players.json');
  const { base, root, service, client } = await makeService({
    client: fakeClient({
      friends: [remoteUser(FRIEND_A, 'Alice'), remoteUser(FRIEND_B, 'Bob')],
      profiles: { [STRANGER]: remoteUser(STRANGER, 'Tagged Stranger', { isFriend: false }) },
    }),
  });
  try {
    await fs.mkdir(path.dirname(path.join(base, dataFile)), { recursive: true });
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(base, dataFile),
      JSON.stringify({
        format: 'hoshikuzu-players',
        version: 1,
        me: null,
        lastSyncAt: null,
        lastSyncError: null,
        updatedAt: now,
        players: [
          {
            id: FRIEND_A,
            displayName: 'Alice Old',
            isFriend: true,
            note: '保留的备注',
            source: 'manual',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'usr_44444444-4444-4444-8444-444444444444',
            displayName: 'Ex Friend',
            isFriend: true,
            note: '',
            source: 'friend-sync',
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );
    await service.ingestRefs([{ id: STRANGER, displayName: 'Tagged Stranger' }]);

    const result = await service.syncFriends();
    assert.equal(result.ok, true, result.error);
    assert.equal(result.friends, 2);
    const view = await service.view();
    assert.equal(view.status.lastSyncError, null);
    assert.ok(view.status.lastSyncAt);
    const alice = view.players.find((player) => player.id === FRIEND_A);
    assert.equal(alice.displayName, 'Alice');
    assert.equal(alice.note, '保留的备注');
    assert.equal(alice.isFriend, true);
    assert.ok(alice.avatar);
    const bob = view.players.find((player) => player.id === FRIEND_B);
    assert.equal(bob.isFriend, true);
    assert.ok(bob.avatar);
    const me = view.players.find((player) => player.id === SELF);
    assert.equal(me.isSelf, true);
    assert.ok(me.avatar);
    const ex = view.players.find((player) => player.id.startsWith('usr_4444'));
    assert.equal(ex.isFriend, false);
    assert.ok(ex.removedFromFriendsAt);
    const stranger = view.players.find((player) => player.id === STRANGER);
    assert.equal(stranger.isFriend, false);
    assert.equal(stranger.displayName, 'Tagged Stranger');
    assert.ok(stranger.avatar);
    assert.equal(view.status.friendCount, 2);

    const downloads = client.state.downloads.length;
    const second = await service.syncFriends();
    assert.equal(second.ok, true, second.error);
    assert.equal(client.state.downloads.length, downloads, 'unchanged avatars are not re-downloaded');
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('unauthorized sync stores an error without destroying the player list', async () => {
  const { base, service } = await makeService({
    client: fakeClient({ unauthorized: true }),
  });
  try {
    await service.add({ displayName: '保留玩家' });
    const result = await service.syncFriends();
    assert.equal(result.ok, false);
    assert.equal(result.needsLogin, true);
    assert.match(result.error, /登录/);
    const view = await service.view();
    assert.equal(view.players.length, 1);
    assert.match(view.status.lastSyncError, /登录/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
