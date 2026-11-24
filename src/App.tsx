import { lazy, Suspense, useEffect, useLayoutEffect } from 'react';
import { useAlbum } from './hooks/useAlbum';
import { useHashRoute } from './hooks/useHashRoute';
import { APPEARANCE_CACHE_KEY, themeChromeColor, themeTone } from './data/appearance';
import { ToastProvider, useToast } from './hooks/useToast';
import { DesktopLibraryProvider, useDesktopLibrary } from './hooks/useDesktopLibrary';
import { DesktopServicesProvider } from './hooks/useDesktopServices';
import { ThumbnailLoadingProvider } from './hooks/useThumbnailLoader';
import { getDesktopBridge, isDesktopRuntime } from './platform';
import { importPhotosFromDesktop } from './platform/importPhotos';
import { DesktopTitleBar } from './components/DesktopTitleBar';
import { LibraryGate } from './components/LibraryGate';
import { BrandGlyph } from './components/BrandGlyph';
import { PublicSite } from './PublicSite';

// The admin console (and its AI/EasyTier panels) is only downloaded when the
// admin route is opened, keeping the public timeline's first paint small.
const AdminApp = lazy(() =>
  import('./admin/AdminApp').then((module) => ({ default: module.AdminApp })),
);

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
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const { chooseLibrary, scan, openFolder, config: libraryConfig } = useDesktopLibrary();
  const addPhoto = album.addPhoto;
  // Web builds have no local library config; browser-native lazy loading is
  // the closest match to realtime mode.
  const imageLoadingMode = libraryConfig?.imageLoadingMode ?? 'realtime';

  useEffect(() => {
    if (desktop) {
      document.documentElement.dataset.desktop = 'true';
    } else {
      delete document.documentElement.dataset.desktop;
    }
  }, [desktop]);

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

  return (
    <>
      {desktop ? <DesktopTitleBar /> : null}
      {desktop ? <LibraryGate /> : null}
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
        <Shell album={album} path={path} navigate={navigate} />
      </DesktopServicesProvider>
    </DesktopLibraryProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}
