import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  Pause,
  Play,
  Shuffle,
  X,
} from 'lucide-react';
import type { Photo } from '../types';
import { photoSrc } from '../platform';
import { useLockBodyScroll } from '../hooks/useDialog';
import { formatDateLong, formatTime } from '../utils/date';
import { StarGlyph } from './StarGlyph';
import { SafeImage } from './SafeImage';
import '../styles/slideshow.css';

interface SlideshowProps {
  open: boolean;
  photos: Photo[];
  onClose: () => void;
}

type SlideshowMode = 'all' | 'today';

function isOnThisDay(photo: Photo, today: Date): boolean {
  if (!photo.capturedAt) return false;
  const date = new Date(photo.capturedAt);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate() &&
    date.getFullYear() !== today.getFullYear()
  );
}

/**
 * Full-screen memory slideshow. Uses generated previews (not originals) so a
 * long-running slideshow does not decode dozens of full-resolution files.
 */
export function Slideshow({ open, photos, onClose }: SlideshowProps) {
  const today = useMemo(() => new Date(), []);
  const todayPhotos = useMemo(
    () => photos.filter((photo) => isOnThisDay(photo, today)),
    [photos, today],
  );
  const [mode, setMode] = useState<SlideshowMode>('all');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [intervalSec, setIntervalSec] = useState(6);
  const [shuffle, setShuffle] = useState(false);
  const [showInfo, setShowInfo] = useState(true);

  useLockBodyScroll(open);

  const active = mode === 'today' ? todayPhotos : photos;
  const photo = active[index] ?? null;

  const advance = useCallback(
    (direction: 1 | -1) => {
      if (active.length === 0) return;
      setIndex((current) => {
        if (active.length === 1) return 0;
        if (shuffle && direction === 1) {
          let next = Math.floor(Math.random() * (active.length - 1));
          if (next >= current) next += 1;
          return next;
        }
        return (current + direction + active.length) % active.length;
      });
    },
    [active.length, shuffle],
  );

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setPlaying(true);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [mode]);

  useEffect(() => {
    if (index >= active.length && active.length > 0) setIndex(0);
  }, [active.length, index]);

  useEffect(() => {
    if (!open || !playing || active.length < 2) return undefined;
    const timer = window.setInterval(() => advance(1), Math.max(2, intervalSec) * 1000);
    return () => window.clearInterval(timer);
  }, [open, playing, intervalSec, active.length, advance]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        advance(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        advance(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, advance]);

  if (!open) return null;

  const progress = active.length > 0 ? ((index + 1) / active.length) * 100 : 0;

  return createPortal(
    <div
      className={`slideshow${playing ? ' is-playing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="回忆幻灯片"
    >
      <div className="slideshow__backdrop" aria-hidden="true" />
      <div className="slideshow__vignette" aria-hidden="true" />

      <header className="slideshow__top">
        <div className="slideshow__brand">
          <StarGlyph size={14} />
          <span>回忆幻灯片</span>
        </div>
        <div className="slideshow__modes" role="group" aria-label="幻灯片范围">
          <button
            type="button"
            className={mode === 'all' ? 'is-active' : ''}
            onClick={() => setMode('all')}
          >
            全部 · {photos.length}
          </button>
          <button
            type="button"
            className={mode === 'today' ? 'is-active' : ''}
            onClick={() => setMode('today')}
          >
            今天 · {todayPhotos.length}
          </button>
        </div>
        <div className="slideshow__top-actions">
          <button
            type="button"
            className={showInfo ? 'is-active' : ''}
            onClick={() => setShowInfo((value) => !value)}
            aria-pressed={showInfo}
            aria-label="照片信息"
            title="照片信息"
          >
            <Info size={17} />
          </button>
          <button type="button" onClick={onClose} aria-label="关闭幻灯片" title="关闭">
            <X size={19} />
          </button>
        </div>
      </header>

      <div className="slideshow__stage">
        {photo ? (
          <figure className="slideshow__frame">
            <SafeImage
              key={`${photo.id}-frame`}
              className="slideshow__frame-image"
              src={photoSrc(photo)}
              alt={photo.alt}
              draggable={false}
              fallback={
                <span className="slideshow__image-fallback">
                  这张照片的预览暂时不可用
                </span>
              }
            />
          </figure>
        ) : (
          <div className="slideshow__empty">
            <CalendarDays size={34} strokeWidth={1.3} />
            <h2>
              {mode === 'today' ? '今天还没有往年回忆' : '相册里还没有可以播放的照片'}
            </h2>
            <p>
              {mode === 'today'
                ? '换到「全部」先看看别的日子，或者明年再回来。'
                : '先在相册里收录几张照片吧。'}
            </p>
            {mode === 'today' ? (
              <button type="button" className="button button--soft" onClick={() => setMode('all')}>
                看全部照片
              </button>
            ) : null}
          </div>
        )}
      </div>

      {photo && showInfo ? (
        <aside className="slideshow__info">
          <p className="slideshow__info-date">
            {formatDateLong(photo.capturedAt)}
            <span aria-hidden="true">·</span>
            {formatTime(photo.capturedAt)}
          </p>
          <p className="slideshow__info-world">
            {photo.world?.name || '未关联世界'}
          </p>
          {photo.note ? <p className="slideshow__info-note">{photo.note}</p> : null}
        </aside>
      ) : null}

      <footer className="slideshow__bottom">
        <div className="slideshow__controls">
          <button type="button" onClick={() => advance(-1)} aria-label="上一张">
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="slideshow__play"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button type="button" onClick={() => advance(1)} aria-label="下一张">
            <ChevronRight size={20} />
          </button>
          <button
            type="button"
            className={shuffle ? 'is-active' : ''}
            onClick={() => setShuffle((value) => !value)}
            aria-pressed={shuffle}
            aria-label="随机播放"
            title="随机播放"
          >
            <Shuffle size={17} />
          </button>
        </div>
        <div className="slideshow__meta">
          <span>
            {active.length > 0 ? index + 1 : 0} / {active.length}
          </span>
          <label className="slideshow__interval">
            <span>间隔</span>
            <select
              value={intervalSec}
              onChange={(event) => setIntervalSec(Number(event.target.value))}
              aria-label="幻灯片切换间隔"
            >
              <option value={4}>4 秒</option>
              <option value={6}>6 秒</option>
              <option value={10}>10 秒</option>
              <option value={15}>15 秒</option>
            </select>
          </label>
          <button type="button" className="slideshow__exit" onClick={onClose}>
            退出
          </button>
        </div>
      </footer>
      <div className="slideshow__progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>,
    document.body,
  );
}
