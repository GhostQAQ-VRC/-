'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PLAYERS_DIR = 'players';
const PLAYERS_FILE = 'players.json';
const AVATAR_DIR = 'avatars';
const PLAYERS_FORMAT = 'hoshikuzu-players';
const PLAYERS_VERSION = 1;
const MAX_PLAYERS = 5000;
const MAX_AVATAR_HISTORY = 12;
const MAX_AVATAR_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 60;
const PAGE_SIZE = 100;
const FRIEND_PAGE_DELAY_MS = 180;
const AVATAR_DELAY_MS = 140;
const MAX_TAGGED_PROFILES_PER_SYNC = 30;
const PLAYER_AVATAR_PATTERN = /^[a-f0-9]{40}\.webp$/;
const USER_ID_PATTERN =
  /^usr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ID_PATTERN = /^local_[a-f0-9]{16}$/;

function isVrchatUserId(value) {
  return typeof value === 'string' && USER_ID_PATTERN.test(value);
}

function normalizePlayerId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (USER_ID_PATTERN.test(id)) return id.toLowerCase();
  if (LOCAL_ID_PATTERN.test(id)) return id.toLowerCase();
  return '';
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function cleanUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return '';
  try {
    const url = new URL(value);
    if (!/(^|\.)vrchat\.(cloud|com)$/i.test(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function urlIdentity(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return '';
  }
}

function avatarCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = [
    [raw.profilePicOverrideThumbnail, 'profile'],
    [raw.currentAvatarThumbnailImageUrl, 'avatar'],
    [raw.userIcon, 'icon'],
    [raw.profilePicOverride, 'profile'],
    [raw.currentAvatarImageUrl, 'avatar'],
  ];
  for (const [value, kind] of candidates) {
    const url = cleanUrl(value);
    if (url) return { url, kind };
  }
  return null;
}

function normalizeAvatar(value) {
  if (!value || typeof value !== 'object') return null;
  const file = typeof value.file === 'string' ? value.file : '';
  if (!PLAYER_AVATAR_PATTERN.test(file)) return null;
  return {
    file,
    sourceUrl: cleanUrl(value.sourceUrl),
    kind: value.kind === 'profile' || value.kind === 'icon' ? value.kind : 'avatar',
    capturedAt:
      typeof value.capturedAt === 'string' && !Number.isNaN(Date.parse(value.capturedAt))
        ? value.capturedAt
        : new Date().toISOString(),
  };
}

function normalizeAvatarHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const history = [];
  for (const item of value) {
    const avatar = normalizeAvatar(item);
    if (!avatar || seen.has(avatar.file)) continue;
    seen.add(avatar.file);
    history.push(avatar);
    if (history.length >= MAX_AVATAR_HISTORY) break;
  }
  return history;
}

function normalizePlayer(value) {
  if (!value || typeof value !== 'object') return null;
  const id = normalizePlayerId(value.id);
  if (!id) return null;
  const displayName =
    cleanText(value.displayName, 80) ||
    (isVrchatUserId(id) ? id.slice(0, 18) : '未命名玩家');
  const avatar = normalizeAvatar(value.avatar);
  return {
    id,
    displayName,
    username: cleanText(value.username, 80),
    isFriend: value.isFriend === true,
    isSelf: value.isSelf === true,
    status: cleanText(value.status, 40),
    statusDescription: cleanText(value.statusDescription, 200),
    pronouns: cleanText(value.pronouns, 40),
    lastPlatform: cleanText(value.lastPlatform, 40),
    lastLogin:
      typeof value.lastLogin === 'string' && !Number.isNaN(Date.parse(value.lastLogin))
        ? value.lastLogin
        : '',
    joinedAt:
      typeof value.joinedAt === 'string' && !Number.isNaN(Date.parse(value.joinedAt))
        ? value.joinedAt
        : '',
    note: cleanText(value.note, 500),
    source:
      value.source === 'friend-sync' ||
      value.source === 'vrcx' ||
      value.source === 'photo-tag'
        ? value.source
        : 'manual',
    avatar,
    avatarHistory: normalizeAvatarHistory(value.avatarHistory),
    createdAt:
      typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
        ? value.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
        ? value.updatedAt
        : new Date().toISOString(),
    syncedAt:
      typeof value.syncedAt === 'string' && !Number.isNaN(Date.parse(value.syncedAt))
        ? value.syncedAt
        : '',
    removedFromFriendsAt:
      typeof value.removedFromFriendsAt === 'string' &&
      !Number.isNaN(Date.parse(value.removedFromFriendsAt))
        ? value.removedFromFriendsAt
        : '',
  };
}

function emptyData(now) {
  return {
    format: PLAYERS_FORMAT,
    version: PLAYERS_VERSION,
    me: null,
    players: [],
    lastSyncAt: null,
    lastSyncError: null,
    updatedAt: now,
  };
}

function normalizeData(raw, now) {
  if (!raw || typeof raw !== 'object' || raw.format !== PLAYERS_FORMAT) return emptyData(now);
  const players = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.players) ? raw.players : []) {
    const player = normalizePlayer(item);
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    players.push(player);
    if (players.length >= MAX_PLAYERS) break;
  }
  const me = raw.me && typeof raw.me === 'object' ? normalizePlayer(raw.me) : null;
  return {
    format: PLAYERS_FORMAT,
    version: PLAYERS_VERSION,
    me: me ? { id: me.id, displayName: me.displayName, avatar: me.avatar } : null,
    players,
    lastSyncAt:
      typeof raw.lastSyncAt === 'string' && !Number.isNaN(Date.parse(raw.lastSyncAt))
        ? raw.lastSyncAt
        : null,
    lastSyncError: cleanText(raw.lastSyncError, 400) || null,
    updatedAt:
      typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : now,
  };
}

function profileFromRemote(raw, existing) {
  if (!raw || typeof raw !== 'object' || !isVrchatUserId(raw.id)) return null;
  const id = raw.id.toLowerCase();
  const now = new Date().toISOString();
  const base = normalizePlayer(existing || { id, source: 'friend-sync' });
  const displayName = cleanText(raw.displayName, 80) || base?.displayName || id.slice(0, 18);
  const candidate = avatarCandidate(raw);
  return {
    player: {
      ...(base || {
        id,
        note: '',
        avatar: null,
        avatarHistory: [],
        createdAt: now,
        updatedAt: now,
        source: 'friend-sync',
      }),
      id,
      displayName,
      username: cleanText(raw.username, 80) || base?.username || '',
      isFriend: raw.isFriend === true || base?.isFriend === true,
      isSelf: base?.isSelf === true,
      status: cleanText(raw.status, 40) || base?.status || '',
      statusDescription:
        cleanText(raw.statusDescription, 200) || base?.statusDescription || '',
      pronouns: cleanText(raw.pronouns, 40) || base?.pronouns || '',
      lastPlatform: cleanText(raw.last_platform, 40) || base?.lastPlatform || '',
      lastLogin:
        typeof raw.last_login === 'string' && !Number.isNaN(Date.parse(raw.last_login))
          ? raw.last_login
          : base?.lastLogin || '',
      joinedAt:
        typeof raw.date_joined === 'string' && !Number.isNaN(Date.parse(raw.date_joined))
          ? raw.date_joined
          : base?.joinedAt || '',
      updatedAt: now,
      syncedAt: now,
      removedFromFriendsAt: '',
      source: base?.source === 'vrcx' ? 'vrcx' : 'friend-sync',
    },
    candidate,
  };
}

class PlayerLibrary {
  constructor(options = {}) {
    this.getRoot = options.getRoot || (() => null);
    this.getClient = options.getClient || (() => null);
    this.onStatus = options.onStatus || (() => {});
    this.onChanged = options.onChanged || (() => {});
    this.now = options.now || (() => new Date().toISOString());
    this.state = { root: null, data: null };
    this.syncPromise = null;
    this.progress = {
      running: false,
      phase: 'idle',
      current: 0,
      total: 0,
      message: '',
      error: null,
    };
  }

  directory(root) {
    return path.join(root, '.hoshikuzu', PLAYERS_DIR);
  }

  avatarDirectory(root) {
    return path.join(this.directory(root), AVATAR_DIR);
  }

  dataFile(root) {
    return path.join(this.directory(root), PLAYERS_FILE);
  }

  async ensureLoaded(root) {
    if (this.state.root === root && this.state.data) return this.state.data;
    let data = emptyData(this.now());
    try {
      const raw = JSON.parse(await fsp.readFile(this.dataFile(root), 'utf8'));
      data = normalizeData(raw, this.now());
    } catch {
      // Missing or corrupt player library: start empty; photo tags keep IDs.
    }
    this.state = { root, data };
    return data;
  }

  async save(root, data) {
    data.updatedAt = this.now();
    data.players = data.players.slice(0, MAX_PLAYERS);
    await fsp.mkdir(this.directory(root), { recursive: true });
    const target = this.dataFile(root);
    const temporary = `${target}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
    try {
      await fsp.rename(temporary, target);
    } catch {
      await fsp.rm(target, { force: true });
      await fsp.rename(temporary, target);
    }
    this.state = { root, data };
    this.onChanged({ updatedAt: data.updatedAt, count: data.players.length });
    return data;
  }

  status() {
    return {
      ...this.progress,
      lastSyncAt: this.state.data?.lastSyncAt || null,
      lastSyncError: this.state.data?.lastSyncError || null,
      totalPlayers: this.state.data?.players.length || 0,
      friendCount: (this.state.data?.players || []).filter(
        (player) => player.isFriend && !player.isSelf,
      ).length,
    };
  }

  pushStatus(patch = {}) {
    this.progress = { ...this.progress, ...patch };
    const status = this.status();
    this.onStatus(status);
    return status;
  }

  async view() {
    const root = this.getRoot();
    if (!root) {
      return {
        ok: false,
        error: '存储库不可用。',
        me: null,
        players: [],
        status: this.status(),
      };
    }
    const data = await this.ensureLoaded(root);
    const sorted = [...data.players].sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.isFriend !== b.isFriend) return a.isFriend ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, 'zh-CN');
    });
    return {
      ok: true,
      me: data.me,
      players: sorted,
      status: this.status(),
    };
  }

  find(data, id) {
    const playerId = normalizePlayerId(id);
    return playerId ? data.players.find((player) => player.id === playerId) || null : null;
  }

  async downloadAvatar(url, kind) {
    if (!url) return null;
    const client = this.getClient();
    if (!client || typeof client.downloadCover !== 'function') return null;
    const dataUrl = await client.downloadCover(url);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    let buffer;
    try {
      buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    } catch {
      return null;
    }
    if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return null;
    const root = this.getRoot();
    if (!root) return null;
    const file = `${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 40)}.webp`;
    const directory = this.avatarDirectory(root);
    await fsp.mkdir(directory, { recursive: true });
    const target = path.join(directory, file);
    try {
      await fsp.writeFile(target, buffer, { flag: 'wx' });
    } catch {
      // Content-addressed: an existing identical file needs no rewrite.
    }
    return {
      file,
      sourceUrl: url,
      kind,
      capturedAt: this.now(),
    };
  }

  async applyAvatar(root, player, candidate) {
    if (!candidate) return player;
    const existing = player.avatar;
    if (existing && existing.file) {
      const absolute = path.join(this.avatarDirectory(root), existing.file);
      const stat = await fsp.stat(absolute).catch(() => null);
      if (stat && stat.isFile() && urlIdentity(existing.sourceUrl) === urlIdentity(candidate.url)) {
        return {
          ...player,
          avatar: { ...existing, sourceUrl: candidate.url, kind: candidate.kind },
        };
      }
    }
    const avatar = await this.downloadAvatar(candidate.url, candidate.kind);
    if (!avatar) return player;
    const history = [...(player.avatarHistory || [])];
    if (!history.some((item) => item.file === avatar.file)) {
      history.unshift(avatar);
    }
    return {
      ...player,
      avatar,
      avatarHistory: history.slice(0, MAX_AVATAR_HISTORY),
    };
  }

  async add(payload = {}) {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const data = await this.ensureLoaded(root);
    const rawId = cleanText(payload.id, 80);
    const displayName = cleanText(payload.displayName, 80);
    const note = cleanText(payload.note, 500);
    let id = normalizePlayerId(rawId);
    if (rawId && !id) {
      return { ok: false, error: '玩家 ID 格式不正确，应为 VRChat 的 usr_… ID。' };
    }
    if (!id) {
      if (!displayName) return { ok: false, error: '请填写玩家名称或 VRChat ID。' };
      const sameName = data.players.find(
        (item) =>
          !isVrchatUserId(item.id) &&
          item.displayName.toLowerCase() === displayName.toLowerCase(),
      );
      if (sameName) {
        id = sameName.id;
      } else {
        const seed = `${displayName.toLowerCase()}|${this.now()}`;
        id = `local_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
      }
    }
    let player = this.find(data, id);
    let warning = '';
    if (!player) {
      const now = this.now();
      player = normalizePlayer({
        id,
        displayName: displayName || id.slice(0, 18),
        note,
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      });
      data.players.push(player);
    } else {
      player.displayName = displayName || player.displayName;
      player.note = note || player.note;
      player.updatedAt = this.now();
    }

    if (isVrchatUserId(id)) {
      try {
        const profile = await this.fetchProfile(id);
        if (profile) {
          player = { ...player, ...profile.player, note: player.note };
          player = await this.applyAvatar(root, player, profile.candidate);
        }
      } catch (error) {
        warning = error.message || '暂时无法获取 VRChat 资料，头像会在登录后补全。';
      }
    }
    await this.save(root, data);
    return { ok: true, player, warning: warning || undefined };
  }

  async update(id, patch = {}) {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const data = await this.ensureLoaded(root);
    const player = this.find(data, id);
    if (!player) return { ok: false, error: '玩家不在列表中。' };
    if (patch.displayName !== undefined) {
      const name = cleanText(patch.displayName, 80);
      if (name) player.displayName = name;
    }
    if (patch.note !== undefined) player.note = cleanText(patch.note, 500);
    player.updatedAt = this.now();
    await this.save(root, data);
    return { ok: true, player };
  }

  async remove(id) {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const data = await this.ensureLoaded(root);
    const playerId = normalizePlayerId(id);
    const before = data.players.length;
    data.players = data.players.filter((player) => player.id !== playerId);
    if (data.me && data.me.id === playerId) data.me = null;
    if (data.players.length === before) return { ok: false, error: '玩家不在列表中。' };
    await this.save(root, data);
    await this.pruneAvatars(root, data).catch(() => {});
    return { ok: true };
  }

  async refresh(id) {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const data = await this.ensureLoaded(root);
    const player = this.find(data, id);
    if (!player) return { ok: false, error: '玩家不在列表中。' };
    if (!isVrchatUserId(player.id)) {
      return { ok: false, error: '本地玩家没有 VRChat ID，无法从官方接口刷新。' };
    }
    try {
      const profile = await this.fetchProfile(player.id);
      if (!profile) return { ok: false, error: 'VRChat 返回了空的玩家资料。' };
      const next = { ...player, ...profile.player, note: player.note };
      const withAvatar = await this.applyAvatar(root, next, profile.candidate);
      const index = data.players.findIndex((item) => item.id === player.id);
      data.players[index] = withAvatar;
      await this.save(root, data);
      return { ok: true, player: withAvatar };
    } catch (error) {
      return { ok: false, error: error.message || '刷新资料失败。', needsLogin: error.status === 401 };
    }
  }

  async fetchProfile(id) {
    const client = this.getClient();
    if (!client) throw new Error('VRChat 客户端未初始化。');
    const { response, json } = await client.request(`/users/${encodeURIComponent(id)}`, {
      timeout: 20000,
    });
    if (response.status === 401) {
      const error = new Error('VRChat 登录已失效，请重新登录。');
      error.status = 401;
      throw error;
    }
    if (response.status !== 200 || !json || !isVrchatUserId(json.id)) {
      throw new Error(
        response.status === 404 ? 'VRChat 没有找到这个玩家。' : `VRChat 返回 HTTP ${response.status}`,
      );
    }
    return profileFromRemote(json, null);
  }

  async ingestRefs(refs) {
    const root = this.getRoot();
    if (!root || !Array.isArray(refs) || refs.length === 0) return { ok: true, added: 0 };
    const data = await this.ensureLoaded(root);
    const now = this.now();
    const unique = new Map();
    for (const ref of refs.slice(0, 50000)) {
      if (!ref || !isVrchatUserId(ref.id)) continue;
      const id = ref.id.toLowerCase();
      if (!unique.has(id)) {
        unique.set(id, {
          id,
          displayName: cleanText(ref.displayName, 80) || id.slice(0, 18),
        });
      }
    }
    let added = 0;
    for (const ref of unique.values()) {
      const existing = this.find(data, ref.id);
      if (existing) {
        if (
          ref.displayName &&
          (existing.source === 'vrcx' ||
            !existing.displayName ||
            existing.displayName === existing.id.slice(0, 18))
        ) {
          existing.displayName = ref.displayName;
        }
        continue;
      }
      data.players.push(
        normalizePlayer({
          id: ref.id,
          displayName: ref.displayName,
          source: 'vrcx',
          createdAt: now,
          updatedAt: now,
        }),
      );
      added += 1;
      if (data.players.length >= MAX_PLAYERS) break;
    }
    if (added > 0) await this.save(root, data);
    return { ok: true, added };
  }

  async syncFriends() {
    if (this.syncPromise) return { ok: false, error: '好友同步正在进行中。' };
    this.syncPromise = this.runSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async runSync() {
    const root = this.getRoot();
    if (!root) return { ok: false, error: '存储库不可用。' };
    const client = this.getClient();
    if (!client) return { ok: false, error: 'VRChat 客户端未初始化。' };
    const data = await this.ensureLoaded(root);
    this.pushStatus({
      running: true,
      phase: 'friends',
      current: 0,
      total: 0,
      message: '正在获取好友列表…',
      error: null,
    });

    try {
      const selfResult = await client.request('/auth/user', { timeout: 20000 });
      if (selfResult.response.status === 401) {
        const message = 'VRChat 登录已失效，请重新登录官方账号。';
        data.lastSyncError = message;
        await this.save(root, data);
        this.pushStatus({ running: false, phase: 'idle', error: message, message });
        return { ok: false, error: message, needsLogin: true };
      }

      const friends = [];
      const seen = new Set();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const offset = page * PAGE_SIZE;
        const { response, json } = await client.request(
          `/auth/user/friends?offline=true&n=${PAGE_SIZE}&offset=${offset}`,
          { timeout: 30000 },
        );
        if (response.status === 401) {
          const message = 'VRChat 登录已失效，请重新登录官方账号。';
          data.lastSyncError = message;
          await this.save(root, data);
          this.pushStatus({ running: false, phase: 'idle', error: message, message });
          return { ok: false, error: message, needsLogin: true };
        }
        if (response.status !== 200 || !Array.isArray(json)) {
          throw new Error(`获取好友列表失败（HTTP ${response.status}）。`);
        }
        for (const raw of json) {
          if (!raw || !isVrchatUserId(raw.id)) continue;
          const id = raw.id.toLowerCase();
          if (seen.has(id)) continue;
          seen.add(id);
          friends.push(raw);
        }
        this.pushStatus({
          running: true,
          phase: 'friends',
          current: friends.length,
          total: Math.max(friends.length, seen.size),
          message: `已获取 ${friends.length} 位好友…`,
        });
        if (json.length < PAGE_SIZE || friends.length >= MAX_PLAYERS) break;
        await new Promise((resolve) => setTimeout(resolve, FRIEND_PAGE_DELAY_MS));
      }

      const now = this.now();
      let selfProfile = null;
      if (selfResult.response.status === 200 && selfResult.json && isVrchatUserId(selfResult.json.id)) {
        selfProfile = profileFromRemote({ ...selfResult.json, isFriend: true }, null);
        if (selfProfile) {
          selfProfile.player.isSelf = true;
          selfProfile.player.isFriend = true;
          const existingSelf = this.find(data, selfProfile.player.id);
          if (existingSelf) {
            selfProfile.player = {
              ...selfProfile.player,
              note: existingSelf.note,
              createdAt: existingSelf.createdAt,
              source: existingSelf.source,
              avatar: existingSelf.avatar,
              avatarHistory: existingSelf.avatarHistory,
            };
          }
          selfProfile.player = await this.applyAvatar(
            root,
            selfProfile.player,
            selfProfile.candidate,
          );
          data.me = {
            id: selfProfile.player.id,
            displayName: selfProfile.player.displayName,
            avatar: selfProfile.player.avatar,
          };
          this.upsert(data, selfProfile.player);
        }
      }

      const friendRecords = [];
      for (const raw of friends) {
        const existing = this.find(data, raw.id);
        const profile = profileFromRemote(raw, existing);
        if (!profile) continue;
        // A manually curated note must survive every friend sync.
        profile.player.note = existing?.note || '';
        profile.player.createdAt = existing?.createdAt || profile.player.createdAt;
        profile.player.source =
          existing?.source === 'vrcx' ? 'vrcx' : existing?.source === 'manual' && existing.avatar ? 'manual' : 'friend-sync';
        const record = this.upsert(data, profile.player);
        friendRecords.push({ record, candidate: profile.candidate });
      }

      for (const player of data.players) {
        if (player.isSelf || seen.has(player.id)) continue;
        if (player.isFriend) {
          player.isFriend = false;
          player.removedFromFriendsAt = now;
          player.updatedAt = now;
        }
      }

      await this.save(root, data);
      this.pushStatus({
        running: true,
        phase: 'avatars',
        current: 0,
        total: friendRecords.length,
        message: '正在缓存好友头像…',
      });

      let current = 0;
      for (const entry of friendRecords) {
        if (!entry.candidate) continue;
        const latest = this.find(data, entry.record.id);
        if (!latest) continue;
        const updated = await this.applyAvatar(root, latest, entry.candidate);
        const index = data.players.findIndex((player) => player.id === updated.id);
        if (index >= 0) data.players[index] = updated;
        current += 1;
        if (current % 5 === 0) {
          await this.save(root, data);
          this.pushStatus({
            running: true,
            phase: 'avatars',
            current,
            total: friendRecords.length,
            message: `已缓存 ${current} / ${friendRecords.length} 位好友头像…`,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, AVATAR_DELAY_MS));
      }

      // Tagged strangers imported from VRCX have no friend-list entry; fill a
      // bounded batch per sync so a large archive cannot hammer the API.
      const pending = data.players
        .filter(
          (player) =>
            !player.isSelf &&
            !player.avatar &&
            isVrchatUserId(player.id) &&
            !seen.has(player.id),
        )
        .slice(0, MAX_TAGGED_PROFILES_PER_SYNC);
      if (pending.length) {
        this.pushStatus({
          running: true,
          phase: 'tagged',
          current: 0,
          total: pending.length,
          message: '正在补全合照玩家资料…',
        });
        let taggedCurrent = 0;
        for (const player of pending) {
          try {
            const profile = await this.fetchProfile(player.id);
            if (profile) {
              const merged = { ...player, ...profile.player, note: player.note };
              const withAvatar = await this.applyAvatar(root, merged, profile.candidate);
              const index = data.players.findIndex((item) => item.id === player.id);
              if (index >= 0) data.players[index] = withAvatar;
            }
          } catch (error) {
            if (error.status === 401) break;
          }
          taggedCurrent += 1;
          if (taggedCurrent % 3 === 0) await this.save(root, data);
          this.pushStatus({
            running: true,
            phase: 'tagged',
            current: taggedCurrent,
            total: pending.length,
            message: `已补全 ${taggedCurrent} / ${pending.length} 位合照玩家…`,
          });
          await new Promise((resolve) => setTimeout(resolve, 550));
        }
      }

      data.lastSyncAt = this.now();
      data.lastSyncError = null;
      await this.pruneAvatars(root, data).catch(() => {});
      await this.save(root, data);
      this.pushStatus({
        running: false,
        phase: 'idle',
        current: friends.length,
        total: friends.length,
        message: `好友同步完成（${friends.length} 位）`,
        error: null,
      });
      return { ok: true, friends: friends.length, status: this.status() };
    } catch (error) {
      const message = error.message || '好友同步失败。';
      data.lastSyncError = message;
      await this.save(root, data).catch(() => {});
      this.pushStatus({ running: false, phase: 'idle', error: message, message });
      return { ok: false, error: message };
    }
  }

  upsert(data, player) {
    const index = data.players.findIndex((item) => item.id === player.id);
    if (index >= 0) {
      data.players[index] = player;
      return data.players[index];
    }
    data.players.push(player);
    return player;
  }

  async pruneAvatars(root, data) {
    const referenced = new Set();
    const collect = (player) => {
      if (!player) return;
      if (player.avatar) referenced.add(player.avatar.file);
      for (const avatar of player.avatarHistory || []) referenced.add(avatar.file);
    };
    for (const player of data.players) collect(player);
    const directory = this.avatarDirectory(root);
    const entries = await fsp.readdir(directory).catch(() => []);
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of entries) {
      if (!PLAYER_AVATAR_PATTERN.test(name) || referenced.has(name)) continue;
      const absolute = path.join(directory, name);
      const stat = await fsp.stat(absolute).catch(() => null);
      // A download may be in flight for a manual add while a background sync
      // finishes; keep recent unreferenced files for an hour before pruning.
      if (stat && stat.mtimeMs < cutoff) {
        await fsp.rm(absolute, { force: true }).catch(() => {});
      }
    }
  }
}

module.exports = {
  AVATAR_DIR,
  MAX_AVATAR_HISTORY,
  PLAYER_AVATAR_PATTERN,
  PLAYERS_DIR,
  PLAYERS_FILE,
  PLAYERS_FORMAT,
  PlayerLibrary,
  USER_ID_PATTERN,
  avatarCandidate,
  isVrchatUserId,
  normalizePlayerId,
  normalizePlayer,
};
