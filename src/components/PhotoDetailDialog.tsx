import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  ImageOff,
  Loader2,
  Monitor,
  Pin,
  PinOff,
  RotateCcw,
  RotateCw,
  ScanText,
  Share2,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type { Photo, WorldLibraryEntry } from '../types';
import { getDesktopBridge, photoOriginalSrc, photoSrc } from '../platform';
import { isMobileRuntime } from '../platform/mobileRuntime';
import { saveManagedPhoto, shareManagedPhotos } from '../mobile/managedActions';
import { normalizePhotoTag, normalizePhotoTags } from '../hooks/useAlbum';
import { useMobileCast } from '../hooks/useMobileCast';
import {
  formatDateLong,
  formatDateShort,
  formatDayTitle,
  formatTime,
  parseDate,
} from '../utils/date';
import { photoOrientation, photoRotation, rotatePhoto } from '../utils/orientation';
import { useToast } from '../hooks/useToast';
import { Modal } from './Modal';
import { SafeImage } from './SafeImage';
import { WorldPanel } from './WorldPanel';

interface PhotoDetailDialogProps {
  photos: Photo[];
  activeId: string | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Photo>) => void;
  onDelete: (id: string) => void;
  featuredId: string | null;
  onToggleFeatured: (id: string) => void;
  library: WorldLibraryEntry[];
  apiBase: string;
  onOpenAdmin?: () => void;
}

type PendingAction = { type: 'close' } | { type: 'navigate'; id: string } | null;

type OriginalState = 'none' | 'loading' | 'ready' | 'error';

export function PhotoDetailDialog({
  photos,
  activeId,
  onClose,
  onNavigate,
  onUpdate,
  onDelete,
  featuredId,
  onToggleFeatured,
  library,
  apiBase,
  onOpenAdmin,
}: PhotoDetailDialogProps) {
  const { pushToast } = useToast();
  const bridge = getDesktopBridge();
  const mobileCast = useMobileCast();
  const photo = activeId ? (photos.find((item) => item.id === activeId) ?? null) : null;
  const index = photo ? photos.findIndex((item) => item.id === photo.id) : -1;
  const prevPhoto = index > 0 ? photos[index - 1] : null;
  const nextPhoto = index >= 0 && index < photos.length - 1 ? photos[index + 1] : null;
  const [noteDraft, setNoteDraft] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [guard, setGuard] = useState<PendingAction>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [worldRunning, setWorldRunning] = useState(false);
  const [orientationRunning, setOrientationRunning] = useState(false);
  const [loadedOriginal, setLoadedOriginal] = useState<string | null>(null);
  const [failedOriginal, setFailedOriginal] = useState<string | null>(null);
  const [mobileBusy, setMobileBusy] = useState<'save' | 'share' | null>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const photoIdRef = useRef<string | null>(null);
  const dirty = noteDraft !== savedNote;
  const mobileLocal = isMobileRuntime() && Boolean(photo?.libraryPath);

  useEffect(() => {
    setTagDraft('');
  }, [photo?.id]);

  const addTag = () => {
    if (!photo) return;
    const tag = normalizePhotoTag(tagDraft);
    if (!tag) return;
    const tags = normalizePhotoTags([...(photo.tags || []), tag]);
    onUpdate(photo.id, { tags });
    setTagDraft('');
  };

  const removeTag = (tag: string) => {
    if (!photo) return;
    onUpdate(photo.id, {
      tags: normalizePhotoTags((photo.tags || []).filter((item) => item !== tag)),
    });
  };

  const setAsWallpaper = async () => {
    if (!photo?.libraryPath || wallpaperBusy) return;
    if (!bridge?.wallpaper) {
      pushToast({
        tone: 'danger',
        title: '当前环境不支持设置壁纸',
        description: '请使用桌面 Windows 客户端打开存储库照片。',
      });
      return;
    }
    setWallpaperBusy(true);
    try {
      const result = await bridge.wallpaper.set({ libraryPath: photo.libraryPath });
      pushToast(
        result.ok
          ? {
              tone: 'success',
              title: '已设为桌面壁纸',
              description: result.path,
            }
          : {
              tone: 'danger',
              title: '设置壁纸失败',
              description: result.error,
            },
      );
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '设置壁纸失败',
        description: error instanceof Error ? error.message : '请重试。',
      });
    } finally {
      setWallpaperBusy(false);
    }
  };

  const handleMobileSave = async () => {
    if (!photo || mobileBusy) return;
    setMobileBusy('save');
    try {
      const result = await saveManagedPhoto(photo);
      pushToast(
        result.ok
          ? {
              tone: 'success',
              title: '已保存到手机',
              description: result.location || '可在系统相册 / 下载目录查看。',
            }
          : { tone: 'danger', title: '保存失败', description: result.error },
      );
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '保存失败',
        description: error instanceof Error ? error.message : '请重试。',
      });
    } finally {
      setMobileBusy(null);
    }
  };

  const handleMobileShare = async () => {
    if (!photo || mobileBusy) return;
    setMobileBusy('share');
    try {
      const result = await shareManagedPhotos([photo]);
      if (!result.ok) {
        pushToast({ tone: 'danger', title: '分享失败', description: result.error });
      }
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '分享失败',
        description: error instanceof Error ? error.message : '请重试。',
      });
    } finally {
      setMobileBusy(null);
    }
  };

  useEffect(() => {
    if (!photo) {
      photoIdRef.current = null;
      setNoteDraft('');
      setSavedNote('');
      setGuard(null);
      setConfirmingDelete(false);
      return;
    }
    if (photoIdRef.current !== photo.id) {
      photoIdRef.current = photo.id;
      setNoteDraft(photo.note);
      setSavedNote(photo.note);
      setGuard(null);
      setConfirmingDelete(false);
    }
  }, [photo]);

  const requestClose = () => {
    if (dirty) {
      setGuard({ type: 'close' });
      return;
    }
    onClose();
  };

  const requestNavigate = (id: string | null | undefined) => {
    if (!id) return;
    if (dirty) {
      setGuard({ type: 'navigate', id });
      return;
    }
    onNavigate(id);
  };

  const proceed = (saveFirst: boolean) => {
    const action = guard;
    if (saveFirst && photo && dirty) {
      const trimmed = noteDraft.trim();
      onUpdate(photo.id, { note: trimmed });
      setSavedNote(trimmed);
      setNoteDraft(trimmed);
      pushToast({ tone: 'success', title: '备注已保存' });
    }
    setGuard(null);
    if (!action) return;
    if (action.type === 'close') onClose();
    else onNavigate(action.id);
  };

  const saveNote = () => {
    if (!photo) return;
    const trimmed = noteDraft.trim();
    onUpdate(photo.id, { note: trimmed });
    setSavedNote(trimmed);
    setNoteDraft(trimmed);
    pushToast({
      tone: 'success',
      title: '备注已保存',
      description: '这段记忆的文字已经更新。',
    });
  };

  const discardNote = () => {
    setNoteDraft(savedNote);
  };

  const generateAiSummary = async () => {
    if (!bridge || !photo || aiRunning) return;
    setAiRunning(true);
    onUpdate(photo.id, { aiState: 'running', aiError: undefined });
    try {
      const result = await bridge.ai.generate({
        item: {
          id: photo.id,
          previewPath: photo.previewPath,
          libraryPath: photo.libraryPath,
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
        context: {
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
      });
      if (result.ok) {
        onUpdate(photo.id, {
          aiSummary: result.summary,
          aiTags: result.tags,
          aiModel: result.model,
          aiUpdatedAt: result.generatedAt,
          aiState: 'done',
          aiError: undefined,
        });
        pushToast({
          tone: 'success',
          title: 'AI 回忆总结已生成',
          description: result.model ? `模型：${result.model}` : undefined,
        });
      } else {
        onUpdate(photo.id, {
          aiState: 'error',
          aiError: result.error || 'AI 生成失败。',
        });
        pushToast({
          tone: 'danger',
          title: 'AI 生成失败',
          description: result.error || '请检查高级设置中的 API 与模型。',
        });
      }
    } catch (error) {
      onUpdate(photo.id, {
        aiState: 'error',
        aiError: (error as Error).message,
      });
      pushToast({
        tone: 'danger',
        title: 'AI 生成失败',
        description: (error as Error).message,
      });
    } finally {
      setAiRunning(false);
    }
  };

  const detectOrientationAI = async () => {
    if (!bridge || !photo || orientationRunning) return;
    setOrientationRunning(true);
    try {
      const result = await bridge.ai.detectOrientation({
        item: {
          id: photo.id,
          previewPath: photo.previewPath,
          libraryPath: photo.libraryPath,
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
      });
      if (result.ok && typeof result.rotation === 'number') {
        onUpdate(photo.id, {
          rotation: result.rotation === 0 ? undefined : result.rotation,
        });
        pushToast({
          tone: 'success',
          title:
            result.rotation === 0
              ? 'AI 判断为正向风景照'
              : 'AI 已校正照片方向',
          description:
            result.rotation === 0
              ? '没有人物主体，按 16:9 风景照保持横图。'
              : `检测到角色头顶朝 ${
                  result.head === 'right'
                    ? '右'
                    : result.head === 'left'
                      ? '左'
                      : result.head === 'down'
                        ? '下'
                        : '上'
                }，已旋转 ${result.rotation}°${result.model ? ` · ${result.model}` : ''}`,
        });
      } else {
        pushToast({
          tone: 'warning',
          title: 'AI 未能判断方向',
          description:
            result.error ||
            '请先在高级设置选择视觉模型，或使用手动旋转按钮。',
        });
      }
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: 'AI 方向检测失败',
        description: (error as Error).message,
      });
    } finally {
      setOrientationRunning(false);
    }
  };

  const recognizeWorldId = async () => {    if (!bridge || !photo || worldRunning) return;
    setWorldRunning(true);
    try {
      const result = await bridge.ai.recognizeWorldId({
        item: {
          id: photo.id,
          previewPath: photo.previewPath,
          libraryPath: photo.libraryPath,
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
      });
      if (result.ok && result.worldId) {
        onUpdate(photo.id, {
          worldId: result.worldId,
          world: {
            id: result.worldId,
            name: result.worldName || `待补充世界 · ${result.worldId.slice(0, 16)}`,
            source: 'local',
          },
          worldLookup: 'resolved',
          worldIdSource: 'ai',
        });
        pushToast({
          tone: 'success',
          title: 'AI 已识别画面上的 World ID',
          description: `${result.worldName || result.worldId}${result.model ? ` · ${result.model}` : ''}`,
        });
      } else {
        pushToast({
          tone: 'warning',
          title: '没有识别到 World ID',
          description: result.error || '请确认图片上的文字清晰可见。',
        });
      }
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: 'World ID 识别失败',
        description: (error as Error).message,
      });
    } finally {
      setWorldRunning(false);
    }
  };

  const handleDelete = () => {
    if (!photo) return;
    onDelete(photo.id);
    onClose();
  };

  useEffect(() => {
    if (!photo) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (guard) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'ArrowLeft' && prevPhoto) {
        event.preventDefault();
        requestNavigate(prevPhoto.id);
      } else if (event.key === 'ArrowRight' && nextPhoto) {
        event.preventDefault();
        requestNavigate(nextPhoto.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!photo) return null;

  const captured = parseDate(photo.capturedAt);
  const isFeatured = featuredId === photo.id;
  const rotation = photoRotation(photo);
  const orientation = photoOrientation(photo);
  const orientationLabel =
    orientation === 'portrait' ? '竖图' : orientation === 'square' ? '方图' : '横图';
  const rotate = (delta: -90 | 90) => {
    const next = rotatePhoto(rotation, delta);
    onUpdate(photo.id, { rotation: next === 0 ? undefined : next });
  };
  const thumbnailSrc = photo.missing ? null : photoSrc(photo) || null;
  const isLibraryPhoto = photo.mediaKind === 'library';
  // Derived from the current photo, so switching photos immediately drops the
  // previous original instead of flashing it over the new thumbnail.
  const originalUrl = photoOriginalSrc(photo);
  const originalState: OriginalState = !originalUrl
    ? 'none'
    : loadedOriginal === originalUrl
      ? 'ready'
      : failedOriginal === originalUrl
        ? 'error'
        : 'loading';

  return (
    <Modal
      open
      onClose={requestClose}
      labelledBy="photo-detail-title"
      className="detail-modal"
    >
      <div className="detail-grid">
        <figure className={`detail-media detail-media--rotate-${rotation}`}>
          <SafeImage
            className="detail-media__bg"
            src={thumbnailSrc}
            alt=""
            aria-hidden="true"
            fallback={null}
          />
          <SafeImage
            className="detail-media__image"
            src={thumbnailSrc}
            alt={photo.alt}
            width={photo.width ?? 1600}
            height={photo.height ?? 1200}
            loading="eager"
            decoding="async"
            fallback={
              <span className="detail-media__missing">
                <ImageOff size={30} aria-hidden="true" />
                <span>{photo.missing ? '原图不在存储库中' : '缩略图正在生成…'}</span>
              </span>
            }
          />
          {originalUrl && originalState !== 'error' ? (
            <img
              key={originalUrl}
              className={`detail-media__image detail-media__image--original${
                originalState === 'ready' ? ' is-loaded' : ''
              }`}
              src={originalUrl}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              fetchPriority="high"
              draggable={false}
              onLoad={() => setLoadedOriginal(originalUrl)}
              onError={() => setFailedOriginal(originalUrl)}
            />
          ) : null}
          <span className="detail-media__veil" aria-hidden="true" />

          <div className="detail-media__top">
            <span className="detail-memory-no">MEMORY {String(index + 1).padStart(2, '0')}</span>
            <span className="detail-media__badges">
              {photo.isUploaded ? (
                <span className={`detail-local${photo.isRemote ? ' is-remote' : ''}`}>
                  {photo.isRemote
                    ? '网络链接照片'
                    : isLibraryPhoto
                      ? '存储库照片'
                      : '浏览器本地照片'}
                </span>
              ) : null}
              {isLibraryPhoto && !photo.missing ? (
                <span className={`detail-original-state is-${originalState}`}>
                  {originalState === 'ready'
                    ? '原图'
                    : originalState === 'loading'
                      ? '原图加载中'
                      : originalState === 'error'
                        ? '原图不可用'
                        : '缩略图'}
                </span>
              ) : null}
            </span>
          </div>

          <figcaption className="detail-media__caption">
            <p className="detail-media__date">
              <time dateTime={photo.capturedAt}>{formatDateLong(photo.capturedAt)}</time>
            </p>
            <p className="detail-media__place">
              <span className="detail-media__place-dot" aria-hidden="true" />
              {photo.world?.name ?? (photo.worldId ? '世界待识别' : '未关联世界')}
            </p>
          </figcaption>

          <div className="detail-pager" aria-label="照片切换">
            <button
              type="button"
              onClick={() => requestNavigate(prevPhoto?.id)}
              disabled={!prevPhoto}
              aria-label="上一张照片"
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              {index + 1} <span aria-hidden="true">/</span> {photos.length}
            </span>
            <button
              type="button"
              onClick={() => requestNavigate(nextPhoto?.id)}
              disabled={!nextPhoto}
              aria-label="下一张照片"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </figure>

        <div className="detail-body">
          <header className="detail-header">
            <p className="eyebrow detail-eyebrow">
              <Sparkles size={13} aria-hidden="true" />
              MEMORY ARCHIVE
              <span className="eyebrow__divider" aria-hidden="true" />
              {captured.getFullYear()}
            </p>
            <h2 className="detail-title" id="photo-detail-title">
              {formatDayTitle(photo.capturedAt)}
              <span className="detail-title__year">{captured.getFullYear()}</span>
            </h2>
            <p className="detail-meta">
              {formatDateLong(photo.capturedAt)}
              <span aria-hidden="true">·</span>
              {formatTime(photo.capturedAt)} 拍摄
              <span aria-hidden="true">·</span>
              收录于 {formatDateShort(photo.createdAt)}
            </p>
            <button
              type="button"
              className={`detail-pin${isFeatured ? ' is-active' : ''}`}
              onClick={() => onToggleFeatured(photo.id)}
              aria-pressed={isFeatured}
              title={isFeatured ? '取消这张照片的首页置顶' : '把这张照片放到首页开头的置顶位置'}
            >
              {isFeatured ? (
                <PinOff size={13} strokeWidth={1.8} aria-hidden="true" />
              ) : (
                <Pin size={13} strokeWidth={1.8} aria-hidden="true" />
              )}
              {isFeatured ? '已置顶 · 取消' : '设为首页置顶'}
            </button>
            <button
              type="button"
              className={`detail-pin${photo.favorite ? ' is-active' : ''}`}
              onClick={() =>
                onUpdate(photo.id, { favorite: photo.favorite ? undefined : true })
              }
              aria-pressed={photo.favorite === true}
              title={photo.favorite ? '取消收藏' : '收藏这张照片'}
            >
              <Star size={13} strokeWidth={1.8} aria-hidden="true" />
              {photo.favorite ? '已收藏 · 取消' : '收藏'}
            </button>
            {photo.libraryPath && !mobileLocal && bridge?.wallpaper ? (
              <button
                type="button"
                className="detail-pin"
                onClick={() => void setAsWallpaper()}
                disabled={wallpaperBusy}
                title="把这张原图设为 Windows 桌面壁纸"
              >
                {wallpaperBusy ? (
                  <Loader2 size={13} className="spin" aria-hidden="true" />
                ) : (
                  <Monitor size={13} strokeWidth={1.8} aria-hidden="true" />
                )}
                {wallpaperBusy ? '设置中…' : '设为壁纸'}
              </button>
            ) : null}
            {mobileCast.running ? (
              <button
                type="button"
                className="detail-cast"
                onClick={() =>
                  void mobileCast.cast(
                    photo.id,
                    photo.note.trim() || formatDateShort(photo.capturedAt),
                  )
                }
                title="把这张照片投送到已连接的手机"
              >
                <Smartphone size={13} strokeWidth={1.8} aria-hidden="true" />
                投送到手机
              </button>
            ) : null}
            {mobileLocal ? (
              <span className="detail-mobile-actions">
                <button
                  type="button"
                  className="detail-cast"
                  onClick={() => void handleMobileSave()}
                  disabled={mobileBusy !== null}
                >
                  {mobileBusy === 'save' ? (
                    <Loader2 size={13} className="spin" aria-hidden="true" />
                  ) : (
                    <Download size={13} strokeWidth={1.8} aria-hidden="true" />
                  )}
                  保存到手机
                </button>
                <button
                  type="button"
                  className="detail-cast"
                  onClick={() => void handleMobileShare()}
                  disabled={mobileBusy !== null}
                >
                  {mobileBusy === 'share' ? (
                    <Loader2 size={13} className="spin" aria-hidden="true" />
                  ) : (
                    <Share2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  )}
                  分享
                </button>
              </span>
            ) : null}
          </header>

          <section className="note-editor" aria-labelledby="note-editor-title">
            <div className="detail-section-head">
              <div>
                <p className="section-kicker">MEMORY NOTE</p>
                <h3 id="note-editor-title">这段记忆的备注</h3>
              </div>
              <span className="char-count">{noteDraft.length}/240</span>
            </div>
            <textarea
              className="note-textarea"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              maxLength={240}
              rows={4}
              placeholder="写下当时的风、光线，或想再对他说的话…"
              aria-label="照片备注"
            />
            <div className="note-editor__actions">
              <span className={`save-state${dirty ? ' is-dirty' : ''}`} aria-live="polite">
                <span className="save-state__dot" aria-hidden="true" />
                {dirty ? '有未保存的修改' : '已保存'}
              </span>
              <div className="note-editor__buttons">
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={discardNote}
                  disabled={!dirty}
                >
                  撤销
                </button>
                <button
                  type="button"
                  className="button button--primary button--tiny"
                  onClick={saveNote}
                  disabled={!dirty}
                >
                  保存变更
                </button>
              </div>
            </div>
          </section>

          <section className="detail-tags" aria-labelledby="detail-tags-title">
            <div className="detail-section-head">
              <div>
                <p className="section-kicker">MY TAGS</p>
                <h3 id="detail-tags-title">我的标签</h3>
              </div>
              <span className="char-count">{(photo.tags || []).length}/20</span>
            </div>
            <div className="detail-tags__list">
              {(photo.tags || []).length === 0 ? (
                <p className="detail-tags__empty">还没有自定义标签，可以按心情、角色或场景添加。</p>
              ) : null}
              {(photo.tags || []).map((tag) => (
                <button
                  type="button"
                  className="detail-tag"
                  key={tag}
                  onClick={() => removeTag(tag)}
                  title="点击移除这个标签"
                >
                  {tag}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <div className="detail-tags__add">
              <input
                type="text"
                value={tagDraft}
                maxLength={24}
                placeholder="添加标签，如：夜景、合影"
                aria-label="添加标签"
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                type="button"
                className="button button--ghost button--tiny"
                onClick={addTag}
                disabled={!tagDraft.trim() || (photo.tags || []).length >= 20}
              >
                添加
              </button>
            </div>
          </section>

          <section className="detail-orientation" aria-labelledby="detail-orientation-title">
            <div className="detail-section-head">
              <div>
                <p className="section-kicker">ORIENTATION</p>
                <h3 id="detail-orientation-title">照片方向</h3>
              </div>
              <span className="detail-orientation__state">
                {orientationLabel}
                {rotation ? ` · 已旋转 ${rotation}°` : ''}
              </span>
            </div>
            <p className="detail-orientation__hint">
              手机竖拍的照片有时会被保存成横向文件（画面内容旋转了 90°），文件本身没有旋转标记。
              这里可以手动校正；只改变相册显示，不会修改或重写原图。
            </p>
            <div className="detail-orientation__actions">
              <button
                type="button"
                className="button button--soft button--tiny"
                onClick={() => rotate(-90)}
              >
                <RotateCcw size={13} aria-hidden="true" />
                向左旋转 90°
              </button>
              <button
                type="button"
                className="button button--soft button--tiny"
                onClick={() => rotate(90)}
              >
                <RotateCw size={13} aria-hidden="true" />
                向右旋转 90°
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => onUpdate(photo.id, { rotation: undefined })}
                disabled={rotation === 0}
              >
                重置方向
              </button>
              {bridge && photo.mediaKind === 'library' && !photo.missing ? (
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={() => void detectOrientationAI()}
                  disabled={orientationRunning}
                  title="用已配置的视觉模型判断角色头顶方向；风景照保持 16:9 不旋转"
                >
                  {orientationRunning ? (
                    <Loader2 size={13} className="spinner" aria-hidden="true" />
                  ) : (
                    <Sparkles size={13} aria-hidden="true" />
                  )}
                  AI 检测方向
                </button>
              ) : null}
            </div>
          </section>

          {bridge && photo.mediaKind === 'library' ? (
            <section className="detail-ai" aria-labelledby="detail-ai-title">
              <div className="detail-section-head">
                <div>
                  <p className="section-kicker">AI MEMORY</p>
                  <h3 id="detail-ai-title">AI 回忆总结</h3>
                </div>
                {photo.aiState === 'running' || aiRunning ? (
                  <span className="detail-ai__state">
                    <Loader2 size={12} className="spinner" aria-hidden="true" />
                    生成中
                  </span>
                ) : photo.aiModel ? (
                  <span className="detail-ai__state">{photo.aiModel}</span>
                ) : null}
              </div>
              {photo.aiSummary ? (
                <>
                  <p className="detail-ai__summary">{photo.aiSummary}</p>
                  {photo.aiTags?.length ? (
                    <div className="detail-ai__tags">
                      {photo.aiTags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="detail-ai__empty">
                  {photo.aiState === 'running'
                    ? '正在观察这张照片，稍等片刻…'
                    : '还没有 AI 总结，可以用视觉模型为这张照片写一段回忆。'}
                </p>
              )}
              {photo.aiError ? (
                <p className="detail-ai__error" role="alert">
                  {photo.aiError}
                </p>
              ) : null}
              {photo.worldIdSource === 'ai' && photo.world ? (
                <p className="detail-ai__world">
                  AI 已从画面文字识别 World ID：{photo.world.name}
                </p>
              ) : null}
              <div className="detail-ai__actions">
                <button
                  type="button"
                  className="button button--soft button--tiny"
                  onClick={() => void generateAiSummary()}
                  disabled={aiRunning || photo.aiState === 'running'}
                >
                  {aiRunning ? (
                    <Loader2 size={13} className="spinner" aria-hidden="true" />
                  ) : (
                    <Sparkles size={13} aria-hidden="true" />
                  )}
                  {photo.aiSummary ? '重新生成总结' : '用 AI 生成总结'}
                </button>
                {!photo.worldId || !photo.world || photo.worldLookup === 'failed' ? (
                  <button
                    type="button"
                    className="button button--ghost button--tiny"
                    onClick={() => void recognizeWorldId()}
                    disabled={worldRunning}
                  >
                    {worldRunning ? (
                      <Loader2 size={13} className="spinner" aria-hidden="true" />
                    ) : (
                      <ScanText size={13} aria-hidden="true" />
                    )}
                    AI 识别画面 World ID
                  </button>
                ) : null}
                {photo.aiSummary ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      onUpdate(photo.id, {
                        aiSummary: undefined,
                        aiTags: undefined,
                        aiModel: undefined,
                        aiUpdatedAt: undefined,
                        aiState: 'none',
                        aiError: undefined,
                      })
                    }
                  >
                    清除总结
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          <WorldPanel
            photo={photo}
            onUpdate={(patch) => onUpdate(photo.id, patch)}
            library={library}
            apiBase={apiBase}
            onOpenAdmin={onOpenAdmin}
          />

          <section className="detail-danger" aria-label="危险操作">
            {confirmingDelete ? (
              <div className="inline-confirm" role="alert">
                <p>删除后，这段记忆将从时间轴和浏览器本地存储中消失，无法撤销。</p>
                <div className="inline-confirm__actions">
                  <button
                    type="button"
                    className="button button--danger button--tiny"
                    onClick={handleDelete}
                  >
                    确认删除
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--tiny"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-button text-button--danger detail-delete"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 size={14} />
                删除这张照片
              </button>
            )}

            {photo.mediaKind === 'library' && photo.libraryPath ? (
              <button
                type="button"
                className="text-button detail-reveal"
                onClick={() => {
                  void getDesktopBridge()?.library.revealFile(photo.libraryPath as string);
                }}
              >
                <FolderOpen size={14} />
                在文件夹中显示
              </button>
            ) : null}
          </section>

          <p className="detail-storage-note">
            {photo.mediaKind === 'library'
              ? photo.missing
                ? '原图已不在存储库中，当前只保留相册记录、备注与缩略图缓存。'
                : '列表只读取缩略图缓存；刚才打开这张照片时才加载原图。原图始终只读，不会被修改、压缩或上传。'
              : photo.isRemote
                ? '图片链接与备注保存在你的浏览器本地；图片由原站提供，打开页面时会产生网络请求。'
                : '照片与备注保存在你的浏览器本地（localStorage），不会上传到任何服务器。'}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="detail-close icon-button"
        onClick={requestClose}
        aria-label="关闭照片详情"
        data-autofocus
      >
        <X size={18} />
      </button>

      {guard ? (
        <div className="detail-guard" role="alert">
          <p>
            {guard.type === 'close'
              ? '备注还没有保存，确定要关闭吗？'
              : '备注还没有保存，切换照片会丢失修改。'}
          </p>
          <div className="detail-guard__actions">
            <button
              type="button"
              className="text-button"
              onClick={() => setGuard(null)}
            >
              继续编辑
            </button>
            <button type="button" className="button button--soft button--tiny" onClick={() => proceed(true)}>
              保存并继续
            </button>
            <button
              type="button"
              className="button button--danger button--tiny"
              onClick={() => proceed(false)}
            >
              {guard.type === 'close' ? '放弃并关闭' : '放弃并切换'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
