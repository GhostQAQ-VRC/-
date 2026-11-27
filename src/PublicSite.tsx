import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Share2, Trash2, UploadCloud } from 'lucide-react';
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
import { Slideshow } from './components/Slideshow';
import { rotatePhoto } from './utils/orientation';
import { isMobileRuntime } from './platform/mobileRuntime';
import {
  pairedDesktopBase,
  saveManagedPhoto,
  shareManagedPhotos,
  uploadManagedPhotos,
} from './mobile/managedActions';

interface PublicSiteProps {
  album: AlbumApi;
  onNavigateAdmin: (path?: string) => void;
}

export function PublicSite({ album, onNavigateAdmin }: PublicSiteProps) {
  const { pushToast } = useToast();
  const mobile = isMobileRuntime();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [slideshowOpen, setSlideshowOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState<'save' | 'share' | 'upload' | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [pairedDesktop, setPairedDesktop] = useState('');
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
  const selectedPhotos = useMemo(
    () => album.photos.filter((photo) => selected.has(photo.id)),
    [album.photos, selected],
  );
  const selectedManaged = useMemo(
    () =>
      selectedPhotos.filter(
        (photo) =>
          !photo.missing && Boolean(photo.libraryPath) && Boolean(photo.contentHash),
      ),
    [selectedPhotos],
  );
  const allFilteredSelected =
    filteredPhotos.length > 0 && filteredPhotos.every((photo) => selected.has(photo.id));

  useEffect(() => {
    if (!selectMode) return;
    setSelected((previous) => {
      const ids = new Set(album.photos.map((photo) => photo.id));
      const next = new Set([...previous].filter((id) => ids.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [album.photos, selectMode]);

  const toggleSelectionMode = useCallback(() => {
    if (selectMode) {
      setSelectMode(false);
      setSelected(new Set());
      return;
    }
    setSelectMode(true);
    setPairedDesktop(pairedDesktopBase());
  }, [selectMode]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((previous) => {
      if (
        filteredPhotos.length > 0 &&
        filteredPhotos.every((photo) => previous.has(photo.id))
      ) {
        return new Set();
      }
      return new Set(filteredPhotos.map((photo) => photo.id));
    });
  }, [filteredPhotos]);

  const handleBatchSave = useCallback(async () => {
    if (batchBusy || selectedManaged.length === 0) return;
    setBatchBusy('save');
    let saved = 0;
    let failed = 0;
    for (const photo of selectedManaged) {
      try {
        const result = await saveManagedPhoto(photo);
        if (result.ok) saved += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setBatchBusy(null);
    pushToast({
      tone: failed ? 'warning' : 'success',
      title: `已保存 ${saved} 张到手机`,
      description: failed
        ? `${failed} 张保存失败，请重试。`
        : '可在系统相册 / 下载目录查看。',
    });
  }, [batchBusy, selectedManaged, pushToast]);

  const handleBatchShare = useCallback(async () => {
    if (batchBusy || selectedManaged.length === 0) return;
    setBatchBusy('share');
    try {
      const result = await shareManagedPhotos(selectedManaged);
      pushToast(
        result.ok
          ? {
              tone: 'success',
              title: `已打开分享 · ${result.count || selectedManaged.length} 张`,
              description: '在系统分享面板里选择要发送到的应用。',
            }
          : { tone: 'danger', title: '分享失败', description: result.error },
      );
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '分享失败',
        description: error instanceof Error ? error.message : '请重试。',
      });
    } finally {
      setBatchBusy(null);
    }
  }, [batchBusy, selectedManaged, pushToast]);

  const handleBatchUpload = useCallback(async () => {
    if (batchBusy || selectedManaged.length === 0) return;
    if (!pairedDesktop) {
      pushToast({
        tone: 'warning',
        title: '还没有连接电脑',
        description: '请点右上角电脑图标，扫码连接后再回传。',
      });
      return;
    }
    setBatchBusy('upload');
    setBatchProgress({ done: 0, total: selectedManaged.length });
    try {
      const summary = await uploadManagedPhotos(selectedManaged, (done, total) => {
        setBatchProgress({ done, total });
      });
      const okCount = summary.uploaded + summary.duplicates;
      pushToast({
        tone: summary.failed ? 'warning' : 'success',
        title: summary.failed
          ? `回传完成 ${okCount} / ${selectedManaged.length} 张`
          : `已回传 ${okCount} 张到电脑`,
        description: summary.failed
          ? summary.errors[0]
          : summary.duplicates
            ? '电脑端已有部分照片，已自动去重。'
            : '电脑端相册已更新。',
      });
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '回传失败',
        description: error instanceof Error ? error.message : '请检查电脑连接后重试。',
      });
    } finally {
      setBatchBusy(null);
      setBatchProgress(null);
    }
  }, [batchBusy, pairedDesktop, selectedManaged, pushToast]);

  const confirmBatchDelete = useCallback(() => {
    const ids = [...selected];
    if (ids.length === 0) return;
    album.deletePhotos(ids);
    setBatchDeleteOpen(false);
    setSelected(new Set());
    setSelectMode(false);
    pushToast({
      title: `已删除 ${ids.length} 张记忆`,
      description: '本地原图已从应用私有目录移除，无法撤销。',
    });
  }, [album, selected, pushToast]);

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

  const handleToggleFavorite = useCallback(
    (id: string) => {
      const photo = photosRef.current.find((item) => item.id === id);
      if (!photo) return;
      album.updatePhoto(id, { favorite: photo.favorite ? undefined : true });
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
        onConnectDesktop={
          isMobileRuntime()
            ? () => window.HoshikuzuAndroid?.openConnect?.()
            : undefined
        }
        onSelect={mobile ? toggleSelectionMode : undefined}
        selectionActive={selectMode}
        onSlideshow={() => setSlideshowOpen(true)}
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
                  onToggleFavorite={handleToggleFavorite}
                  selectionMode={mobile && selectMode}
                  selected={selected}
                  onToggleSelect={toggleSelect}
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

      {mobile && selectMode ? (
        <div className="mobile-batch-bar" role="toolbar" aria-label="批量操作">
          <div className="mobile-batch-bar__head">
            <button type="button" onClick={toggleSelectionMode}>
              取消
            </button>
            <strong>{selected.size > 0 ? `已选 ${selected.size} 张` : '选择照片'}</strong>
            <button type="button" onClick={toggleSelectAll}>
              {allFilteredSelected ? '取消全选' : '全选'}
            </button>
          </div>
          <div className="mobile-batch-bar__actions">
            <button
              type="button"
              disabled={selectedManaged.length === 0 || batchBusy !== null}
              onClick={() => void handleBatchSave()}
            >
              <Download size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{batchBusy === 'save' ? '保存中…' : '保存'}</span>
            </button>
            <button
              type="button"
              disabled={selectedManaged.length === 0 || batchBusy !== null}
              onClick={() => void handleBatchShare()}
            >
              <Share2 size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>分享</span>
            </button>
            <button
              type="button"
              disabled={selectedManaged.length === 0 || batchBusy !== null}
              onClick={() => void handleBatchUpload()}
              title={pairedDesktop ? `回传到 ${pairedDesktop}` : '请先连接电脑'}
            >
              <UploadCloud size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>{batchBusy === 'upload' ? '回传中…' : '回传'}</span>
            </button>
            <button
              type="button"
              className="is-danger"
              disabled={selected.size === 0 || batchBusy !== null}
              onClick={() => setBatchDeleteOpen(true)}
            >
              <Trash2 size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>删除</span>
            </button>
          </div>
          {batchProgress ? (
            <p className="mobile-batch-bar__progress">
              正在回传 {batchProgress.done} / {batchProgress.total}
            </p>
          ) : null}
        </div>
      ) : null}

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

      <Slideshow
        open={slideshowOpen}
        photos={allSorted}
        onClose={() => setSlideshowOpen(false)}
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

      <ConfirmDialog
        open={batchDeleteOpen}
        title={`删除选中的 ${selected.size} 张记忆？`}
        description="这些照片会从时间轴移除，并删除应用私有目录中的本地原图与缩略图。此操作无法撤销。"
        confirmLabel="确认删除"
        onConfirm={confirmBatchDelete}
        onCancel={() => setBatchDeleteOpen(false)}
      />
    </div>
  );
}
