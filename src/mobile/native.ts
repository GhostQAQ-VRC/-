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
  /** Optional desktop sync: open the native QR/manual connection screen. */
  openConnect?(): void;
  /** Leave remote desktop mode and return to the standalone local album. */
  openLocal?(): void;
  /** Android-only platform services used by the shared frontend bridge. */
  pickMedia?(callbackId: string, maxEdge: number, quality: number): void;
  deleteManaged?(contentHash: string): boolean;
  secureGet?(key: string): string;
  secureSet?(key: string, value: string): boolean;
  secureDelete?(key: string): boolean;
  openExternal?(url: string): void;
  httpRequest?(callbackId: string, requestJson: string): void;
  md5Hex?(base64: string): string;
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
