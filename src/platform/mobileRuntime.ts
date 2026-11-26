/**
 * True only inside the Android shell. The shell installs a JS bridge that
 * exposes the same DesktopBridge surface the Electron client uses, so the
 * existing React UI (public site, admin, settings, effects, AI, cloud sync)
 * can run unchanged.
 */
export function isMobileRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as Window & { __HOSHIKUZU_MOBILE_RUNTIME__?: boolean })
      .__HOSHIKUZU_MOBILE_RUNTIME__,
  );
}

export function mobileMediaBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    (window as Window & { __HOSHIKUZU_MOBILE_MEDIA_BASE__?: string })
      .__HOSHIKUZU_MOBILE_MEDIA_BASE__ || 'https://appassets.androidplatform.net/media'
  );
}
