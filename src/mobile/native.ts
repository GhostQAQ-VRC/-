/**
 * Hooks for the Android APK shell. The LAN page is otherwise a normal web app;
 * when it is hosted inside the HoshikuzuMobile WebView, this bridge streams
 * originals straight into the phone's Downloads folder using the WebView's
 * HttpOnly pairing cookie.
 */
export interface HoshikuzuAndroidBridge {
  saveUrl(name: string, url: string): boolean;
  toast?(message: string): void;
  appVersion?(): string;
}

declare global {
  interface Window {
    HoshikuzuAndroid?: HoshikuzuAndroidBridge;
    /** Lets the APK's hardware back button close overlays before exiting. */
    __hoshikuzuHandleBack?: () => boolean;
  }
}

export function androidBridge(): HoshikuzuAndroidBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.HoshikuzuAndroid;
  return bridge && typeof bridge.saveUrl === 'function' ? bridge : null;
}

export function isAndroidShell(): boolean {
  return androidBridge() !== null;
}

export function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}
