import type { Photo, PhotoOrientation } from '../types';

/**
 * Decide how a photo should be framed in cards.
 *
 * The desktop scanner already swaps width/height for EXIF orientations 5–8, so
 * the pair here matches what the browser decodes. Photos imported before this
 * feature have no dimensions and keep the original 4:3 landscape frame.
 */
export function photoOrientation(
  photo: Pick<Photo, 'width' | 'height'>,
): PhotoOrientation {
  const width = photo.width;
  const height = photo.height;
  if (!width || !height || width < 1 || height < 1) return 'landscape';
  const ratio = width / height;
  if (ratio >= 1.06) return 'landscape';
  if (ratio <= 0.94) return 'portrait';
  return 'square';
}

export function orientationClass(photo: Pick<Photo, 'width' | 'height'>): string {
  return `is-${photoOrientation(photo)}`;
}
