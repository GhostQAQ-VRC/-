import { useEffect, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import type { YearGroup } from '../utils/filters';
import { formatMonthEn, formatMonthLabel } from '../utils/date';
import { StarGlyph } from './StarGlyph';
import { YearRail } from './YearRail';

interface TimelineNavProps {
  groups: YearGroup[];
}

function scrollToId(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

export function TimelineNav({ groups }: TimelineNavProps) {
  const [activeYear, setActiveYear] = useState<number | null>(groups[0]?.year ?? null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);

  useEffect(() => {
    if (groups.length === 0) return undefined;
    let frame = 0;
    const update = () => {
      const yearSections = [...document.querySelectorAll<HTMLElement>('[data-year-section]')];
      const monthSections = [...document.querySelectorAll<HTMLElement>('[data-month-section]')];
      let year: number | null = null;
      let month: string | null = null;
      for (const section of yearSections) {
        if (section.getBoundingClientRect().top <= 230) {
          year = Number(section.dataset.yearSection);
        }
      }
      for (const section of monthSections) {
        if (section.getBoundingClientRect().top <= 260) {
          month = section.dataset.monthSection ?? null;
        }
      }
      setActiveYear(year ?? groups[0]?.year ?? null);
      setActiveMonth(month);
      frame = 0;
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [groups]);

  if (groups.length === 0) return null;

  return (
    <>
      <YearRail groups={groups} activeYear={activeYear} onJump={scrollToId} />
      <nav className="timeline-nav" aria-label="按时间快速跳转">
        <div className="timeline-nav__head">
          <span className="timeline-nav__label">
            <CalendarRange size={14} strokeWidth={1.7} aria-hidden="true" />
            快速跳转
          </span>
          <div className="timeline-nav__years" role="group" aria-label="年份">
            {groups.map((group) => (
              <button
                key={group.year}
                type="button"
                className={`timeline-nav__year${activeYear === group.year ? ' is-active' : ''}`}
                onClick={() => scrollToId(`year-${group.year}`)}
                aria-current={activeYear === group.year ? 'true' : undefined}
              >
                {group.year}
                <span className="timeline-nav__year-count">{group.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="timeline-nav__rail">
          {groups.map((group) => (
            <div className="timeline-nav__group" key={group.year}>
              <span className="timeline-nav__group-year" aria-hidden="true">
                {group.year}
              </span>
              {group.months.map((monthGroup) => (
                <button
                  key={monthGroup.key}
                  type="button"
                  className={`timeline-nav__month${
                    activeMonth === monthGroup.key ? ' is-active' : ''
                  }`}
                  onClick={() => scrollToId(`month-${monthGroup.key}`)}
                  aria-label={`跳转到 ${monthGroup.year} 年${formatMonthLabel(monthGroup.month)}，共 ${monthGroup.photos.length} 张照片`}
                  aria-current={activeMonth === monthGroup.key ? 'true' : undefined}
                  title={`${formatMonthEn(monthGroup.month)} · ${monthGroup.photos.length} 张`}
                >
                  <StarGlyph size={9} />
                  <span>{formatMonthLabel(monthGroup.month)}</span>
                  <span className="timeline-nav__month-count">{monthGroup.photos.length}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
