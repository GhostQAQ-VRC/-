import type { Photo, PhotoOrientation, PhotoRotation } from '../types';

/**
 * Display rotation in degrees clockwise. Values other than 90/180/270 mean 0.
 */
export function photoRotation(
  photo: Pick<Photo, 'rotation'> | null | undefined,
): PhotoRotation {
  const value = photo?.rotation;
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

/**
 * Dimensions as the viewer sees them. A 90°/270° display rotation swaps the
 * frame, so a 1920×1080 screenshot with sideways content becomes 1080×1920.
 */
export function orientedDimensions(
  photo: Pick<Photo, 'width' | 'height' | 'rotation'>,
): { width: number; height: number } {
  const width = photo.width ?? 0;
  const height = photo.height ?? 0;
  if (!width || !height) return { width, height };
  return photoRotation(photo) % 180 === 90
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Decide how a photo should be framed in cards.
 *
 * The desktop scanner already swaps width/height for EXIF orientations 5–8, so
 * the pair here matches what the browser decodes. Photos imported before this
 * feature have no dimensions and keep the original 4:3 landscape frame unless
 * the user sets a rotation.
 */
export function photoOrientation(
  photo: Pick<Photo, 'width' | 'height' | 'rotation'>,
): PhotoOrientation {
  const { width, height } = orientedDimensions(photo);
  if (!width || !height || width < 1 || height < 1) return 'landscape';
  const ratio = width / height;
  if (ratio >= 1.06) return 'landscape';
  if (ratio <= 0.94) return 'portrait';
  return 'square';
}

/** Step the display rotation by ±90°, keeping the result inside 0–270. */
export function rotatePhoto(
  current: PhotoRotation | undefined,
  delta: -90 | 90,
): PhotoRotation {
  const value = photoRotation({ rotation: current });
  return ((value + delta + 360) % 360) as PhotoRotation;
}

export function orientationClass(photo: Pick<Photo, 'width' | 'height' | 'rotation'>): string {
  return `is-${photoOrientation(photo)}`;
}

export function rotationClass(photo: Pick<Photo, 'rotation'>): string {
  return `rotate-${photoRotation(photo)}`;
}
