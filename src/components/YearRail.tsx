import type { YearGroup } from '../utils/filters';

interface YearRailProps {
  groups: YearGroup[];
  activeYear: number | null;
  onJump: (id: string) => void;
}

export function YearRail({ groups, activeYear, onJump }: YearRailProps) {
  return (
    <nav className="year-rail" aria-label="年份快速导航">
      <span className="year-rail__cap" aria-hidden="true" />
      <div className="year-rail__line" aria-hidden="true" />
      {groups.map((group) => (
        <button
          key={group.year}
          type="button"
          className={`year-rail__item${activeYear === group.year ? ' is-active' : ''}`}
          onClick={() => onJump(`year-${group.year}`)}
          aria-current={activeYear === group.year ? 'true' : undefined}
          aria-label={`跳转到 ${group.year} 年，共 ${group.count} 张照片`}
        >
          <span className="year-rail__dot" aria-hidden="true" />
          <span className="year-rail__year">{group.year}</span>
          <span className="year-rail__count">{group.count}</span>
        </button>
      ))}
      <span className="year-rail__cap year-rail__cap--end" aria-hidden="true" />
    </nav>
  );
}
