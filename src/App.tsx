import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import type { PhotoDraft } from './types';
import { useAlbum } from './hooks/useAlbum';
import { useHashRoute } from './hooks/useHashRoute';
import { APPEARANCE_CACHE_KEY, themeChromeColor, themeTone } from './data/appearance';
import { ToastProvider, useToast } from './hooks/useToast';
import { DesktopLibraryProvider, useDesktopLibrary } from './hooks/useDesktopLibrary';
import { DesktopServicesProvider } from './hooks/useDesktopServices';
import { MobileCastProvider } from './hooks/useMobileCast';
import { ThumbnailLoadingProvider } from './hooks/useThumbnailLoader';
import { getDesktopBridge, isDesktopRuntime } from './platform';
import { isMobileRuntime } from './platform/mobileRuntime';
import { androidBridge } from './mobile/native';
import { formatDateShort } from './utils/date';
import { importPhotosFromDesktop } from './platform/importPhotos';
import { DesktopTitleBar } from './components/DesktopTitleBar';
import { UpdateNotice } from './components/UpdateNotice';
import { LibraryGate } from './components/LibraryGate';
import { BrandGlyph } from './components/BrandGlyph';
import { PublicSite } from './PublicSite';
import { isMobileClientEntry } from './mobile/entry';

// The admin console (and its AI/EasyTier panels) is only downloaded when the
// admin route is opened, keeping the public timeline's first paint small.
const AdminApp = lazy(() =>
  import('./admin/AdminApp').then((module) => ({ default: module.AdminApp })),
);

// The phone client is a separate chunk: the public site and the desktop window
// never download its timeline, viewer or gesture code.
const MobileClient = lazy(() =>
  import('./mobile/MobileApp').then((module) => ({ default: module.MobileApp })),
);

function MobileClientLoading() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: '#05040c',
        color: '#b7adca',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        letterSpacing: '0.08em',
      }}
      role="status"
      aria-live="polite"
    >
      <BrandGlyph size={46} />
      <span>正在打开手机客户端…</span>
    </div>
  );
}

function AdminRouteLoading() {
  return (
    <div className="admin-route-loading" role="status" aria-live="polite">
      <BrandGlyph size={28} />
      <span>正在打开管理台…</span>
    </div>
  );
}

function Shell({
  album,
  path,
  navigate,
}: {
  album: ReturnType<typeof useAlbum>;
  path: string;
  navigate: (target: string) => void;
}) {
  const desktop = isDesktopRuntime();
  const mobile = isMobileRuntime();
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const { chooseLibrary, scan, openFolder, config: libraryConfig } = useDesktopLibrary();
  const addPhoto = album.addPhoto;
  const widgetSignature = useRef('');
  // Web builds have no local library config; browser-native lazy loading is
  // the closest match to realtime mode.
  const imageLoadingMode = libraryConfig?.imageLoadingMode ?? 'realtime';

  useEffect(() => {
    if (desktop && !mobile) {
      document.documentElement.dataset.desktop = 'true';
    } else {
      delete document.documentElement.dataset.desktop;
    }
    if (mobile) {
      document.documentElement.dataset.mobile = 'true';
    } else {
      delete document.documentElement.dataset.mobile;
    }
  }, [desktop, mobile]);

  // Dropping a file outside the upload dropzone must never navigate the window
  // away from the app inside Electron.
  useEffect(() => {
    if (!desktop) return;
    const preventFileDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', preventFileDrop);
    window.addEventListener('drop', preventFileDrop);
    return () => {
      window.removeEventListener('dragover', preventFileDrop);
      window.removeEventListener('drop', preventFileDrop);
    };
  }, [desktop]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.app.onCommand((command) => {
      if (command === 'choose-library') {
        void chooseLibrary();
        return;
      }
      if (command === 'scan-library') {
        void scan();
        return;
      }
      if (command === 'open-library-folder') {
        void openFolder();
        return;
      }
      if (command === 'open-settings') {
        navigate('/admin/settings');
        return;
      }
      if (command === 'import-photos') {
        void importPhotosFromDesktop(bridge, { addPhoto }, pushToast);
        return;
      }
      if (command === 'export-metadata' || command === 'export-full') {
        const task =
          command === 'export-metadata'
            ? bridge.backup.exportMetadata()
            : bridge.backup.exportFull();
        void task.then((result) => {
          if (result.ok) {
            pushToast({
              tone: 'success',
              title: '备份已导出',
              description: result.path,
            });
          } else if (!result.canceled) {
            pushToast({
              tone: 'danger',
              title: '备份失败',
              description: result.error,
            });
          }
        });
      }
    });
  }, [bridge, chooseLibrary, scan, openFolder, addPhoto, navigate, pushToast]);

  // Phone uploads and watched-folder imports arrive as drafts from the main
  // process; merge them into the live album so the timeline updates without a
  // full rescan.
  useEffect(() => {
    if (!bridge || typeof bridge.library.onImported !== 'function') return;
    return bridge.library.onImported((draft) => {
      addPhoto(draft);
      pushToast({
        tone: 'success',
        title: '收录了一张新照片',
        description: draft.note || draft.alt || '来自手机回传 / 自动导入',
      });
    });
  }, [bridge, addPhoto, pushToast]);

  // Images shared from other Android apps arrive as drafts (before or after
  // React mounts). The native bridge queues them and dispatches this event.
  useEffect(() => {
    if (!mobile) return undefined;
    const receive = (drafts: PhotoDraft[]) => {
      if (!Array.isArray(drafts) || drafts.length === 0) return;
      for (const draft of drafts) addPhoto(draft);
      pushToast({
        tone: 'success',
        title: `已收录 ${drafts.length} 张分享照片`,
        description: '来自系统分享，已加入本地相册。',
      });
    };
    const queued = window.__hoshikuzuSharedDrafts;
    if (Array.isArray(queued) && queued.length > 0) {
      window.__hoshikuzuSharedDrafts = [];
      receive(queued as PhotoDraft[]);
    }
    const onShared = (event: Event) => {
      const detail = (event as CustomEvent<PhotoDraft[]>).detail;
      window.__hoshikuzuSharedDrafts = [];
      receive(detail);
    };
    window.addEventListener('hoshikuzu:shared-media', onShared);
    return () => window.removeEventListener('hoshikuzu:shared-media', onShared);
  }, [mobile, addPhoto, pushToast]);

  // Home-screen "on this day" widget: push one preview + non-sensitive caption.
  // Notes stay out of the widget so the app lock is not undermined by it.
  useEffect(() => {
    if (!mobile) return;
    const today = new Date();
    const match =
      album.photos
        .filter(
          (photo) =>
            !photo.missing &&
            Boolean(photo.previewPath) &&
            Boolean(photo.capturedAt),
        )
        .filter((photo) => {
          const date = new Date(photo.capturedAt);
          return (
            !Number.isNaN(date.getTime()) &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate() &&
            date.getFullYear() < today.getFullYear()
          );
        })
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0] ?? null;
    const signature = match ? `${match.id}:${match.previewPath}` : 'empty';
    if (widgetSignature.current === signature) return;
    widgetSignature.current = signature;
    const payload = match
      ? {
          previewPath: match.previewPath,
          title: (match.world?.name || '那年今天').slice(0, 60),
          subtitle: `${formatDateShort(match.capturedAt)} · 时光轴`,
        }
      : {};
    try {
      androidBridge()?.updateOnThisDayWidget?.(JSON.stringify(payload));
    } catch {
      // The widget is optional; never disturb the album.
    }
  }, [mobile, album.photos]);

  return (
    <>
      {desktop && !mobile ? <DesktopTitleBar /> : null}
      {desktop && !mobile ? <LibraryGate /> : null}
      {path.startsWith('/admin') ? (
        <Suspense fallback={<AdminRouteLoading />}>
          <AdminApp album={album} route={path} navigate={navigate} />
        </Suspense>
      ) : (
        <ThumbnailLoadingProvider
          mode={imageLoadingMode}
          previewMaxEdge={libraryConfig?.previewMaxEdge}
        >
          <PublicSite
            album={album}
            onNavigateAdmin={(target = '/admin') => navigate(target)}
          />
        </ThumbnailLoadingProvider>
      )}
    </>
  );
}

function Root() {
  const album = useAlbum();
  const { path, navigate } = useHashRoute();

  useLayoutEffect(() => {
    const { theme, layout, backgroundEffect, experimentalEffects } = album.settings;
    const background =
      backgroundEffect === 'blackhole' && !experimentalEffects
        ? 'stars'
        : backgroundEffect || 'stars';
    const tone = themeTone(theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.layout = layout;
    document.documentElement.dataset.background = background;
    document.documentElement.dataset.tone = tone;
    document.documentElement.style.colorScheme = tone;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themeChromeColor(theme));
    try {
      localStorage.setItem(
        APPEARANCE_CACHE_KEY,
        JSON.stringify({
          theme,
          layout,
          background,
          experimental: experimentalEffects === true,
        }),
      );
    } catch {
      // Storage may be full; the in-memory appearance still applies for this visit.
    }
  }, [
    album.settings.theme,
    album.settings.layout,
    album.settings.backgroundEffect,
    album.settings.experimentalEffects,
  ]);

  return (
    <DesktopLibraryProvider album={album}>
      <DesktopServicesProvider album={album}>
        <MobileCastProvider>
          <Shell album={album} path={path} navigate={navigate} />
          {isMobileRuntime() ? null : <UpdateNotice />}
        </MobileCastProvider>
      </DesktopServicesProvider>
    </DesktopLibraryProvider>
  );
}

export default function App() {
  if (isMobileClientEntry()) {
    return (
      <Suspense fallback={<MobileClientLoading />}>
        <MobileClient />
      </Suspense>
    );
  }
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}
