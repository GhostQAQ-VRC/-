import { Globe2, ImageOff, Pencil, Pin, PinOff, Sparkles, Trash2, ArrowUpRight } from 'lucide-react';
import type { Photo } from '../types';
import { photoSrc } from '../platform';
import { useThumbnailLoader } from '../hooks/useThumbnailLoader';
import { formatDateShort, formatTime } from '../utils/date';
import { photoOrientation } from '../utils/orientation';
import { SafeImage } from './SafeImage';

interface PhotoCardProps {
  photo: Photo;
  index: number;
  pinned: boolean;
  onTogglePin: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

export function PhotoCard({ photo, index, pinned, onTogglePin, onOpen, onDelete }: PhotoCardProps) {
  const pending = !photo.world && Boolean(photo.worldId);
  const imageSrc = photo.missing ? null : photoSrc(photo) || null;
  const gate = useThumbnailLoader(photo.id, index, imageSrc);
  const orientation = photoOrientation(photo);
  const kind =
    photo.world?.source === 'manual'
      ? '手动'
      : photo.world?.source === 'demo'
        ? '内置'
        : pending
          ? '待识别'
          : null;

  return (
    <article
      className={`photo-card photo-card--${orientation}${pinned ? ' is-pinned' : ''}`}
      data-orientation={orientation}
    >
      <button
        type="button"
        className="photo-card__hit"
        onClick={onOpen}
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
        <div className="photo-card__actions">
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
  );
}
