import type { AlbumFilters, Photo } from '../types';
import { monthKey, searchText, yearOf } from './date';

export const ALL_WORLDS = 'all';
export const UNLINKED_WORLD = 'unlinked';
export const PENDING_WORLD = 'pending';

export const DEFAULT_FILTERS: AlbumFilters = {
  query: '',
  worldKey: ALL_WORLDS,
  sort: 'desc',
};

export function photoWorldKey(photo: Photo): string {
  if (photo.world) {
    if (photo.world.source === 'manual' || !photo.world.id) {
      return `manual:${photo.world.name}`;
    }
    return `world:${photo.world.id}`;
  }
  if (photo.worldId) return PENDING_WORLD;
  return UNLINKED_WORLD;
}

export function photoWorldSearchText(photo: Photo): string {
  return [
    photo.note,
    photo.alt,
    photo.aiSummary,
    photo.aiTags?.join(' '),
    photo.world?.name,
    photo.world?.author,
    photo.world?.description,
    photo.worldId,
    searchText(photo.capturedAt),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export interface WorldFilterOption {
  key: string;
  label: string;
  count: number;
  kind: 'unlinked' | 'pending' | 'world' | 'manual';
}

export function buildWorldOptions(photos: Photo[]): WorldFilterOption[] {
  const map = new Map<string, WorldFilterOption>();
  for (const photo of photos) {
    const key = photoWorldKey(photo);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    if (key === UNLINKED_WORLD) {
      map.set(key, { key, label: '未关联世界', count: 1, kind: 'unlinked' });
    } else if (key === PENDING_WORLD) {
      map.set(key, { key, label: '待识别的世界', count: 1, kind: 'pending' });
    } else if (key.startsWith('manual:')) {
      map.set(key, {
        key,
        label: photo.world?.name ?? '手动填写',
        count: 1,
        kind: 'manual',
      });
    } else {
      map.set(key, {
        key,
        label: photo.world?.name ?? '未知世界',
        count: 1,
        kind: 'world',
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.kind === 'unlinked') return 1;
    if (b.kind === 'unlinked') return -1;
    if (a.kind === 'pending') return 1;
    if (b.kind === 'pending') return -1;
    return a.label.localeCompare(b.label, 'zh-Hans-CN');
  });
}

export function filterPhotos(photos: Photo[], filters: AlbumFilters): Photo[] {
  const qRaw = filters.query.trim().toLowerCase();
  const qCompact = qRaw.replace(/\s+/g, '');
  const filtered = photos.filter((photo) => {
    if (filters.worldKey !== ALL_WORLDS && photoWorldKey(photo) !== filters.worldKey) {
      return false;
    }
    if (!qRaw) return true;
    const haystack = photoWorldSearchText(photo);
    return haystack.includes(qRaw) || haystack.replace(/\s+/g, '').includes(qCompact);
  });

  const direction = filters.sort === 'asc' ? 1 : -1;
  return filtered.sort((a, b) => {
    const diff = Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
    if (diff !== 0) return diff * direction;
    return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * direction;
  });
}

export interface MonthGroup {
  key: string;
  year: number;
  month: number;
  photos: Photo[];
}

export interface YearGroup {
  year: number;
  months: MonthGroup[];
  count: number;
}

/** Photos must be pre-sorted; months are kept contiguous. */
export function groupPhotos(photos: Photo[]): YearGroup[] {
  const years: YearGroup[] = [];
  for (const photo of photos) {
    const year = yearOf(photo.capturedAt);
    const key = monthKey(photo.capturedAt);
    const month = Number(key.slice(5, 7)) - 1;
    let yearGroup = years[years.length - 1];
    if (!yearGroup || yearGroup.year !== year) {
      yearGroup = { year, months: [], count: 0 };
      years.push(yearGroup);
    }
    let monthGroup = yearGroup.months[yearGroup.months.length - 1];
    if (!monthGroup || monthGroup.key !== key) {
      monthGroup = { key, year, month, photos: [] };
      yearGroup.months.push(monthGroup);
    }
    monthGroup.photos.push(photo);
    yearGroup.count += 1;
  }
  return years;
}

export interface AlbumStats {
  total: number;
  worlds: number;
  years: number;
}

export function getAlbumStats(photos: Photo[]): AlbumStats {
  const worlds = new Set<string>();
  const years = new Set<number>();
  for (const photo of photos) {
    const key = photoWorldKey(photo);
    if (key !== UNLINKED_WORLD) worlds.add(key);
    years.add(yearOf(photo.capturedAt));
  }
  return { total: photos.length, worlds: worlds.size, years: years.size };
}
