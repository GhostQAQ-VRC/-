import type { RefObject } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Globe2, Search, X } from 'lucide-react';
import type { AlbumFilters } from '../types';
import { ALL_WORLDS, type WorldFilterOption } from '../utils/filters';

interface FilterBarProps {
  filters: AlbumFilters;
  onChange: (patch: Partial<AlbumFilters>) => void;
  worldOptions: WorldFilterOption[];
  resultCount: number;
  totalCount: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onClear: () => void;
}

export function FilterBar({
  filters,
  onChange,
  worldOptions,
  resultCount,
  totalCount,
  searchRef,
  onClear,
}: FilterBarProps) {
  const isFiltered = filters.query.trim().length > 0 || filters.worldKey !== ALL_WORLDS;
  const countLabel = isFiltered
    ? `找到 ${resultCount} 段回忆`
    : `共 ${totalCount} 段回忆`;

  return (
    <div className="filter-shell">
      <div className="filter-bar" role="search" aria-label="搜索和筛选照片">
        <div className="filter-bar__search">
          <Search size={17} strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={searchRef}
            id="album-search"
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ query: event.target.value })}
            placeholder="搜索备注、世界或日期…"
            aria-label="搜索备注、世界或日期"
            autoComplete="off"
          />
          {filters.query ? (
            <button
              type="button"
              className="filter-bar__search-clear"
              onClick={() => onChange({ query: '' })}
              aria-label="清空搜索"
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="filter-bar__kbd" aria-hidden="true">
              /
            </kbd>
          )}
        </div>

        <div className="filter-bar__select">
          <Globe2 size={16} strokeWidth={1.7} aria-hidden="true" />
          <select
            value={filters.worldKey}
            onChange={(event) => onChange({ worldKey: event.target.value })}
            aria-label="按世界筛选"
          >
            <option value={ALL_WORLDS}>全部世界</option>
            {worldOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}（{option.count}）
              </option>
            ))}
          </select>
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className="filter-bar__chevron" />
        </div>

        <button
          type="button"
          className="filter-bar__sort"
          onClick={() => onChange({ sort: filters.sort === 'desc' ? 'asc' : 'desc' })}
          aria-label={filters.sort === 'desc' ? '当前最新优先，切换为最早优先' : '当前最早优先，切换为最新优先'}
        >
          {filters.sort === 'desc' ? (
            <ArrowDownWideNarrow size={16} strokeWidth={1.7} aria-hidden="true" />
          ) : (
            <ArrowUpNarrowWide size={16} strokeWidth={1.7} aria-hidden="true" />
          )}
          <span>{filters.sort === 'desc' ? '最新优先' : '最早优先'}</span>
        </button>

        <span className="filter-bar__divider" aria-hidden="true" />

        <p className="filter-bar__count" aria-live="polite">
          {countLabel}
        </p>

        {isFiltered ? (
          <button type="button" className="filter-bar__clear" onClick={onClear}>
            <X size={13} />
            清除筛选
          </button>
        ) : null}
      </div>
    </div>
  );
}
