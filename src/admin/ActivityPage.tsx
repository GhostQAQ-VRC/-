import { useMemo, useState } from 'react';
import { History, Trash2 } from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type { ActivityEvent } from '../types';
import { useToast } from '../hooks/useToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AdminEmpty,
  AdminPageHead,
  AdminPanel,
  AdminTag,
  formatAdminDate,
  formatAdminRelative,
} from './AdminUI';

interface ActivityPageProps {
  album: AlbumApi;
}

type ActivityFilter = 'all' | 'photo' | 'world' | 'settings' | 'data';

const FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'photo', label: '照片' },
  { key: 'world', label: '世界资料' },
  { key: 'settings', label: '站点设置' },
  { key: 'data', label: '数据操作' },
];

function eventCategory(type: ActivityEvent['type']): ActivityFilter {
  if (type.startsWith('photo.')) return 'photo';
  if (type.startsWith('world.')) return 'world';
  if (type.startsWith('settings.')) return 'settings';
  if (type.startsWith('data.') || type.startsWith('auth.')) return 'data';
  return 'all';
}

function glyph(type: ActivityEvent['type']): string {
  const map: Record<ActivityEvent['type'], string> = {
    'photo.add': '＋',
    'photo.update': '✎',
    'photo.delete': '−',
    'photo.bulk': '⇄',
    'photo.feature': '⌖',
    'world.create': '◎',
    'world.update': '◍',
    'world.delete': '×',
    'settings.update': '⚙',
    'data.import': '↧',
    'data.reset': '↺',
    'data.clear': '⌫',
    'auth.update': '⌘',
  };
  return map[type];
}

export function ActivityPage({ album }: ActivityPageProps) {
  const { pushToast } = useToast();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const events = useMemo(() => {
    const list = [...album.activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    if (filter === 'all') return list;
    return list.filter((event) => eventCategory(event.type) === filter);
  }, [album.activity, filter]);

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="ACTIVITY · 操作记录"
        title="操作记录"
        description="记录最近的增删改、备份与设置变更，最多保留 120 条。它只保存在当前浏览器，不包含管理口令。"
        actions={
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setConfirmClear(true)}
            disabled={album.activity.length === 0}
          >
            <Trash2 size={14} />
            清空记录
          </button>
        }
      />

      <AdminPanel
        kicker="AUDIT TRAIL"
        title={`${events.length} 条记录`}
        actions={
          <div className="admin-filter-pills" role="group" aria-label="筛选操作类型">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`admin-filter-pill${filter === item.key ? ' is-active' : ''}`}
                onClick={() => setFilter(item.key)}
                aria-pressed={filter === item.key}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        {events.length ? (
          <ol className="admin-activity-timeline">
            {events.map((event) => (
              <li key={event.id} className="admin-activity-timeline__item">
                <span
                  className={`admin-activity__icon admin-activity__icon--${eventCategory(event.type)}`}
                  aria-hidden="true"
                >
                  {glyph(event.type)}
                </span>
                <div className="admin-activity-timeline__body">
                  <p>{event.message}</p>
                  <div className="admin-activity-timeline__meta">
                    <span>{formatAdminDate(event.at)}</span>
                    <span>{formatAdminRelative(event.at)}</span>
                    {event.meta ? <code>{event.meta.slice(-8)}</code> : null}
                    <AdminTag
                      tone={
                        eventCategory(event.type) === 'photo'
                          ? 'sakura'
                          : eventCategory(event.type) === 'world'
                            ? 'lilac'
                            : eventCategory(event.type) === 'settings'
                              ? 'aqua'
                              : 'gold'
                      }
                    >
                      {FILTERS.find((item) => item.key === eventCategory(event.type))?.label ?? '记录'}
                    </AdminTag>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <AdminEmpty
            icon={<History size={24} />}
            title={album.activity.length ? '这个分类下还没有记录' : '还没有操作记录'}
            text={
              album.activity.length
                ? '切换其他分类看看。'
                : '上传照片、编辑世界资料或修改站点设置后，记录会出现在这里。'
            }
          />
        )}
      </AdminPanel>

      <ConfirmDialog
        open={confirmClear}
        title="清空操作记录？"
        description="会删除所有审计记录，但不会影响照片、世界资料或站点设置。此操作无法撤销。"
        confirmLabel="确认清空"
        onConfirm={() => {
          album.clearActivity();
          pushToast({ title: '操作记录已清空' });
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
