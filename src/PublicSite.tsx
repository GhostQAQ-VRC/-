import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PhotoDraft } from './types';
import type { AlbumApi } from './hooks/useAlbum';
import { useToast } from './hooks/useToast';
import { DEFAULT_FILTERS, buildWorldOptions, filterPhotos, getAlbumStats, groupPhotos } from './utils/filters';
import { formatDateShort } from './utils/date';
import { effectiveWorldApiBase } from './data/settings';
import { PROGRAM_NAME, SHORT_SITE_NAME } from './data/branding';
import { BackgroundStage } from './components/backgrounds/BackgroundStage';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { FilterBar } from './components/FilterBar';
import { TimelineNav } from './components/TimelineNav';
import { Timeline } from './components/Timeline';
import { EmptyState } from './components/EmptyState';
import { Footer } from './components/Footer';
import { UploadDialog } from './components/UploadDialog';
import { PhotoDetailDialog } from './components/PhotoDetailDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AppearancePanel } from './components/AppearancePanel';
import { rotatePhoto } from './utils/orientation';

interface PublicSiteProps {
  album: AlbumApi;
  onNavigateAdmin: (path?: string) => void;
}

export function PublicSite({ album, onNavigateAdmin }: PublicSiteProps) {
  const { pushToast } = useToast();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const announcedCorruption = useRef(false);
  const lastStorageError = useRef<string | null>(null);
  const photosRef = useRef(album.photos);
  photosRef.current = album.photos;
  const featuredIdRef = useRef(album.settings.featuredPhotoId);
  featuredIdRef.current = album.settings.featuredPhotoId;

  const apiBase = effectiveWorldApiBase(album.settings);
  const worldApiEnabled = Boolean(apiBase);

  const allSorted = useMemo(
    () =>
      [...album.photos].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt)),
    [album.photos],
  );
  const stats = useMemo(() => getAlbumStats(album.photos), [album.photos]);
  const worldOptions = useMemo(() => buildWorldOptions(album.photos), [album.photos]);
  // Typing in search and background thumbnail updates should never block
  // scrolling: the expensive filtering/grouping waits for a spare frame.
  const deferredFilters = useDeferredValue(filters);
  const filteredPhotos = useMemo(
    () => filterPhotos(album.photos, deferredFilters),
    [album.photos, deferredFilters],
  );
  const groups = useMemo(() => groupPhotos(filteredPhotos), [filteredPhotos]);
  const pinnedPhoto = useMemo(
    () =>
      album.settings.featuredPhotoId
        ? album.photos.find((photo) => photo.id === album.settings.featuredPhotoId)
        : undefined,
    [album.settings.featuredPhotoId, album.photos],
  );
  const latestPhoto = pinnedPhoto ?? allSorted[0] ?? null;
  const detailPhotos = useMemo(() => {
    if (activeId && !filteredPhotos.some((photo) => photo.id === activeId)) return allSorted;
    return filteredPhotos;
  }, [activeId, filteredPhotos, allSorted]);
  const pendingDeletePhoto = pendingDeleteId
    ? (album.photos.find((photo) => photo.id === pendingDeleteId) ?? null)
    : null;

  useEffect(() => {
    document.title =
      album.settings.siteName === SHORT_SITE_NAME
        ? PROGRAM_NAME
        : `${album.settings.siteName} · ${PROGRAM_NAME}`;
    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '#top') window.scrollTo({ top: 0 });
  }, [album.settings.siteName]);

  useEffect(() => {
    if (album.initiallyCorrupted && !announcedCorruption.current) {
      announcedCorruption.current = true;
      pushToast({
        tone: 'warning',
        title: '本地相册未能读取',
        description: '已载入起始相册，你仍然可以正常浏览和继续编辑。',
      });
    }
  }, [album.initiallyCorrupted, pushToast]);

  useEffect(() => {
    if (album.initialSource === 'migrated' && !announcedCorruption.current) {
      announcedCorruption.current = true;
      pushToast({
        tone: 'success',
        title: '相册已升级到正式版结构',
        description: '照片、世界资料与备注已迁移到新的本地数据格式。',
      });
    }
  }, [album.initialSource, pushToast]);

  useEffect(() => {
    if (album.storageError && album.storageError !== lastStorageError.current) {
      lastStorageError.current = album.storageError;
      pushToast({
        tone: 'warning',
        title: '本地保存受限',
        description: album.storageError,
      });
    }
    if (!album.storageError) lastStorageError.current = null;
  }, [album.storageError, pushToast]);

  useEffect(() => {
    if (activeId && !album.photos.some((photo) => photo.id === activeId)) {
      setActiveId(null);
    }
  }, [activeId, album.photos]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '/' && !isTyping(event.target) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const input = searchRef.current;
        if (!input) return;
        event.preventDefault();
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updateFilters = useCallback((patch: Partial<typeof filters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const clearFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const focusSearch = useCallback(() => {
    const input = searchRef.current;
    if (!input) {
      document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const scrollToTimeline = useCallback(() => {
    document.getElementById('timeline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const openPhoto = useCallback((id: string) => setActiveId(id), []);
  const requestPhotoDelete = useCallback((id: string) => setPendingDeleteId(id), []);
  const openUpload = useCallback(() => setUploadOpen(true), []);

  const handleTogglePin = useCallback(
    (id: string) => {
      const photo = photosRef.current.find((item) => item.id === id);
      if (!photo) return;
      const pinned = featuredIdRef.current === id;
      album.setFeaturedPhoto(pinned ? null : id);
      pushToast({
        tone: 'success',
        title: pinned ? '已取消置顶' : '已设为首页置顶',
        description: pinned
          ? '首页开头将恢复显示最新收录的照片。'
          : '这张照片已经出现在首页开头的置顶位置。',
      });
    },
    [album.setFeaturedPhoto, pushToast],
  );

  const handleRotatePhoto = useCallback(
    (id: string, delta: -90 | 90) => {
      const photo = photosRef.current.find((item) => item.id === id);
      if (!photo) return;
      const next = rotatePhoto(photo.rotation, delta);
      album.updatePhoto(id, { rotation: next === 0 ? undefined : next });
    },
    [album.updatePhoto],
  );

  const handleUploadAdd = (draft: PhotoDraft) => {
    album.addPhoto(draft);
    setFilters(DEFAULT_FILTERS);
  };

  const handleDeleteFromDetail = (id: string) => {
    album.deletePhoto(id);
    setActiveId(null);
    pushToast({ title: '照片已删除', description: '这段记忆已从时间轴中移除。' });
  };

  const handleReset = () => {
    album.resetAlbum();
    setFilters(DEFAULT_FILTERS);
    setActiveId(null);
    pushToast({ title: '已恢复起始相册', description: '起始照片与内置世界资料重新回到了时间轴上。' });
  };

  const confirmQuickDelete = () => {
    if (!pendingDeleteId) return;
    const photo = album.photos.find((item) => item.id === pendingDeleteId);
    album.deletePhoto(pendingDeleteId);
    if (activeId === pendingDeleteId) setActiveId(null);
    setPendingDeleteId(null);
    pushToast({
      title: '照片已删除',
      description: photo ? `${formatDateShort(photo.capturedAt)} 的记忆已从时间轴移除。` : undefined,
    });
  };

  const isAlbumEmpty = album.photos.length === 0;
  const hasNoResults = !isAlbumEmpty && filteredPhotos.length === 0;

  return (
    <div
      className="app"
      data-background={album.settings.backgroundEffect || 'stars'}
    >
      <BackgroundStage settings={album.settings} />
      <div className="atmosphere" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <a className="skip-link" href="#timeline">
        跳到时光轴
      </a>

      <Header
        siteName={album.settings.siteName}
        siteNameEn={album.settings.siteNameEn}
        onUpload={() => setUploadOpen(true)}
        onFocusSearch={focusSearch}
        onToggleAppearance={() => setAppearanceOpen((value) => !value)}
        appearanceOpen={appearanceOpen}
        appearanceButtonRef={appearanceButtonRef}
        worldApiEnabled={worldApiEnabled}
      />

      <main>
        <Hero
          stats={stats}
          latestPhoto={latestPhoto}
          featuredPinned={Boolean(pinnedPhoto)}
          tagline={album.settings.tagline}
          onUpload={() => setUploadOpen(true)}
          onOpenPhoto={openPhoto}
          onExplore={scrollToTimeline}
        />

        <section className="timeline-section" id="timeline" aria-labelledby="timeline-title">
          <div className="container">
            <div className="timeline-intro">
              <div className="timeline-intro__main">
                <p className="eyebrow">
                  <span className="eyebrow__star" aria-hidden="true">
                    ✦
                  </span>
                  MEMORY TIMELINE
                  <span className="eyebrow__divider" aria-hidden="true" />
                  星の軌跡
                </p>
                <h2 className="timeline-title" id="timeline-title">
                  时光轴
                  <span className="timeline-title__sub">Time Axis</span>
                </h2>
              </div>
              <div className="timeline-intro__side">
                <p>{album.settings.timelineIntro}</p>
                <p className="timeline-intro__meta">
                  <span>{stats.total} MEMORIES</span>
                  <span aria-hidden="true">/</span>
                  <span>{stats.worlds} WORLDS</span>
                  <span aria-hidden="true">/</span>
                  <span>{stats.years} YEARS</span>
                </p>
              </div>
            </div>

            {!isAlbumEmpty ? (
              <>
                <FilterBar
                  filters={filters}
                  onChange={updateFilters}
                  worldOptions={worldOptions}
                  resultCount={filteredPhotos.length}
                  totalCount={album.photos.length}
                  searchRef={searchRef}
                  onClear={clearFilters}
                />
                <TimelineNav groups={groups} />
              </>
            ) : null}

            {album.storageError ? (
              <p className="storage-warning" role="status">
                <AlertTriangle size={15} aria-hidden="true" />
                {album.storageError}
              </p>
            ) : null}

            <div className="timeline-body">
              {isAlbumEmpty ? (
                <EmptyState
                  variant="empty"
                  onPrimary={() => setUploadOpen(true)}
                  onSecondary={handleReset}
                  hasSamplesAvailable
                />
              ) : hasNoResults ? (
                <EmptyState variant="no-results" onPrimary={clearFilters} />
              ) : (
                <Timeline
                  groups={groups}
                  featuredPhotoId={album.settings.featuredPhotoId}
                  onTogglePin={handleTogglePin}
                  onRotatePhoto={handleRotatePhoto}
                  onOpenPhoto={openPhoto}
                  onRequestDelete={requestPhotoDelete}
                  onUpload={openUpload}
                />
              )}
            </div>
          </div>
        </section>
      </main>

      <AppearancePanel
        open={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
        theme={album.settings.theme}
        layout={album.settings.layout}
        backgroundEffect={album.settings.backgroundEffect}
        customBackgroundSrc={album.settings.customBackgroundSrc}
        customBackgroundName={album.settings.customBackgroundName}
        customVideoKey={album.settings.customVideoKey}
        customVideoName={album.settings.customVideoName}
        customVideoPoster={album.settings.customVideoPoster}
        customVideoBytes={album.settings.customVideoBytes}
        experimentalEffects={album.settings.experimentalEffects}
        onChange={album.updateSettings}
        triggerRef={appearanceButtonRef}
      />

      <Footer
        siteName={album.settings.siteName}
        siteNameEn={album.settings.siteNameEn}
        photoCount={album.photos.length}
        worldApiEnabled={worldApiEnabled}
        onUpload={() => setUploadOpen(true)}
        onReset={handleReset}
      />

      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onAdd={handleUploadAdd} />

      <PhotoDetailDialog
        photos={detailPhotos}
        activeId={activeId}
        onClose={() => setActiveId(null)}
        onNavigate={setActiveId}
        onUpdate={album.updatePhoto}
        onDelete={handleDeleteFromDetail}
        featuredId={album.settings.featuredPhotoId}
        onToggleFeatured={handleTogglePin}
        library={album.worlds}
        apiBase={apiBase}
        onOpenAdmin={() => onNavigateAdmin('/admin/worlds')}
      />

      <ConfirmDialog
        open={pendingDeletePhoto !== null}
        title="删除这段记忆？"
        description={
          pendingDeletePhoto
            ? `「${formatDateShort(pendingDeletePhoto.capturedAt)} · ${
                pendingDeletePhoto.note || '未写备注的照片'
              }」将从时间轴和浏览器本地存储中移除，无法撤销。`
            : ''
        }
        confirmLabel="确认删除"
        onConfirm={confirmQuickDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
