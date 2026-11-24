import type {
  ActivityEvent,
  ActivityType,
  AiPhotoState,
  AlbumData,
  BackupFile,
  Photo,
  PhotoMediaKind,
  PhotoMetaSource,
  PhotoSyncState,
  WorldInfo,
  WorldLibraryEntry,
  WorldLookupState,
  WorldSource,
} from '../types';
import { getDesktopBridge, hydrateLibrarySources } from '../platform';
import { createSamplePhotos } from '../data/photos';
import { createSeedWorlds, findSeedWorld } from '../data/worlds';
import { DEFAULT_SETTINGS, normalizeSettings } from '../data/settings';

export const STORAGE_KEY = 'hoshikuzu-album-v2';
const LEGACY_STORAGE_KEY = 'hoshikuzu-album-v1';
export const BACKUP_FORMAT = 'hoshikuzu-album-backup';
const BACKUP_VERSION = 2;

export interface LoadedAlbum {
  data: AlbumData;
  source: 'stored' | 'migrated' | 'sample';
  corrupted: boolean;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

const LOOKUP_STATES: WorldLookupState[] = ['none', 'resolved', 'manual', 'failed'];
const WORLD_SOURCES: WorldSource[] = ['demo', 'api', 'manual', 'local'];
const MEDIA_KINDS: PhotoMediaKind[] = ['embedded', 'remote', 'library'];
const META_SOURCES: PhotoMetaSource[] = [
  'xmp',
  'json',
  'exif',
  'filename',
  'mtime',
  'none',
  'manual',
];
const SYNC_STATES: PhotoSyncState[] = ['local', 'pending', 'synced', 'error'];
const AI_STATES: AiPhotoState[] = ['none', 'queued', 'running', 'done', 'error'];
const ACTIVITY_TYPES: ActivityType[] = [
  'photo.add',
  'photo.update',
  'photo.delete',
  'photo.bulk',
  'photo.feature',
  'world.create',
  'world.update',
  'world.delete',
  'settings.update',
  'data.import',
  'data.reset',
  'data.clear',
  'auth.update',
];

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asCapacity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

export function sanitizeWorldInfo(value: unknown): WorldInfo | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = asString(raw.name);
  if (!name) return null;
  const source = WORLD_SOURCES.includes(raw.source as WorldSource)
    ? (raw.source as WorldSource)
    : 'local';
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: name.slice(0, 120),
    author: asString(raw.author)?.slice(0, 80),
    thumbnail: asString(raw.thumbnail),
    description: asString(raw.description)?.slice(0, 800),
    capacity: asCapacity(raw.capacity),
    source,
    fetchedAt: asString(raw.fetchedAt),
  };
}

export function sanitizeWorldEntry(value: unknown): WorldLibraryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const world = sanitizeWorldInfo(raw);
  if (!world) return null;
  const createdAt = asString(raw.createdAt) ?? nowIso();
  return {
    ...world,
    key: asString(raw.key) ?? createId('wlib'),
    createdAt,
    updatedAt: asString(raw.updatedAt) ?? createdAt,
    notes: asString(raw.notes)?.slice(0, 500),
    builtin: raw.builtin === true,
  };
}

export function sanitizePhoto(value: unknown, legacy = false): Photo | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.src !== 'string') return null;
  if (typeof raw.capturedAt !== 'string' || Number.isNaN(new Date(raw.capturedAt).getTime())) {
    return null;
  }
  const world = raw.world ? sanitizeWorldInfo(raw.world) : null;
  const lookup = LOOKUP_STATES.includes(raw.worldLookup as WorldLookupState)
    ? (raw.worldLookup as WorldLookupState)
    : world
      ? world.source === 'manual'
        ? 'manual'
        : 'resolved'
      : 'none';
  const libraryPath = asString(raw.libraryPath)?.replace(/\\/g, '/');
  const mediaKind: PhotoMediaKind = MEDIA_KINDS.includes(raw.mediaKind as PhotoMediaKind)
    ? (raw.mediaKind as PhotoMediaKind)
    : libraryPath
      ? 'library'
      : /^https?:\/\//i.test(raw.src)
        ? 'remote'
        : 'embedded';
  const metaSource = META_SOURCES.includes(raw.metaSource as PhotoMetaSource)
    ? (raw.metaSource as PhotoMetaSource)
    : undefined;
  const syncState = SYNC_STATES.includes(raw.syncState as PhotoSyncState)
    ? (raw.syncState as PhotoSyncState)
    : undefined;
  const aiState = AI_STATES.includes(raw.aiState as AiPhotoState)
    ? (raw.aiState as AiPhotoState)
    : undefined;
  const aiSummary =
    typeof raw.aiSummary === 'string' && raw.aiSummary.trim()
      ? raw.aiSummary.trim().slice(0, 2000)
      : undefined;
  const aiTags = Array.isArray(raw.aiTags)
    ? raw.aiTags
        .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
        .map((tag) => tag.trim().slice(0, 24))
        .slice(0, 12)
    : undefined;
  return {
    id: raw.id,
    src: raw.src,
    alt: typeof raw.alt === 'string' ? raw.alt : '时光相册中的照片',
    capturedAt: raw.capturedAt,
    note: typeof raw.note === 'string' ? raw.note : '',
    worldId: asString(raw.worldId),
    world,
    worldRef: asString(raw.worldRef),
    worldLookup: lookup,
    createdAt: asString(raw.createdAt) ?? raw.capturedAt,
    width: typeof raw.width === 'number' ? raw.width : undefined,
    height: typeof raw.height === 'number' ? raw.height : undefined,
    isUploaded: raw.isUploaded === true,
    isRemote:
      mediaKind === 'library'
        ? false
        : raw.isRemote === true || /^https?:\/\//i.test(raw.src),
    isSample: raw.isSample === true || (legacy && raw.id.startsWith('mem-')),
    worldIdSource:
      raw.worldIdSource === 'ai' ||
      raw.worldIdSource === 'scan' ||
      raw.worldIdSource === 'manual'
        ? raw.worldIdSource
        : undefined,
    mediaKind,
    libraryPath,
    previewPath: asString(raw.previewPath)?.replace(/\\/g, '/'),
    fileBytes:
      typeof raw.fileBytes === 'number' && Number.isFinite(raw.fileBytes) && raw.fileBytes > 0
        ? Math.round(raw.fileBytes)
        : undefined,
    contentHash: asString(raw.contentHash),
    metaSource,
    worldInstanceId: asString(raw.worldInstanceId),
    missing: raw.missing === true || undefined,
    managedCopy: raw.managedCopy === true || undefined,
    syncState,
    aiSummary,
    aiTags,
    aiModel: asString(raw.aiModel)?.slice(0, 120),
    aiUpdatedAt: asString(raw.aiUpdatedAt),
    aiState,
    aiError: asString(raw.aiError)?.slice(0, 500),
  };
}

function sanitizeActivity(value: unknown): ActivityEvent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.message !== 'string') return null;
  const type = ACTIVITY_TYPES.includes(raw.type as ActivityType)
    ? (raw.type as ActivityType)
    : 'photo.update';
  return {
    id: raw.id,
    type,
    message: raw.message.slice(0, 300),
    at: asString(raw.at) ?? nowIso(),
    meta: asString(raw.meta)?.slice(0, 120),
  };
}

function entryFromWorld(world: WorldInfo, createdAt = nowIso()): WorldLibraryEntry {
  return {
    ...world,
    key: createId('wlib'),
    createdAt,
    updatedAt: nowIso(),
    builtin: false,
  };
}

function findEntryForWorld(
  worlds: WorldLibraryEntry[],
  world: WorldInfo,
): WorldLibraryEntry | undefined {
  if (world.id) {
    const byId = worlds.find(
      (entry) => entry.id && entry.id.toLowerCase() === world.id.toLowerCase(),
    );
    if (byId) return byId;
  }
  return worlds.find((entry) => !entry.id && entry.name === world.name);
}

/** Make sure every photo with a world snapshot points at a library record. */
function ensureWorldRefs(photos: Photo[], worlds: WorldLibraryEntry[]): void {
  for (const photo of photos) {
    if (!photo.world) {
      photo.worldRef = undefined;
      continue;
    }
    const existing = photo.worldRef
      ? worlds.find((entry) => entry.key === photo.worldRef)
      : undefined;
    if (existing) continue;
    const match = findEntryForWorld(worlds, photo.world);
    if (match) {
      photo.worldRef = match.key;
    } else {
      const entry = entryFromWorld(photo.world, photo.createdAt);
      worlds.push(entry);
      photo.worldRef = entry.key;
    }
  }
}

export function createInitialAlbum(): AlbumData {
  const worlds = createSeedWorlds();
  const photos = createSamplePhotos();
  ensureWorldRefs(photos, worlds);
  return {
    version: 2,
    photos,
    worlds,
    settings: { ...DEFAULT_SETTINGS },
    activity: [],
    updatedAt: nowIso(),
  };
}

/** First-run album for a desktop library: no demo photos or demo worlds. */
export function createEmptyAlbum(): AlbumData {
  return {
    version: 2,
    photos: [],
    worlds: [],
    settings: { ...DEFAULT_SETTINGS },
    activity: [],
    updatedAt: nowIso(),
  };
}

function migrateLegacy(raw: unknown): AlbumData | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as { photos?: unknown };
  if (!Array.isArray(source.photos)) return null;
  const photos = source.photos
    .map((item) => sanitizePhoto(item, true))
    .filter((photo): photo is Photo => photo !== null);
  const worlds = createSeedWorlds();

  for (const photo of photos) {
    if (!photo.world) continue;
    const seed = findSeedWorld(worlds, photo.world);
    if (seed) {
      photo.worldRef = seed.key;
      continue;
    }
    const entry = entryFromWorld(photo.world, photo.createdAt);
    worlds.push(entry);
    photo.worldRef = entry.key;
  }

  return {
    version: 2,
    photos,
    worlds,
    settings: { ...DEFAULT_SETTINGS },
    activity: [
      {
        id: createId('act'),
        type: 'data.import',
        message: `从旧版相册迁移了 ${photos.length} 张照片`,
        at: nowIso(),
      },
    ],
    updatedAt: nowIso(),
  };
}

function sanitizeAlbum(raw: unknown): AlbumData | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.photos)) return null;
  const photos = source.photos
    .map((item) => sanitizePhoto(item))
    .filter((photo): photo is Photo => photo !== null);
  const worlds = Array.isArray(source.worlds)
    ? source.worlds
        .map(sanitizeWorldEntry)
        .filter((entry): entry is WorldLibraryEntry => entry !== null)
    : [];
  ensureWorldRefs(photos, worlds);
  const activity = Array.isArray(source.activity)
    ? source.activity
        .map(sanitizeActivity)
        .filter((event): event is ActivityEvent => event !== null)
        .slice(0, 120)
    : [];
  const settings = normalizeSettings(source.settings);
  if (settings.featuredPhotoId && !photos.some((photo) => photo.id === settings.featuredPhotoId)) {
    settings.featuredPhotoId = null;
  }
  return {
    version: 2,
    photos,
    worlds,
    settings,
    activity,
    updatedAt: asString(source.updatedAt) ?? nowIso(),
  };
}

export function loadAlbum(): LoadedAlbum {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      const result = bridge.album.loadSync();
      if (result.configured) {
        if (!result.json) {
          return { data: createEmptyAlbum(), source: 'stored', corrupted: false };
        }
        const data = sanitizeAlbum(JSON.parse(result.json) as unknown);
        if (data) {
          return { data: hydrateLibrarySources(data), source: 'stored', corrupted: false };
        }
        return { data: createEmptyAlbum(), source: 'sample', corrupted: true };
      }
    } catch {
      // A broken library should not take the whole client down; fall through
      // to browser storage / the starter album so the UI can still open.
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const data = sanitizeAlbum(parsed);
      if (data) return { data, source: 'stored', corrupted: false };
      return { data: createInitialAlbum(), source: 'sample', corrupted: true };
    }
  } catch {
    return { data: createInitialAlbum(), source: 'sample', corrupted: true };
  }

  try {
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const migrated = migrateLegacy(JSON.parse(legacyRaw) as unknown);
      if (migrated) return { data: migrated, source: 'migrated', corrupted: false };
    }
  } catch {
    return { data: createInitialAlbum(), source: 'sample', corrupted: true };
  }

  return { data: createInitialAlbum(), source: 'sample', corrupted: false };
}

export function saveAlbum(data: AlbumData): SaveResult {
  const payload: AlbumData = { ...data, updatedAt: nowIso() };
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      const result = bridge.album.saveSync(JSON.stringify(payload));
      if (result.configured) {
        return result.ok
          ? { ok: true }
          : {
              ok: false,
              error: result.error ?? '无法写入存储库，新的修改可能在关闭后丢失。',
            };
      }
    } catch {
      return {
        ok: false,
        error: '无法写入存储库，新的修改可能在关闭后丢失。',
      };
    }
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch (error) {
    const name = (error as Error)?.name;
    return {
      ok: false,
      error:
        name === 'QuotaExceededError'
          ? '浏览器本地存储空间不足，新的修改可能在刷新后丢失。请导出备份并清理照片。'
          : '无法写入浏览器本地存储，新的修改可能在刷新后丢失。',
    };
  }
}

export function removeStoredAlbum(): void {
  const bridge = getDesktopBridge();
  if (bridge) {
    try {
      bridge.album.resetSync();
    } catch {
      // Keep the in-memory reset usable even if the library is unavailable.
    }
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore storage failures — the in-memory reset still works.
  }
}

export function exportAlbumBackup(data: AlbumData): string {
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: nowIso(),
    data,
  };
  return JSON.stringify(backup);
}

export interface ParsedBackup {
  data: AlbumData;
  exportedAt: string;
}

export function parseAlbumBackup(text: string): ParsedBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON。');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('备份文件结构不正确。');
  const raw = parsed as Record<string, unknown>;
  let dataSource: unknown = raw;
  if (raw.format === BACKUP_FORMAT && raw.data) {
    dataSource = raw.data;
  } else if (raw.format) {
    throw new Error('无法识别这个备份文件的格式。');
  } else if (Array.isArray(raw.photos)) {
    // Allow an older raw album payload as a convenience.
    dataSource = { ...raw, worlds: raw.worlds ?? [] };
  }
  const data = sanitizeAlbum(dataSource);
  if (!data) throw new Error('备份中没有可用的相册数据。');
  return {
    data,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : nowIso(),
  };
}

export function estimateAlbumBytes(data: AlbumData): number {
  try {
    return new Blob([JSON.stringify(data)]).size;
  } catch {
    return JSON.stringify(data).length;
  }
}
