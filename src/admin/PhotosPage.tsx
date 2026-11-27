import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FilterX,
  ImageOff,
  Images,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Star,
  Tag,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type { FavoriteFilter, Photo, SmartAlbum } from '../types';
import { formatDateShort, formatTime } from '../utils/date';
import { rotatePhoto } from '../utils/orientation';
import { useToast } from '../hooks/useToast';
import { SafeImage } from '../components/SafeImage';
import { AdminPhotoEditor } from './AdminPhotoEditor';
import { AdminEmpty, AdminPageHead, AdminTag } from './AdminUI';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BulkEditDialog } from './BulkEditDialog';

interface PhotosPageProps {
  album: AlbumApi;
  onUpload: () => void;
  onNavigateWorlds: () => void;
}

type WorldFilter = 'all' | 'unlinked' | 'pending' | string;
type OriginFilter = 'all' | 'library' | 'uploaded' | 'sample' | 'missing';
type SortMode = 'newest' | 'oldest' | 'created' | 'note';

interface PendingBulk {
  kind: 'delete' | 'detach';
  ids: string[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function photoSearchText(photo: Photo): string {
  return normalize(
    [
      photo.note,
      photo.alt,
      photo.aiSummary,
      photo.aiTags?.join(' '),
      photo.tags?.join(' '),
      photo.isRemote ? photo.src : '',
      photo.world?.name,
      photo.world?.author,
      photo.worldId,
      formatDateShort(photo.capturedAt),
      formatTime(photo.capturedAt),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function sourceTag(photo: Photo) {
  if (!photo.world) return null;
  if (photo.world.source === 'demo') return <AdminTag tone="gold">内置</AdminTag>;
  if (photo.world.source === 'api') return <AdminTag tone="aqua">实时 API</AdminTag>;
  if (photo.world.source === 'manual') return <AdminTag tone="lilac">手动</AdminTag>;
  return <AdminTag tone="aqua">本地资料</AdminTag>;
}

function linkTag(photo: Photo) {
  if (!photo.world && photo.worldId) return <AdminTag tone="gold">待识别</AdminTag>;
  if (!photo.world) return <AdminTag tone="muted">未关联</AdminTag>;
  return <AdminTag tone="aqua">已关联</AdminTag>;
}

export function PhotosPage({ album, onUpload, onNavigateWorlds }: PhotosPageProps) {
  const { pushToast } = useToast();
  const [query, setQuery] = useState('');
  const [worldFilter, setWorldFilter] = useState<WorldFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const [tagFilter, setTagFilter] = useState('all');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [smartName, setSmartName] = useState('');

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of album.photos) {
      for (const tag of photo.tags || []) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'))
      .map(([tag, count]) => ({ tag, count }));
  }, [album.photos]);
  const smartAlbums = album.settings.smartAlbums ?? [];

  const worldOptions = useMemo(
    () =>
      album.worlds
        .map((world) => ({
          key: world.key,
          label: world.name,
          count: album.photos.filter((photo) => photo.worldRef === world.key).length,
        }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN')),
    [album.worlds, album.photos],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    const rows = album.photos.filter((photo) => {
      if (q && !photoSearchText(photo).includes(q)) return false;
      if (originFilter === 'library' && photo.mediaKind !== 'library') return false;
      if (originFilter === 'missing' && !photo.missing) return false;
      if (originFilter === 'uploaded' && !photo.isUploaded) return false;
      if (originFilter === 'sample' && !photo.isSample) return false;
      if (favoriteFilter === 'only' && !photo.favorite) return false;
      if (favoriteFilter === 'none' && photo.favorite) return false;
      if (tagFilter !== 'all' && !(photo.tags || []).includes(tagFilter)) return false;
      if (worldFilter === 'unlinked') return !photo.world && !photo.worldId;
      if (worldFilter === 'pending') return !photo.world && Boolean(photo.worldId);
      if (worldFilter !== 'all' && photo.worldRef !== worldFilter) return false;
      return true;
    });
    return rows.sort((a, b) => {
      if (sortMode === 'created') return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (sortMode === 'note') return a.note.localeCompare(b.note, 'zh-Hans-CN');
      const diff = Date.parse(a.capturedAt) - Date.parse(b.capturedAt);
      return sortMode === 'oldest' ? diff : -diff;
    });
  }, [album.photos, query, originFilter, worldFilter, sortMode, tagFilter, favoriteFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageIds = pageRows.map((photo) => photo.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const resetFilters = () => {
    setQuery('');
    setWorldFilter('all');
    setOriginFilter('all');
    setSortMode('newest');
    setTagFilter('all');
    setFavoriteFilter('all');
    setPage(1);
  };

  const saveSmartAlbum = () => {
    const name = (smartName.trim() || `智能相册 ${smartAlbums.length + 1}`).slice(0, 24);
    const albumFilter: SmartAlbum = {
      id: `smart_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      query,
      worldRef: worldFilter,
      origin: originFilter,
      sort: sortMode,
      tag: tagFilter,
      favorite: favoriteFilter,
      createdAt: new Date().toISOString(),
    };
    album.updateSettings({
      smartAlbums: [...smartAlbums, albumFilter].slice(-20),
    });
    setSmartName('');
    pushToast({
      tone: 'success',
      title: '已保存智能相册',
      description: `「${name}」会记住当前筛选条件。`,
    });
  };

  const applySmartAlbum = (entry: SmartAlbum) => {
    setQuery(entry.query);
    setWorldFilter(entry.worldRef as WorldFilter);
    setOriginFilter(entry.origin as OriginFilter);
    setSortMode(entry.sort as SortMode);
    setTagFilter(entry.tag);
    setFavoriteFilter(entry.favorite as FavoriteFilter);
    setPage(1);
  };

  const deleteSmartAlbum = (id: string) => {
    album.updateSettings({
      smartAlbums: smartAlbums.filter((entry) => entry.id !== id),
    });
  };

  const toggleFavorite = (photo: Photo) => {
    album.updatePhoto(photo.id, { favorite: photo.favorite ? undefined : true });
  };

  const toggleFeatured = (photo: Photo) => {
    const pinned = album.settings.featuredPhotoId === photo.id;
    album.setFeaturedPhoto(pinned ? null : photo.id);
    pushToast({
      tone: 'success',
      title: pinned ? '已取消置顶' : '已设为首页置顶',
      description: pinned
        ? '公开相册首页将恢复显示最新收录的照片。'
        : '公开相册首页开头的置顶图片已更新。',
    });
  };

  const performBulk = () => {
    if (!pending) return;
    if (pending.kind === 'delete') album.deletePhotos(pending.ids);
    else album.detachWorldFromPhotos(pending.ids);
    pushToast({
      tone: pending.kind === 'delete' ? 'default' : 'success',
      title: pending.kind === 'delete' ? '已批量删除照片' : '已解除世界关联',
      description: `${pending.ids.length} 张照片已更新。`,
    });
    setSelected(new Set());
    setPending(null);
  };

  const rotateSelected = (delta: -90 | 90) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    for (const id of ids) {
      const photo = album.photos.find((item) => item.id === id);
      if (!photo) continue;
      const next = rotatePhoto(photo.rotation, delta);
      album.updatePhoto(id, { rotation: next === 0 ? undefined : next });
    }
    pushToast({
      tone: 'success',
      title: `已旋转 ${ids.length} 张照片`,
      description: '只改变相册显示，原图未被修改。',
    });
  };

  const activeFilters =
    query.trim() !== '' ||
    worldFilter !== 'all' ||
    originFilter !== 'all' ||
    sortMode !== 'newest' ||
    tagFilter !== 'all' ||
    favoriteFilter !== 'all';

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="PHOTOS · 照片管理"
        title="照片库"
        description={`共 ${album.photos.length} 张照片。可以编辑拍摄时间、备注、替代文本，并批量整理世界关联。`}
        actions={
          <button type="button" className="button button--primary button--small" onClick={onUpload}>
            <Plus size={15} />
            收录照片
          </button>
        }
      />

      <section className="admin-panel admin-toolbar-panel">
        <div className="admin-toolbar">
          <div className="admin-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="搜索备注、世界、World ID 或日期…"
              aria-label="搜索照片"
            />
          </div>
          <select
            className="admin-select"
            value={worldFilter}
            onChange={(event) => {
              setWorldFilter(event.target.value);
              setPage(1);
            }}
            aria-label="按世界筛选"
          >
            <option value="all">全部世界</option>
            <option value="unlinked">未关联世界</option>
            <option value="pending">待识别的世界</option>
            {worldOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}（{option.count}）
              </option>
            ))}
          </select>
          <select
            className="admin-select"
            value={originFilter}
            onChange={(event) => {
              setOriginFilter(event.target.value as OriginFilter);
              setPage(1);
            }}
            aria-label="按来源筛选"
          >
            <option value="all">全部来源</option>
            <option value="library">存储库照片</option>
            <option value="uploaded">用户收录</option>
            <option value="sample">起始内容</option>
            <option value="missing">文件缺失</option>
          </select>
          <select
            className="admin-select"
            value={tagFilter}
            onChange={(event) => {
              setTagFilter(event.target.value);
              setPage(1);
            }}
            aria-label="按标签筛选"
          >
            <option value="all">全部标签</option>
            {tagOptions.map((option) => (
              <option key={option.tag} value={option.tag}>
                #{option.tag}（{option.count}）
              </option>
            ))}
          </select>
          <select
            className="admin-select"
            value={favoriteFilter}
            onChange={(event) => {
              setFavoriteFilter(event.target.value as FavoriteFilter);
              setPage(1);
            }}
            aria-label="按收藏筛选"
          >
            <option value="all">全部照片</option>
            <option value="only">只看收藏</option>
            <option value="none">未收藏</option>
          </select>
          <select
            className="admin-select"
            value={sortMode}
            onChange={(event) => {
              setSortMode(event.target.value as SortMode);
              setPage(1);
            }}
            aria-label="排序方式"
          >
            <option value="newest">拍摄时间：新 → 旧</option>
            <option value="oldest">拍摄时间：旧 → 新</option>
            <option value="created">按收录顺序</option>
            <option value="note">按备注排序</option>
          </select>
          {activeFilters ? (
            <button type="button" className="text-button" onClick={resetFilters}>
              <FilterX size={14} />
              清除筛选
            </button>
          ) : null}
          <span className="admin-toolbar__count">
            筛选后 {filtered.length} 张
          </span>
        </div>

        <div className="admin-smart-albums">
          {smartAlbums.map((entry) => (
            <span className="smart-album-chip" key={entry.id}>
              <button type="button" onClick={() => applySmartAlbum(entry)}>
                <Star size={11} aria-hidden="true" />
                {entry.name}
              </button>
              <button
                type="button"
                className="smart-album-chip__remove"
                onClick={() => deleteSmartAlbum(entry.id)}
                aria-label={`删除智能相册 ${entry.name}`}
              >
                ×
              </button>
            </span>
          ))}
          {activeFilters ? (
            <span className="smart-album-save">
              <Tag size={11} aria-hidden="true" />
              <input
                type="text"
                value={smartName}
                maxLength={24}
                placeholder="智能相册名称"
                onChange={(event) => setSmartName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    saveSmartAlbum();
                  }
                }}
                aria-label="智能相册名称"
              />
              <button type="button" onClick={saveSmartAlbum}>
                保存当前筛选
              </button>
            </span>
          ) : null}
        </div>

        {selected.size > 0 ? (
          <div className="admin-bulkbar" aria-live="polite">
            <span>已选择 {selected.size} 张</span>
            <button
              type="button"
              className="text-button"
              onClick={() => setBulkEditOpen(true)}
            >
              <Pencil size={13} />
              批量编辑
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => rotateSelected(-90)}
              title="选中照片向左旋转 90°（只改变显示）"
            >
              <RotateCcw size={13} />
              向左旋转
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => rotateSelected(90)}
              title="选中照片向右旋转 90°（只改变显示）"
            >
              <RotateCw size={13} />
              向右旋转
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setPending({ kind: 'detach', ids: [...selected] })}
            >
              <Unlink size={13} />
              解除世界关联
            </button>
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={() => setPending({ kind: 'delete', ids: [...selected] })}
            >
              <Trash2 size={13} />
              批量删除
            </button>
            <button type="button" className="text-button" onClick={() => setSelected(new Set())}>
              取消选择
            </button>
          </div>
        ) : null}

        {pageRows.length ? (
          <>
            <div className="admin-table-wrap">
              <table className="admin-table admin-photo-table">
                <thead>
                  <tr>
                    <th className="admin-table__check">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleAllPage}
                        aria-label="选择本页全部照片"
                      />
                    </th>
                    <th>照片</th>
                    <th>拍摄时间</th>
                    <th>备注</th>
                    <th>世界</th>
                    <th>状态</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((photo) => {
                    const isSelected = selected.has(photo.id);
                    const isFeatured = album.settings.featuredPhotoId === photo.id;
                    return (
                      <tr
                        key={photo.id}
                        className={isSelected ? 'is-selected' : undefined}
                        onClick={() => setEditingId(photo.id)}
                      >
                        <td className="admin-table__check" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(photo.id)}
                            aria-label={`选择 ${formatDateShort(photo.capturedAt)} 的照片`}
                          />
                        </td>
                        <td>
                          <div className="admin-photo-cell">
                            <SafeImage
                              src={photo.missing ? null : photo.src}
                              alt=""
                              loading="lazy"
                            />
                            <div>
                              <span className="admin-photo-cell__title">
                                {photo.isUploaded
                                  ? photo.isRemote
                                    ? '链接照片'
                                    : photo.mediaKind === 'library'
                                      ? '存储库照片'
                                      : '本地照片'
                                  : photo.isSample
                                    ? '起始照片'
                                    : '相册照片'}
                                {photo.missing ? (
                                  <span className="admin-featured-mark">
                                    <ImageOff size={8} aria-hidden="true" />
                                    文件缺失
                                  </span>
                                ) : null}
                                {isFeatured ? (
                                  <span className="admin-featured-mark">
                                    <Pin size={8} aria-hidden="true" />
                                    置顶
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  className={`admin-star-toggle${photo.favorite ? ' is-active' : ''}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleFavorite(photo);
                                  }}
                                  aria-pressed={photo.favorite === true}
                                  aria-label={photo.favorite ? '取消收藏' : '收藏这张照片'}
                                  title={photo.favorite ? '取消收藏' : '收藏'}
                                >
                                  <Star size={11} aria-hidden="true" />
                                </button>
                              </span>
                              <span className="admin-photo-cell__id">
                                {photo.width ?? 1600} × {photo.height ?? 1200}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <time dateTime={photo.capturedAt}>
                            {formatDateShort(photo.capturedAt)}
                            <span>{formatTime(photo.capturedAt)}</span>
                          </time>
                        </td>
                        <td>
                          <p className="admin-note-cell">{photo.note || '未写备注'}</p>
                        </td>
                        <td>
                          <div className="admin-world-cell">
                            <span>{photo.world?.name ?? (photo.worldId ? '待识别' : '未关联')}</span>
                            {photo.world?.name ? sourceTag(photo) : null}
                          </div>
                        </td>
                        <td>{linkTag(photo)}</td>
                        <td>
                          <div className="admin-row-actions" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className={`icon-button icon-button--tiny admin-pin-button${isFeatured ? ' is-active' : ''}`}
                              onClick={() => toggleFeatured(photo)}
                              aria-label={isFeatured ? '取消首页置顶' : '设为首页置顶'}
                              aria-pressed={isFeatured}
                              title={isFeatured ? '取消置顶' : '设为首页置顶'}
                            >
                              {isFeatured ? <PinOff size={13} /> : <Pin size={13} />}
                            </button>
                            <button
                              type="button"
                              className="icon-button icon-button--tiny"
                              onClick={() => setEditingId(photo.id)}
                              aria-label="编辑照片"
                              title="编辑"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className="icon-button icon-button--tiny admin-danger-button"
                              onClick={() => setPending({ kind: 'delete', ids: [photo.id] })}
                              aria-label="删除照片"
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="admin-photo-cards">
              {pageRows.map((photo) => {
                const isFeatured = album.settings.featuredPhotoId === photo.id;
                return (
                  <article
                    key={photo.id}
                    className={`admin-photo-mobile${selected.has(photo.id) ? ' is-selected' : ''}`}
                  >
                    <label className="admin-photo-mobile__check">
                      <input
                        type="checkbox"
                        checked={selected.has(photo.id)}
                        onChange={() => toggleSelect(photo.id)}
                        aria-label={`选择 ${formatDateShort(photo.capturedAt)} 的照片`}
                      />
                    </label>
                    <button
                      type="button"
                      className="admin-photo-mobile__main"
                      onClick={() => setEditingId(photo.id)}
                    >
                      <SafeImage src={photo.missing ? null : photo.src} alt="" loading="lazy" />
                      <span className="admin-photo-mobile__body">
                        <span className="admin-photo-mobile__meta">
                          <time dateTime={photo.capturedAt}>
                            {formatDateShort(photo.capturedAt)} · {formatTime(photo.capturedAt)}
                          </time>
                          {linkTag(photo)}
                          {photo.mediaKind === 'library' ? (
                            <AdminTag tone="aqua">存储库</AdminTag>
                          ) : null}
                          {photo.worldIdSource === 'ai' ? (
                            <AdminTag tone="aqua">AI 识图</AdminTag>
                          ) : null}
                          {photo.missing ? <AdminTag tone="gold">文件缺失</AdminTag> : null}
                          {photo.isRemote ? <AdminTag tone="lilac">链接</AdminTag> : null}
                          {isFeatured ? (
                            <span className="admin-featured-mark">
                              <Pin size={8} aria-hidden="true" />
                              置顶
                            </span>
                          ) : null}
                        </span>
                        <span className="admin-photo-mobile__note">{photo.note || '未写备注'}</span>
                        <span className="admin-photo-mobile__world">
                          {photo.world?.name ?? (photo.worldId ? '世界待识别' : '未关联世界')}
                        </span>
                      </span>
                    </button>
                    <div className="admin-photo-mobile__actions">
                      <button
                        type="button"
                        className={`icon-button icon-button--tiny admin-pin-button${isFeatured ? ' is-active' : ''}`}
                        onClick={() => toggleFeatured(photo)}
                        aria-label={isFeatured ? '取消首页置顶' : '设为首页置顶'}
                        aria-pressed={isFeatured}
                        title={isFeatured ? '取消置顶' : '设为首页置顶'}
                      >
                        {isFeatured ? <PinOff size={13} /> : <Pin size={13} />}
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--tiny"
                        onClick={() => setEditingId(photo.id)}
                        aria-label="编辑照片"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button icon-button--tiny admin-danger-button"
                        onClick={() => setPending({ kind: 'delete', ids: [photo.id] })}
                        aria-label="删除照片"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="admin-pagination">
              <span>
                第 {safePage} / {pageCount} 页
              </span>
              <div>
                <select
                  className="admin-select admin-select--small"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                  aria-label="每页数量"
                >
                  <option value={10}>每页 10 张</option>
                  <option value={20}>每页 20 张</option>
                  <option value={50}>每页 50 张</option>
                </select>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={safePage <= 1}
                  aria-label="上一页"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                  disabled={safePage >= pageCount}
                  aria-label="下一页"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <AdminEmpty
            icon={<Images size={24} />}
            title={album.photos.length ? '没有符合筛选条件的照片' : '照片库还是空的'}
            text={
              album.photos.length
                ? '换一个关键词或世界筛选，或清除全部条件。'
                : '收录第一张照片后，可以在这里管理时间、备注与世界关联。'
            }
            action={
              album.photos.length ? (
                <button type="button" className="button button--soft button--small" onClick={resetFilters}>
                  清除筛选
                </button>
              ) : (
                <button type="button" className="button button--primary button--small" onClick={onUpload}>
                  <Plus size={14} />
                  收录照片
                </button>
              )
            }
          />
        )}
      </section>

      <AdminPhotoEditor
        photoId={editingId}
        album={album}
        onClose={() => setEditingId(null)}
        onNavigateWorlds={() => {
          setEditingId(null);
          onNavigateWorlds();
        }}
      />

      <BulkEditDialog
        open={bulkEditOpen}
        count={selected.size}
        worlds={album.worlds}
        onClose={() => setBulkEditOpen(false)}
        onApply={(patch) => {
          const ids = [...selected];
          album.updatePhotos(ids, patch);
          pushToast({
            tone: 'success',
            title: `已更新 ${ids.length} 张照片`,
            description: '世界、日期、备注、标签或收藏状态已应用。',
          });
          setBulkEditOpen(false);
          setSelected(new Set());
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'detach' ? '解除这些照片的世界关联？' : '删除这些照片？'}
        description={
          pending
            ? pending.kind === 'detach'
              ? `将解除 ${pending.ids.length} 张照片与世界资料的关联，照片本身会保留。`
              : `将删除 ${pending.ids.length} 张照片，并从本地存储中移除，无法撤销。请先确认已导出备份。`
            : ''
        }
        confirmLabel={pending?.kind === 'detach' ? '解除关联' : '确认删除'}
        onConfirm={performBulk}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
