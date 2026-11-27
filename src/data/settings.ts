import type { AlbumSettings, SmartAlbum } from '../types';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_LAYOUT,
  DEFAULT_THEME,
  isBackgroundEffect,
  isLayoutId,
  isThemeId,
} from './appearance';
import {
  LEGACY_SITE_NAME,
  LEGACY_SITE_NAME_EN,
  SHORT_SITE_NAME,
  SHORT_SITE_NAME_EN,
} from './branding';

const envApiBase = (import.meta.env.VITE_WORLD_API_BASE ?? '').trim();

export const DEFAULT_SETTINGS: AlbumSettings = {
  siteName: SHORT_SITE_NAME,
  siteNameEn: SHORT_SITE_NAME_EN,
  tagline:
    '在世界的缝隙里，留住一起看过的月亮、雨与烟火。\n翻开这条时间轴，回到当时的光。',
  timelineIntro:
    '沿着星轨往回走。每一个节点，都是某一次推开门、走进一个世界时留下的光。',
  featuredPhotoId: null,
  worldApiBase: envApiBase,
  theme: DEFAULT_THEME,
  layout: DEFAULT_LAYOUT,
  backgroundEffect: DEFAULT_BACKGROUND,
  experimentalEffects: false,
};

function normalizeSmartAlbums(value: unknown): SmartAlbum[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: SmartAlbum[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Partial<SmartAlbum>;
    if (typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const name = item.name.trim().slice(0, 24);
    if (!name) continue;
    out.push({
      id: item.id.slice(0, 80),
      name,
      query: typeof item.query === 'string' ? item.query.slice(0, 120) : '',
      worldRef: typeof item.worldRef === 'string' ? item.worldRef.slice(0, 120) : 'all',
      origin: typeof item.origin === 'string' ? item.origin.slice(0, 40) : 'all',
      sort: typeof item.sort === 'string' ? item.sort.slice(0, 20) : 'newest',
      tag: typeof item.tag === 'string' ? item.tag.slice(0, 40) : 'all',
      favorite:
        item.favorite === 'only' || item.favorite === 'none' ? item.favorite : 'all',
      createdAt:
        typeof item.createdAt === 'string' && !Number.isNaN(Date.parse(item.createdAt))
          ? item.createdAt
          : new Date(0).toISOString(),
    });
    if (out.length >= 30) break;
  }
  return out.length ? out : undefined;
}

export function normalizeSettings(value: unknown): AlbumSettings {  const raw = value && typeof value === 'object' ? (value as Partial<AlbumSettings>) : {};
  let siteName =
    typeof raw.siteName === 'string' && raw.siteName.trim()
      ? raw.siteName.trim().slice(0, 40)
      : DEFAULT_SETTINGS.siteName;
  let siteNameEn =
    typeof raw.siteNameEn === 'string' && raw.siteNameEn.trim()
      ? raw.siteNameEn.trim().slice(0, 60)
      : DEFAULT_SETTINGS.siteNameEn;

  // Rebrand migration: only replace the untouched legacy defaults. A custom
  // site name chosen by the user is preserved.
  if (siteName === LEGACY_SITE_NAME && siteNameEn === LEGACY_SITE_NAME_EN) {
    siteName = DEFAULT_SETTINGS.siteName;
    siteNameEn = DEFAULT_SETTINGS.siteNameEn;
  }

  const experimentalEffects = raw.experimentalEffects === true;
  let backgroundEffect = isBackgroundEffect(raw.backgroundEffect)
    ? raw.backgroundEffect
    : DEFAULT_BACKGROUND;
  // The black hole is an experimental backdrop. If the flag is off, never
  // restore it from an old record or a backup: fall back to the default sky.
  if (backgroundEffect === 'blackhole' && !experimentalEffects) {
    backgroundEffect = DEFAULT_BACKGROUND;
  }

  const customVideoPoster =
    typeof raw.customVideoPoster === 'string' &&
    raw.customVideoPoster.length > 0 &&
    raw.customVideoPoster.length <= 900_000 &&
    raw.customVideoPoster.startsWith('data:image/')
      ? raw.customVideoPoster
      : undefined;
  const customVideoKey =
    typeof raw.customVideoKey === 'string' &&
    /^[0-9a-zA-Z._-]{1,120}$/.test(raw.customVideoKey)
      ? raw.customVideoKey
      : undefined;
  // A video effect without a stored clip would render an empty screen; fall
  // back to the default sky instead of losing the background entirely.
  if (backgroundEffect === 'video' && (!customVideoKey || !customVideoPoster)) {
    backgroundEffect = DEFAULT_BACKGROUND;
  }

  return {
    siteName,
    siteNameEn,
    tagline:
      typeof raw.tagline === 'string' && raw.tagline.trim()
        ? raw.tagline.trim().slice(0, 240)
        : DEFAULT_SETTINGS.tagline,
    timelineIntro:
      typeof raw.timelineIntro === 'string' && raw.timelineIntro.trim()
        ? raw.timelineIntro.trim().slice(0, 240)
        : DEFAULT_SETTINGS.timelineIntro,
    featuredPhotoId:
      typeof raw.featuredPhotoId === 'string' && raw.featuredPhotoId
        ? raw.featuredPhotoId
        : null,
    worldApiBase:
      typeof raw.worldApiBase === 'string'
        ? raw.worldApiBase.trim().replace(/\/+$/, '')
        : DEFAULT_SETTINGS.worldApiBase,
    theme: isThemeId(raw.theme) ? raw.theme : DEFAULT_THEME,
    layout: isLayoutId(raw.layout) ? raw.layout : DEFAULT_LAYOUT,
    backgroundEffect,
    experimentalEffects,
    customBackgroundSrc:
      typeof raw.customBackgroundSrc === 'string' &&
      raw.customBackgroundSrc.length > 0 &&
      raw.customBackgroundSrc.length <= 4_500_000 &&
      (raw.customBackgroundSrc.startsWith('data:image/') ||
        /^https?:\/\//i.test(raw.customBackgroundSrc))
        ? raw.customBackgroundSrc
        : undefined,
    customBackgroundName:
      typeof raw.customBackgroundName === 'string' && raw.customBackgroundName.trim()
        ? raw.customBackgroundName.trim().slice(0, 80)
        : undefined,
    customVideoKey,
    customVideoName:
      typeof raw.customVideoName === 'string' && raw.customVideoName.trim()
        ? raw.customVideoName.trim().slice(0, 80)
        : undefined,
    customVideoPoster,
    customVideoMime:
      typeof raw.customVideoMime === 'string' &&
      /^video\/[a-z0-9.+-]{1,40}$/i.test(raw.customVideoMime)
        ? raw.customVideoMime
        : undefined,
    customVideoBytes:
      typeof raw.customVideoBytes === 'number' &&
      Number.isFinite(raw.customVideoBytes) &&
      raw.customVideoBytes > 0
        ? Math.round(raw.customVideoBytes)
        : undefined,
    customVideoWidth:
      typeof raw.customVideoWidth === 'number' && raw.customVideoWidth > 0
        ? Math.round(raw.customVideoWidth)
        : undefined,
    customVideoHeight:
      typeof raw.customVideoHeight === 'number' && raw.customVideoHeight > 0
        ? Math.round(raw.customVideoHeight)
        : undefined,
    smartAlbums: normalizeSmartAlbums(raw.smartAlbums),
  };
}

export function effectiveWorldApiBase(settings: AlbumSettings): string {
  return (settings.worldApiBase || '').trim().replace(/\/+$/, '');
}
