import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDesktopBridge,
  type DesktopPlayer,
  type PlayerLibraryView,
} from '../platform';

export interface PlayerLibraryApi {
  available: boolean;
  loading: boolean;
  error: string;
  view: PlayerLibraryView | null;
  players: DesktopPlayer[];
  refresh: () => Promise<void>;
  sync: () => Promise<{
    ok: boolean;
    friends?: number;
    needsLogin?: boolean;
    error?: string;
  }>;
  add: (payload: {
    id?: string;
    displayName?: string;
    note?: string;
  }) => Promise<{ ok: boolean; player?: DesktopPlayer | null; warning?: string; error?: string }>;
  update: (
    id: string,
    patch: { displayName?: string; note?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  refreshPlayer: (id: string) => Promise<{ ok: boolean; error?: string; needsLogin?: boolean }>;
}

/**
 * Shared access to the desktop player library. The list is deliberately
 * loaded through IPC instead of album data: friend names and avatar snapshots
 * must never reach the public timeline payload.
 */
export function usePlayerLibrary(): PlayerLibraryApi {
  const bridge = getDesktopBridge();
  const api = bridge?.players;
  const available = Boolean(api);
  const [view, setView] = useState<PlayerLibraryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const aliveRef = useRef(true);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const next = await api.list();
      if (!aliveRef.current) return;
      setView(next);
      setError(next.ok ? '' : next.error || '玩家列表不可用。');
    } catch (caught) {
      if (aliveRef.current) {
        setError((caught as Error).message || '读取玩家列表失败。');
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    aliveRef.current = true;
    if (!api) {
      setView(null);
      return undefined;
    }
    void load();
    const scheduleReload = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void load();
      }, 220);
    };
    const offChanged = api.onChanged(scheduleReload);
    const offStatus = api.onStatus((status) => {
      setView((previous) =>
        previous ? { ...previous, status } : previous,
      );
      if (!status.running) scheduleReload();
    });
    return () => {
      aliveRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      offChanged();
      offStatus();
    };
  }, [api, load]);

  const sync = useCallback(async () => {
    if (!api) return { ok: false, error: '玩家列表仅在桌面客户端可用。' };
    const result = await api.sync();
    await load();
    return result;
  }, [api, load]);

  const add = useCallback(
    async (payload: { id?: string; displayName?: string; note?: string }) => {
      if (!api) return { ok: false, error: '玩家列表仅在桌面客户端可用。' };
      const result = await api.add(payload);
      await load();
      return result;
    },
    [api, load],
  );

  const update = useCallback(
    async (id: string, patch: { displayName?: string; note?: string }) => {
      if (!api) return { ok: false, error: '玩家列表仅在桌面客户端可用。' };
      const result = await api.update(id, patch);
      await load();
      return result;
    },
    [api, load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!api) return { ok: false, error: '玩家列表仅在桌面客户端可用。' };
      const result = await api.remove(id);
      await load();
      return result;
    },
    [api, load],
  );

  const refreshPlayer = useCallback(
    async (id: string) => {
      if (!api) return { ok: false, error: '玩家列表仅在桌面客户端可用。' };
      const result = await api.refresh(id);
      await load();
      return result;
    },
    [api, load],
  );

  return {
    available,
    loading,
    error,
    view,
    players: view?.players || [],
    refresh: load,
    sync,
    add,
    update,
    remove,
    refreshPlayer,
  };
}
