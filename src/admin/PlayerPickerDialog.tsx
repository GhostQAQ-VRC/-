import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search, UserPlus, Users, X } from 'lucide-react';
import type { DesktopPlayer } from '../platform';
import { usePlayerLibrary } from '../hooks/usePlayerLibrary';
import { normalizePlayerId } from '../utils/players';
import { Modal } from '../components/Modal';
import { PlayerAvatar } from '../components/PlayerAvatar';

interface PlayerPickerDialogProps {
  open: boolean;
  selectedIds: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}

function playerSubtitle(player: DesktopPlayer): string {
  if (player.isSelf) return '自己';
  if (player.isFriend) return '好友';
  if (player.removedFromFriendsAt) return '前好友';
  return '陌生人';
}

export function PlayerPickerDialog({
  open,
  selectedIds,
  onClose,
  onApply,
}: PlayerPickerDialogProps) {
  const library = usePlayerLibrary();
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const [query, setQuery] = useState('');
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  const [addNotice, setAddNotice] = useState('');
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraftIds(selectedIds);
      setQuery('');
      setNewId('');
      setNewName('');
      setAddError('');
      setAddNotice('');
    }
    wasOpen.current = open;
  }, [open, selectedIds]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return library.players;
    return library.players.filter(
      (player) =>
        player.displayName.toLowerCase().includes(text) ||
        player.id.toLowerCase().includes(text) ||
        player.username.toLowerCase().includes(text),
    );
  }, [library.players, query]);

  const unresolved = draftIds.filter(
    (id) => !library.players.some((player) => player.id === id),
  );
  const selectedPlayers = draftIds
    .map((id) => library.players.find((player) => player.id === id))
    .filter((player): player is DesktopPlayer => Boolean(player));

  const toggle = (id: string) => {
    setDraftIds((previous) => {
      if (previous.includes(id)) return previous.filter((item) => item !== id);
      if (previous.length >= 32) return previous;
      return [...previous, id];
    });
  };

  const addPlayer = async () => {
    if (addBusy) return;
    setAddError('');
    setAddNotice('');
    const id = newId.trim();
    const name = newName.trim();
    if (id && !normalizePlayerId(id)) {
      setAddError('VRChat 玩家 ID 应以 usr_ 开头，并包含完整 UUID。');
      return;
    }
    if (!id && !name) {
      setAddError('请填写 VRChat ID，或只填写一个玩家名称。');
      return;
    }
    setAddBusy(true);
    try {
      const result = await library.add({ id: id || undefined, displayName: name || undefined });
      if (!result.ok || !result.player) {
        setAddError(result.error || '添加玩家失败。');
        return;
      }
      setDraftIds((previous) =>
        previous.includes(result.player!.id) ? previous : [...previous, result.player!.id],
      );
      setNewId('');
      setNewName('');
      setAddNotice(
        result.warning
          ? `${result.player.displayName} 已加入，${result.warning}`
          : `${result.player.displayName} 已加入玩家列表并选中。`,
      );
    } catch (caught) {
      setAddError((caught as Error).message || '添加玩家失败。');
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="player-picker-title"
      className="admin-modal player-picker"
    >
      <header className="player-picker__head">
        <div>
          <p className="section-kicker">GROUP PHOTO · PLAYERS</p>
          <h2 id="player-picker-title">标记合照玩家</h2>
          <p>选择好友，或按 VRChat ID 添加陌生人；头像会在加入时抓取并缓存。</p>
        </div>
        <button
          type="button"
          className="icon-button icon-button--small"
          onClick={onClose}
          aria-label="关闭玩家选择"
        >
          <X size={16} />
        </button>
      </header>

      <div className="player-picker__body">
        <div className="player-picker__main">
          <div className="player-picker__search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、用户名或 usr_ ID"
              aria-label="搜索玩家"
              autoFocus
            />
          </div>

          {!library.available ? (
            <p className="player-picker__empty">玩家列表只在桌面客户端可用。</p>
          ) : library.loading && library.players.length === 0 ? (
            <p className="player-picker__empty">
              <Loader2 size={16} className="spinner" aria-hidden="true" />
              正在读取玩家列表…
            </p>
          ) : filtered.length === 0 ? (
            <p className="player-picker__empty">
              <Users size={18} aria-hidden="true" />
              {library.players.length === 0
                ? '玩家列表还是空的。登录 VRChat 后会自动同步好友，也可以在右侧添加。'
                : '没有匹配的玩家。'}
            </p>
          ) : (
            <div className="player-picker__list" role="listbox" aria-multiselectable="true">
              {filtered.map((player) => {
                const selected = draftIds.includes(player.id);
                return (
                  <button
                    type="button"
                    key={player.id}
                    role="option"
                    aria-selected={selected}
                    className={`player-picker__row${selected ? ' is-selected' : ''}`}
                    onClick={() => toggle(player.id)}
                  >
                    <PlayerAvatar name={player.displayName} src={player.avatarUrl} size={38} />
                    <span className="player-picker__identity">
                      <strong>{player.displayName}</strong>
                      <span>
                        {playerSubtitle(player)} · {player.id}
                      </span>
                    </span>
                    <span className="player-picker__check" aria-hidden="true">
                      {selected ? <Check size={14} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {library.error ? (
            <p className="field-error" role="alert">
              {library.error}
            </p>
          ) : null}
        </div>

        <aside className="player-picker__side">
          <div className="player-picker__selected">
            <p className="field-label">已选 {draftIds.length} 人</p>
            {selectedPlayers.length ? (
              <div className="player-picker__chips">
                {selectedPlayers.map((player) => (
                  <button
                    type="button"
                    key={player.id}
                    className="player-chip"
                    onClick={() => toggle(player.id)}
                    title="移除"
                  >
                    <PlayerAvatar name={player.displayName} src={player.avatarUrl} size={20} />
                    <span>{player.displayName}</span>
                    <X size={11} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="player-picker__hint">还没有选择玩家。</p>
            )}
            {unresolved.length ? (
              <p className="player-picker__hint">
                另有 {unresolved.length} 个 ID 尚未登记到玩家列表，仍会保留在照片标记中。
              </p>
            ) : null}
          </div>

          <div className="player-picker__add">
            <p className="field-label">
              <UserPlus size={13} aria-hidden="true" />
              添加陌生人
            </p>
            <input
              value={newId}
              onChange={(event) => setNewId(event.target.value)}
              placeholder="VRChat ID：usr_…（可选）"
              aria-label="新玩家 VRChat ID"
              spellCheck={false}
              autoCapitalize="none"
            />
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="显示名称"
              aria-label="新玩家显示名称"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addPlayer();
                }
              }}
            />
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void addPlayer()}
              disabled={addBusy}
            >
              {addBusy ? (
                <Loader2 size={14} className="spinner" aria-hidden="true" />
              ) : (
                <UserPlus size={14} aria-hidden="true" />
              )}
              {addBusy ? '正在获取资料…' : '添加并选中'}
            </button>
            <p className="player-picker__hint">
              有 ID 时会自动读取 VRChat 资料和头像；只填名称会创建本地玩家。
            </p>
            {addError ? (
              <p className="field-error" role="alert">
                {addError}
              </p>
            ) : null}
            {addNotice ? <p className="player-picker__notice">{addNotice}</p> : null}
          </div>
        </aside>
      </div>

      <footer className="player-picker__footer">
        <button type="button" className="button button--ghost button--small" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="button button--primary button--small"
          onClick={() => onApply(draftIds)}
        >
          应用 {draftIds.length ? `${draftIds.length} 位玩家` : '空列表'}
        </button>
      </footer>
    </Modal>
  );
}
