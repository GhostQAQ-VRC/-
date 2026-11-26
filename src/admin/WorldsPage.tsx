import { useEffect, useMemo, useState } from 'react';
import {
  Globe2,
  ImagePlus,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { AlbumApi, WorldEntryInput } from '../hooks/useAlbum';
import type { WorldLibraryEntry } from '../types';
import { WORLD_ID_PATTERN } from '../services/worldService';
import { effectiveWorldApiBase } from '../data/settings';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/Modal';
import { SafeImage } from '../components/SafeImage';
import { AdminEmpty, AdminPageHead, AdminTag, formatAdminDate } from './AdminUI';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { VRChatPanel } from './VRChatPanel';
import { isMobileRuntime } from '../platform/mobileRuntime';

interface WorldsPageProps {
  album: AlbumApi;
}

function worldUsage(album: AlbumApi, key: string): number {
  return album.photos.filter((photo) => photo.worldRef === key).length;
}

function WorldSourceTag({ entry }: { entry: WorldLibraryEntry }) {
  if (entry.source === 'demo') return <AdminTag tone="gold">内置资料</AdminTag>;
  if (entry.source === 'api') return <AdminTag tone="aqua">API 缓存</AdminTag>;
  if (entry.source === 'manual') return <AdminTag tone="lilac">手动</AdminTag>;
  return <AdminTag tone="aqua">本地资料</AdminTag>;
}

interface EditorProps {
  entryKey: string | null;
  album: AlbumApi;
  onClose: () => void;
}

function AdminWorldEditor({ entryKey, album, onClose }: EditorProps) {
  const { pushToast } = useToast();
  const entry = entryKey ? album.worlds.find((item) => item.key === entryKey) : undefined;
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [author, setAuthor] = useState('');
  const [capacity, setCapacity] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnail, setThumbnail] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [guard, setGuard] = useState(false);

  useEffect(() => {
    setName(entry?.name ?? '');
    setId(entry?.id ?? '');
    setAuthor(entry?.author ?? '');
    setCapacity(entry?.capacity ? String(entry.capacity) : '');
    setDescription(entry?.description ?? '');
    setThumbnail(entry?.thumbnail ?? '');
    setNotes(entry?.notes ?? '');
    setError('');
    setConfirmingDelete(false);
    setGuard(false);
  }, [entryKey]);

  const dirty =
    name !== (entry?.name ?? '') ||
    id !== (entry?.id ?? '') ||
    author !== (entry?.author ?? '') ||
    capacity !== (entry?.capacity ? String(entry.capacity) : '') ||
    description !== (entry?.description ?? '') ||
    thumbnail !== (entry?.thumbnail ?? '') ||
    notes !== (entry?.notes ?? '');

  const requestClose = () => {
    if (dirty) {
      setGuard(true);
      return;
    }
    onClose();
  };

  const usage = entryKey ? album.photos.filter((photo) => photo.worldRef === entryKey).length : 0;
  const photoCovers = album.photos.slice(0, 6);
  const apiEnabled = Boolean(effectiveWorldApiBase(album.settings));

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请填写世界名称。');
      return;
    }
    const normalizedId = id.trim().toLowerCase();
    if (normalizedId && !WORLD_ID_PATTERN.test(normalizedId)) {
      setError('World ID 格式不正确，应为 wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx。');
      return;
    }
    if (normalizedId) {
      const duplicate = album.worlds.find(
        (item) =>
          item.key !== entryKey &&
          item.id &&
          item.id.toLowerCase() === normalizedId,
      );
      if (duplicate) {
        setError(`这个 World ID 已存在于「${duplicate.name}」中。`);
        return;
      }
    }
    const input: WorldEntryInput = {
      name: trimmedName,
      id: normalizedId,
      author,
      capacity: capacity ? Number(capacity) : undefined,
      description,
      thumbnail,
      notes,
    };
    const saved = album.saveWorld(input, entryKey ?? undefined);
    pushToast({
      tone: 'success',
      title: entry ? '世界资料已更新' : '世界资料已新增',
      description: `${saved.name}${usage ? ` · 已同步 ${usage} 张照片` : ''}`,
    });
    onClose();
  };

  const remove = () => {
    if (!entryKey) return;
    album.deleteWorld(entryKey);
    pushToast({
      title: '世界资料已删除',
      description: usage ? `${usage} 张照片已回到未关联状态。` : entry?.name,
    });
    onClose();
  };

  return (
    <Modal
      open
      onClose={requestClose}
      labelledBy="admin-world-title"
      className="admin-modal admin-world-editor"
    >
      <div className="admin-world-editor__body">
        <button
          type="button"
          className="admin-editor__close icon-button icon-button--small"
          onClick={requestClose}
          aria-label="关闭世界编辑"
        >
          <X size={16} />
        </button>
        <header className="admin-editor__header">
          <p className="section-kicker">WORLD LIBRARY</p>
          <h2 id="admin-world-title">{entry ? '编辑世界资料' : '新增世界资料'}</h2>
          <p>
            {entry
              ? usage
                ? `保存后会同步更新 ${usage} 张已关联照片。`
                : '这条资料目前没有关联照片。'
              : '新增后可被照片通过 World ID 离线识别，或直接从资料库选择。'}
          </p>
        </header>

        <div className="admin-editor__fields">
          <div className="field">
            <label className="field-label" htmlFor="admin-world-name">
              世界名称 <span className="field-required">必填</span>
            </label>
            <div className="input-shell">
              <input
                id="admin-world-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：月灯りの杜"
                maxLength={80}
                data-autofocus
              />
            </div>
          </div>

          <div className="admin-editor__row">
            <div className="field">
              <label className="field-label" htmlFor="admin-world-id">
                World ID
              </label>
              <div className="input-shell">
                <input
                  id="admin-world-id"
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  placeholder="wrld_…"
                  spellCheck={false}
                  autoComplete="off"
                  className="admin-mono-input"
                />
              </div>
              <p className="field-hint">可留空；填写后离线识别才能命中。</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="admin-world-author">
                作者
              </label>
              <div className="input-shell">
                <input
                  id="admin-world-author"
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  placeholder="创作者名称"
                  maxLength={60}
                />
              </div>
            </div>
          </div>

          <div className="admin-editor__row">
            <div className="field">
              <label className="field-label" htmlFor="admin-world-capacity">
                建议人数
              </label>
              <div className="input-shell">
                <input
                  id="admin-world-capacity"
                  type="number"
                  min={1}
                  max={200}
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                  placeholder="例如 32"
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="admin-world-thumbnail">
                封面 URL
              </label>
              <div className="input-shell">
                <input
                  id="admin-world-thumbnail"
                  value={thumbnail}
                  onChange={(event) => setThumbnail(event.target.value)}
                  placeholder="https://… 或 data:image/…"
                />
              </div>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="admin-world-description">
              世界简介
            </label>
            <textarea
              id="admin-world-description"
              className="note-textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="给这个世界写一段介绍，会显示在照片详情中。"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="admin-world-notes">
              管理备注 <span className="field-optional">仅管理台可见</span>
            </label>
            <div className="input-shell">
              <input
                id="admin-world-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="例如：来自某次活动的收藏"
                maxLength={200}
              />
            </div>
          </div>

          <div className="admin-world-cover">
            <div className="admin-world-cover__preview">
              {thumbnail ? (
                <SafeImage src={thumbnail} alt="世界封面预览" />
              ) : (
                <span>
                  <ImagePlus size={22} aria-hidden="true" />
                  无封面
                </span>
              )}
            </div>
            <div className="admin-world-cover__picker">
              <p className="field-label">从已有照片选择封面</p>
              <div className="admin-cover-grid">
                {photoCovers.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    className="admin-cover-thumb"
                    onClick={() => setThumbnail(photo.src)}
                    aria-label={`使用 ${photo.note || '照片'} 作为封面`}
                    title={photo.note || photo.alt}
                  >
                    <SafeImage src={photo.missing ? null : photo.src} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
              {thumbnail ? (
                <button type="button" className="text-button" onClick={() => setThumbnail('')}>
                  清除封面
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}

        {confirmingDelete ? (
          <div className="inline-confirm" role="alert">
            <p>
              删除世界资料会保留照片，但
              {usage ? ` ${usage} 张照片会回到未关联状态。` : ' 当前没有照片受影响。'}
            </p>
            <div className="inline-confirm__actions">
              <button type="button" className="button button--danger button--tiny" onClick={remove}>
                确认删除
              </button>
              <button
                type="button"
                className="button button--ghost button--tiny"
                onClick={() => setConfirmingDelete(false)}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        <footer className="admin-editor__footer">
          {entry ? (
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} />
              删除世界资料
            </button>
          ) : (
            <span className="admin-editor__footer-note">
              {apiEnabled ? '当前也配置了后端代理；本地资料仍可优先使用。' : '保存后可在照片详情中从资料库选择。'}
            </span>
          )}
          <div className="admin-editor__actions">
            <button type="button" className="button button--ghost button--small" onClick={requestClose}>
              取消
            </button>
            <button type="button" className="button button--primary button--small" onClick={save}>
              保存世界资料
            </button>
          </div>
        </footer>
      </div>

      {guard ? (
        <div className="admin-editor-guard" role="alert">
          <p>还有未保存的世界资料修改，确定要关闭吗？</p>
          <div>
            <button type="button" className="text-button" onClick={() => setGuard(false)}>
              继续编辑
            </button>
            <button type="button" className="button button--danger button--tiny" onClick={onClose}>
              放弃并关闭
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function WorldsPage({ album }: WorldsPageProps) {
  const { pushToast } = useToast();
  const [query, setQuery] = useState('');
  const [editorKey, setEditorKey] = useState<string | null | undefined>(undefined);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return album.worlds
      .map((world) => ({
        world,
        count: album.photos.filter((photo) => photo.worldRef === world.key).length,
      }))
      .filter(({ world }) =>
        q
          ? [world.name, world.author, world.id, world.description]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => b.count - a.count || a.world.name.localeCompare(b.world.name, 'zh-Hans-CN'));
  }, [album.worlds, album.photos, query]);

  const deleteTarget = deleteKey ? album.worlds.find((world) => world.key === deleteKey) : null;
  const deleteUsage = deleteKey ? worldUsage(album, deleteKey) : 0;

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="WORLD LIBRARY · 世界资料库"
        title="世界资料"
        description="维护可离线识别的世界资料。照片通过 World ID 或资料库选择建立关联；保存修改会同步到所有关联照片。"
        actions={
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setEditorKey(null)}
          >
            <Plus size={15} />
            新增世界
          </button>
        }
      />

      {isMobileRuntime() ? null : <VRChatPanel album={album} />}

      <section className="admin-panel admin-toolbar-panel">
        <div className="admin-toolbar">
          <div className="admin-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索世界名称、作者或 World ID…"
              aria-label="搜索世界资料"
            />
          </div>
          <span className="admin-toolbar__count">
            {rows.length} / {album.worlds.length} 条资料
          </span>
        </div>

        {rows.length ? (
          <div className="admin-world-grid">
            {rows.map(({ world, count }) => (
              <article className="admin-world-card" key={world.key}>
                <button
                  type="button"
                  className="admin-world-card__hit"
                  onClick={() => setEditorKey(world.key)}
                  aria-label={`编辑世界资料 ${world.name}`}
                />
                <div className="admin-world-card__media">
                  {world.thumbnail ? (
                    <SafeImage src={world.thumbnail} alt="" loading="lazy" />
                  ) : (
                    <span className="admin-world-card__fallback" aria-hidden="true">
                      <Globe2 size={26} strokeWidth={1.3} />
                    </span>
                  )}
                  <span className="admin-world-card__count">{count} 张照片</span>
                </div>
                <div className="admin-world-card__body">
                  <div className="admin-world-card__title-row">
                    <h3>{world.name}</h3>
                    <WorldSourceTag entry={world} />
                  </div>
                  <p className="admin-world-card__by">
                    {world.author || '未知作者'}
                    {world.capacity ? ` · ${world.capacity} 人` : ''}
                  </p>
                  {world.id ? (
                    <code className="admin-world-card__id">{world.id}</code>
                  ) : (
                    <span className="admin-world-card__id admin-world-card__id--empty">
                      未填写 World ID
                    </span>
                  )}
                  <p className="admin-world-card__desc">
                    {world.description || '还没有简介。打开编辑补充一段描述。'}
                  </p>
                  <div className="admin-world-card__footer">
                    <span>更新于 {formatAdminDate(world.updatedAt)}</span>
                    <button
                      type="button"
                      className="text-button text-button--danger admin-world-card__delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteKey(world.key);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <AdminEmpty
            icon={<Globe2 size={24} />}
            title="没有找到世界资料"
            text={query ? '换一个关键词，或清空搜索。' : '新增真实或自建世界资料，照片就能离线识别。'}
            action={
              query ? (
                <button type="button" className="button button--soft button--small" onClick={() => setQuery('')}>
                  清空搜索
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => setEditorKey(null)}
                >
                  <Plus size={14} />
                  新增世界
                </button>
              )
            }
          />
        )}
      </section>

      {editorKey !== undefined ? (
        <AdminWorldEditor
          entryKey={editorKey}
          album={album}
          onClose={() => setEditorKey(undefined)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除这条世界资料？"
        description={
          deleteTarget
            ? `「${deleteTarget.name}」将从资料库移除${
                deleteUsage ? `，${deleteUsage} 张照片会回到未关联状态` : ''
              }。照片本身不会删除。`
            : ''
        }
        confirmLabel="确认删除"
        onConfirm={() => {
          if (!deleteKey) return;
          album.deleteWorld(deleteKey);
          pushToast({
            title: '世界资料已删除',
            description: deleteUsage
              ? `${deleteUsage} 张照片已回到未关联状态。`
              : deleteTarget?.name,
          });
          setDeleteKey(null);
        }}
        onCancel={() => setDeleteKey(null)}
      />
    </div>
  );
}
