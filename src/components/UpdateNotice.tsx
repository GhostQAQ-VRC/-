import { useEffect, useState } from 'react';
import { Download, RefreshCw, Sparkles, X } from 'lucide-react';
import type { UpdateInfo } from '../platform/desktopApi';
import { getDesktopBridge } from '../platform';

const DISMISS_KEY = 'hoshikuzu-update-dismissed-v1';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) || '';
  } catch {
    return '';
  }
}

export function UpdateNotice() {
  const bridge = getDesktopBridge();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!bridge) return undefined;
    let cancelled = false;

    const maybeShow = (next: UpdateInfo) => {
      if (cancelled || !next?.ok || !next.hasUpdate) return;
      if (readDismissed() === next.latestVersion) return;
      setInfo(next);
    };

    const unsubscribe = bridge.update.onAvailable(maybeShow);
    const timer = window.setTimeout(() => {
      void bridge.update
        .check()
        .then(maybeShow)
        .catch(() => {});
    }, 1800);
    const interval = window.setInterval(() => {
      void bridge.update
        .check()
        .then(maybeShow)
        .catch(() => {});
    }, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [bridge]);

  if (!bridge || !info) return null;

  const open = async (url?: string) => {
    if (!url || opening) return;
    setOpening(true);
    try {
      await bridge.update.open(url);
    } finally {
      setOpening(false);
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, info.latestVersion);
    } catch {
      // Dismissing is best effort.
    }
    setInfo(null);
  };

  return (
    <aside className="update-notice" role="status" aria-live="polite">
      <span className="update-notice__icon" aria-hidden="true">
        <Sparkles size={17} />
      </span>
      <div className="update-notice__copy">
        <strong>发现新版本 v{info.latestVersion}</strong>
        <span>
          当前 v{info.currentVersion}
          {info.setupSize
            ? ` · 安装包 ${(info.setupSize / 1024 / 1024).toFixed(0)}MB`
            : ''}
        </span>
      </div>
      <div className="update-notice__actions">
        <button
          type="button"
          className="button button--primary button--tiny"
          onClick={() => void open(info.setupUrl || info.releaseUrl)}
          disabled={opening}
        >
          {opening ? (
            <RefreshCw size={13} className="spinner" aria-hidden="true" />
          ) : (
            <Download size={13} aria-hidden="true" />
          )}
          下载更新
        </button>
        <button
          type="button"
          className="button button--ghost button--tiny"
          onClick={() => void open(info.releaseUrl)}
          disabled={opening}
        >
          更新说明
        </button>
        <button
          type="button"
          className="update-notice__close"
          onClick={dismiss}
          aria-label="稍后提醒"
          title="稍后提醒"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
