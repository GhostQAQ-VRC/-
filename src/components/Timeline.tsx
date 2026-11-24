import { memo } from 'react';
import type { Photo } from '../types';
import type { YearGroup } from '../utils/filters';
import {
  formatDateLong,
  formatDateShort,
  formatMonthEn,
  formatMonthLabel,
  formatTime,
  formatYearCN,
} from '../utils/date';
import { cn } from '../utils/cn';
import { useInView } from '../hooks/useInView';
import { PhotoCard } from './PhotoCard';
import { StarGlyph } from './StarGlyph';

interface TimelineProps {
  groups: YearGroup[];
  featuredPhotoId: string | null;
  onTogglePin: (id: string) => void;
  onRotatePhoto: (id: string, delta: -90 | 90) => void;
  onOpenPhoto: (id: string) => void;
  onRequestDelete: (id: string) => void;
  onUpload: () => void;
}

interface EntryProps {
  photo: Photo;
  index: number;
  side: 'left' | 'right';
  pinned: boolean;
  onTogglePin: (id: string) => void;
  onRotatePhoto: (id: string, delta: -90 | 90) => void;
  onOpenPhoto: (id: string) => void;
  onRequestDelete: (id: string) => void;
}

function TimelineEcho({
  photo,
  index,
  side,
}: {
  photo: Photo;
  index: number;
  side: 'left' | 'right';
}) {
  return (
    <div className={`timeline-echo timeline-echo--${side}`} aria-hidden="true">
      <span className="timeline-echo__index">
        <span />
        MEMORY {String(index).padStart(2, '0')}
        <span />
      </span>
      <span className="timeline-echo__date">{formatDateShort(photo.capturedAt)}</span>
      <span className="timeline-echo__rule" />
      <span className="timeline-echo__world">
        <StarGlyph size={9} />
        {photo.world?.name ?? '未关联世界'}
      </span>
      <span className="timeline-echo__time">{formatTime(photo.capturedAt)} · 收录于星轨</span>
    </div>
  );
}

const TimelineEntry = memo(function TimelineEntry({
  photo,
  index,
  side,
  pinned,
  onTogglePin,
  onRotatePhoto,
  onOpenPhoto,
  onRequestDelete,
}: EntryProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const card = (
    <PhotoCard
      photo={photo}
      index={index}
      pinned={pinned}
      onTogglePin={() => onTogglePin(photo.id)}
      onRotate={() => onRotatePhoto(photo.id, -90)}
      onOpen={() => onOpenPhoto(photo.id)}
      onDelete={() => onRequestDelete(photo.id)}
    />
  );
  const echo = (
    <TimelineEcho photo={photo} index={index} side={side === 'left' ? 'right' : 'left'} />
  );

  return (
    <div
      ref={ref}
      className={`timeline-entry timeline-entry--${side}${inView ? ' is-visible' : ''}`}
    >
      <div
        className={cn(
          'timeline-entry__side',
          'timeline-entry__side--left',
          side !== 'left' && 'is-ghost',
        )}
      >
        {side === 'left' ? card : echo}
      </div>
      <div className="timeline-entry__node">
        <button
          type="button"
          className="timeline-node"
          onClick={() => onOpenPhoto(photo.id)}
          aria-label={`打开 ${formatDateLong(photo.capturedAt)} 的照片`}
          title={`${formatDateLong(photo.capturedAt)} · ${formatTime(photo.capturedAt)}`}
        >
          <span className="timeline-node__pulse" aria-hidden="true" />
          <StarGlyph size={14} />
        </button>
        <span className="timeline-entry__time">{formatTime(photo.capturedAt)}</span>
      </div>
      <div
        className={cn(
          'timeline-entry__side',
          'timeline-entry__side--right',
          side !== 'right' && 'is-ghost',
        )}
      >
        {side === 'right' ? card : echo}
      </div>
    </div>
  );
});

export function Timeline({
  groups,
  featuredPhotoId,
  onTogglePin,
  onRotatePhoto,
  onOpenPhoto,
  onRequestDelete,
  onUpload,
}: TimelineProps) {
  let entryIndex = 0;

  return (
    <div className="timeline">
      <div className="timeline-spine" aria-hidden="true">
        <span className="timeline-spine__core" />
        <span className="timeline-spine__glow" />
        <span className="timeline-spine__dust timeline-spine__dust--one" />
        <span className="timeline-spine__dust timeline-spine__dust--two" />
        <span className="timeline-spine__dust timeline-spine__dust--three" />
        <span className="timeline-spine__comet" />
      </div>

      {groups.map((yearGroup) => (
        <section
          key={yearGroup.year}
          id={`year-${yearGroup.year}`}
          data-year-section={yearGroup.year}
          className="year-section"
          aria-labelledby={`year-heading-${yearGroup.year}`}
        >
          <header className="year-heading">
            <span className="year-heading__star" aria-hidden="true">
              <StarGlyph size={18} />
            </span>
            <h3 id={`year-heading-${yearGroup.year}`} className="year-heading__title">
              <span className="year-heading__number">{yearGroup.year}</span>
              <span className="year-heading__cn">{formatYearCN(yearGroup.year)}</span>
            </h3>
            <p className="year-heading__meta">
              <span aria-hidden="true">✦</span>
              {yearGroup.count} 段记忆
              <span aria-hidden="true">✦</span>
            </p>
          </header>

          {yearGroup.months.map((monthGroup) => (
            <section
              key={monthGroup.key}
              id={`month-${monthGroup.key}`}
              data-month-section={monthGroup.key}
              className="month-section"
              aria-labelledby={`month-heading-${monthGroup.key}`}
            >
              <header className="month-heading">
                <span className="month-heading__node" aria-hidden="true">
                  <StarGlyph size={15} />
                </span>
                <h4 className="month-plaque" id={`month-heading-${monthGroup.key}`}>
                  <span className="month-plaque__main">
                    <span className="month-plaque__name">{formatMonthLabel(monthGroup.month)}</span>
                    <span className="month-plaque__en">{formatMonthEn(monthGroup.month)}</span>
                  </span>
                  <span className="month-plaque__divider" aria-hidden="true" />
                  <span className="month-plaque__count">{monthGroup.photos.length} 张</span>
                </h4>
              </header>

              <div className={`month-entries${monthGroup.photos.length === 1 ? ' is-single' : ''}`}>
                {monthGroup.photos.map((photo) => {
                  const index = entryIndex + 1;
                  const side: 'left' | 'right' = entryIndex % 2 === 0 ? 'left' : 'right';
                  entryIndex += 1;
                  return (
                    <TimelineEntry
                      key={photo.id}
                      photo={photo}
                      index={index}
                      side={side}
                      pinned={photo.id === featuredPhotoId}
                      onTogglePin={onTogglePin}
                      onRotatePhoto={onRotatePhoto}
                      onOpenPhoto={onOpenPhoto}
                      onRequestDelete={onRequestDelete}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      ))}

      <div className="timeline-endcap">
        <span className="timeline-endcap__star" aria-hidden="true">
          <StarGlyph size={22} />
        </span>
        <p className="timeline-endcap__title">时间轴的这一端，是下一次相遇。</p>
        <p className="timeline-endcap__text">把新的风景留在这里，星轨会继续向前。</p>
        <button type="button" className="button button--soft" onClick={onUpload}>
          收录一段新记忆
        </button>
      </div>
    </div>
  );
}
