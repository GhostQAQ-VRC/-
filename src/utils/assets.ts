/** Resolve a file in public/ while respecting Vite's deployed base path. */
export function photoAsset(slug: string): string {
  return `${import.meta.env.BASE_URL}photos/${slug}.webp`;
}
