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
  /** Save / share / upload an original from the app-private mobile library. */
  saveManaged?(callbackId: string, libraryPath: string, name: string): void;
  shareManaged?(callbackId: string, libraryPathsJson: string): void;
  uploadManaged?(callbackId: string, libraryPath: string, name: string): void;
  /** Backup export / import through the Android document picker. */
  exportText?(callbackId: string, name: string, text: string): void;
  exportZip?(callbackId: string, name: string, albumJson: string): void;
  importBackup?(callbackId: string): void;
  /** Import images shared from another Android app into the local album. */
  consumeSharedMedia?(callbackId: string, maxEdge: number, quality: number): void;
  /** Push the latest "on this day" card data to the home-screen widget. */
  updateOnThisDayWidget?(json: string): void;
  /** Origin of the last paired desktop, or "" when not paired. */
  desktopBaseUrl?(): string;
  /** Post a system notification for a desktop cast. */
  notifyCast?(photoId: string, title: string, body: string): void;
}

declare global {
  interface Window {
    HoshikuzuAndroid?: HoshikuzuAndroidBridge;
    /** Lets the APK's hardware back button close overlays before exiting. */
    __hoshikuzuHandleBack?: () => boolean;
    /** Native result callback shared by save / share / upload actions. */
    __hoshikuzuMobileActionResult?: (callbackId: string, json: string) => void;
    /** Drafts imported from another app before React finished mounting. */
    __hoshikuzuSharedDrafts?: unknown[];
    /** Called by Android when a new share intent arrives. */
    __hoshikuzuRequestSharedMedia?: () => void;
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
