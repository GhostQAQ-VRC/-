import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getDesktopBridge, type MobileReceiveMode, type MobileStatusView } from '../platform';
import { useToast } from './useToast';

interface MobileCastValue {
  /** Sync service is listening on the LAN. */
  running: boolean;
  /** At least one phone has an open live connection. */
  connected: boolean;
  receiveMode: MobileReceiveMode;
  status: MobileStatusView | null;
  cast: (photoId: string, label?: string) => Promise<boolean>;
}

const MobileCastContext = createContext<MobileCastValue>({
  running: false,
  connected: false,
  receiveMode: 'stream',
  status: null,
  cast: async () => false,
});

export function MobileCastProvider({ children }: { children: ReactNode }) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const [status, setStatus] = useState<MobileStatusView | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const refresh = () => {
      bridge.mobile
        .status()
        .then((config) => {
          if (!alive) return;
          setStatus((previous) => {
            const next = config.status;
            if (
              previous &&
              previous.running === next.running &&
              previous.deviceCount === next.deviceCount &&
              previous.receiveMode === next.receiveMode &&
              previous.port === next.port
            ) {
              return previous;
            }
            return next;
          });
        })
        .catch(() => {
          // The sync page surfaces configuration errors; the album can ignore them.
        });
    };
    refresh();
    const off = bridge.mobile.onStatus((next) => {
      if (alive) setStatus(next);
    });
    // SSE connections are event-driven, but a slow poll keeps the hint accurate
    // if a phone closes its tab without a clean disconnect.
    const timer = window.setInterval(refresh, 12_000);
    return () => {
      alive = false;
      off();
      window.clearInterval(timer);
    };
  }, [bridge]);

  const cast = useCallback(
    async (photoId: string, label?: string) => {
      if (!bridge || sending) return false;
      setSending(true);
      try {
        const result = await bridge.mobile.cast({ id: photoId });
        if (result.ok) {
          pushToast({
            tone: 'success',
            title: '已投送到手机',
            description:
              result.config?.receiveMode === 'save'
                ? `${label || '照片'}已送达，手机端会提示保存原图。`
                : `${label || '照片'}正在手机端实时显示，不占用手机空间。`,
          });
          return true;
        }
        pushToast({
          tone: 'warning',
          title: '没有送达手机',
          description: result.error || '请确认手机页面仍然打开。',
        });
        return false;
      } catch (error) {
        pushToast({
          tone: 'danger',
          title: '投送失败',
          description: error instanceof Error ? error.message : undefined,
        });
        return false;
      } finally {
        setSending(false);
      }
    },
    [bridge, pushToast, sending],
  );

  const value = useMemo<MobileCastValue>(
    () => ({
      running: Boolean(status?.running),
      connected: Boolean(status?.deviceCount),
      receiveMode: status?.receiveMode ?? 'stream',
      status,
      cast,
    }),
    [status, cast],
  );

  return <MobileCastContext.Provider value={value}>{children}</MobileCastContext.Provider>;
}

export function useMobileCast(): MobileCastValue {
  return useContext(MobileCastContext);
}
