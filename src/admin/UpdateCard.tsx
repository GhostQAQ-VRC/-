import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Rocket,
  TriangleAlert,
} from 'lucide-react';
import type { UpdateInfo } from '../platform/desktopApi';
import { getDesktopBridge } from '../platform';
import { AdminPanel } from './AdminUI';

export function UpdateCard() {
  const bridge = getDesktopBridge();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  if (!bridge) {
    return (
      <AdminPanel kicker="UPDATE" title="检查更新">
        <p className="admin-panel__note">
          <TriangleAlert size={13} aria-hidden="true" />
          更新提示只在桌面客户端生效；网页版随静态部署一起更新。
        </p>
      </AdminPanel>
    );
  }

  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setInfo(await bridge.update.check());
    } catch (error) {
      setInfo({
        ok: false,
        currentVersion: '',
        latestVersion: '',
        hasUpdate: false,
        releaseUrl: 'https://github.com/GhostQAQ-VRC/-/releases',
        error: (error as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const open = (url?: string) => {
    if (url) void bridge.update.open(url);
  };

  return (
    <AdminPanel kicker="UPDATE" title="检查更新">
      <div className="admin-form">
        <div
          className={`admin-status-line${info?.ok && info.hasUpdate ? ' is-live' : ''}`}
        >
          <span className="admin-status-line__dot" aria-hidden="true" />
          {info
            ? info.ok
              ? info.hasUpdate
                ? `发现新版本 v${info.latestVersion}（当前 v${info.currentVersion}）`
                : `当前已是最新版本 v${info.currentVersion}`
              : info.error || '检查失败'
            : '尚未检查'}
        </div>
        <p className="field-hint">
          检查会通过当前网络代理访问 GitHub Release；发现新版本时，客户端启动后会自动提示。
        </p>

        {info?.ok && info.hasUpdate ? (
          <div className="admin-form__footer">
            <span className="admin-editor__footer-note">
              最新版本 v{info.latestVersion}
            </span>
            <div className="admin-test-row">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => open(info.releaseUrl)}
              >
                更新说明
              </button>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => open(info.setupUrl || info.releaseUrl)}
              >
                <Download size={14} />
                下载安装包
              </button>
            </div>
          </div>
        ) : (
          <div className="admin-form__footer">
            <span className="admin-editor__footer-note">
              {info?.ok
                ? '客户端已经是最新版本。'
                : '如果无法连接，请先在「网络代理」中配置代理。'}
            </span>
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void check()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={14} className="spinner" />
              ) : info?.ok ? (
                <CheckCircle2 size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              检查更新
            </button>
          </div>
        )}

        {info?.ok && info.hasUpdate ? (
          <div className="admin-form__footer">
            <span />
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void check()}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
              重新检查
            </button>
          </div>
        ) : null}

        <p className="admin-panel__note">
          <Rocket size={13} aria-hidden="true" />
          安装包未做代码签名，更新后首次运行可能触发 Windows SmartScreen；请从本仓库 Release 下载。
        </p>
      </div>
    </AdminPanel>
  );
}
