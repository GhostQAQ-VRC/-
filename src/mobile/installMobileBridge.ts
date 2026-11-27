import type {
  AiBatchDone,
  AiBatchMode,
  AiBatchProgress,
  AiPhotoInput,
  AiProtocol,
  DesktopBridge,
  DesktopImportResult,
} from '../platform/desktopApi';
import { mediaUrl } from '../platform/media';
import type { HoshikuzuAndroidBridge } from './native';
import {
  detectOrientation,
  listModels as listAiModels,
  recognizeWorldId,
  summarizePhoto,
  testConnection as testAiConnection,
} from './aiService';
import { installHttpBridge } from './mobileHttp';
import {
  makeIdleState,
  manifestInfo,
  resetCloudManifest,
  runWebDavSync,
  runWebsiteSync,
  syncStateFor,
  testWebDav,
  testWebsite,
} from './cloudSync';
import { runGoogleSync, testGoogle } from './googleSync';
import { runBaiduSync, testBaidu } from './baiduSync';

interface AndroidNative extends HoshikuzuAndroidBridge {
  pickMedia(callbackId: string, maxEdge: number, quality: number): void;
  deleteManaged(hash: string): boolean;
  secureGet(key: string): string;
  secureSet(key: string, value: string): boolean;
  secureDelete(key: string): boolean;
  appVersion(): string;
  openExternal(url: string): void;
  httpRequest(callbackId: string, requestJson: string): void;
  md5Hex(base64: string): string;
  toast(message: string): void;
  openConnect(): void;
  openLocal(): void;
}

declare global {
  interface Window {
    __HOSHIKUZU_MOBILE_RUNTIME__?: boolean;
    __HOSHIKUZU_MOBILE_MEDIA_BASE__?: string;
    __hoshikuzuMobilePickResult?: (callbackId: string, json: string) => void;
    __hoshikuzuMobileHttpResult?: (callbackId: string, json: string) => void;
  }
}

const ALBUM_KEY = 'hoshikuzu-mobile-album-v2';
const LIBRARY_KEY = 'hoshikuzu-mobile-library-v1';
const AI_KEY = 'hoshikuzu-mobile-ai-v1';
const SYNC_KEY = 'hoshikuzu-mobile-sync-v1';
let cloudSyncRunning: 'cloud' | 'website' | null = null;

const noopUnsub = () => () => {};

function native(): AndroidNative | null {
  if (typeof window === 'undefined' || !window.HoshikuzuAndroid) return null;
  const bridge = window.HoshikuzuAndroid as unknown as AndroidNative;
  return typeof bridge.pickMedia === 'function' ? bridge : null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function albumPhotos(): Array<{
  mediaKind?: string;
  previewPath?: string;
  fileBytes?: number;
}> {
  const raw = localStorage.getItem(ALBUM_KEY);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { photos?: unknown };
    return Array.isArray(data.photos)
      ? (data.photos as Array<{
          mediaKind?: string;
          previewPath?: string;
          fileBytes?: number;
        }>)
      : [];
  } catch {
    return [];
  }
}

function libraryConfig() {
  const saved = readJson<{
    imageLoadingMode?: string;
    previewPreset?: string;
    previewMaxEdge?: number;
    previewQuality?: number;
  }>(LIBRARY_KEY, {});
  return {
    configured: true,
    libraryPath: 'app://mobile-library',
    libraryName: '手机本地相册',
    libraryId: 'mobile-local',
    previewPreset: saved.previewPreset || 'balanced',
    previewMaxEdge: Number(saved.previewMaxEdge) || 1600,
    previewQuality: Number(saved.previewQuality) || 82,
    thumbnailDir: '缩略图缓存',
    thumbnailDirPath: mediaUrl('preview', ''),
    thumbnailsConfigured: true,
    imageLoadingMode: saved.imageLoadingMode || 'predictive',
    autoScan: false,
    watch: false,
    onboardingDismissed: true,
    unavailable: false,
  };
}

function libraryStats() {
  const photos = albumPhotos();
  const libraryPhotos = photos.filter((photo) => photo.mediaKind === 'library');
  return {
    imageCount: libraryPhotos.length,
    libraryBytes: libraryPhotos.reduce(
      (sum, photo) => sum + (Number(photo.fileBytes) || 0),
      0,
    ),
    previewBytes: 0,
    previewCount: libraryPhotos.filter((photo) => photo.previewPath).length,
    lastScanAt: null as string | null,
  };
}

function aiConfig() {
  const saved = readJson<Record<string, unknown>>(AI_KEY, {});
  const key = native()?.secureGet('aiApiKey') || '';
  return {
    protocol: (saved.protocol as string) || 'openai',
    baseUrl: (saved.baseUrl as string) || '',
    primaryModel: (saved.primaryModel as string) || '',
    backupModel: (saved.backupModel as string) || '',
    showAllModels: saved.showAllModels === true,
    allowUnverifiedVision: saved.allowUnverifiedVision === true,
    models: Array.isArray(saved.models) ? saved.models : [],
    modelsAt: (saved.modelsAt as string) || null,
    hasApiKey: Boolean(key),
  };
}

function syncConfig() {
  const saved = readJson<{
    cloud?: Record<string, unknown>;
    website?: Record<string, unknown>;
    state?: { cloud?: any; website?: any };
    previousState?: { cloud?: any; website?: any };
  }>(SYNC_KEY, {});
  const cloud = saved.cloud || {};
  const website = saved.website || {};
  const stateCloud = saved.state?.cloud || saved.previousState?.cloud || makeIdleState();
  const stateWebsite =
    saved.state?.website || saved.previousState?.website || makeIdleState();
  const manifest = manifestInfo();
  return {
    providers: [
      {
        id: 'webdav',
        kind: 'webdav' as const,
        label: 'WebDAV / NAS',
        description: '支持 Basic Auth 的 WebDAV（坚果云、Nextcloud、Alist 等）。',
      },
      {
        id: 'google',
        kind: 'google' as const,
        label: 'Google Drive API',
        description: '通过 Google Drive API 上传；填写 Client ID/Secret 与 Token。',
      },
      {
        id: 'baidu',
        kind: 'baidu' as const,
        label: '百度网盘 API',
        description: '通过百度网盘开放平台上传；填写 AppKey/SecretKey 与 Token。',
      },
    ],
    cloud: {
      provider: ['webdav', 'google', 'baidu'].includes(cloud.provider as string)
        ? (cloud.provider as string)
        : 'webdav',
      folderRoot: (cloud.folderRoot as string) || '',
      baseFolder: (cloud.baseFolder as string) || 'Hoshikuzu Album',
      skipExisting: cloud.skipExisting !== false,
      uploadMetadata: cloud.uploadMetadata !== false,
      webdavUrl: (cloud.webdavUrl as string) || '',
      webdavUsername: (cloud.webdavUsername as string) || '',
      googleClientId: (cloud.googleClientId as string) || '',
      baiduAppKey: (cloud.baiduAppKey as string) || '',
      baiduAppName: (cloud.baiduAppName as string) || '',
      hasWebdavPassword: Boolean(native()?.secureGet('syncWebdavPassword')),
      hasGoogleClientSecret: Boolean(native()?.secureGet('syncGoogleClientSecret')),
      hasGoogleAccessToken: Boolean(native()?.secureGet('syncGoogleAccessToken')),
      hasGoogleRefreshToken: Boolean(native()?.secureGet('syncGoogleRefreshToken')),
      hasBaiduSecretKey: Boolean(native()?.secureGet('syncBaiduSecretKey')),
      hasBaiduAccessToken: Boolean(native()?.secureGet('syncBaiduAccessToken')),
      hasBaiduRefreshToken: Boolean(native()?.secureGet('syncBaiduRefreshToken')),
    },
    website: {
      endpoint: (website.endpoint as string) || '',
      includePreviewImages: website.includePreviewImages !== false,
      maxPayloadMb: Number(website.maxPayloadMb) || 80,
      hasWebsiteToken: Boolean(native()?.secureGet('syncWebsiteToken')),
    },
    state: { cloud: stateCloud, website: stateWebsite },
    manifest,
    status: {
      enabled: true,
      provider: ['webdav', 'google', 'baidu'].includes(cloud.provider as string)
        ? (cloud.provider as string)
        : 'webdav',
      lastSyncAt: stateCloud.lastSyncAt || stateWebsite.lastSyncAt || null,
      message: stateCloud.message || stateWebsite.message || '尚未同步',
      running: cloudSyncRunning,
      cloud: stateCloud,
      website: stateWebsite,
    },
  };
}

export function installMobileBridge(): void {
  if (typeof window === 'undefined' || !native()) return;
  const android = native()!;
  window.__HOSHIKUZU_MOBILE_RUNTIME__ = true;
  window.__HOSHIKUZU_MOBILE_MEDIA_BASE__ =
    (window as Window & { __HOSHIKUZU_MOBILE_MEDIA_BASE_OVERRIDE__?: string })
      .__HOSHIKUZU_MOBILE_MEDIA_BASE_OVERRIDE__ ||
    'https://appassets.androidplatform.net/media';
  installHttpBridge();

  const aiProgressListeners = new Set<(progress: AiBatchProgress) => void>();
  const aiResultListeners = new Set<(result: unknown) => void>();
  const aiDoneListeners = new Set<(summary: AiBatchDone) => void>();
  let aiBatchCanceled = false;
  const syncProgressListeners = new Set<(progress: unknown) => void>();
  const syncDoneListeners = new Set<(result: unknown) => void>();
  const syncStateListeners = new Set<(payload: unknown) => void>();
  const syncStatusListeners = new Set<(status: unknown) => void>();
  let syncCanceled = false;

  const pickWaiters = new Map<
    string,
    { resolve: (result: DesktopImportResult) => void; reject: (error: Error) => void }
  >();
  window.__hoshikuzuMobilePickResult = (callbackId, json) => {
    const waiter = pickWaiters.get(callbackId);
    if (!waiter) return;
    pickWaiters.delete(callbackId);
    try {
      waiter.resolve(JSON.parse(json) as DesktopImportResult);
    } catch {
      waiter.reject(new Error('手机相册返回了无效数据。'));
    }
  };

  const pickAndImport = (): Promise<DesktopImportResult> => {
    const callbackId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const config = libraryConfig();
    return new Promise((resolve, reject) => {
      pickWaiters.set(callbackId, {
        resolve: (result) => {
          try {
            const existing = new Set(
              albumPhotos()
                .map((photo) => (photo as { contentHash?: string }).contentHash)
                .filter((hash): hash is string => Boolean(hash)),
            );
            const drafts = (result.drafts || []).filter(
              (draft) => !draft.contentHash || !existing.has(draft.contentHash),
            );
            resolve({ ...result, drafts });
          } catch {
            resolve(result);
          }
        },
        reject,
      });
      try {
        android.pickMedia(callbackId, config.previewMaxEdge, config.previewQuality);
      } catch (error) {
        pickWaiters.delete(callbackId);
        reject(error instanceof Error ? error : new Error('无法打开系统相册。'));
      }
    });
  };

  const bridge: any = {
    version: '1.1.2-mobile',
    platform: 'android',
    album: {
      loadSync: () => ({
        configured: true,
        json: localStorage.getItem(ALBUM_KEY),
      }),
      saveSync: (json: string) => {
        try {
          localStorage.setItem(ALBUM_KEY, json);
          return { configured: true, ok: true };
        } catch (error) {
          return {
            configured: true,
            ok: false,
            error:
              error instanceof Error
                ? `手机本地存储写入失败：${error.message}`
                : '手机本地存储写入失败。',
          };
        }
      },
      resetSync: () => {
        localStorage.removeItem(ALBUM_KEY);
        return { configured: true, ok: true };
      },
    },
    library: {
      getConfig: async () => libraryConfig(),
      chooseFolder: async () => ({ ok: false, error: '手机端使用系统相册导入。' }),
      createFolder: async () => ({ ok: false, error: '手机端使用系统相册导入。' }),
      dismissOnboarding: async () => libraryConfig(),
      getThumbnailPresets: async () => ({
        presets: [
          { id: 'feather', maxEdge: 960, quality: 66 },
          { id: 'swift', maxEdge: 1280, quality: 74 },
          { id: 'balanced', maxEdge: 1600, quality: 82 },
          { id: 'clear', maxEdge: 1920, quality: 86 },
          { id: 'lush', maxEdge: 2560, quality: 90 },
        ],
        defaultId: 'balanced',
        defaultDir: '缩略图缓存',
      }),
      sampleThumbnailPreview: async () => ({
        ok: false,
        error: '手机端缩略图由导入时自动生成。',
      }),
      setupThumbnails: async () => ({
        ok: true,
        config: libraryConfig(),
        thumbnailDirPath: mediaUrl('preview', ''),
      }),
      openFolder: async () => ({ ok: false, error: '手机端无法打开系统文件夹。' }),
      revealFile: async () => ({ ok: false, error: '手机端无法在文件管理器中定位。' }),
      scan: async () => ({
        ok: true,
        complete: true,
        seeds: [],
        worlds: [],
        stats: {
          scanned: libraryStats().imageCount,
          total: libraryStats().imageCount,
          withWorldId: 0,
          withDate: 0,
          previewsQueued: 0,
        },
      }),
      cancelScan: async () => ({ ok: true }),
      setOptions: async (options: Record<string, unknown>) => {
        const current = readJson<Record<string, unknown>>(LIBRARY_KEY, {});
        writeJson(LIBRARY_KEY, { ...current, ...options });
        return libraryConfig();
      },
      ignoreHashes: async () => ({ ok: true }),
      resetIgnored: async () => ({ ok: true }),
      stats: async () => libraryStats(),
      clearPreviewCache: async () => ({ ok: true }),
      onScanProgress: noopUnsub,
      onPreviewReady: noopUnsub,
      onPreviewProgress: noopUnsub,
      onLibraryChanged: noopUnsub,
    },
    media: {
      getPathForFile: () => '',
      pickAndImport,
      importFiles: async () => ({
        ok: false,
        drafts: [],
        errors: [{ file: '', message: '手机端请使用「收录照片」从系统相册选择。' }],
      }),
      importDataUrls: async () => ({
        ok: false,
        drafts: [],
        errors: [{ file: '', message: '手机端请使用系统相册导入。' }],
      }),
      deleteManaged: async (contentHash: string) => ({
        ok: android.deleteManaged(contentHash),
      }),
      urlForPreview: (previewPath: string) => mediaUrl('preview', previewPath),
      urlForOriginal: (libraryPath: string) => mediaUrl('original', libraryPath),
    },
    background: {
      saveVideo: async () => ({
        ok: false,
        error: '手机端视频背景服务正在接入。',
      }),
      deleteVideo: async () => ({ ok: true }),
    },
    backup: {
      exportMetadata: async () => ({
        ok: false,
        canceled: true,
        error: '手机端备份导出正在接入。',
      }),
      exportFull: async () => ({
        ok: false,
        canceled: true,
        error: '手机端整库备份正在接入。',
      }),
      importFile: async () => ({
        ok: false,
        canceled: true,
        error: '手机端备份导入正在接入。',
      }),
    },
    network: {
      getConfig: async () => ({
        proxy: {
          mode: 'system',
          httpUrl: '',
          socksUrl: '',
          pacUrl: '',
          customRules: '',
          bypass: '<local>',
        },
        vrchat: {
          username: '',
          apiBase: 'https://api.vrchat.cloud',
          hasPassword: false,
        },
        modes: ['system', 'none', 'http', 'socks5', 'pac', 'custom'],
      }),
      setProxy: async () => ({
        ok: false,
        config: await bridge.network.getConfig(),
        error: '手机端代理跟随系统设置。',
      }),
      test: async () => ({ ok: false, error: '手机端代理跟随系统设置。' }),
    },
    vrchat: {
      getConfig: async () => ({
        username: '',
        apiBase: 'https://api.vrchat.cloud',
        hasPassword: false,
        progress: { total: 0, current: 0, running: false, canceled: false },
      }),
      setConfig: async () => ({
        ok: false,
        config: {
          username: '',
          apiBase: 'https://api.vrchat.cloud',
          hasPassword: false,
        },
      }),
      status: async () => ({
        loggedIn: false,
        progress: { total: 0, current: 0, running: false, canceled: false },
      }),
      login: async () => ({ ok: false, error: '手机端 VRChat 登录正在接入。' }),
      verify2fa: async () => ({ ok: false, error: '手机端 VRChat 登录正在接入。' }),
      logout: async () => ({
        ok: true,
        config: {
          username: '',
          apiBase: 'https://api.vrchat.cloud',
          hasPassword: false,
        },
      }),
      fetchCovers: async () => ({
        ok: false,
        total: 0,
        updated: 0,
        failed: 0,
        canceled: false,
        error: '手机端 VRChat 封面拉取正在接入。',
      }),
      cancelCovers: async () => ({ ok: true }),
      onCoverProgress: noopUnsub,
    },
    update: {
      check: async () => ({
        ok: true,
        currentVersion: android.appVersion(),
        latestVersion: android.appVersion(),
        hasUpdate: false,
        releaseUrl: 'https://github.com/GhostQAQ-VRC/-/releases',
      }),
      open: async (url: string) => {
        android.openExternal(url);
        return { ok: true };
      },
      onAvailable: noopUnsub,
    },
    window: {
      minimize: () => {},
      toggleMaximize: () => {},
      close: () => {},
      isMaximized: async () => false,
      onMaximizedChange: noopUnsub,
    },
    app: {
      info: async () => ({
        app: 'VRchat时间轴纪念相册',
        electron: 'Android',
        chrome: navigator.userAgent,
        node: '—',
      }),
      openExternal: async (url: string) => {
        android.openExternal(url);
      },
      onCommand: noopUnsub,
    },
    sync: {
      getConfig: async () => syncConfig(),
      setConfig: async (patch: { cloud?: Record<string, unknown>; website?: Record<string, unknown> }) => {
        const current = readJson<{
          cloud?: Record<string, unknown>;
          website?: Record<string, unknown>;
          state?: { cloud?: unknown; website?: unknown };
        }>(SYNC_KEY, {});
        const cloud = { ...(current.cloud || {}), ...(patch.cloud || {}) };
        const website = { ...(current.website || {}), ...(patch.website || {}) };
        const secretKeys: Array<[string, string]> = [
          ['webdavPassword', 'syncWebdavPassword'],
          ['websiteToken', 'syncWebsiteToken'],
          ['googleClientSecret', 'syncGoogleClientSecret'],
          ['googleAccessToken', 'syncGoogleAccessToken'],
          ['googleRefreshToken', 'syncGoogleRefreshToken'],
          ['baiduSecretKey', 'syncBaiduSecretKey'],
          ['baiduAccessToken', 'syncBaiduAccessToken'],
          ['baiduRefreshToken', 'syncBaiduRefreshToken'],
        ];
        for (const [field, secureKey] of secretKeys) {
          const value = field in cloud ? cloud[field] : field in website ? website[field] : undefined;
          if (typeof value === 'string' && value.trim()) {
            android.secureSet(secureKey, value.trim());
          } else if (value === '' || value === null) {
            android.secureDelete(secureKey);
          }
          delete cloud[field];
          delete website[field];
        }
        delete cloud.clearWebdavPassword;
        delete cloud.clearGoogleClientSecret;
        delete cloud.clearGoogleAccessToken;
        delete cloud.clearGoogleRefreshToken;
        delete cloud.clearBaiduSecretKey;
        delete cloud.clearBaiduAccessToken;
        delete cloud.clearBaiduRefreshToken;
        delete website.clearWebsiteToken;
        writeJson(SYNC_KEY, { ...current, cloud, website });
        const config = syncConfig();
        syncStatusListeners.forEach((listener) => listener(config.status));
        return config;
      },
      chooseFolder: async () => ({
        ok: false,
        canceled: true,
        error: '手机端请使用 WebDAV 或网站同步；手机文件夹写入需要系统目录授权。',
      }),
      test: async (payload: { target: 'cloud' | 'website' }) => {
        const config = syncConfig();
        try {
          if (payload?.target === 'website') {
            const message = await testWebsite(
              config.website,
              android.secureGet('syncWebsiteToken') || '',
            );
            return { ok: true, message };
          }
          if (config.cloud.provider === 'webdav') {
            const message = await testWebDav(
              config.cloud,
              android.secureGet('syncWebdavPassword') || '',
            );
            return { ok: true, message };
          }
          if (config.cloud.provider === 'google') {
            const message = await testGoogle(
              config.cloud,
              {
                clientSecret: android.secureGet('syncGoogleClientSecret') || '',
                accessToken: android.secureGet('syncGoogleAccessToken') || '',
                refreshToken: android.secureGet('syncGoogleRefreshToken') || '',
              },
              (key, value) => android.secureSet(key, value),
            );
            return { ok: true, message };
          }
          if (config.cloud.provider === 'baidu') {
            const message = await testBaidu(
              config.cloud,
              {
                secretKey: android.secureGet('syncBaiduSecretKey') || '',
                accessToken: android.secureGet('syncBaiduAccessToken') || '',
                refreshToken: android.secureGet('syncBaiduRefreshToken') || '',
              },
              (key, value) => android.secureSet(key, value),
            );
            return { ok: true, message };
          }
          return { ok: false, message: '请选择 WebDAV / Google Drive / 百度网盘。' };
        } catch (error) {
          return {
            ok: false,
            message: error instanceof Error ? error.message : '连接测试失败。',
          };
        }
      },
      start: async (payload: {
        target: 'cloud' | 'website';
        full?: boolean;
        album?: unknown;
        photoIds?: string[];
      }) => {
        if (cloudSyncRunning) {
          return { ok: false, error: '已有同步任务正在运行。' };
        }
        const target = payload?.target === 'website' ? 'website' : 'cloud';
        const config = syncConfig();
        if (
          target === 'cloud' &&
          !['webdav', 'google', 'baidu'].includes(config.cloud.provider)
        ) {
          return { ok: false, error: '请选择 WebDAV / Google Drive / 百度网盘。' };
        }
        const album =
          payload?.album && typeof payload.album === 'object'
            ? (payload.album as any)
            : null;
        if (!album || !Array.isArray(album.photos)) {
          return { ok: false, error: '相册数据不可用。' };
        }
        syncCanceled = false;
        cloudSyncRunning = target;
        syncStatusListeners.forEach((listener) => listener(syncConfig().status));
        void (async () => {
          let result: any;
          try {
            if (target === 'website') {
              result = await runWebsiteSync({
                target,
                config: config.cloud,
                website: config.website,
                secrets: { websiteToken: android.secureGet('syncWebsiteToken') || '' },
                album,
                photoIds: payload.photoIds,
                shouldCancel: () => syncCanceled,
                onProgress: (progress) => {
                  syncProgressListeners.forEach((listener) => listener(progress));
                },
              });
            } else if (config.cloud.provider === 'google') {
              result = await runGoogleSync({
                target,
                config: config.cloud,
                website: config.website,
                secrets: {},
                album,
                photoIds: payload.photoIds,
                shouldCancel: () => syncCanceled,
                google: {
                  clientSecret: android.secureGet('syncGoogleClientSecret') || '',
                  accessToken: android.secureGet('syncGoogleAccessToken') || '',
                  refreshToken: android.secureGet('syncGoogleRefreshToken') || '',
                },
                setSecret: (key, value) => android.secureSet(key, value),
                onProgress: (progress) => {
                  syncProgressListeners.forEach((listener) => listener(progress));
                },
              });
            } else if (config.cloud.provider === 'baidu') {
              result = await runBaiduSync({
                target,
                config: config.cloud,
                website: config.website,
                secrets: {},
                album,
                photoIds: payload.photoIds,
                shouldCancel: () => syncCanceled,
                baidu: {
                  secretKey: android.secureGet('syncBaiduSecretKey') || '',
                  accessToken: android.secureGet('syncBaiduAccessToken') || '',
                  refreshToken: android.secureGet('syncBaiduRefreshToken') || '',
                },
                setSecret: (key, value) => android.secureSet(key, value),
                onProgress: (progress) => {
                  syncProgressListeners.forEach((listener) => listener(progress));
                },
              });
            } else {
              result = await runWebDavSync({
                target,
                config: config.cloud,
                website: config.website,
                secrets: { webdavPassword: android.secureGet('syncWebdavPassword') || '' },
                album,
                photoIds: payload.photoIds,
                shouldCancel: () => syncCanceled,
                onProgress: (progress) => {
                  syncProgressListeners.forEach((listener) => listener(progress));
                },
              });
            }
          } catch (error) {
            result = {
              target,
              ok: false,
              error: error instanceof Error ? error.message : '同步失败。',
            };
          }
          const state = syncStateFor(result);
          const saved = readJson<Record<string, unknown>>(SYNC_KEY, {});
          const previousState = (saved.state as Record<string, unknown> | undefined) || {};
          writeJson(SYNC_KEY, {
            ...saved,
            state: { ...previousState, [target]: state },
          });
          cloudSyncRunning = null;
          syncDoneListeners.forEach((listener) => listener({ ...result, state }));
          syncStateListeners.forEach((listener) => listener({ target, state }));
          syncStatusListeners.forEach((listener) => listener(syncConfig().status));
        })();
        return { ok: true, started: true, target };
      },
      cancel: async () => {
        syncCanceled = true;
        return { ok: true };
      },
      status: async () => syncConfig().status,
      resetManifest: async () => {
        resetCloudManifest();
        return { ok: true, config: syncConfig() };
      },
      onProgress: (callback: (progress: unknown) => void) => {
        syncProgressListeners.add(callback);
        return () => syncProgressListeners.delete(callback);
      },
      onDone: (callback: (result: unknown) => void) => {
        syncDoneListeners.add(callback);
        return () => syncDoneListeners.delete(callback);
      },
      onState: (callback: (payload: unknown) => void) => {
        syncStateListeners.add(callback);
        return () => syncStateListeners.delete(callback);
      },
      onConfig: noopUnsub,
      onStatus: (callback: (status: unknown) => void) => {
        syncStatusListeners.add(callback);
        return () => syncStatusListeners.delete(callback);
      },
    },
    ai: {
      getConfig: async () => aiConfig(),
      setConfig: async (patch: Record<string, unknown>) => {
        const current = readJson<Record<string, unknown>>(AI_KEY, {});
        const next = { ...current, ...patch };
        delete next.apiKey;
        delete next.clearKey;
        if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
          android.secureSet('aiApiKey', patch.apiKey.trim());
        }
        if (patch.clearKey === true) android.secureDelete('aiApiKey');
        writeJson(AI_KEY, next);
        return aiConfig();
      },
      test: async (payload: {
        protocol?: AiProtocol;
        baseUrl?: string;
        apiKey?: string;
      }) => {
        const config = aiConfig();
        const protocol = (payload?.protocol || config.protocol) as AiProtocol;
        const baseUrl = payload?.baseUrl || config.baseUrl;
        const apiKey =
          (payload?.apiKey || '').trim() || android.secureGet('aiApiKey') || '';
        try {
          const result = await testAiConnection({ protocol, baseUrl, apiKey });
          return { ...result };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : 'AI 连接测试失败。',
          };
        }
      },
      listModels: async (payload: {
        protocol?: AiProtocol;
        baseUrl?: string;
        apiKey?: string;
      }) => {
        const config = aiConfig();
        const protocol = (payload?.protocol || config.protocol) as AiProtocol;
        const baseUrl = payload?.baseUrl || config.baseUrl;
        const apiKey =
          (payload?.apiKey || '').trim() || android.secureGet('aiApiKey') || '';
        try {
          const result = await listAiModels({
            protocol,
            baseUrl,
            apiKey,
            allowEmptyKey: protocol === 'ollama',
          });
          const current = readJson<Record<string, unknown>>(AI_KEY, {});
          writeJson(AI_KEY, {
            ...current,
            models: result.models,
            modelsAt: new Date().toISOString(),
          });
          return result;
        } catch (error) {
          return {
            ok: false,
            models: [],
            visionCount: 0,
            error: error instanceof Error ? error.message : '获取模型失败。',
          };
        }
      },
      generate: async (payload: {
        item: AiPhotoInput;
        context?: { capturedAt?: string; worldName?: string; note?: string };
      }) => {
        const config = aiConfig();
        const apiKey = android.secureGet('aiApiKey') || '';
        try {
          return await summarizePhoto({
            item: payload.item,
            settings: {
              protocol: config.protocol as AiProtocol,
              baseUrl: config.baseUrl,
              primaryModel: config.primaryModel,
              backupModel: config.backupModel,
              allowUnverifiedVision: config.allowUnverifiedVision,
            },
            apiKey,
            context: payload.context,
          });
        } catch (error) {
          return {
            ok: false,
            id: payload?.item?.id,
            state: 'error' as const,
            error: error instanceof Error ? error.message : 'AI 生成失败。',
          };
        }
      },
      recognizeWorldId: async (payload: {
        item: AiPhotoInput;
        context?: { capturedAt?: string; worldName?: string; note?: string };
      }) => {
        const config = aiConfig();
        const apiKey = android.secureGet('aiApiKey') || '';
        try {
          return await recognizeWorldId({
            item: payload.item,
            settings: {
              protocol: config.protocol as AiProtocol,
              baseUrl: config.baseUrl,
              primaryModel: config.primaryModel,
              backupModel: config.backupModel,
              allowUnverifiedVision: config.allowUnverifiedVision,
            },
            apiKey,
          });
        } catch (error) {
          return {
            ok: false,
            id: payload?.item?.id,
            state: 'error' as const,
            error: error instanceof Error ? error.message : 'AI 识图失败。',
          };
        }
      },
      detectOrientation: async (payload: { item: AiPhotoInput }) => {
        const config = aiConfig();
        const apiKey = android.secureGet('aiApiKey') || '';
        try {
          return await detectOrientation({
            item: payload.item,
            settings: {
              protocol: config.protocol as AiProtocol,
              baseUrl: config.baseUrl,
              primaryModel: config.primaryModel,
              backupModel: config.backupModel,
              allowUnverifiedVision: config.allowUnverifiedVision,
            },
            apiKey,
          });
        } catch (error) {
          return {
            ok: false,
            id: payload?.item?.id,
            state: 'error' as const,
            error: error instanceof Error ? error.message : 'AI 方向检测失败。',
          };
        }
      },
      startBatch: async (payload: { items: AiPhotoInput[]; mode?: AiBatchMode }) => {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const mode: AiBatchMode = payload?.mode || 'summary';
        if (items.length === 0) {
          return { ok: false, total: 0, error: '没有可处理的照片。' };
        }
        const config = aiConfig();
        const apiKey = android.secureGet('aiApiKey') || '';
        if (!apiKey && config.protocol !== 'ollama') {
          return { ok: false, total: items.length, error: '请先保存 API Key。' };
        }
        aiBatchCanceled = false;
        void (async () => {
          let done = 0;
          let failed = 0;
          let worldIds = 0;
          let rotated = 0;
          const settings = {
            protocol: config.protocol as AiProtocol,
            baseUrl: config.baseUrl,
            primaryModel: config.primaryModel,
            backupModel: config.backupModel,
            allowUnverifiedVision: config.allowUnverifiedVision,
          };
          for (let index = 0; index < items.length; index += 1) {
            if (aiBatchCanceled) break;
            const item = items[index];
            aiProgressListeners.forEach((listener) =>
              listener({
                current: index + 1,
                total: items.length,
                id: item.id,
                mode,
                state: 'running',
              }),
            );
            let result;
            try {
              if (mode === 'worldId') {
                result = await recognizeWorldId({ item, settings, apiKey });
              } else if (mode === 'orientation') {
                result = await detectOrientation({ item, settings, apiKey });
              } else {
                result = await summarizePhoto({ item, settings, apiKey });
              }
            } catch (error) {
              result = {
                ok: false,
                id: item.id,
                error: error instanceof Error ? error.message : 'AI 处理失败。',
              };
            }
            if (result.ok) {
              done += 1;
              if (result.worldId) worldIds += 1;
              if (mode === 'orientation' && result.rotation) rotated += 1;
            } else {
              failed += 1;
            }
            const event = { ...result, mode };
            aiResultListeners.forEach((listener) => listener(event));
          }
          const summary: AiBatchDone = {
            ok: failed === 0 && !aiBatchCanceled,
            canceled: aiBatchCanceled,
            total: items.length,
            done,
            failed,
            mode,
            worldIds,
            rotated,
          };
          aiDoneListeners.forEach((listener) => listener(summary));
        })();
        return { ok: true, total: items.length };
      },
      cancelBatch: async () => {
        aiBatchCanceled = true;
        return { ok: true };
      },
      onBatchProgress: (callback: (progress: AiBatchProgress) => void) => {
        aiProgressListeners.add(callback);
        return () => aiProgressListeners.delete(callback);
      },
      onBatchResult: (callback: (result: unknown) => void) => {
        aiResultListeners.add(callback);
        return () => aiResultListeners.delete(callback);
      },
      onBatchDone: (callback: (summary: AiBatchDone) => void) => {
        aiDoneListeners.add(callback);
        return () => aiDoneListeners.delete(callback);
      },
    },
    easytier: {
      getConfig: async () => ({
        corePath: '',
        cliPath: '',
        networkName: '',
        peers: [],
        ipv4: '',
        listenerPort: 11010,
        rpcPort: 15888,
        autoStart: false,
        noTun: false,
        customArgs: '',
        networkSecret: '',
        hasSecret: false,
        detection: null,
        status: {
          running: false,
          pid: null,
          startedAt: null,
          corePath: null,
          cliPath: null,
          elevated: false,
          noTun: false,
          peers: [],
          directCount: 0,
          relayCount: 0,
          selfIp: null,
          logs: [],
        },
        license: 'LGPL-3.0',
        licenseUrl: 'https://github.com/EasyTier/EasyTier/blob/main/LICENSE',
      }),
      setConfig: async () => bridge.easytier.getConfig(),
      detect: async () => ({
        found: false,
        corePath: null,
        cliPath: null,
        wintun: false,
        version: null,
        license: 'LGPL-3.0',
        licenseUrl: 'https://github.com/EasyTier/EasyTier/blob/main/LICENSE',
        releasePage: 'https://github.com/EasyTier/EasyTier/releases',
        elevated: false,
      }),
      chooseCore: async () => ({ ok: false, canceled: true }),
      download: async () => ({ ok: false, canceled: true, error: '手机端不适用。' }),
      start: async () => ({ ok: false, error: '手机端不适用 EasyTier。' }),
      stop: async () => ({ ok: true }),
      status: async () => ({
        query: { ok: false, error: '手机端不适用。' },
        status: {
          running: false,
          pid: null,
          startedAt: null,
          corePath: null,
          cliPath: null,
          elevated: false,
          noTun: false,
          peers: [],
          directCount: 0,
          relayCount: 0,
          selfIp: null,
          logs: [],
        },
        detection: null,
        elevated: false,
      }),
      test: async () => ({ ok: false, error: '手机端不适用 EasyTier。' }),
      logs: async () => [],
      toml: async () => ({ text: '', license: 'LGPL-3.0', licenseUrl: '' }),
      openFolder: async () => ({ ok: false, error: '手机端不适用。' }),
      elevate: async () => ({ ok: false, quitting: false }),
      onStatus: noopUnsub,
      onLog: noopUnsub,
      onDownloadProgress: noopUnsub,
    },
    transfer: {
      getConfig: async () => ({
        provider: 'easytier',
        receiver: { enabled: false, port: 7878 },
        lastTarget: '',
        token: '',
        status: { running: false, port: 7878, startedAt: null, requiresToken: true },
        localIps: [],
        virtualIp: null,
        directCount: 0,
        relayCount: 0,
      }),
      setConfig: async () => bridge.transfer.getConfig(),
      startReceiver: async () => ({ ok: false, error: '手机端不适用 P2P 传图。' }),
      stopReceiver: async () => ({ ok: true }),
      status: async () => bridge.transfer.getConfig(),
      testTarget: async () => ({ ok: false, error: '手机端不适用 P2P 传图。' }),
      send: async () => ({
        ok: false,
        sent: 0,
        failed: 0,
        results: [],
        error: '手机端不适用 P2P 传图。',
      }),
      regenerateToken: async () => bridge.transfer.getConfig(),
      onIncoming: noopUnsub,
      onProgress: noopUnsub,
    },
    mobile: {
      getConfig: async () => ({
        enabled: false,
        port: 0,
        preferredIp: '',
        receiveMode: 'stream',
        status: {
          running: false,
          port: 0,
          startedAt: null,
          deviceCount: 0,
          devices: [],
          receiveMode: 'stream',
          preferredIp: '',
          activeIp: '',
          lanIps: [],
          lastCast: null,
          lastError: null,
          hasLibrary: true,
          libraryName: '手机本地相册',
          url: null,
        },
      }),
      setConfig: async () => bridge.mobile.getConfig(),
      start: async () => bridge.mobile.getConfig(),
      stop: async () => bridge.mobile.getConfig(),
      status: async () => bridge.mobile.getConfig(),
      qr: async () => ({ ok: false, error: '手机端不作为同步服务端。' }),
      rotate: async () => bridge.mobile.getConfig(),
      cast: async () => ({ ok: false, delivered: 0, error: '手机端不作为投送源。' }),
      disconnect: async () => bridge.mobile.getConfig(),
      onStatus: noopUnsub,
      onCast: noopUnsub,
    },
  };

  (window as Window & { hoshikuzu?: { desktop?: DesktopBridge } }).hoshikuzu = {
    desktop: bridge as unknown as DesktopBridge,
  };
}
