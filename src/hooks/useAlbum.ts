import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivityEvent,
  ActivityType,
  AiSummaryResult,
  AlbumData,
  AlbumSettings,
  ImportMode,
  LibraryScanResult,
  LibraryScanSeed,
  Photo,
  PhotoDraft,
  WorldInfo,
  WorldLibraryEntry,
} from '../types';
import { getDesktopBridge, mediaUrl } from '../platform';
import {
  createId,
  createInitialAlbum,
  exportAlbumBackup,
  loadAlbum,
  nowIso,
  removeStoredAlbum,
  saveAlbum,
} from '../services/albumStorage';

export interface WorldEntryInput {
  name: string;
  id?: string;
  author?: string;
  thumbnail?: string;
  description?: string;
  capacity?: number;
  notes?: string;
}

/** Official world data returned by the desktop VRChat cover fetch. */
export interface WorldCoverInput {
  id: string;
  name?: string;
  author?: string;
  thumbnail?: string;
  description?: string;
  capacity?: number;
  fetchedAt?: string;
}

export interface AlbumApi {
  data: AlbumData;
  photos: Photo[];
  worlds: WorldLibraryEntry[];
  settings: AlbumSettings;
  activity: ActivityEvent[];
  storageError: string | null;
  initialSource: 'stored' | 'migrated' | 'sample';
  initiallyCorrupted: boolean;
  addPhoto: (draft: PhotoDraft) => Photo;
  updatePhoto: (id: string, patch: Partial<Photo>) => void;
  deletePhoto: (id: string) => void;
  deletePhotos: (ids: string[]) => void;
  detachWorldFromPhotos: (ids: string[]) => void;
  setFeaturedPhoto: (id: string | null) => void;
  saveWorld: (input: WorldEntryInput, existingKey?: string) => WorldLibraryEntry;
  deleteWorld: (key: string) => void;
  applyWorldCovers: (entries: WorldCoverInput[]) => void;
  updateSettings: (patch: Partial<AlbumSettings>) => void;
  importData: (data: AlbumData, mode: ImportMode) => void;
  applyScan: (result: LibraryScanResult) => void;
  applyPreviews: (entries: Array<{ hash: string; previewPath: string }>) => void;
  applyAiResults: (entries: AiSummaryResult[]) => void;
  applyWorldRecognition: (
    entries: Array<{ id: string; worldId?: string; worldName?: string }>,
  ) => void;
  logAiActivity: (message: string) => void;
  clearPreviewPaths: () => void;
  clearSampleContent: () => void;
  clearAllPhotos: () => void;
  clearActivity: () => void;
  resetAlbum: () => void;
  exportBackup: () => string;
}

function makeActivity(type: ActivityType, message: string, meta?: string): ActivityEvent {
  return { id: createId('act'), type, message, at: nowIso(), meta };
}

function pushActivity(activity: ActivityEvent[], event: ActivityEvent): ActivityEvent[] {
  return [event, ...activity].slice(0, 120);
}

function photoLabel(photo: Photo): string {
  const note = photo.note.trim();
  if (note) return note.length > 22 ? `${note.slice(0, 22)}…` : note;
  return `${photo.capturedAt.slice(0, 10)} 的照片`;
}

function keepFeaturedPhoto(settings: AlbumSettings, photos: Photo[]): AlbumSettings {
  const id = settings.featuredPhotoId;
  if (!id || photos.some((photo) => photo.id === id)) return settings;
  return { ...settings, featuredPhotoId: null };
}

function matchWorldEntry(
  worlds: WorldLibraryEntry[],
  world: WorldInfo,
  preferredKey?: string,
): WorldLibraryEntry | undefined {
  if (preferredKey) {
    const byKey = worlds.find((entry) => entry.key === preferredKey);
    if (byKey) return byKey;
  }
  if (world.id) {
    const byId = worlds.find(
      (entry) => entry.id && entry.id.toLowerCase() === world.id.toLowerCase(),
    );
    if (byId) return byId;
  }
  return worlds.find((entry) => !entry.id && entry.name === world.name);
}

function upsertWorldRecord(
  worlds: WorldLibraryEntry[],
  world: WorldInfo,
  preferredKey?: string,
): { worlds: WorldLibraryEntry[]; entry: WorldLibraryEntry } {
  const existing = matchWorldEntry(worlds, world, preferredKey);
  const stamp = nowIso();
  if (existing) {
    const entry: WorldLibraryEntry = {
      ...existing,
      id: world.id || existing.id,
      name: world.name,
      author: world.author ?? existing.author,
      thumbnail: world.thumbnail ?? existing.thumbnail,
      description: world.description ?? existing.description,
      capacity: world.capacity ?? existing.capacity,
      source: world.source,
      fetchedAt: world.fetchedAt ?? existing.fetchedAt,
      updatedAt: stamp,
    };
    return {
      worlds: worlds.map((item) => (item.key === entry.key ? entry : item)),
      entry,
    };
  }
  const entry: WorldLibraryEntry = {
    ...world,
    key: createId('wlib'),
    createdAt: stamp,
    updatedAt: stamp,
    builtin: false,
  };
  return { worlds: [...worlds, entry], entry };
}

function snapshotWorld(entry: WorldLibraryEntry): WorldInfo {
  return {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    thumbnail: entry.thumbnail,
    description: entry.description,
    capacity: entry.capacity,
    source: entry.source,
    fetchedAt: entry.fetchedAt,
  };
}

function lookupStateFor(world: WorldInfo | null): Photo['worldLookup'] {
  if (!world) return 'none';
  return world.source === 'manual' ? 'manual' : 'resolved';
}

/**
 * Removing a record must not delete the indexed original. Remember the hash so
 * a later library scan does not silently bring the photo back.
 */
function ignoreLibraryHashes(photos: Photo[]): void {
  const bridge = getDesktopBridge();
  if (!bridge) return;
  const hashes = photos
    .filter((photo) => photo.mediaKind === 'library' && photo.contentHash)
    .map((photo) => photo.contentHash as string);
  if (hashes.length === 0) return;
  void bridge.library.ignoreHashes(hashes).catch(() => {
    // Ignoring is best-effort; the record is still removed from the album.
  });
}

interface WorldRecognitionInput {
  id: string;
  worldId?: string;
  worldName?: string;
}

/** Attach AI-recognized World IDs without overwriting manual/resolved links. */
function attachRecognizedWorlds(
  photos: Photo[],
  worlds: WorldLibraryEntry[],
  entries: WorldRecognitionInput[],
): { photos: Photo[]; worlds: WorldLibraryEntry[]; count: number } {
  const nextPhotos = [...photos];
  const nextWorlds = [...worlds];
  const stamp = nowIso();
  let count = 0;

  for (const entry of entries) {
    if (!entry.worldId) continue;
    const index = nextPhotos.findIndex((photo) => photo.id === entry.id);
    if (index < 0) continue;
    const photo = nextPhotos[index];
    if (photo.worldLookup === 'manual') continue;
    if (photo.worldRef && photo.worldLookup !== 'none' && photo.worldLookup !== 'failed') {
      continue;
    }

    const lookup = entry.worldId.toLowerCase();
    let world = nextWorlds.find(
      (item) => item.id && item.id.toLowerCase() === lookup,
    );
    if (!world) {
      world = {
        key: createId('wlib'),
        id: entry.worldId,
        name:
          entry.worldName?.trim() ||
          `待补充世界 · ${entry.worldId.slice(0, 16)}`,
        source: 'local',
        createdAt: stamp,
        updatedAt: stamp,
        builtin: false,
      };
      nextWorlds.push(world);
    }

    nextPhotos[index] = {
      ...photo,
      worldId: world.id,
      world: snapshotWorld(world),
      worldRef: world.key,
      worldLookup: 'resolved',
      worldIdSource: 'ai',
    };
    count += 1;
  }

  return { photos: nextPhotos, worlds: nextWorlds, count };
}

export function useAlbum(): AlbumApi {
  const initial = useRef<ReturnType<typeof loadAlbum> | null>(null);
  if (!initial.current) initial.current = loadAlbum();
  const [data, setData] = useState<AlbumData>(initial.current.data);
  const [storageError, setStorageError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const didMount = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      if (initial.current?.source === 'migrated') saveAlbum(dataRef.current);
      return;
    }
    // Coalesce bursts (typing, thumbnail batches) into one write. The album
    // object can be large, and saving every preview event used to stutter
    // scrolling while a big library generated thumbnails.
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const result = saveAlbum(dataRef.current);
      setStorageError(result.ok ? null : (result.error ?? '本地保存失败。'));
    }, 320);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [data]);

  // Never lose the last edit when the window closes before the debounce fires.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const result = saveAlbum(dataRef.current);
      if (!result.ok) setStorageError(result.error ?? '本地保存失败。');
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  const addPhoto = useCallback((draft: PhotoDraft): Photo => {
    const current = dataRef.current;
    const libraryMatch = draft.worldId
      ? current.worlds.find(
          (entry) => entry.id && entry.id.toLowerCase() === draft.worldId?.toLowerCase(),
        )
      : undefined;
    const world = libraryMatch ? snapshotWorld(libraryMatch) : (draft.world ?? null);
    const photo: Photo = {
      id: createId('photo'),
      src: draft.src,
      alt: draft.alt,
      capturedAt: draft.capturedAt,
      note: draft.note,
      worldId: world?.id || draft.worldId,
      world,
      worldRef: libraryMatch?.key,
      worldLookup: world ? lookupStateFor(world) : draft.worldId ? 'failed' : 'none',
      createdAt: nowIso(),
      width: draft.width,
      height: draft.height,
      isUploaded: draft.isUploaded,
      isRemote: draft.isRemote === true,
      isSample: false,
      mediaKind: draft.mediaKind ?? (draft.libraryPath ? 'library' : draft.isRemote ? 'remote' : 'embedded'),
      libraryPath: draft.libraryPath,
      previewPath: draft.previewPath,
      fileBytes: draft.fileBytes,
      contentHash: draft.contentHash,
      metaSource: draft.metaSource,
      worldInstanceId: draft.worldInstanceId,
      managedCopy: draft.managedCopy,
      syncState: draft.libraryPath ? 'local' : undefined,
    };
    setData((prev) => {
      let worlds = prev.worlds;
      let nextPhoto = photo;
      if (world && !libraryMatch) {
        const result = upsertWorldRecord(worlds, world);
        worlds = result.worlds;
        nextPhoto = { ...photo, worldRef: result.entry.key };
      }
      return {
        ...prev,
        photos: [...prev.photos, nextPhoto],
        worlds,
        activity: pushActivity(
          prev.activity,
          makeActivity(
            'photo.add',
            `收录了照片「${photoLabel(nextPhoto)}」`,
            nextPhoto.id,
          ),
        ),
        updatedAt: nowIso(),
      };
    });
    return photo;
  }, []);

  const updatePhoto = useCallback((id: string, patch: Partial<Photo>) => {
    setData((prev) => {
      const target = prev.photos.find((photo) => photo.id === id);
      if (!target) return prev;
      let worlds = prev.worlds;
      const next: Photo = { ...target, ...patch };

      if (patch.world !== undefined) {
        if (patch.world === null) {
          next.worldRef = undefined;
          next.worldId = undefined;
          next.worldLookup = 'none';
        } else {
          const result = upsertWorldRecord(worlds, patch.world, patch.worldRef);
          worlds = result.worlds;
          next.worldRef = result.entry.key;
          next.worldId = result.entry.id || undefined;
          next.worldLookup = lookupStateFor(patch.world);
        }
      } else if (patch.worldRef) {
        const entry = worlds.find((item) => item.key === patch.worldRef);
        if (entry) {
          next.world = snapshotWorld(entry);
          next.worldId = entry.id || undefined;
          next.worldLookup = lookupStateFor(next.world);
        }
      }

      const dateChanged =
        patch.capturedAt !== undefined && patch.capturedAt !== target.capturedAt;
      const noteChanged = patch.note !== undefined && patch.note !== target.note;
      const altChanged = patch.alt !== undefined && patch.alt !== target.alt;
      const worldChanged =
        patch.world !== undefined ||
        patch.worldRef !== undefined ||
        patch.worldLookup !== undefined;
      let message = `更新了照片「${photoLabel(next)}」的信息`;
      if (worldChanged) {
        message = next.world
          ? `为「${photoLabel(next)}」关联/更新了世界「${next.world.name}」`
          : `解除了「${photoLabel(next)}」的世界关联`;
      } else {
        const changes: string[] = [];
        if (dateChanged) changes.push('拍摄时间');
        if (noteChanged) changes.push('备注');
        if (altChanged) changes.push('图片描述');
        if (changes.length) {
          message = `更新了照片「${photoLabel(next)}」的${changes.join('、')}`;
        }
      }

      return {
        ...prev,
        photos: prev.photos.map((photo) => (photo.id === id ? next : photo)),
        worlds,
        activity: pushActivity(
          prev.activity,
          makeActivity('photo.update', message, id),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const deletePhoto = useCallback((id: string) => {
    const target = dataRef.current.photos.find((photo) => photo.id === id);
    if (target) ignoreLibraryHashes([target]);
    setData((prev) => {
      const target = prev.photos.find((photo) => photo.id === id);
      if (!target) return prev;
      const photos = prev.photos.filter((photo) => photo.id !== id);
      return {
        ...prev,
        photos,
        settings: keepFeaturedPhoto(prev.settings, photos),
        activity: pushActivity(
          prev.activity,
          makeActivity('photo.delete', `删除了照片「${photoLabel(target)}」`, id),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const deletePhotos = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    ignoreLibraryHashes(dataRef.current.photos.filter((photo) => idSet.has(photo.id)));
    setData((prev) => {
      const photos = prev.photos.filter((photo) => !idSet.has(photo.id));
      return {
        ...prev,
        photos,
        settings: keepFeaturedPhoto(prev.settings, photos),
        activity: pushActivity(
          prev.activity,
          makeActivity('photo.bulk', `批量删除了 ${idSet.size} 张照片`),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const detachWorldFromPhotos = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    setData((prev) => ({
      ...prev,
      photos: prev.photos.map((photo) =>
        idSet.has(photo.id)
          ? {
              ...photo,
              worldId: undefined,
              world: null,
              worldRef: undefined,
              worldLookup: 'none',
            }
          : photo,
      ),
      activity: pushActivity(
        prev.activity,
        makeActivity('photo.bulk', `为 ${idSet.size} 张照片解除了世界关联`),
      ),
      updatedAt: nowIso(),
    }));
  }, []);

  const saveWorld = useCallback(
    (input: WorldEntryInput, existingKey?: string): WorldLibraryEntry => {
      const current = dataRef.current;
      const stamp = nowIso();
      const normalizedId = (input.id ?? '').trim().toLowerCase();
      const duplicate = normalizedId
        ? current.worlds.find(
            (entry) =>
              entry.key !== existingKey &&
              entry.id &&
              entry.id.toLowerCase() === normalizedId,
          )
        : undefined;
      const targetKey = existingKey ?? duplicate?.key;
      const existing = targetKey
        ? current.worlds.find((entry) => entry.key === targetKey)
        : undefined;
      const entry: WorldLibraryEntry = {
        key: existing?.key ?? createId('wlib'),
        id: normalizedId,
        name: input.name.trim(),
        author: input.author?.trim() || undefined,
        thumbnail: input.thumbnail?.trim() || undefined,
        description: input.description?.trim() || undefined,
        capacity: input.capacity && input.capacity > 0 ? Math.round(input.capacity) : undefined,
        source: 'local',
        notes: input.notes?.trim() || undefined,
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
        builtin: false,
        fetchedAt: existing?.fetchedAt,
      };

      setData((prev) => {
        const worlds = existing
          ? prev.worlds.map((item) => (item.key === entry.key ? entry : item))
          : [...prev.worlds, entry];
        const snapshot = snapshotWorld(entry);
        let affected = 0;
        const photos = prev.photos.map((photo) => {
          if (photo.worldRef !== entry.key) return photo;
          affected += 1;
          return {
            ...photo,
            world: snapshot,
            worldId: entry.id || undefined,
            worldLookup: 'resolved' as const,
            worldRef: entry.key,
          };
        });
        return {
          ...prev,
          worlds,
          photos,
          activity: pushActivity(
            prev.activity,
            makeActivity(
              existing ? 'world.update' : 'world.create',
              `${existing ? '更新' : '新建'}了世界资料「${entry.name}」${
                affected ? `，同步到 ${affected} 张照片` : ''
              }`,
              entry.key,
            ),
          ),
          updatedAt: nowIso(),
        };
      });
      return entry;
    },
    [],
  );

  const deleteWorld = useCallback((key: string) => {
    setData((prev) => {
      const entry = prev.worlds.find((item) => item.key === key);
      if (!entry) return prev;
      let affected = 0;
      const photos = prev.photos.map((photo) => {
        if (photo.worldRef !== key) return photo;
        affected += 1;
        return {
          ...photo,
          worldId: undefined,
          world: null,
          worldRef: undefined,
          worldLookup: 'none' as const,
        };
      });
      return {
        ...prev,
        worlds: prev.worlds.filter((item) => item.key !== key),
        photos,
        activity: pushActivity(
          prev.activity,
          makeActivity(
            'world.delete',
            `删除了世界资料「${entry.name}」${
              affected ? `，${affected} 张照片回到未关联状态` : ''
            }`,
            key,
          ),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  /**
   * Merge official VRChat world data into the library. Curator-edited names and
   * descriptions win; missing fields are filled, covers and `fetchedAt` always
   * refresh so the map library can be re-synced at any time.
   */
  const applyWorldCovers = useCallback((entries: WorldCoverInput[]) => {
    if (!entries.length) return;
    const byId = new Map(
      entries
        .filter((entry) => entry && entry.id)
        .map((entry) => [entry.id.toLowerCase(), entry]),
    );
    if (byId.size === 0) return;
    setData((prev) => {
      const stamp = nowIso();
      let updated = 0;
      const worlds = prev.worlds.map((world) => {
        if (!world.id) return world;
        const official = byId.get(world.id.toLowerCase());
        if (!official) return world;
        updated += 1;
        const placeholder =
          !world.name || world.name.startsWith('待补充') || world.name === world.id;
        return {
          ...world,
          name:
            placeholder && official.name
              ? official.name.trim().slice(0, 120)
              : world.name,
          author: official.author?.trim() || world.author,
          thumbnail:
            official.thumbnail?.startsWith('data:')
              ? official.thumbnail
              : world.thumbnail || official.thumbnail,
          description:
            world.description ||
            (official.description ? official.description.trim().slice(0, 800) : undefined),
          capacity: world.capacity || official.capacity,
          source: 'api' as const,
          fetchedAt: official.fetchedAt ?? stamp,
          updatedAt: stamp,
        };
      });
      if (!updated) return prev;

      const byKey = new Map(worlds.map((world) => [world.key, world]));
      const photos = prev.photos.map((photo) => {
        if (!photo.worldRef) return photo;
        const world = byKey.get(photo.worldRef);
        if (!world) return photo;
        return {
          ...photo,
          world: snapshotWorld(world),
          worldId: world.id || photo.worldId,
        };
      });

      return {
        ...prev,
        worlds,
        photos,
        activity: pushActivity(
          prev.activity,
          makeActivity(
            'world.update',
            `从 VRChat 官方更新了 ${updated} 个世界的封面与资料`,
          ),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AlbumSettings>) => {
    setData((prev) => {
      const settings = { ...prev.settings, ...patch };
      return {
        ...prev,
        settings,
        activity: pushActivity(
          prev.activity,
          makeActivity('settings.update', '更新了站点设置'),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const setFeaturedPhoto = useCallback((id: string | null) => {
    setData((prev) => {
      const photo = id ? prev.photos.find((item) => item.id === id) : undefined;
      if (id && !photo) return prev;
      const nextId = photo?.id ?? null;
      if (prev.settings.featuredPhotoId === nextId) return prev;
      return {
        ...prev,
        settings: { ...prev.settings, featuredPhotoId: nextId },
        activity: pushActivity(
          prev.activity,
          makeActivity(
            'photo.feature',
            photo
              ? `将照片「${photoLabel(photo)}」设为首页置顶`
              : '取消了首页置顶照片',
            photo?.id,
          ),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const importData = useCallback((incoming: AlbumData, mode: ImportMode) => {
    setData((prev) => {
      if (mode === 'replace') {
        return {
          ...incoming,
          settings: keepFeaturedPhoto(incoming.settings, incoming.photos),
          activity: pushActivity(
            incoming.activity,
            makeActivity(
              'data.import',
              `导入了备份，覆盖现有数据（${incoming.photos.length} 张照片、${incoming.worlds.length} 个世界）`,
            ),
          ),
          updatedAt: nowIso(),
        };
      }

      const keyMap = new Map<string, string>();
      const worlds = [...prev.worlds];
      for (const incomingWorld of incoming.worlds) {
        const existing = worlds.find(
          (entry) =>
            entry.key === incomingWorld.key ||
            (incomingWorld.id && entry.id && entry.id.toLowerCase() === incomingWorld.id.toLowerCase()),
        );
        if (existing) {
          keyMap.set(incomingWorld.key, existing.key);
          const merged: WorldLibraryEntry = {
            ...incomingWorld,
            key: existing.key,
            createdAt: existing.createdAt,
          };
          const index = worlds.findIndex((entry) => entry.key === existing.key);
          worlds[index] = merged;
        } else {
          worlds.push(incomingWorld);
          keyMap.set(incomingWorld.key, incomingWorld.key);
        }
      }

      const photoMap = new Map(prev.photos.map((photo) => [photo.id, photo]));
      for (const incomingPhoto of incoming.photos) {
        photoMap.set(incomingPhoto.id, {
          ...incomingPhoto,
          worldRef: incomingPhoto.worldRef
            ? (keyMap.get(incomingPhoto.worldRef) ?? incomingPhoto.worldRef)
            : undefined,
        });
      }

      return {
        ...prev,
        photos: [...photoMap.values()],
        worlds,
        activity: pushActivity(
          prev.activity,
          makeActivity(
            'data.import',
            `导入了备份并合并数据（新增 ${incoming.photos.length} 张照片、${incoming.worlds.length} 个世界记录）`,
          ),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  /**
   * Merge a desktop library scan into the album. Existing user edits (notes,
   * manual world overrides, manual dates) win; only derived fields refresh.
   */
  const applyScan = useCallback((result: LibraryScanResult) => {
    const seeds = result.seeds ?? [];
    if (seeds.length === 0 && !result.complete) return;
    setData((prev) => {
      const stamp = nowIso();
      const worldByVrchatId = new Map<string, WorldLibraryEntry>();
      for (const entry of prev.worlds) {
        if (entry.id) worldByVrchatId.set(entry.id.toLowerCase(), entry);
      }
      const touchedWorlds = new Map<string, WorldLibraryEntry>();

      const ensureWorld = (seed: LibraryScanSeed): WorldLibraryEntry | undefined => {
        const worldId = seed.worldId?.trim();
        if (!worldId) return undefined;
        const lookupKey = worldId.toLowerCase();
        const existing = worldByVrchatId.get(lookupKey);
        const fallbackName = `待补充世界 · ${worldId.slice(0, 16)}`;
        if (existing) {
          const placeholder =
            !existing.name ||
            existing.name.startsWith('待补充') ||
            existing.name === existing.id;
          const next: WorldLibraryEntry =
            seed.worldName && placeholder
              ? { ...existing, name: seed.worldName.trim().slice(0, 120), updatedAt: stamp }
              : existing;
          touchedWorlds.set(next.key, next);
          worldByVrchatId.set(lookupKey, next);
          return next;
        }
        const created: WorldLibraryEntry = {
          key: createId('wlib'),
          id: worldId,
          name: seed.worldName?.trim().slice(0, 120) || fallbackName,
          source: 'local',
          createdAt: stamp,
          updatedAt: stamp,
          builtin: false,
        };
        touchedWorlds.set(created.key, created);
        worldByVrchatId.set(lookupKey, created);
        return created;
      };

      const photos = [...prev.photos];
      const indexByHash = new Map<string, number>();
      photos.forEach((photo, index) => {
        if (photo.contentHash) indexByHash.set(photo.contentHash, index);
      });

      let added = 0;
      let updated = 0;

      for (const seed of seeds) {
        const entry = ensureWorld(seed);
        const worldSnapshot = entry ? snapshotWorld(entry) : null;
        const previewSrc = seed.previewPath ? mediaUrl('preview', seed.previewPath) : '';
        const existingIndex = indexByHash.get(seed.contentHash);

        if (existingIndex !== undefined) {
          const previous = photos[existingIndex];
          const dateLocked = previous.metaSource === 'manual';
          const worldLocked = previous.worldLookup === 'manual';
          const nextPreviewPath = seed.previewPath ?? previous.previewPath;
          photos[existingIndex] = {
            ...previous,
            // Thumbnails only. A library photo without a preview stays blank
            // until the background queue reports one (never the original).
            src: nextPreviewPath ? mediaUrl('preview', nextPreviewPath) : '',
            previewPath: nextPreviewPath,
            libraryPath: seed.libraryPath,
            fileBytes: seed.fileBytes,
            width: seed.width ?? previous.width,
            height: seed.height ?? previous.height,
            missing: false,
            mediaKind: 'library',
            contentHash: seed.contentHash,
            ...(dateLocked
              ? {}
              : { capturedAt: seed.capturedAt, metaSource: seed.metaSource }),
            ...(!worldLocked && worldSnapshot && entry
              ? {
                  world: worldSnapshot,
                  worldId: entry.id,
                  worldRef: entry.key,
                  worldLookup: 'resolved' as const,
                  worldInstanceId: seed.worldInstanceId,
                }
              : {}),
          };
          updated += 1;
          continue;
        }

        photos.push({
          id: seed.id || createId('photo'),
          src: previewSrc,
          alt: seed.alt || seed.libraryPath.split('/').pop() || '存储库照片',
          capturedAt: seed.capturedAt,
          note: '',
          worldId: entry?.id,
          world: worldSnapshot,
          worldRef: entry?.key,
          worldLookup: entry ? 'resolved' : 'none',
          createdAt: stamp,
          width: seed.width,
          height: seed.height,
          isUploaded: true,
          isRemote: false,
          isSample: false,
          mediaKind: 'library',
          libraryPath: seed.libraryPath,
          previewPath: seed.previewPath,
          fileBytes: seed.fileBytes,
          contentHash: seed.contentHash,
          metaSource: seed.metaSource,
          worldInstanceId: seed.worldInstanceId,
          syncState: 'local',
        });
        indexByHash.set(seed.contentHash, photos.length - 1);
        added += 1;
      }

      let missing = 0;
      const seenHashes = new Set(seeds.map((seed) => seed.contentHash));
      const nextPhotos = result.complete
        ? photos.map((photo) => {
            if (photo.mediaKind !== 'library') return photo;
            if (!photo.contentHash || seenHashes.has(photo.contentHash)) return photo;
            if (photo.missing) return photo;
            missing += 1;
            return { ...photo, missing: true };
          })
        : photos;

      const worlds = [
        ...prev.worlds.map((entry) => touchedWorlds.get(entry.key) ?? entry),
        ...Array.from(touchedWorlds.values()).filter(
          (entry) => !prev.worlds.some((item) => item.key === entry.key),
        ),
      ];

      const summary =
        added || updated || missing
          ? `扫描存储库：新增 ${added} 张、更新 ${updated} 张${
              missing ? `、${missing} 张文件缺失` : ''
            }`
          : '';

      return {
        ...prev,
        photos: nextPhotos,
        worlds,
        activity: summary
          ? pushActivity(prev.activity, makeActivity('data.import', summary))
          : prev.activity,
        updatedAt: stamp,
      };
    });
  }, []);

  const applyPreviews = useCallback(
    (entries: Array<{ hash: string; previewPath: string }>) => {
      if (entries.length === 0) return;
      const byHash = new Map(entries.map((entry) => [entry.hash, entry.previewPath]));
      setData((prev) => {
        let changed = false;
        const photos = prev.photos.map((photo) => {
          if (!photo.contentHash) return photo;
          const previewPath = byHash.get(photo.contentHash);
          if (!previewPath || previewPath === photo.previewPath) return photo;
          changed = true;
          return { ...photo, previewPath, src: mediaUrl('preview', previewPath) };
        });
        return changed ? { ...prev, photos, updatedAt: nowIso() } : prev;
      });
    },
    [],
  );

  const applyAiResults = useCallback((entries: AiSummaryResult[]) => {
    if (!entries.length) return;
    setData((prev) => {
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      let changed = false;
      const photos = prev.photos.map((photo) => {
        const entry = byId.get(photo.id);
        if (!entry) return photo;
        changed = true;
        return {
          ...photo,
          aiState: entry.state,
          aiSummary: entry.summary ?? photo.aiSummary,
          aiTags: entry.tags ?? photo.aiTags,
          aiModel: entry.model ?? photo.aiModel,
          aiUpdatedAt:
            entry.state === 'done'
              ? entry.generatedAt ?? nowIso()
              : photo.aiUpdatedAt,
          aiError: entry.state === 'error' ? entry.error : undefined,
        };
      });
      const attached = attachRecognizedWorlds(photos, prev.worlds, entries);
      return changed || attached.count
        ? {
            ...prev,
            photos: attached.photos,
            worlds: attached.worlds,
            updatedAt: nowIso(),
          }
        : prev;
    });
  }, []);

  const applyWorldRecognition = useCallback((entries: WorldRecognitionInput[]) => {
    if (!entries.length) return;
    setData((prev) => {
      const attached = attachRecognizedWorlds(prev.photos, prev.worlds, entries);
      if (!attached.count) return prev;
      return {
        ...prev,
        photos: attached.photos,
        worlds: attached.worlds,
        activity: pushActivity(
          prev.activity,
          makeActivity(
            'photo.update',
            `AI 从图片画面识别并关联了 ${attached.count} 个 World ID`,
          ),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const logAiActivity = useCallback((message: string) => {
    if (!message) return;
    setData((prev) => ({
      ...prev,
      activity: pushActivity(prev.activity, makeActivity('photo.update', message)),
      updatedAt: nowIso(),
    }));
  }, []);

  const clearPreviewPaths = useCallback(() => {
    setData((prev) => {
      let changed = false;
      const photos = prev.photos.map((photo) => {
        if (!photo.previewPath) return photo;
        changed = true;
        return {
          ...photo,
          previewPath: undefined,
          // Never repoint a grid photo at the original file.
          src: photo.mediaKind === 'library' ? '' : photo.src,
        };
      });
      return changed ? { ...prev, photos, updatedAt: nowIso() } : prev;
    });
  }, []);

  const clearSampleContent = useCallback(() => {
    setData((prev) => {
      const photos = prev.photos.filter((photo) => !photo.isSample);
      const usedRefs = new Set(photos.map((photo) => photo.worldRef).filter(Boolean));
      const worlds = prev.worlds.filter(
        (entry) => !entry.builtin || usedRefs.has(entry.key),
      );
      const removed = prev.photos.length - photos.length;
      return {
        ...prev,
        photos,
        worlds,
        settings: keepFeaturedPhoto(prev.settings, photos),
        activity: pushActivity(
          prev.activity,
          makeActivity('data.clear', `移除了 ${removed} 张示例照片与未使用的内置世界`),
        ),
        updatedAt: nowIso(),
      };
    });
  }, []);

  const clearAllPhotos = useCallback(() => {
    ignoreLibraryHashes(dataRef.current.photos);
    setData((prev) => ({
      ...prev,
      photos: [],
      settings: { ...prev.settings, featuredPhotoId: null },
      activity: pushActivity(
        prev.activity,
        makeActivity('data.clear', '清空了所有照片，世界资料库保留'),
      ),
      updatedAt: nowIso(),
    }));
  }, []);

  const clearActivity = useCallback(() => {
    setData((prev) => ({ ...prev, activity: [], updatedAt: nowIso() }));
  }, []);

  const resetAlbum = useCallback(() => {
    removeStoredAlbum();
    const fresh = createInitialAlbum();
    setData({
      ...fresh,
      activity: [
        makeActivity('data.reset', '恢复了起始相册与内置示例内容'),
      ],
    });
    setStorageError(null);
  }, []);

  const exportBackup = useCallback(() => exportAlbumBackup(dataRef.current), []);

  return {
    data,
    photos: data.photos,
    worlds: data.worlds,
    settings: data.settings,
    activity: data.activity,
    storageError,
    initialSource: initial.current.source,
    initiallyCorrupted: initial.current.corrupted,
    addPhoto,
    updatePhoto,
    deletePhoto,
    deletePhotos,
    detachWorldFromPhotos,
    setFeaturedPhoto,
    saveWorld,
    deleteWorld,
    applyWorldCovers,
    updateSettings,
    importData,
    applyScan,
    applyPreviews,
    applyAiResults,
    applyWorldRecognition,
    logAiActivity,
    clearPreviewPaths,
    clearSampleContent,
    clearAllPhotos,
    clearActivity,
    resetAlbum,
    exportBackup,
  };
}
