import { useMemo } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  Database,
  Download,
  Globe2,
  HardDrive,
  Images,
  Plus,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type { ActivityEvent } from '../types';
import { estimateAlbumBytes } from '../services/albumStorage';
import { effectiveWorldApiBase } from '../data/settings';
import { useToast } from '../hooks/useToast';
import { useDesktopLibrary } from '../hooks/useDesktopLibrary';
import { backupFilename, downloadTextFile } from '../utils/download';
import { formatDateShort } from '../utils/date';
import { SafeImage } from '../components/SafeImage';
import {
  AdminEmpty,
  AdminPageHead,
  AdminPanel,
  AdminStat,
  StorageMeter,
  formatAdminRelative,
  formatBytes,
} from './AdminUI';

interface DashboardPageProps {
  album: AlbumApi;
  navigate: (path: string) => void;
  onUpload: () => void;
}

function ActivityGlyph({ type }: { type: ActivityEvent['type'] }) {
  const map: Record<ActivityEvent['type'], string> = {
    'photo.add': '＋',
    'photo.update': '✎',
    'photo.delete': '−',
    'photo.bulk': '⇄',
    'photo.feature': '⌖',
    'world.create': '◎',
    'world.update': '◎',
    'world.delete': '×',
    'settings.update': '⚙',
    'data.import': '↧',
    'data.reset': '↺',
    'data.clear': '⌫',
    'auth.update': '⌘',
  };
  return <span aria-hidden="true">{map[type]}</span>;
}

export function DashboardPage({ album, navigate, onUpload }: DashboardPageProps) {
  const { pushToast } = useToast();
  const library = useDesktopLibrary();
  const photos = album.photos;
  const totalBytes = useMemo(() => estimateAlbumBytes(album.data), [album.data]);
  const years = new Set(photos.map((photo) => new Date(photo.capturedAt).getFullYear()));
  const uploaded = photos.filter((photo) => photo.isUploaded).length;
  const linked = photos.filter((photo) => photo.isRemote).length;
  const samples = photos.filter((photo) => photo.isSample).length;
  const pending = photos.filter((photo) => !photo.world && photo.worldId).length;
  const unlinked = photos.filter((photo) => !photo.world && !photo.worldId).length;
  const libraryPhotos = photos.filter((photo) => photo.mediaKind === 'library');
  const libraryMissing = libraryPhotos.filter((photo) => photo.missing).length;
  const apiBase = effectiveWorldApiBase(album.settings);

  const yearCounts = [...years]
    .sort((a, b) => b - a)
    .map((year) => ({
      year,
      count: photos.filter((photo) => new Date(photo.capturedAt).getFullYear() === year).length,
    }));
  const maxYear = Math.max(1, ...yearCounts.map((item) => item.count));

  const worldUsage = album.worlds
    .map((world) => ({
      world,
      count: photos.filter((photo) => photo.worldRef === world.key).length,
    }))
    .sort((a, b) => b.count - a.count || a.world.name.localeCompare(b.world.name));
  const usedWorlds = worldUsage.filter((item) => item.count > 0).length;
  const maxWorld = Math.max(1, ...worldUsage.map((item) => item.count));

  const recentPhotos = [...photos]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 4);

  const exportBackup = () => {
    downloadTextFile(backupFilename(), album.exportBackup());
    pushToast({
      tone: 'success',
      title: '备份已导出',
      description: 'JSON 文件包含照片、世界资料、设置与操作记录。',
    });
  };

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="OVERVIEW · 时间轴纪念相册管理台"
        title="欢迎回来，旅人。"
        description="照片、世界资料与站点状态都在这里。先看看今天的星光，再决定去哪里。"
        actions={
          <>
            <button type="button" className="button button--primary button--small" onClick={onUpload}>
              <Plus size={15} />
              收录照片
            </button>
            <button type="button" className="button button--ghost button--small" onClick={exportBackup}>
              <Download size={15} />
              导出备份
            </button>
          </>
        }
      />

      <div className="admin-stat-grid">
        <AdminStat
          icon={<Images size={19} strokeWidth={1.6} />}
          label="照片"
          value={photos.length}
          unit="张"
          hint={`${uploaded} 张用户收录${linked ? `（${linked} 张链接）` : ''} · ${samples} 张起始照片`}
          tone="sakura"
        />
        <AdminStat
          icon={<Globe2 size={19} strokeWidth={1.6} />}
          label="世界资料"
          value={album.worlds.length}
          unit="条"
          hint={`${usedWorlds} 条已关联到照片`}
          tone="lilac"
        />
        <AdminStat
          icon={<CalendarDays size={19} strokeWidth={1.6} />}
          label="跨越年份"
          value={years.size}
          unit="年"
          hint={yearCounts.length ? `${yearCounts[yearCounts.length - 1].year} — ${yearCounts[0].year}` : '还没有照片'}
          tone="gold"
        />
        <AdminStat
          icon={<HardDrive size={19} strokeWidth={1.6} />}
          label={library.available && library.config?.configured ? '存储库原图' : '本地数据'}
          value={formatBytes(
            library.available && library.config?.configured
              ? (library.stats?.libraryBytes ?? totalBytes)
              : totalBytes,
          )}
          hint={
            library.available && library.config?.configured
              ? `预览缓存 ${formatBytes(library.stats?.previewBytes ?? 0)}`
              : apiBase
                ? '世界查询：后端代理'
                : '世界查询：本地资料库'
          }
          tone="aqua"
        />
      </div>

      {library.available ? (
        <AdminPanel kicker="LOCAL LIBRARY" title="存储库">
          <div className="admin-health-grid">
            <div>
              <span>状态</span>
              <strong>
                {library.config?.configured
                  ? library.scanning
                    ? '正在扫描'
                    : '已连接'
                  : library.config?.unavailable
                    ? '不可用'
                    : '示例模式'}
              </strong>
            </div>
            <div>
              <span>库内照片</span>
              <strong>{libraryPhotos.length} 张</strong>
            </div>
            <div>
              <span>原图体积</span>
              <strong>{formatBytes(library.stats?.libraryBytes ?? 0)}</strong>
            </div>
            <div>
              <span>预览缓存</span>
              <strong>{formatBytes(library.stats?.previewBytes ?? 0)}</strong>
            </div>
            <div>
              <span>文件缺失</span>
              <strong className={libraryMissing ? 'is-warn' : ''}>{libraryMissing} 张</strong>
            </div>
          </div>
          <p className="admin-panel__note">
            <Database size={13} aria-hidden="true" />
            {library.config?.libraryPath || '尚未选择存储库文件夹'}
          </p>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => navigate('/admin/settings')}
            >
              管理存储库
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void library.scan()}
              disabled={library.scanning || !library.config?.configured}
            >
              {library.scanning ? '正在扫描…' : '扫描新增照片'}
            </button>
          </div>
        </AdminPanel>
      ) : null}

      <div className="admin-grid admin-grid--wide">
        <AdminPanel kicker="MEMORY DISTRIBUTION" title="回忆分布">
          {yearCounts.length ? (
            <div className="admin-bars">
              {yearCounts.map((item) => (
                <div className="admin-bar" key={item.year}>
                  <span className="admin-bar__label">{item.year}</span>
                  <span className="admin-bar__track">
                    <span
                      className="admin-bar__fill"
                      style={{ width: `${Math.max(4, (item.count / maxYear) * 100)}%` }}
                    />
                  </span>
                  <span className="admin-bar__value">{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmpty
              icon={<Sparkles size={22} />}
              title="还没有可统计的照片"
              text="收录第一张照片后，这里会出现按年份的分布。"
              action={
                <button type="button" className="button button--soft button--small" onClick={onUpload}>
                  <Plus size={14} />
                  收录照片
                </button>
              }
            />
          )}
          <div className="admin-health-row">
            <span className={pending ? 'is-warn' : ''}>{pending} 张待识别世界</span>
            <span className={unlinked ? 'is-warn' : ''}>{unlinked} 张未关联世界</span>
            <button type="button" className="text-button" onClick={() => navigate('/admin/photos')}>
              去照片管理
              <ArrowUpRight size={13} />
            </button>
          </div>
        </AdminPanel>

        <AdminPanel
          kicker="WORLD LIBRARY"
          title="世界资料库"
          actions={
            <button type="button" className="text-button" onClick={() => navigate('/admin/worlds')}>
              管理
              <ArrowUpRight size={13} />
            </button>
          }
        >
          {worldUsage.length ? (
            <div className="admin-bars admin-bars--world">
              {worldUsage.slice(0, 6).map(({ world, count }) => (
                <div className="admin-bar" key={world.key}>
                  <span className="admin-bar__label" title={world.name}>
                    {world.name}
                  </span>
                  <span className="admin-bar__track">
                    <span
                      className="admin-bar__fill admin-bar__fill--lilac"
                      style={{ width: `${Math.max(3, (count / maxWorld) * 100)}%` }}
                    />
                  </span>
                  <span className="admin-bar__value">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmpty
              icon={<Globe2 size={22} />}
              title="世界资料库还是空的"
              text="添加世界资料后，照片可以通过 World ID 离线识别。"
              action={
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={() => navigate('/admin/worlds')}
                >
                  新增世界
                </button>
              }
            />
          )}
          <div className="admin-health-row">
            <span>{album.worlds.filter((world) => world.source === 'local').length} 条本地资料</span>
            <span>{album.worlds.filter((world) => world.source === 'demo').length} 条内置资料</span>
            <span>{album.worlds.filter((world) => world.source === 'api').length} 条 API 缓存</span>
          </div>
        </AdminPanel>
      </div>

      <div className="admin-grid">
        <AdminPanel
          kicker="RECENT ACTIVITY"
          title="最近操作"
          actions={
            <button type="button" className="text-button" onClick={() => navigate('/admin/activity')}>
              全部记录
              <ArrowUpRight size={13} />
            </button>
          }
        >
          {album.activity.length ? (
            <ul className="admin-activity-list">
              {album.activity.slice(0, 6).map((event) => (
                <li key={event.id} className="admin-activity">
                  <span className={`admin-activity__icon admin-activity__icon--${event.type.split('.')[0]}`}>
                    <ActivityGlyph type={event.type} />
                  </span>
                  <div>
                    <p>{event.message}</p>
                    <span>{formatAdminRelative(event.at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <AdminEmpty
              icon={<Database size={22} />}
              title="还没有操作记录"
              text="上传、编辑、关联世界或修改设置后，会在这里留下记录。"
            />
          )}
        </AdminPanel>

        <AdminPanel kicker="SYSTEM HEALTH" title="系统状态">
          {library.available && library.config?.configured ? (
            <p className="admin-panel__note">
              <Database size={13} aria-hidden="true" />
              存储库模式：容量取决于所选磁盘，不再受浏览器 localStorage 约 5MB 的限制。
            </p>
          ) : (
            <StorageMeter bytes={totalBytes} />
          )}
          <div className="admin-health-grid">
            <div>
              <span>世界查询</span>
              <strong>{apiBase ? '后端代理' : '本地资料库'}</strong>
            </div>
            <div>
              <span>待识别 ID</span>
              <strong className={pending ? 'is-warn' : ''}>{pending}</strong>
            </div>
            <div>
              <span>起始内容</span>
              <strong>{samples} 张</strong>
            </div>
            <div>
              <span>内置世界</span>
              <strong>{album.worlds.filter((world) => world.builtin).length} 条</strong>
            </div>
          </div>
          <div className="admin-inline-actions">
            <button type="button" className="button button--soft button--small" onClick={() => navigate('/admin/settings')}>
              数据与备份
            </button>
            <button type="button" className="button button--ghost button--small" onClick={() => navigate('/admin/worlds')}>
              维护世界资料
            </button>
          </div>
        </AdminPanel>
      </div>

      <AdminPanel
        kicker="LATEST SAVED"
        title="最近收录"
        actions={
          <button type="button" className="text-button" onClick={() => navigate('/admin/photos')}>
            照片管理
            <ArrowUpRight size={13} />
          </button>
        }
      >
        {recentPhotos.length ? (
          <div className="admin-recent-grid">
            {recentPhotos.map((photo) => (
              <button
                key={photo.id}
                type="button"
                className="admin-recent-card"
                onClick={() => navigate('/admin/photos')}
              >
                <SafeImage
                  src={photo.missing ? null : photo.src}
                  alt={photo.alt}
                  loading="lazy"
                />
                <span className="admin-recent-card__shade" aria-hidden="true" />
                <span className="admin-recent-card__date">
                  {formatDateShort(photo.capturedAt)}
                  {photo.isSample ? ' · 起始' : ''}
                </span>
                <span className="admin-recent-card__note">{photo.note || '未写备注'}</span>
                <span className="admin-recent-card__world">
                  <UploadCloud size={11} aria-hidden="true" />
                  {photo.world?.name ?? '未关联世界'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <AdminEmpty
            icon={<Images size={22} />}
            title="还没有照片"
            text="把第一段 VRChat 记忆收进时间轴吧。"
            action={
              <button type="button" className="button button--primary button--small" onClick={onUpload}>
                <Plus size={14} />
                收录照片
              </button>
            }
          />
        )}
      </AdminPanel>
    </div>
  );
}
