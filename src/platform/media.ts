import type { AlbumData, Photo } from '../types';

export type MediaUrlKind = 'preview' | 'original' | 'background';

function normalizeRelative(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Build a display URL for a file inside the active library.
 * The Electron main process maps this scheme back to disk with a traversal guard.
 */
export function mediaUrl(kind: MediaUrlKind, relativePath: string): string {
  const safe = normalizeRelative(relativePath);
  return `hoshikuzu-media://${kind}/${safe}`;
}

export function isLibraryPhoto(photo: Photo): boolean {
  return photo.mediaKind === 'library' || Boolean(photo.libraryPath);
}

/**
 * Desktop albums persist relative paths, not absolute URLs. Re-derive `src`
 * so existing <img src={photo.src}> rendering keeps working everywhere.
 *
 * Library photos intentionally never fall back to the original file: grids,
 * cards and list views only ever receive generated thumbnails. The original is
 * requested only by the photo detail dialog after the user opens one photo.
 */
export function hydrateLibrarySources(data: AlbumData): AlbumData {
  for (const photo of data.photos) {
    if (!isLibraryPhoto(photo)) continue;
    photo.mediaKind = 'library';
    photo.isRemote = false;
    photo.src = photo.previewPath ? mediaUrl('preview', photo.previewPath) : '';
  }
  return data;
}

/** Thumbnail-only URL used by every list/grid surface. Empty until ready. */
export function photoSrc(photo: Photo): string {
  if (isLibraryPhoto(photo)) {
    return photo.previewPath ? mediaUrl('preview', photo.previewPath) : '';
  }
  return photo.src;
}

/**
 * Full-resolution URL for the detail dialog only. Callers must be reacting to
 * an explicit user opening a single photo; never use this in lists.
 */
export function photoOriginalSrc(photo: Photo): string | null {
  if (!isLibraryPhoto(photo) || photo.missing || !photo.libraryPath) return null;
  return mediaUrl('original', photo.libraryPath);
}
