import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  Globe2,
  ImageOff,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Photo } from '../types';
import { photoSrc } from '../platform';
import { useThumbnailLoader } from '../hooks/useThumbnailLoader';
import { useMobileCast } from '../hooks/useMobileCast';
import { formatDateShort, formatTime } from '../utils/date';
import { photoOrientation, photoRotation } from '../utils/orientation';
import { SafeImage } from './SafeImage';

const CAST_ARM_MS = 380;
const CAST_THRESHOLD = 56;

interface PhotoCardProps {
  photo: Photo;
  index: number;
  pinned: boolean;
  onTogglePin: () => void;
  onRotate: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

export function PhotoCard({
  photo,
  index,
  pinned,
  onTogglePin,
  onRotate,
  onOpen,
  onDelete,
}: PhotoCardProps) {
  const pending = !photo.world && Boolean(photo.worldId);
  const imageSrc = photo.missing ? null : photoSrc(photo) || null;
  const gate = useThumbnailLoader(photo.id, index, imageSrc);
  const orientation = photoOrientation(photo);
  const rotation = photoRotation(photo);
  const mobileCast = useMobileCast();
  const canCast = mobileCast.running;
  const [castPhase, setCastPhase] = useState<'idle' | 'armed' | 'drag'>('idle');
  const [castDistance, setCastDistance] = useState(0);
  const articleRef = useRef<HTMLElement | null>(null);
  const suppressClick = useRef(false);
  const gesture = useRef({
    timer: 0,
    startX: 0,
    startY: 0,
    dy: 0,
    armed: false,
    pointerId: -1,
  });
  const castLabel = photo.note.trim() || `${formatDateShort(photo.capturedAt)} 的照片`;
  const castPhoto = () => {
    void mobileCast.cast(photo.id, castLabel);
  };
  const castPhotoRef = useRef(castPhoto);
  castPhotoRef.current = castPhoto;

  const disarmCast = (allowFire: boolean) => {
    const state = gesture.current;
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = 0;
    }
    const shouldFire = allowFire && state.armed && state.dy >= CAST_THRESHOLD;
    if (state.armed) {
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 700);
    }
    state.armed = false;
    state.dy = 0;
    state.pointerId = -1;
    setCastPhase('idle');
    setCastDistance(0);
    if (shouldFire) castPhotoRef.current();
  };

  // Touch needs a non-passive touchmove listener so a long-press can take over
  // the gesture before the browser starts scrolling the timeline.
  useEffect(() => {
    const element = articleRef.current;
    if (!element || !canCast) return;
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let armed = false;

    const arm = () => {
      timer = 0;
      armed = true;
      gesture.current.armed = true;
      setCastPhase('armed');
      try {
        navigator.vibrate?.(10);
      } catch {
        // Vibration is a nicety; iOS Safari does not support it.
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button')) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      armed = false;
      gesture.current.dy = 0;
      gesture.current.armed = false;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(arm, CAST_ARM_MS);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!armed) {
        if (event.touches.length === 1 && timer) {
          const dx = event.touches[0].clientX - startX;
          const dy = event.touches[0].clientY - startY;
          if (Math.hypot(dx, dy) > 9) {
            window.clearTimeout(timer);
            timer = 0;
          }
        }
        return;
      }
      if (event.cancelable) event.preventDefault();
      const dy = Math.max(0, startY - event.touches[0].clientY);
      gesture.current.dy = dy;
      setCastDistance(dy);
      setCastPhase(dy > 0 ? 'drag' : 'armed');
    };

    const onTouchEnd = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      if (!armed && !gesture.current.armed) return;
      disarmCast(true);
      armed = false;
    };

    const onTouchCancel = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      if (!armed && !gesture.current.armed) return;
      disarmCast(false);
      armed = false;
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchCancel);
    return () => {
      if (timer) window.clearTimeout(timer);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [canCast]);

  useEffect(
    () => () => {
      if (gesture.current.timer) window.clearTimeout(gesture.current.timer);
    },
    [],
  );

  useEffect(() => {
    if (!canCast) {
      setCastPhase('idle');
      setCastDistance(0);
    }
  }, [canCast]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!canCast || event.pointerType === 'touch' || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('button')) return;
    const state = gesture.current;
    if (state.timer) window.clearTimeout(state.timer);
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.dy = 0;
    state.armed = false;
    state.pointerId = event.pointerId;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      state.armed = true;
      try {
        articleRef.current?.setPointerCapture(state.pointerId);
      } catch {
        // Capture is best-effort; the card still handles pointerup if capture fails.
      }
      setCastPhase('armed');
      try {
        navigator.vibrate?.(10);
      } catch {
        // Ignore unsupported vibration APIs.
      }
    }, CAST_ARM_MS);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = gesture.current;
    if (state.pointerId !== event.pointerId || !state.armed) return;
    if (event.cancelable) event.preventDefault();
    const dy = Math.max(0, state.startY - event.clientY);
    state.dy = dy;
    setCastDistance(dy);
    setCastPhase(dy > 0 ? 'drag' : 'armed');
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const state = gesture.current;
    if (state.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may not have been established.
    }
    if (state.armed) {
      disarmCast(true);
    } else if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = 0;
      state.pointerId = -1;
    }
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    const state = gesture.current;
    if (state.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may not have been established.
    }
    if (state.armed) disarmCast(false);
    state.pointerId = -1;
  };

  const kind =
    photo.world?.source === 'manual'
      ? '手动'
      : photo.world?.source === 'demo'
        ? '内置'
        : pending
          ? '待识别'
          : null;

  return (
    <>
    <article
      ref={articleRef}
      className={`photo-card photo-card--${orientation} photo-card--rotate-${rotation}${
        pinned ? ' is-pinned' : ''
      }${castPhase !== 'idle' ? ' is-casting' : ''}`}
      data-orientation={orientation}
      data-rotation={rotation}
      data-photo-id={photo.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <button
        type="button"
        className="photo-card__hit"
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          onOpen();
        }}
        aria-label={`打开 ${formatDateShort(photo.capturedAt)} ${formatTime(photo.capturedAt)} 的记忆：${
          photo.note || photo.alt
        }`}
      />
      <div className="photo-card__media" ref={gate.ref}>
        <SafeImage
          src={gate.allowed ? imageSrc : null}
          alt={photo.alt}
          width={photo.width ?? 1600}
          height={photo.height ?? 1200}
          decoding="async"
          fetchPriority="low"
          draggable={false}
          fallback={
            photo.missing ? (
              <span className="photo-card__missing" aria-hidden="true">
                <ImageOff size={28} />
              </span>
            ) : (
              <span className="photo-card__pending" aria-hidden="true">
                <span className="photo-card__pending-shine" />
              </span>
            )
          }
        />
        <span className="photo-card__shade" aria-hidden="true" />
        <span className="photo-card__shine" aria-hidden="true" />
        <span className="photo-card__time">
          <span className="photo-card__time-dot" aria-hidden="true" />
          {formatTime(photo.capturedAt)}
        </span>
        {pinned ? (
          <span className="photo-card__pinned-flag">
            <Pin size={9} strokeWidth={2} aria-hidden="true" />
            置顶
          </span>
        ) : null}
        {canCast ? (
          <span className="photo-card__cast-cue" aria-hidden="true">
            <Smartphone size={11} strokeWidth={1.8} />
            长按上滑投送
          </span>
        ) : null}
        <div className="photo-card__actions">
          {canCast ? (
            <button
              type="button"
              className="photo-card__action photo-card__action--cast"
              onClick={(event) => {
                event.stopPropagation();
                castPhoto();
              }}
              aria-label="投送这张照片到手机"
              title="投送到手机"
            >
              <Smartphone size={14} strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            type="button"
            className={`photo-card__action photo-card__action--pin${pinned ? ' is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin();
            }}
            aria-label={pinned ? '取消首页置顶' : '设为首页置顶'}
            aria-pressed={pinned}
            title={pinned ? '取消置顶' : '设为首页置顶'}
          >
            {pinned ? (
              <PinOff size={14} strokeWidth={1.8} />
            ) : (
              <Pin size={14} strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            className="photo-card__action"
            onClick={(event) => {
              event.stopPropagation();
              onRotate();
            }}
            aria-label="向左旋转 90 度（只改变相册显示）"
            title="向左旋转 90°（不改原图）"
          >
            <RotateCcw size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="photo-card__action"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-label="打开并编辑这张照片"
            title="编辑"
          >
            <Pencil size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="photo-card__action photo-card__action--danger"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="删除这张照片"
            title="删除"
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <div className="photo-card__body">
        <div className="photo-card__meta">
          <span className="photo-card__meta-index">MEMORY {String(index).padStart(2, '0')}</span>
          <time dateTime={photo.capturedAt}>{formatDateShort(photo.capturedAt)}</time>
          {photo.isUploaded ? (
            <span className={`photo-card__local${photo.isRemote ? ' is-remote' : ''}`}>
              {photo.isRemote ? '链接' : '本地'}
            </span>
          ) : null}
        </div>

        {photo.aiSummary ? (
          <span className="photo-card__ai">
            <Sparkles size={10} aria-hidden="true" />
            AI 回忆
          </span>
        ) : null}
        <p className={`photo-card__note${photo.note || photo.aiSummary ? '' : ' is-empty'}`}>
          {photo.note || photo.aiSummary || '还没有写下备注。'}
        </p>

        <div className="photo-card__footer">
          {photo.world ? (
            <span className="world-pill" title={photo.world.name}>
              {photo.world.thumbnail ? (
                <SafeImage
                  className="world-pill__thumb"
                  src={photo.world.thumbnail}
                  alt=""
                  width={24}
                  height={24}
                  loading="lazy"
                  fallback={
                    <span
                      className="world-pill__thumb world-pill__thumb--fallback"
                      aria-hidden="true"
                    >
                      <Globe2 size={13} strokeWidth={1.7} />
                    </span>
                  }
                />
              ) : (
                <span className="world-pill__thumb world-pill__thumb--fallback" aria-hidden="true">
                  <Globe2 size={13} strokeWidth={1.7} />
                </span>
              )}
              <span className="world-pill__name">{photo.world.name}</span>
              {kind ? <span className={`world-pill__tag world-pill__tag--${photo.world.source}`}>{kind}</span> : null}
            </span>
          ) : (
            <span className={`world-pill world-pill--empty${pending ? ' is-pending' : ''}`}>
              <span className="world-pill__thumb world-pill__thumb--fallback" aria-hidden="true">
                <Globe2 size={13} strokeWidth={1.7} />
              </span>
              <span className="world-pill__name">{pending ? '世界待识别' : '未关联世界'}</span>
              {pending && kind ? <span className="world-pill__tag world-pill__tag--pending">{kind}</span> : null}
            </span>
          )}
          <span className="photo-card__cta" aria-hidden="true">
            查看
            <ArrowUpRight size={14} strokeWidth={1.8} />
          </span>
        </div>
      </div>

    </article>
    {castPhase !== 'idle'
      ? createPortal(
          <div
            className={`cast-layer${castPhase === 'drag' ? ' is-dragging' : ''}${
              castDistance >= CAST_THRESHOLD ? ' is-ready' : ''
            }`}
            aria-hidden="true"
          >
            <div className="cast-layer__veil" />
            <div className="cast-layer__headline">
              <Smartphone size={15} strokeWidth={1.8} />
              <span>
                {castDistance >= CAST_THRESHOLD
                  ? '松手，投送到手机'
                  : castPhase === 'armed'
                    ? '继续向上滑'
                    : '向上滑，投送到手机'}
              </span>
            </div>
            <div
              className="cast-layer__thumb"
              style={
                {
                  '--cast-lift': `${Math.min(210, castDistance)}px`,
                  '--cast-progress': Math.min(1, castDistance / CAST_THRESHOLD),
                } as CSSProperties
              }
            >
              {imageSrc ? <img src={imageSrc} alt="" draggable={false} /> : null}
            </div>
            <div className="cast-layer__dock">
              <span className="cast-layer__dock-ring">
                <Smartphone size={20} strokeWidth={1.5} />
              </span>
              <strong>投送到手机</strong>
              <small>保持手机页面打开 · 松手后立即送达</small>
            </div>
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
