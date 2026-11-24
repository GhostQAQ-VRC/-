import { ArrowDown, ArrowUpRight, ImageOff, Plus, Sparkles } from 'lucide-react';
import type { Photo } from '../types';
import { photoSrc } from '../platform';
import type { AlbumStats } from '../utils/filters';
import { formatDateShort, formatTime } from '../utils/date';
import { photoOrientation, photoRotation } from '../utils/orientation';
import { StarGlyph } from './StarGlyph';
import { SafeImage } from './SafeImage';

interface HeroProps {
  stats: AlbumStats;
  latestPhoto: Photo | null;
  featuredPinned: boolean;
  tagline: string;
  onUpload: () => void;
  onOpenPhoto: (id: string) => void;
  onExplore: () => void;
}

export function Hero({
  stats,
  latestPhoto,
  featuredPinned,
  tagline,
  onUpload,
  onOpenPhoto,
  onExplore,
}: HeroProps) {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-orbit hero-orbit--one" aria-hidden="true">
        <span className="hero-orbit__dot" />
      </div>
      <div className="hero-orbit hero-orbit--two" aria-hidden="true" />
      <p className="hero-vertical" aria-hidden="true">
        星の記憶を、ひとつずつ。
      </p>

      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="eyebrow hero-eyebrow">
            <Sparkles size={14} strokeWidth={1.6} aria-hidden="true" />
            <span>VRCHAT MEMORY ARCHIVE</span>
            <span className="eyebrow__divider" aria-hidden="true" />
            <span className="eyebrow__jp">思い出アルバム</span>
          </p>

          <h1 className="hero-title" id="hero-title">
            把每一次<em>相遇</em>，
            <br />
            收进星光里。
          </h1>

          <p className="hero-lede">{tagline}</p>

          <div className="hero-actions">
            <button type="button" className="button button--primary" onClick={onExplore}>
              翻开相册
              <ArrowDown size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button type="button" className="button button--ghost" onClick={onUpload}>
              <Plus size={17} strokeWidth={1.8} aria-hidden="true" />
              添加一段记忆
            </button>
          </div>

          <dl className="hero-stats" aria-label="相册统计">
            <div className="hero-stat">
              <dt>回忆</dt>
              <dd>
                {stats.total}
                <span>张</span>
              </dd>
            </div>
            <div className="hero-stat">
              <dt>世界</dt>
              <dd>
                {stats.worlds}
                <span>个</span>
              </dd>
            </div>
            <div className="hero-stat">
              <dt>年份</dt>
              <dd>
                {stats.years}
                <span>年</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="hero-feature">
          <div className="hero-feature__halo" aria-hidden="true" />
          <span className="hero-feature__ghost" aria-hidden="true" />
          {latestPhoto ? (
            <button
              type="button"
              className={`feature-card feature-card--${photoOrientation(latestPhoto)} feature-card--rotate-${photoRotation(latestPhoto)}`}
              onClick={() => onOpenPhoto(latestPhoto.id)}
              aria-label={`打开${featuredPinned ? '置顶' : '最新收录'}的记忆：${latestPhoto.note || latestPhoto.alt}`}
            >
              <span className="feature-card__ribbon">
                <StarGlyph size={11} />
                {featuredPinned ? '置顶记忆' : '最新收录'}
              </span>
              <span className="feature-card__media">
                <SafeImage
                  src={latestPhoto.missing ? null : photoSrc(latestPhoto)}
                  alt={latestPhoto.alt}
                  width={latestPhoto.width ?? 1600}
                  height={latestPhoto.height ?? 1200}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  fallback={
                    <span className="feature-card__missing" aria-hidden="true">
                      <ImageOff size={30} />
                    </span>
                  }
                />
                <span className="feature-card__media-shade" aria-hidden="true" />
                <span className="feature-card__open">
                  打开这段记忆
                  <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" />
                </span>
              </span>
              <span className="feature-card__body">
                <span className="feature-card__date">
                  <time dateTime={latestPhoto.capturedAt}>
                    {formatDateShort(latestPhoto.capturedAt)}
                  </time>
                  <span aria-hidden="true">·</span>
                  <span>{formatTime(latestPhoto.capturedAt)}</span>
                </span>
                <span className="feature-card__note">
                  {latestPhoto.note || latestPhoto.aiSummary || '一段还没有写下备注的记忆。'}
                </span>
                {latestPhoto.aiSummary ? (
                  <span className="feature-card__ai">
                    <Sparkles size={11} aria-hidden="true" />
                    AI 回忆
                  </span>
                ) : null}
                <span className="feature-card__world">
                  <span className="feature-card__world-dot" aria-hidden="true" />
                  {latestPhoto.world?.name ?? '尚未关联世界'}
                  <span className="feature-card__arrow" aria-hidden="true">
                    ↗
                  </span>
                </span>
              </span>
            </button>
          ) : (
            <div className="feature-empty">
              <span className="feature-empty__orbit" aria-hidden="true">
                <StarGlyph size={22} />
              </span>
              <p className="feature-empty__title">这里还空着</p>
              <p className="feature-empty__text">收录第一张照片，让星轨开始延伸。</p>
              <button type="button" className="button button--soft" onClick={onUpload}>
                <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
                收录第一张
              </button>
            </div>
          )}
          <div className="hero-feature__caption" aria-hidden="true">
            <span>MEMORY OF THE STARS</span>
            <span className="hero-feature__caption-line" />
            <span>VOL. 01</span>
          </div>
        </div>
      </div>

      <button type="button" className="hero-scroll" onClick={onExplore} aria-label="向下滚动到时光轴">
        <span>往下翻 · SCROLL</span>
        <span className="hero-scroll__line" aria-hidden="true" />
      </button>
    </section>
  );
}
