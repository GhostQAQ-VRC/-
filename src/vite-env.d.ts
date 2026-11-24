/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional backend proxy base for real VRChat world lookups, e.g. "/api". */
  readonly VITE_WORLD_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Injected by desktop/preload.cjs when running inside the Electron client. */
  hoshikuzu?: {
    desktop?: import('./platform/desktopApi').DesktopBridge;
  };
}
