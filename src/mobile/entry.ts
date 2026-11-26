/**
 * The LAN mobile client is served by the desktop at /m. We keep this check
 * dependency-free so App can decide before useAlbum touches desktop/local
 * storage. ?mobile=1 is a development-only preview hook.
 */
export function isMobileClientEntry(): boolean {
  if (typeof window === 'undefined') return false;
  const pathname = window.location.pathname.replace(/\/+$/, '');
  if (pathname === '/m') return true;
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    return params.get('mobile') === '1';
  }
  return false;
}
