import { ImagePlus, SearchX, Sparkles } from 'lucide-react';
import { StarGlyph } from './StarGlyph';

interface EmptyStateProps {
  variant: 'empty' | 'no-results';
  onPrimary: () => void;
  onSecondary?: () => void;
  hasSamplesAvailable?: boolean;
}

export function EmptyState({
  variant,
  onPrimary,
  onSecondary,
  hasSamplesAvailable,
}: EmptyStateProps) {
  const isNoResults = variant === 'no-results';

  return (
    <div className={`empty-state empty-state--${variant}`}>
      <div className="empty-art" aria-hidden="true">
        <span className="empty-art__orbit empty-art__orbit--outer" />
        <span className="empty-art__orbit empty-art__orbit--inner" />
        <span className="empty-art__frame empty-art__frame--back" />
        <span className="empty-art__frame empty-art__frame--front">
          {isNoResults ? <SearchX size={30} strokeWidth={1.4} /> : <ImagePlus size={30} strokeWidth={1.4} />}
        </span>
        <span className="empty-art__star empty-art__star--one">
          <StarGlyph size={14} />
        </span>
        <span className="empty-art__star empty-art__star--two">
          <StarGlyph size={9} />
        </span>
        <span className="empty-art__glow" />
      </div>

      <p className="eyebrow empty-state__eyebrow">
        <Sparkles size={13} aria-hidden="true" />
        {isNoResults ? 'SIGNAL LOST' : 'A QUIET TIMELINE'}
      </p>
      <h3 className="empty-state__title">
        {isNoResults ? '没有找到对应的星光' : '这条时间轴还很安静'}
      </h3>
      <p className="empty-state__text">
        {isNoResults
          ? '试试别的关键词，或清除当前的搜索与世界筛选。'
          : '收录第一张照片，把当时的风、月亮和一起看风景的人留在这里。'}
      </p>
      <div className="empty-state__actions">
        <button type="button" className="button button--primary" onClick={onPrimary}>
          {isNoResults ? '清除所有筛选' : '收录第一张照片'}
        </button>
        {!isNoResults && hasSamplesAvailable && onSecondary ? (
          <button type="button" className="button button--ghost" onClick={onSecondary}>
            恢复起始相册
          </button>
        ) : null}
      </div>
    </div>
  );
}
