import { useMemo, useState } from 'react';
import { Compass, Download, Globe2, Images, Loader2, Sparkles } from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import { SafeImage } from '../components/SafeImage';
import { AdminEmpty, AdminPageHead, formatBytes } from './AdminUI';
import { buildWorldJourney, journeyRange } from '../utils/worldJourney';
import { getDesktopBridge } from '../platform';
import { useToast } from '../hooks/useToast';

interface JourneyPageProps {
  album: AlbumApi;
}

export function JourneyPage({ album }: JourneyPageProps) {
  const journey = useMemo(() => buildWorldJourney(album.photos), [album.photos]);
  const desktop = getDesktopBridge();
  const { pushToast } = useToast();
  const [reviewYear, setReviewYear] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  // The annual review covers every photo, including ones that are not linked
  // to a world yet, so its year list comes from the album rather than the
  // world-only journey buckets.
  const reviewYears = useMemo(() => {
    const years = new Set<number>();
    for (const photo of album.photos) {
      if (photo.missing) continue;
      const date = new Date(photo.capturedAt);
      if (!Number.isNaN(date.getTime())) years.add(date.getFullYear());
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [album.photos]);
  const selectedYear =
    reviewYear !== null && reviewYears.includes(reviewYear)
      ? reviewYear
      : reviewYears[0] ?? null;
  const maxVisits = journey.entries[0]?.photos || 1;
  const maxYearPhotos = Math.max(1, ...journey.byYear.map((item) => item.photos));

  const exportReview = async () => {
    if (!desktop || selectedYear === null || reviewBusy) return;
    setReviewBusy(true);
    try {
      const result = await desktop.review.exportYear(selectedYear);
      if (result.ok) {
        pushToast({
          tone: 'success',
          title: `${selectedYear} 年度回顾已导出`,
          description: `${result.summary?.photos ?? 0} 张照片 · ${formatBytes(
            result.summary?.bytes ?? 0,
          )} · ${result.path || ''}`,
        });
      } else if (!result.canceled) {
        pushToast({
          tone: 'danger',
          title: '导出年度回顾失败',
          description: result.error || '请重试。',
        });
      }
    } catch (caught) {
      pushToast({
        tone: 'danger',
        title: '导出年度回顾失败',
        description: (caught as Error).message || '请重试。',
      });
    } finally {
      setReviewBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="WORLD JOURNEY · 世界旅程"
        title="走过的世界"
        description={`${journey.totalWorlds} 个世界、${journey.totalPhotos} 张照片组成的时间轴足迹。`}
      />

      {desktop && reviewYears.length ? (
        <section className="admin-panel journey-review" aria-labelledby="journey-review-title">
          <div className="journey-review__body">
            <span className="journey-review__icon" aria-hidden="true">
              <Download size={18} strokeWidth={1.6} />
            </span>
            <div className="journey-review__copy">
              <p className="section-kicker">YEAR IN REVIEW</p>
              <h2 id="journey-review-title">把这一年带回家</h2>
              <p>统计月度节奏、常去世界与精选照片，生成可离线打开的单文件 HTML。</p>
            </div>
            <div className="journey-review__actions">
              <select
                className="admin-select"
                aria-label="选择要导出的年份"
                value={selectedYear ?? ''}
                onChange={(event) => setReviewYear(Number(event.target.value))}
                disabled={reviewBusy}
              >
                {reviewYears.map((year) => (
                  <option key={year} value={year}>
                    {year} 年
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void exportReview()}
                disabled={reviewBusy || selectedYear === null}
              >
                {reviewBusy ? (
                  <Loader2 size={14} className="spinner" aria-hidden="true" />
                ) : (
                  <Download size={14} aria-hidden="true" />
                )}
                {reviewBusy ? '正在生成…' : '导出年度回顾'}
              </button>
            </div>
          </div>
          <p className="admin-panel__note">
            图片会压缩后内嵌在 HTML 中，不包含磁盘路径；生成过程可能需要几十秒。
          </p>
        </section>
      ) : null}

      {journey.totalWorlds === 0 ? (
        <AdminEmpty
          icon={<Compass size={24} />}
          title="还没有可以统计的世界足迹"
          text="给照片关联世界后，这里会按回访次数和时间整理出你的 VRChat 旅程。"
        />
      ) : (
        <>
          <div className="journey-stats">
            <div>
              <span>到访世界</span>
              <strong>{journey.totalWorlds}</strong>
              <small>WORLDS</small>
            </div>
            <div>
              <span>世界照片</span>
              <strong>{journey.totalPhotos}</strong>
              <small>MEMORIES</small>
            </div>
            <div>
              <span>跨越年份</span>
              <strong>{journey.spanYears}</strong>
              <small>
                {journey.years[0]} — {journey.years[journey.years.length - 1]}
              </small>
            </div>
            <div>
              <span>最常回访</span>
              <strong className="is-name">{journey.topWorld?.name || '—'}</strong>
              <small>{journey.topWorld ? `${journey.topWorld.photos} 张照片` : ''}</small>
            </div>
          </div>

          <section className="admin-panel" aria-labelledby="journey-top-title">
            <div className="admin-panel__head">
              <div>
                <p className="section-kicker">MOST VISITED</p>
                <h2 id="journey-top-title">最常回访的世界</h2>
              </div>
              <span className="admin-panel__count">{journey.entries.length} 个世界</span>
            </div>
            <ol className="journey-top">
              {journey.entries.slice(0, 8).map((entry, index) => (
                <li key={entry.key}>
                  <span className="journey-top__rank">{String(index + 1).padStart(2, '0')}</span>
                  <span className="journey-top__name" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="journey-top__bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, (entry.photos / maxVisits) * 100)}%` }} />
                  </span>
                  <span className="journey-top__count">{entry.photos} 张</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="admin-panel" aria-labelledby="journey-years-title">
            <div className="admin-panel__head">
              <div>
                <p className="section-kicker">TIMELINE</p>
                <h2 id="journey-years-title">按年份回看</h2>
              </div>
              <span className="admin-panel__count">
                {journey.years.length} 个年份
              </span>
            </div>
            <div className="journey-years">
              {journey.byYear.map((item) => (
                <div className="journey-year" key={item.year}>
                  <span className="journey-year__count">{item.photos}</span>
                  <span className="journey-year__bar" aria-hidden="true">
                    <span style={{ height: `${Math.max(8, (item.photos / maxYearPhotos) * 100)}%` }} />
                  </span>
                  <span className="journey-year__label">{item.year}</span>
                  <span className="journey-year__worlds">{item.worlds} 世界</span>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-panel" aria-labelledby="journey-wall-title">
            <div className="admin-panel__head">
              <div>
                <p className="section-kicker">WORLD WALL</p>
                <h2 id="journey-wall-title">世界封面墙</h2>
              </div>
              <span className="admin-panel__count">
                <Images size={12} aria-hidden="true" /> {journey.totalPhotos}
              </span>
            </div>
            <div className="journey-wall">
              {journey.entries.map((entry) => (
                <article className="journey-world" key={entry.key}>
                  <SafeImage
                    src={entry.cover || null}
                    alt=""
                    loading="lazy"
                    fallback={
                      <span className="journey-world__fallback" aria-hidden="true">
                        <Globe2 size={20} strokeWidth={1.5} />
                      </span>
                    }
                  />
                  <div className="journey-world__body">
                    <strong title={entry.name}>{entry.name}</strong>
                    <span>
                      {entry.photos} 张
                      <i aria-hidden="true">·</i>
                      {journeyRange(entry)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
            {journey.unlinked > 0 ? (
              <p className="admin-panel__note">
                <Sparkles size={13} aria-hidden="true" />
                还有 {journey.unlinked} 张照片尚未关联世界，不会出现在世界旅程里。
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
