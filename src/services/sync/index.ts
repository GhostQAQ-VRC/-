/**
 * Sync is implemented by the desktop client (`desktop/services/sync.cjs`).
 * The renderer talks to it through `DesktopBridge.sync`; visit 管理台 → 云同步
 * for cloud-drive and website sync settings. This module intentionally keeps
 * no network code in the web build.
 */
export {};
