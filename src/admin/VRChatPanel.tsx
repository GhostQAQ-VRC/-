import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Globe2,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type {
  VRChatConfigView,
  VRChatCoverProgress,
  VRChatStatusView,
} from '../platform/desktopApi';
import { getDesktopBridge } from '../platform';
import { WORLD_ID_PATTERN } from '../services/worldService';
import { useToast } from '../hooks/useToast';
import { AdminPanel } from './AdminUI';

interface VRChatPanelProps {
  album: AlbumApi;
}

export function VRChatPanel({ album }: VRChatPanelProps) {
  const { pushToast } = useToast();
  const bridge = getDesktopBridge();
  const [config, setConfig] = useState<VRChatConfigView | null>(null);
  const [status, setStatus] = useState<VRChatStatusView | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [remember, setRemember] = useState(false);
  const [requires2fa, setRequires2fa] = useState(false);
  const [methods, setMethods] = useState<string[]>(['totp']);
  const [busy, setBusy] = useState<'login' | 'verify' | 'logout' | 'covers' | null>(null);
  const [progress, setProgress] = useState<VRChatCoverProgress | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'error' | 'info';
    text: string;
  } | null>(null);
  const [apiDraft, setApiDraft] = useState('');
  const [apiBusy, setApiBusy] = useState(false);

  const coverTargets = useMemo(
    () =>
      album.worlds
        .filter((world) => world.source !== 'demo')
        .map((world) => world.id)
        .filter((id): id is string => Boolean(id) && WORLD_ID_PATTERN.test(id)),
    [album.worlds],
  );
  const demoWorldCount = useMemo(
    () => album.worlds.filter((world) => world.source === 'demo').length,
    [album.worlds],
  );
  const loggedIn = status?.loggedIn === true;

  useEffect(() => {
    if (!bridge) return undefined;
    let cancelled = false;
    Promise.all([bridge.vrchat.getConfig(), bridge.vrchat.status()])
      .then(([nextConfig, nextStatus]) => {
        if (cancelled) return;
        setConfig(nextConfig);
        setUsername(nextConfig.username);
        setApiDraft(nextConfig.apiBase);
        setStatus(nextStatus);
        if (nextStatus.pending2fa) setRequires2fa(true);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setNotice({ tone: 'error', text: error.message || '无法读取 VRChat 配置。' });
        }
      });
    const unsubscribe = bridge.vrchat.onCoverProgress((next) => {
      if (!cancelled) setProgress(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  if (!bridge) {
    return (
      <AdminPanel kicker="VRCHAT OFFICIAL" title="VRChat 官方资料">
        <p className="admin-panel__note">
          <ShieldCheck size={13} aria-hidden="true" />
          官方世界资料拉取只在桌面客户端可用：VRChat API 需要登录 Cookie 与可配置代理，浏览器端无法安全完成。
        </p>
      </AdminPanel>
    );
  }

  const login = async () => {
    if (busy) return;
    const name = username.trim() || config?.username || '';
    if (!name) {
      setNotice({ tone: 'error', text: '请填写 VRChat 用户名或邮箱。' });
      return;
    }
    if (!password && !config?.hasPassword) {
      setNotice({ tone: 'error', text: '请填写密码。' });
      return;
    }
    setBusy('login');
    setNotice(null);
    try {
      const result = await bridge.vrchat.login({
        username: name,
        password: password || undefined,
        totp: totp.trim() || undefined,
        remember,
      });
      if (result.config) {
        setConfig(result.config);
        if (!username) setUsername(result.config.username);
      }
      if (result.ok && result.user) {
        setStatus({ loggedIn: true, user: result.user });
        setPassword('');
        setTotp('');
        setRequires2fa(false);
        setNotice({ tone: 'ok', text: `已登录：${result.user.displayName}` });
        pushToast({
          tone: 'success',
          title: 'VRChat 账号已登录',
          description: result.user.displayName,
        });
      } else if (result.requires2fa) {
        setRequires2fa(true);
        setMethods(result.methods?.length ? result.methods : ['totp']);
        setNotice({
          tone: 'info',
          text:
            result.error ||
            '该账号开启了两步验证，请输入验证器 App 的 6 位动态码后继续。',
        });
      } else {
        setNotice({ tone: 'error', text: result.error || '登录失败。' });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (busy) return;
    if (!/^\d{6,8}$/.test(totp.trim())) {
      setNotice({ tone: 'error', text: '请输入 6 位动态验证码。' });
      return;
    }
    setBusy('verify');
    setNotice(null);
    try {
      const method =
        methods.includes('emailotp') && !methods.includes('totp') ? 'emailotp' : 'totp';
      const result = await bridge.vrchat.verify2fa({ code: totp.trim(), method });
      if (result.ok && result.user) {
        setStatus({ loggedIn: true, user: result.user });
        setPassword('');
        setTotp('');
        setRequires2fa(false);
        setNotice({ tone: 'ok', text: `已登录：${result.user.displayName}` });
      } else {
        setNotice({
          tone: 'error',
          text: result.error || '验证码验证失败，请重新输入。',
        });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const logout = async () => {
    if (busy) return;
    setBusy('logout');
    setNotice(null);
    try {
      await bridge.vrchat.logout();
      setStatus({ loggedIn: false });
      setRequires2fa(false);
      setPassword('');
      setTotp('');
      setConfig((prev) => (prev ? { ...prev, hasPassword: false } : prev));
      setNotice({ tone: 'info', text: '已退出 VRChat，并清除了本机保存的密码与登录 Cookie。' });
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const fetchCovers = async () => {
    if (busy) return;
    if (coverTargets.length === 0) {
      pushToast({
        tone: 'warning',
        title: '没有可拉取的世界',
        description: '世界资料库里还没有填写 World ID。',
      });
      return;
    }
    setBusy('covers');
    setNotice(null);
    setProgress({ current: 0, total: coverTargets.length, id: '', name: '准备中…', ok: true });
    try {
      const result = await bridge.vrchat.fetchCovers({ ids: coverTargets });
      const usable = (result.results ?? []).filter(
        (entry) => entry.ok && (entry.thumbnail || entry.name),
      );
      if (usable.length) album.applyWorldCovers(usable);
      const failed = (result.results ?? []).filter((entry) => !entry.ok).length;
      if (result.ok) {
        setNotice({
          tone: 'ok',
          text: `已更新 ${usable.length} 个世界的封面与资料${failed ? `，${failed} 个失败` : ''}${
            result.canceled ? '（任务已取消）' : ''
          }。`,
        });
        pushToast({
          tone: 'success',
          title: 'VRChat 世界资料已更新',
          description: `${usable.length} 个世界${failed ? ` · ${failed} 个失败` : ''}`,
        });
      } else {
        setNotice({
          tone: 'error',
          text: result.error || '拉取失败，请检查登录状态与代理设置。',
        });
        pushToast({
          tone: 'danger',
          title: '拉取世界封面失败',
          description: result.error,
        });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: (error as Error).message });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const cancelFetch = () => {
    void bridge.vrchat.cancelCovers();
  };

  const saveApiBase = async () => {
    if (apiBusy) return;
    setApiBusy(true);
    try {
      const result = await bridge.vrchat.setConfig({ apiBase: apiDraft.trim() });
      setConfig(result.config);
      setApiDraft(result.config.apiBase);
      pushToast({
        tone: 'success',
        title: 'VRChat API 地址已保存',
        description: result.config.apiBase,
      });
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '保存失败',
        description: (error as Error).message,
      });
    } finally {
      setApiBusy(false);
    }
  };

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <AdminPanel kicker="VRCHAT OFFICIAL" title="从 VRChat 拉取世界封面">
      <div className="admin-form">
        <div className={`admin-status-line${loggedIn ? ' is-live' : ''}`}>
          <span className="admin-status-line__dot" aria-hidden="true" />
          {status === null
            ? '正在检查 VRChat 登录状态…'
            : loggedIn
              ? `已登录：${status.user?.displayName || status.user?.username || 'VRChat 账号'}`
              : requires2fa || status.pending2fa
                ? '登录尚未完成两步验证'
                : status.error
                  ? 'VRChat 暂不可用'
                  : '未登录 VRChat'}
        </div>

        <p className="field-hint">
          登录后会读取世界资料库中所有 World ID 的官方名称、作者、简介与封面。封面会压缩成 512px WebP
          存入相册，之后离线也能显示。若在中国大陆连不上官方 API，请先到「站点设置 → 网络代理」配置代理。
        </p>

        {status?.error && !loggedIn ? (
          <p className="admin-test-result is-error" role="status">
            <AlertTriangle size={14} />
            {status.error}
          </p>
        ) : null}

        {!loggedIn ? (
          <>
            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label" htmlFor="vrchat-username">
                  VRChat 用户名 / 邮箱
                </label>
                <div className="input-shell">
                  <UserRound size={15} aria-hidden="true" />
                  <input
                    id="vrchat-username"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setNotice(null);
                    }}
                    placeholder="账号或邮箱"
                    autoComplete="username"
                    spellCheck={false}
                    disabled={busy !== null}
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="vrchat-password">
                  密码
                </label>
                <div className="input-shell">
                  <KeyRound size={15} aria-hidden="true" />
                  <input
                    id="vrchat-password"
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setNotice(null);
                    }}
                    placeholder={config?.hasPassword ? '已保存密码，可留空' : 'VRChat 密码'}
                    autoComplete="current-password"
                    disabled={busy !== null}
                  />
                </div>
              </div>
            </div>

            {requires2fa ? (
              <div className="field">
                <label className="field-label" htmlFor="vrchat-totp">
                  两步验证码
                </label>
                <div className="input-shell">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <input
                    id="vrchat-totp"
                    value={totp}
                    onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="6 位动态验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    disabled={busy !== null}
                  />
                </div>
                <p className="field-hint">
                  {methods.includes('emailotp') && !methods.includes('totp')
                    ? 'VRChat 已向你的邮箱发送验证码。'
                    : '打开验证器 App，输入当前 6 位动态码。'}
                </p>
              </div>
            ) : null}

            <label className="appearance-experimental">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={busy !== null}
              />
              <span className="appearance-experimental__icon" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <span className="appearance-experimental__copy">
                <strong>记住密码</strong>
                <small>
                  用系统 safeStorage 加密保存在本机配置中，不上传、不写入相册备份；公共电脑上请不要勾选。登录
                  Cookie 本身会保留在客户端网络会话里。
                </small>
              </span>
            </label>

            <div className="admin-form__footer">
              <span className="admin-editor__footer-note">
                {config?.hasPassword ? '已保存密码；密码留空也可登录。' : '账号凭据只用于 VRChat 官方 API。'}
              </span>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void (requires2fa ? verify() : login())}
                disabled={busy !== null}
              >
                {busy === 'login' || busy === 'verify' ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <LogIn size={14} />
                )}
                {requires2fa ? '验证并登录' : '登录 VRChat'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="vrchat-account">
              <span className="vrchat-account__avatar">
                <Globe2 size={17} aria-hidden="true" />
              </span>
              <span className="vrchat-account__copy">
                <strong>{status.user?.displayName || 'VRChat 账号'}</strong>
                <small>{config?.apiBase || 'https://api.vrchat.cloud'}</small>
              </span>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void logout()}
                disabled={busy !== null}
              >
                {busy === 'logout' ? <Loader2 size={14} className="spinner" /> : <LogOut size={14} />}
                退出登录
              </button>
            </div>

            <div className="admin-form__footer">
              <span className="admin-editor__footer-note">
                资料库中有 {coverTargets.length} 个可查询的 World ID
                {demoWorldCount ? `（已跳过 ${demoWorldCount} 个内置示例世界）` : ''}
                {album.worlds.length > coverTargets.length + demoWorldCount
                  ? `（另有 ${album.worlds.length - coverTargets.length - demoWorldCount} 条未填写 ID）`
                  : ''}
                。
              </span>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void fetchCovers()}
                disabled={busy !== null || coverTargets.length === 0}
              >
                {busy === 'covers' ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {busy === 'covers' ? '正在拉取封面…' : '拉取全部封面'}
              </button>
            </div>

            {progress ? (
              <div className="vrchat-progress" role="status" aria-live="polite">
                <div className="vrchat-progress__bar">
                  <span style={{ width: `${Math.max(2, percent)}%` }} />
                </div>
                <div className="vrchat-progress__meta">
                  <span>
                    {progress.current} / {progress.total}
                    {progress.name ? ` · ${progress.name}` : ''}
                  </span>
                  <span>{percent}%</span>
                </div>
                <button type="button" className="text-button text-button--danger" onClick={cancelFetch}>
                  <X size={12} />
                  取消拉取
                </button>
              </div>
            ) : null}
          </>
        )}

        {notice ? (
          <p
            className={`admin-test-result${
              notice.tone === 'ok'
                ? ' is-ok'
                : notice.tone === 'error'
                  ? ' is-error'
                  : ''
            }`}
            role="status"
          >
            {notice.tone === 'ok' ? (
              <CheckCircle2 size={14} />
            ) : notice.tone === 'error' ? (
              <AlertTriangle size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            {notice.text}
          </p>
        ) : null}

        <details className="admin-details">
          <summary>高级：自定义 VRChat API 地址</summary>
          <div className="field">
            <label className="field-label" htmlFor="vrchat-api-base">
              API Base URL
            </label>
            <div className="input-shell">
              <Globe2 size={15} aria-hidden="true" />
              <input
                id="vrchat-api-base"
                value={apiDraft}
                onChange={(event) => setApiDraft(event.target.value)}
                placeholder="https://api.vrchat.cloud"
                spellCheck={false}
              />
            </div>
            <p className="field-hint">
              默认使用 VRChat 官方地址。仅当你使用自建 API 镜像或代理网关时才需要修改。
            </p>
            <div className="admin-form__footer">
              <span />
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void saveApiBase()}
                disabled={apiBusy}
              >
                {apiBusy ? <Loader2 size={14} className="spinner" /> : null}
                保存 API 地址
              </button>
            </div>
          </div>
        </details>
      </div>
    </AdminPanel>
  );
}
