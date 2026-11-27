import type { Photo } from '../types';
import { photoSrc } from '../platform';
import { PENDING_WORLD, UNLINKED_WORLD, photoWorldKey } from './filters';
import { formatDateShort } from './date';

export interface WorldJourneyEntry {
  key: string;
  name: string;
  id?: string;
  photos: number;
  firstAt: string;
  lastAt: string;
  years: number[];
  cover: string;
}

export interface YearJourney {
  year: number;
  photos: number;
  worlds: number;
}

export interface WorldJourney {
  totalPhotos: number;
  totalWorlds: number;
  unlinked: number;
  years: number[];
  spanYears: number;
  entries: WorldJourneyEntry[];
  topWorld: WorldJourneyEntry | null;
  byYear: YearJourney[];
}

interface Bucket {
  key: string;
  name: string;
  id?: string;
  thumbnail?: string;
  photos: Photo[];
}

/**
 * Group the world-linked photos by their world and derive first/last visits,
 * per-year activity and a cover image. Unlinked photos are counted separately
 * so the page can explain why they do not appear in the journey.
 */
export function buildWorldJourney(photos: Photo[]): WorldJourney {
  const buckets = new Map<string, Bucket>();
  const yearPhotos = new Map<number, number>();
  const yearWorlds = new Map<number, Set<string>>();
  let unlinked = 0;

  for (const photo of photos) {
    if (photo.missing) continue;
    const key = photoWorldKey(photo);
    if (key === UNLINKED_WORLD || key === PENDING_WORLD) {
      unlinked += 1;
      continue;
    }
    const date = new Date(photo.capturedAt);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getFullYear();
    yearPhotos.set(year, (yearPhotos.get(year) || 0) + 1);
    const worlds = yearWorlds.get(year) || new Set<string>();
    worlds.add(key);
    yearWorlds.set(year, worlds);

    const existing = buckets.get(key);
    if (existing) {
      existing.photos.push(photo);
      if (!existing.thumbnail && photo.world?.thumbnail) {
        existing.thumbnail = photo.world.thumbnail;
      }
    } else {
      buckets.set(key, {
        key,
        name: photo.world?.name || photo.worldId || '未知世界',
        id: photo.world?.id || photo.worldId,
        thumbnail: photo.world?.thumbnail,
        photos: [photo],
      });
    }
  }

  const entries: WorldJourneyEntry[] = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket.photos].sort(
      (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt),
    );
    if (sorted.length === 0) continue;
    const years = Array.from(
      new Set(sorted.map((photo) => new Date(photo.capturedAt).getFullYear())),
    ).sort((a, b) => a - b);
    entries.push({
      key: bucket.key,
      name: bucket.name,
      id: bucket.id,
      photos: sorted.length,
      firstAt: sorted[0].capturedAt,
      lastAt: sorted[sorted.length - 1].capturedAt,
      years,
      cover: bucket.thumbnail || photoSrc(sorted[sorted.length - 1]) || '',
    });
  }
  entries.sort(
    (a, b) => b.photos - a.photos || Date.parse(b.lastAt) - Date.parse(a.lastAt),
  );

  const years = Array.from(yearPhotos.keys()).sort((a, b) => a - b);
  const byYear = years.map((year) => ({
    year,
    photos: yearPhotos.get(year) || 0,
    worlds: yearWorlds.get(year)?.size || 0,
  }));

  const totalPhotos = entries.reduce((sum, entry) => sum + entry.photos, 0);
  return {
    totalPhotos,
    totalWorlds: entries.length,
    unlinked,
    years,
    spanYears: years.length ? years[years.length - 1] - years[0] + 1 : 0,
    entries,
    topWorld: entries[0] || null,
    byYear,
  };
}

export function journeyRange(entry: WorldJourneyEntry): string {
  if (entry.firstAt === entry.lastAt) return formatDateShort(entry.lastAt);
  return `${formatDateShort(entry.firstAt)} — ${formatDateShort(entry.lastAt)}`;
}
