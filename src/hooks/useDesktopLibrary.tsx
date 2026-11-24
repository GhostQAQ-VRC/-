import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AlbumApi } from './useAlbum';
import type { LibraryScanResult } from '../types';
import {
  getDesktopBridge,
  type DesktopLibraryConfig,
  type DesktopLibraryStats,
  type DesktopScanProgress,
  type ImageLoadingMode,
  type PreviewProgress,
  type ThumbnailSampleResult,
  type ThumbnailSetupResult,
} from '../platform';
import { useToast } from './useToast';

interface DesktopLibraryContextValue {
  /** False in the browser build. */
  available: boolean;
  config: DesktopLibraryConfig | null;
  stats: DesktopLibraryStats | null;
  scanning: boolean;
  refresh: () => Promise<void>;
  refreshStats: () => Promise<void>;
  scan: (options?: { full?: boolean; silent?: boolean }) => Promise<LibraryScanResult | null>;
  cancelScan: () => Promise<void>;
  chooseLibrary: () => Promise<boolean>;
  createLibrary: () => Promise<boolean>;
  dismissOnboarding: () => Promise<void>;
  setupThumbnails: (options: {
    thumbnailDir: string;
    presetId: string;
  }) => Promise<ThumbnailSetupResult>;
  sampleThumbnailPreview: () => Promise<ThumbnailSampleResult>;
  openFolder: () => Promise<void>;
  revealFile: (relativePath: string) => Promise<void>;
  setOptions: (
    patch: Partial<{
      previewPreset: string;
      previewMaxEdge: number;
      imageLoadingMode: ImageLoadingMode;
      autoScan: boolean;
      watch: boolean;
    }>,
  ) => Promise<void>;
  clearPreviewCache: () => Promise<void>;
  resetIgnored: () => Promise<void>;
}

const DesktopLibraryContext = createContext<DesktopLibraryContextValue | null>(null);

interface DesktopLibraryActivityValue {
  progress: DesktopScanProgress | null;
  previewProgress: PreviewProgress | null;
}

const DesktopLibraryActivityContext = createContext<DesktopLibraryActivityValue>({
  progress: null,
  previewProgress: null,
});

export function DesktopLibraryProvider({
  album,
  children,
}: {
  album: AlbumApi;
  children: ReactNode;
}) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const albumRef = useRef(album);
  albumRef.current = album;

  const [config, setConfig] = useState<DesktopLibraryConfig | null>(null);
  const [stats, setStats] = useState<DesktopLibraryStats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DesktopScanProgress | null>(null);
  const [previewProgress, setPreviewProgress] = useState<PreviewProgress | null>(null);
  const scanningRef = useRef(false);
  const autoScanKey = useRef<string | null>(null);
  const pendingPreviews = useRef(new Map<string, string>());
  // Thumbnail events can finish while the scan IPC is still resolving. Keep a
  // bounded history so the scan result can pick them up instead of dropping
  // the first thumbnails of a large batch.
  const recentPreviews = useRef(new Map<string, string>());
  const previewTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      setConfig(await bridge.library.getConfig());
    } catch {
      // The renderer keeps working with the sample album if config is unreadable.
    }
  }, [bridge]);

  const refreshStats = useCallback(async () => {
    if (!bridge) return;
    try {
      setStats(await bridge.library.stats());
    } catch {
      setStats(null);
    }
  }, [bridge]);

  const flushPreviews = useCallback(() => {
    if (previewTimer.current) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    const entries = Array.from(pendingPreviews.current, ([hash, previewPath]) => ({
      hash,
      previewPath,
    }));
    pendingPreviews.current.clear();
    if (entries.length) {
      // Preview thumbnails arrive while the user is scrolling. A transition
      // keeps that update from interrupting input or scroll frames.
      startTransition(() => albumRef.current.applyPreviews(entries));
    }
  }, []);

  useEffect(() => {
    if (!bridge) return;
    void refresh();
    void refreshStats();

    const offProgress = bridge.library.onScanProgress((next) => setProgress(next));
    const offPreview = bridge.library.onPreviewReady((batch) => {
      const items = Array.isArray(batch) ? batch : [batch];
      for (const { hash, previewPath } of items) {
        if (!hash || !previewPath) continue;
        pendingPreviews.current.set(hash, previewPath);
        recentPreviews.current.set(hash, previewPath);
        if (recentPreviews.current.size > 30000) {
          const oldest = recentPreviews.current.keys().next().value;
          if (oldest) recentPreviews.current.delete(oldest);
        }
      }
      if (pendingPreviews.current.size === 0) return;
      if (previewTimer.current) return;
      previewTimer.current = window.setTimeout(() => {
        previewTimer.current = null;
        flushPreviews();
      }, 600);
    });
    const offPreviewProgress = bridge.library.onPreviewProgress((next) =>
      setPreviewProgress(next),
    );
    const offLibrary = bridge.library.onLibraryChanged((next) => {
      setConfig(next);
      void refreshStats();
    });

    return () => {
      offProgress();
      offPreview();
      offPreviewProgress();
      offLibrary();
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [bridge, refresh, refreshStats, flushPreviews]);

  const scan = useCallback(
    async (options: { full?: boolean; silent?: boolean } = {}): Promise<LibraryScanResult | null> => {
      if (!bridge || scanningRef.current) return null;
      scanningRef.current = true;
      setScanning(true);
      setPreviewProgress(null);
      setProgress({ phase: 'discover', current: 0, message: '正在扫描存储库…' });
      try {
        const result = await bridge.library.scan({ full: options.full });
        if (result.ok) {
          // Apply any thumbnails that finished before this scan result. The
          // two updates are queued together so applyPreviews sees the new
          // photos and can attach their preview paths immediately.
          const seedHashes = new Set(result.seeds.map((seed) => seed.contentHash));
          const earlyPreviews = Array.from(recentPreviews.current, ([hash, previewPath]) => ({
            hash,
            previewPath,
          })).filter((entry) => seedHashes.has(entry.hash));
          startTransition(() => {
            albumRef.current.applyScan(result);
            if (earlyPreviews.length) albumRef.current.applyPreviews(earlyPreviews);
          });
          await refreshStats();
          if (!options.silent) {
            pushToast({
              tone: result.complete ? 'success' : 'warning',
              title: result.complete ? '扫描完成' : '扫描已取消',
              description: `索引 ${result.stats.scanned} 张 · 识别 World ID ${result.stats.withWorldId} 张 · 待生成预览 ${result.stats.previewsQueued} 张`,
            });
          }
        } else if (!options.silent) {
          pushToast({
            tone: 'danger',
            title: '扫描失败',
            description: result.error ?? '请检查存储库文件夹是否可访问。',
          });
        }
        return result;
      } catch (error) {
        if (!options.silent) {
          pushToast({
            tone: 'danger',
            title: '扫描失败',
            description: (error as Error).message || '未知错误。',
          });
        }
        return null;
      } finally {
        scanningRef.current = false;
        setScanning(false);
        setProgress(null);
      }
    },
    [bridge, pushToast, refreshStats],
  );

  // Auto-scan once per library selection, after the library is ready and its
  // thumbnail cache has been chosen in onboarding.
  useEffect(() => {
    if (!bridge || !config?.configured || !config.autoScan) return;
    if (config.thumbnailsConfigured === false) return;
    const key = `${config.libraryPath}|${config.libraryId}`;
    if (autoScanKey.current === key) return;
    autoScanKey.current = key;
    void scan({ silent: true });
  }, [
    bridge,
    config?.configured,
    config?.autoScan,
    config?.thumbnailsConfigured,
    config?.libraryPath,
    config?.libraryId,
    scan,
  ]);

  const chooseLibrary = useCallback(async () => {
    if (!bridge) return false;
    const result = await bridge.library.chooseFolder();
    if (result.ok) {
      window.location.reload();
      return true;
    }
    if (result.error && result.error !== '已取消。') {
      pushToast({ tone: 'danger', title: '无法使用这个文件夹', description: result.error });
    }
    return false;
  }, [bridge, pushToast]);

  const createLibrary = useCallback(async () => {
    if (!bridge) return false;
    const result = await bridge.library.createFolder();
    if (result.ok) {
      window.location.reload();
      return true;
    }
    if (result.error && result.error !== '已取消。') {
      pushToast({ tone: 'danger', title: '无法创建存储库', description: result.error });
    }
    return false;
  }, [bridge, pushToast]);

  const setupThumbnails = useCallback(
    async (options: { thumbnailDir: string; presetId: string }) => {
      if (!bridge) {
        return { ok: false, error: '当前环境不支持本地存储库。' } as ThumbnailSetupResult;
      }
      const result = await bridge.library.setupThumbnails(options);
      if (result.ok && result.config) {
        setConfig(result.config);
        void refreshStats();
      }
      return result;
    },
    [bridge, refreshStats],
  );

  const sampleThumbnailPreview = useCallback(async (): Promise<ThumbnailSampleResult> => {
    if (!bridge) return { ok: false, error: '当前环境不支持本地存储库。' };
    return bridge.library.sampleThumbnailPreview();
  }, [bridge]);

  const dismissOnboarding = useCallback(async () => {
    if (!bridge) return;
    try {
      setConfig(await bridge.library.dismissOnboarding());
    } catch {
      // Keep the gate visible if the preference cannot be written.
    }
  }, [bridge]);

  const openFolder = useCallback(async () => {
    if (!bridge) return;
    const result = await bridge.library.openFolder();
    if (!result.ok) {
      pushToast({
        tone: 'warning',
        title: '无法打开存储库文件夹',
        description: result.error,
      });
    }
  }, [bridge, pushToast]);

  const revealFile = useCallback(
    async (relativePath: string) => {
      if (!bridge) return;
      const result = await bridge.library.revealFile(relativePath);
      if (!result.ok) {
        pushToast({
          tone: 'warning',
          title: '无法定位文件',
          description: result.error,
        });
      }
    },
    [bridge, pushToast],
  );

  const setOptions = useCallback(
    async (
      patch: Partial<{
        previewPreset: string;
        previewMaxEdge: number;
        imageLoadingMode: ImageLoadingMode;
        autoScan: boolean;
        watch: boolean;
      }>,
    ) => {
      if (!bridge) return;
      try {
        const next = await bridge.library.setOptions(patch);
        setConfig(next);
        if (patch.previewPreset || patch.previewMaxEdge) {
          // The main process cleared the old cache; drop stale URLs, then
          // rebuild thumbnails in the background at the new preset.
          pendingPreviews.current.clear();
          recentPreviews.current.clear();
          albumRef.current.clearPreviewPaths();
          pushToast({
            tone: 'success',
            title: '缩略图规格已更新',
            description: '正在按新规格重新生成缩略图，原图保持不动。',
          });
          void scan({ silent: true });
        }
      } catch (error) {
        pushToast({
          tone: 'danger',
          title: '无法保存设置',
          description: (error as Error).message,
        });
      }
    },
    [bridge, pushToast, scan],
  );

  const clearPreviewCache = useCallback(async () => {
    if (!bridge) return;
    const result = await bridge.library.clearPreviewCache();
    if (!result.ok) {
      pushToast({ tone: 'danger', title: '清理失败', description: result.error });
      return;
    }
    pendingPreviews.current.clear();
    recentPreviews.current.clear();
    albumRef.current.clearPreviewPaths();
    pushToast({
      tone: 'success',
      title: '预览缓存已清理',
      description: '正在按当前尺寸重新生成预览。',
    });
    void scan({ silent: true });
  }, [bridge, pushToast, scan]);

  const resetIgnored = useCallback(async () => {
    if (!bridge) return;
    await bridge.library.resetIgnored();
    pushToast({
      tone: 'success',
      title: '已重置忽略列表',
      description: '下次扫描会重新发现之前从相册移除的照片。',
    });
  }, [bridge, pushToast]);

  const cancelScan = useCallback(async () => {
    if (!bridge) return;
    await bridge.library.cancelScan();
  }, [bridge]);

  const value = useMemo<DesktopLibraryContextValue>(
    () => ({
      available: Boolean(bridge),
      config,
      stats,
      scanning,
      refresh,
      refreshStats,
      scan,
      cancelScan,
      chooseLibrary,
      createLibrary,
      dismissOnboarding,
      setupThumbnails,
      sampleThumbnailPreview,
      openFolder,
      revealFile,
      setOptions,
      clearPreviewCache,
      resetIgnored,
    }),
    [
      bridge,
      config,
      stats,
      scanning,
      refresh,
      refreshStats,
      scan,
      cancelScan,
      chooseLibrary,
      createLibrary,
      dismissOnboarding,
      setupThumbnails,
      sampleThumbnailPreview,
      openFolder,
      revealFile,
      setOptions,
      clearPreviewCache,
      resetIgnored,
    ],
  );

  // Scan/preview progress changes several times per second. Keeping it in a
  // separate context prevents the whole public timeline from re-rendering.
  const activity = useMemo<DesktopLibraryActivityValue>(
    () => ({ progress, previewProgress }),
    [progress, previewProgress],
  );

  return (
    <DesktopLibraryContext.Provider value={value}>
      <DesktopLibraryActivityContext.Provider value={activity}>
        {children}
      </DesktopLibraryActivityContext.Provider>
    </DesktopLibraryContext.Provider>
  );
}

export function useDesktopLibrary(): DesktopLibraryContextValue {
  const value = useContext(DesktopLibraryContext);
  if (!value) {
    throw new Error('useDesktopLibrary must be used inside DesktopLibraryProvider');
  }
  return value;
}

export function useDesktopLibraryActivity(): DesktopLibraryActivityValue {
  return useContext(DesktopLibraryActivityContext);
}
