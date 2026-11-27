import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  Heart,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  ShieldQuestion,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type { DesktopPlayer } from '../platform';
import { usePlayerLibrary } from '../hooks/usePlayerLibrary';
import { useToast } from '../hooks/useToast';
import { formatDateShort } from '../utils/date';
import { Modal } from '../components/Modal';
import { SafeImage } from '../components/SafeImage';
import { PlayerAvatar } from '../components/PlayerAvatar';
import {
  AdminEmpty,
  AdminPageHead,
  AdminStat,
  formatAdminDate,
} from './AdminUI';

interface PlayersPageProps {
  album: AlbumApi;
  navigate: (path: string) => void;
}

type PlayerFilter = 'all' | 'friends' | 'strangers';

function playerBadge(player: DesktopPlayer): { label: string; tone: string } {
  if (player.isSelf) return { label: '自己', tone: 'self' };
  if (player.isFriend) return { label: '好友', tone: 'friend' };
  if (player.removedFromFriendsAt) return { label: '前好友', tone: 'former' };
  return { label: '陌生人', tone: 'stranger' };
}

export function PlayersPage({ album, navigate }: PlayersPageProps) {
  const library = usePlayerLibrary();
  const { pushToast } = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PlayerFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const photoCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const photo of album.photos) {
      if (photo.missing) continue;
      for (const id of photo.playerIds || []) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    return counts;
  }, [album.photos]);

  const activePlayer = activeId
    ? library.players.find((player) => player.id === activeId) || null
    : null;
  const activePhotos = activePlayer
    ? album.photos.filter((photo) => photo.playerIds?.includes(activePlayer.id)).slice(0, 9)
    : [];

  useEffect(() => {
    if (!activePlayer) {
      setActiveId(null);
      return;
    }
    setNoteDraft(activePlayer.note);
    setConfirmRemove(false);
  }, [activePlayer?.id]);

  const counts = useMemo(() => {
    const total = library.players.length;
    const friends = library.players.filter(
      (player) => player.isFriend && !player.isSelf,
    ).length;
    const strangers = library.players.filter(
      (player) => !player.isFriend && !player.isSelf,
    ).length;
    const withAvatar = library.players.filter((player) => Boolean(player.avatar)).length;
    return { total, friends, strangers, withAvatar };
  }, [library.players]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return library.players.filter((player) => {
      if (filter === 'friends' && !player.isFriend) return false;
      if (filter === 'strangers' && (player.isFriend || player.isSelf)) return false;
      if (!text) return true;
      return (
        player.displayName.toLowerCase().includes(text) ||
        player.id.toLowerCase().includes(text) ||
        player.username.toLowerCase().includes(text) ||
        player.note.toLowerCase().includes(text)
      );
    });
  }, [library.players, filter, query]);

  const syncFriends = async () => {
    if (syncBusy || library.view?.status.running) return;
    setSyncBusy(true);
    try {
      const result = await library.sync();
      if (result.ok) {
        pushToast({
          tone: 'success',
          title: '好友列表已同步',
          description: `${result.friends ?? 0} 位好友，头像变化已保存为快照。`,
        });
      } else if (result.needsLogin) {
        pushToast({
          tone: 'warning',
          title: '需要登录 VRChat',
          description: '请先在「世界资料库」登录官方账号，再同步好友。',
        });
      } else {
        pushToast({
          tone: 'danger',
          title: '好友同步失败',
          description: result.error || '请稍后重试。',
        });
      }
    } catch (caught) {
      pushToast({
        tone: 'danger',
        title: '好友同步失败',
        description: (caught as Error).message || '请稍后重试。',
      });
    } finally {
      setSyncBusy(false);
    }
  };

  const addPlayer = async () => {
    if (addBusy) return;
    setAddError('');
    if (!newId.trim() && !newName.trim()) {
      setAddError('请填写 VRChat ID，或只填写一个玩家名称。');
      return;
    }
    setAddBusy(true);
    try {
      const result = await library.add({
        id: newId.trim() || undefined,
        displayName: newName.trim() || undefined,
        note: newNote.trim() || undefined,
      });
      if (!result.ok || !result.player) {
        setAddError(result.error || '添加玩家失败。');
        return;
      }
      setAddOpen(false);
      setNewId('');
      setNewName('');
      setNewNote('');
      pushToast({
        tone: 'success',
        title: `${result.player.displayName} 已加入玩家列表`,
        description: result.warning || '头像已抓取并缓存。',
      });
      setActiveId(result.player.id);
    } catch (caught) {
      setAddError((caught as Error).message || '添加玩家失败。');
    } finally {
      setAddBusy(false);
    }
  };

  const saveNote = async () => {
    if (!activePlayer || noteBusy) return;
    setNoteBusy(true);
    try {
      const result = await library.update(activePlayer.id, { note: noteDraft });
      if (result.ok) {
        pushToast({ tone: 'success', title: '玩家备注已保存' });
      } else {
        pushToast({ tone: 'danger', title: '保存失败', description: result.error });
      }
    } finally {
      setNoteBusy(false);
    }
  };

  const refreshActive = async () => {
    if (!activePlayer || refreshBusy) return;
    setRefreshBusy(true);
    try {
      const result = await library.refreshPlayer(activePlayer.id);
      if (result.ok) {
        pushToast({ tone: 'success', title: '玩家资料已刷新' });
      } else if (result.needsLogin) {
        pushToast({
          tone: 'warning',
          title: '需要登录 VRChat',
          description: result.error || '登录后才能刷新官方资料。',
        });
      } else {
        pushToast({
          tone: 'danger',
          title: '刷新失败',
          description: result.error || '请稍后重试。',
        });
      }
    } finally {
      setRefreshBusy(false);
    }
  };

  const removeActive = async () => {
    if (!activePlayer) return;
    const result = await library.remove(activePlayer.id);
    if (result.ok) {
      pushToast({
        title: '玩家已从列表移除',
        description: '照片里的玩家 ID 仍会保留，但不再显示名称和头像。',
      });
      setActiveId(null);
    } else {
      pushToast({ tone: 'danger', title: '移除失败', description: result.error });
    }
  };

  const status = library.view?.status;
  const syncing = Boolean(status?.running) || syncBusy;

  return (
    <div className="admin-page players-page">
      <AdminPageHead
        kicker="PLAYERS · 玩家列表"
        title="玩家列表"
        description="记录好友、陌生人和合照标记；资料与头像快照只保存在本地存储库。"
        actions={
          <>
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void syncFriends()}
              disabled={syncing || !library.available}
            >
              {syncing ? (
                <Loader2 size={14} className="spinner" aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              {syncing ? status?.message || '同步中…' : '同步好友'}
            </button>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => setAddOpen((open) => !open)}
              disabled={!library.available}
            >
              <UserPlus size={14} aria-hidden="true" />
              添加玩家
            </button>
          </>
        }
      />

      <div className="admin-stat-grid">
        <AdminStat
          icon={<Users size={17} />}
          label="玩家总数"
          value={counts.total}
          hint="好友 + 陌生人"
          tone="lilac"
        />
        <AdminStat
          icon={<Heart size={17} />}
          label="好友"
          value={counts.friends}
          hint="登录后自动同步"
          tone="sakura"
        />
        <AdminStat
          icon={<ShieldQuestion size={17} />}
          label="陌生人 / 前好友"
          value={counts.strangers}
          hint="手动添加或合照识别"
          tone="gold"
        />
        <AdminStat
          icon={<Camera size={17} />}
          label="已缓存头像"
          value={counts.withAvatar}
          hint="加入时抓取的快照"
          tone="aqua"
        />
      </div>

      {!library.available ? (
        <AdminEmpty
          icon={<Users size={24} />}
          title="玩家列表只在桌面客户端可用"
          text="好友资料和头像缓存保存在存储库里，不会进入公开时间轴。"
        />
      ) : (
        <>
          {addOpen ? (
            <section className="admin-panel player-add">
              <div className="player-add__head">
                <div>
                  <p className="section-kicker">ADD PLAYER</p>
                  <h3>添加好友或陌生人</h3>
                </div>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={() => setAddOpen(false)}
                  aria-label="关闭添加玩家"
                >
                  <X size={15} />
                </button>
              </div>
              <div className="player-add__grid">
                <div className="field">
                  <label className="field-label" htmlFor="player-add-id">
                    VRChat ID（可选）
                  </label>
                  <input
                    id="player-add-id"
                    value={newId}
                    onChange={(event) => setNewId(event.target.value)}
                    placeholder="usr_…"
                    spellCheck={false}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="player-add-name">
                    显示名称
                  </label>
                  <input
                    id="player-add-name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="只填名称会创建本地玩家"
                    maxLength={80}
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="player-add-note">
                    备注
                  </label>
                  <input
                    id="player-add-note"
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    placeholder="例如：2025 跨年合照"
                    maxLength={500}
                  />
                </div>
              </div>
              <div className="player-add__actions">
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void addPlayer()}
                  disabled={addBusy}
                >
                  {addBusy ? (
                    <Loader2 size={14} className="spinner" aria-hidden="true" />
                  ) : (
                    <UserPlus size={14} aria-hidden="true" />
                  )}
                  {addBusy ? '正在获取资料…' : '添加玩家'}
                </button>
                <p className="field-hint">
                  有 VRChat ID 时会读取官方资料并抓取当前头像；未登录时先保存 ID，头像稍后补全。
                </p>
              </div>
              {addError ? (
                <p className="field-error" role="alert">
                  {addError}
                </p>
              ) : null}
            </section>
          ) : null}

          {status?.lastSyncError ? (
            <p className="player-sync-error" role="status">
              {status.lastSyncError}
              <button type="button" className="text-button" onClick={() => navigate('/admin/worlds')}>
                去登录 VRChat
              </button>
            </p>
          ) : null}

          <section className="admin-panel player-library">
            <div className="player-toolbar">
              <div className="player-tabs" role="tablist" aria-label="玩家筛选">
                {(
                  [
                    ['all', `全部 ${counts.total}`],
                    ['friends', `好友 ${counts.friends}`],
                    ['strangers', `陌生人 ${counts.strangers}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    className={`player-tab${filter === value ? ' is-active' : ''}`}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="player-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索名称、备注或 ID"
                  aria-label="搜索玩家列表"
                />
              </div>
              <span className="player-sync-time">
                {status?.lastSyncAt
                  ? `上次同步 ${formatAdminDate(status.lastSyncAt)}`
                  : '尚未同步好友'}
              </span>
            </div>

            {library.loading && library.players.length === 0 ? (
              <p className="player-library__empty">
                <Loader2 size={18} className="spinner" aria-hidden="true" />
                正在读取玩家列表…
              </p>
            ) : filtered.length === 0 ? (
              <AdminEmpty
                icon={<Users size={24} />}
                title={library.players.length ? '没有匹配的玩家' : '玩家列表还是空的'}
                text={
                  library.players.length
                    ? '换个关键词或切换筛选条件。'
                    : '登录 VRChat 后会自动同步好友，也可以手动添加陌生人。'
                }
              />
            ) : (
              <div className="player-grid">
                {filtered.map((player) => {
                  const badge = playerBadge(player);
                  const photoCount = photoCounts.get(player.id) || 0;
                  return (
                    <button
                      type="button"
                      key={player.id}
                      className="player-card"
                      onClick={() => setActiveId(player.id)}
                    >
                      <span className="player-card__head">
                        <PlayerAvatar
                          name={player.displayName}
                          src={player.avatarUrl}
                          size={48}
                        />
                        <span className="player-card__identity">
                          <strong>{player.displayName}</strong>
                          <span className="player-card__id">{player.id}</span>
                        </span>
                        <span className={`player-badge player-badge--${badge.tone}`}>
                          {badge.label}
                        </span>
                      </span>
                      <span className="player-card__meta">
                        <span>{photoCount} 张合照</span>
                        {player.statusDescription ? (
                          <span>“{player.statusDescription}”</span>
                        ) : player.status ? (
                          <span>{player.status}</span>
                        ) : null}
                      </span>
                      {player.note ? <span className="player-card__note">{player.note}</span> : null}
                      <span className="player-card__foot">
                        <span>{player.source === 'friend-sync' ? '好友同步' : player.source === 'vrcx' ? '合照识别' : '手动添加'}</span>
                        <span>{player.avatar ? '头像已缓存' : '待补全头像'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <p className="admin-panel__note players-page__privacy">
            <Users size={13} aria-hidden="true" />
            玩家资料只写入 `.hoshikuzu/players/`，公开时间轴和手机投送只包含照片里的 VRChat ID，不包含姓名、备注或头像。
          </p>
        </>
      )}

      <Modal
        open={Boolean(activePlayer)}
        onClose={() => setActiveId(null)}
        labelledBy="player-detail-title"
        className="admin-modal player-detail"
      >
        {activePlayer ? (
          <>
            <header className="player-detail__head">
              <PlayerAvatar
                name={activePlayer.displayName}
                src={activePlayer.avatarUrl}
                size={72}
              />
              <div className="player-detail__title">
                <p className="section-kicker">PLAYER PROFILE</p>
                <h2 id="player-detail-title">{activePlayer.displayName}</h2>
                <p>
                  <span className={`player-badge player-badge--${playerBadge(activePlayer).tone}`}>
                    {playerBadge(activePlayer).label}
                  </span>
                  <code>{activePlayer.id}</code>
                </p>
              </div>
              <button
                type="button"
                className="icon-button icon-button--small"
                onClick={() => setActiveId(null)}
                aria-label="关闭玩家资料"
              >
                <X size={16} />
              </button>
            </header>

            <div className="player-detail__body">
              <div className="player-detail__facts">
                <div>
                  <span>用户名</span>
                  <strong>{activePlayer.username || '未记录'}</strong>
                </div>
                <div>
                  <span>状态</span>
                  <strong>{activePlayer.statusDescription || activePlayer.status || '未记录'}</strong>
                </div>
                <div>
                  <span>最后平台</span>
                  <strong>{activePlayer.lastPlatform || '未记录'}</strong>
                </div>
                <div>
                  <span>最后登录</span>
                  <strong>
                    {activePlayer.lastLogin ? formatAdminDate(activePlayer.lastLogin) : '未记录'}
                  </strong>
                </div>
                <div>
                  <span>加入列表</span>
                  <strong>{formatAdminDate(activePlayer.createdAt)}</strong>
                </div>
                <div>
                  <span>合照</span>
                  <strong>{photoCounts.get(activePlayer.id) || 0} 张</strong>
                </div>
              </div>

              <div className="player-detail__note">
                <label className="field-label" htmlFor="player-detail-note">
                  <Pencil size={13} aria-hidden="true" />
                  我的备注
                </label>
                <textarea
                  id="player-detail-note"
                  className="note-textarea"
                  rows={3}
                  maxLength={500}
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="记录你们怎么认识、一起去过哪些世界…"
                />
                <div className="player-detail__note-actions">
                  <button
                    type="button"
                    className="button button--soft button--small"
                    onClick={() => void saveNote()}
                    disabled={noteBusy || noteDraft === activePlayer.note}
                  >
                    {noteBusy ? (
                      <Loader2 size={14} className="spinner" aria-hidden="true" />
                    ) : (
                      <Check size={14} aria-hidden="true" />
                    )}
                    保存备注
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void refreshActive()}
                    disabled={refreshBusy || !activePlayer.id.startsWith('usr_')}
                  >
                    {refreshBusy ? (
                      <Loader2 size={14} className="spinner" aria-hidden="true" />
                    ) : (
                      <RefreshCw size={14} aria-hidden="true" />
                    )}
                    刷新资料
                  </button>
                </div>
              </div>

              {activePlayer.avatarHistory.length ? (
                <div className="player-history">
                  <p className="field-label">头像快照</p>
                  <div className="player-history__list">
                    {activePlayer.avatarHistory.map((avatar) => (
                      <span
                        key={avatar.file}
                        title={`${formatAdminDate(avatar.capturedAt)} · ${avatar.kind}`}
                      >
                        <SafeImage src={avatar.avatarUrl} alt="" loading="lazy" />
                      </span>
                    ))}
                  </div>
                  <p className="field-hint">
                    每次头像地址变化都会保留快照；VRChat 不提供历史头像，只能记录加入/同步时的当前头像。
                  </p>
                </div>
              ) : null}

              {activePhotos.length ? (
                <div className="player-detail__photos">
                  <p className="field-label">合照</p>
                  <div className="player-detail__photo-grid">
                    {activePhotos.map((photo) => (
                      <span key={photo.id} title={formatDateShort(photo.capturedAt)}>
                        <SafeImage src={photo.missing ? null : photo.src} alt={photo.alt} />
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <footer className="player-detail__footer">
              {confirmRemove ? (
                <div className="inline-confirm player-detail__confirm">
                  <p>从玩家列表移除？照片上的玩家 ID 会保留，但不再显示姓名和头像。</p>
                  <div className="inline-confirm__actions">
                    <button
                      type="button"
                      className="button button--danger button--tiny"
                      onClick={() => void removeActive()}
                    >
                      确认移除
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--tiny"
                      onClick={() => setConfirmRemove(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-button text-button--danger"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  从玩家列表移除
                </button>
              )}
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setActiveId(null)}
              >
                关闭
              </button>
            </footer>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
