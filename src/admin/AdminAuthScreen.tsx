import { useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { ADMIN_MIN_PASSPHRASE } from '../utils/adminAuth';
import { BrandGlyph } from '../components/BrandGlyph';

interface AdminAuthScreenProps {
  siteName: string;
  siteNameEn: string;
  hasCredential: boolean;
  onSetup: (passphrase: string) => Promise<void>;
  onLogin: (passphrase: string) => Promise<void>;
  onResetCredential: () => void;
}

export function AdminAuthScreen({
  siteName,
  siteNameEn,
  hasCredential,
  onSetup,
  onLogin,
  onResetCredential,
}: AdminAuthScreenProps) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const isSetup = !hasCredential;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (isSetup) {
      if (passphrase.length < ADMIN_MIN_PASSPHRASE) {
        setError(`管理口令至少需要 ${ADMIN_MIN_PASSPHRASE} 个字符。`);
        return;
      }
      if (passphrase !== confirm) {
        setError('两次输入的管理口令不一致。');
        return;
      }
    }
    setBusy(true);
    try {
      if (isSetup) await onSetup(passphrase);
      else await onLogin(passphrase);
    } catch (caught) {
      setError((caught as Error).message || '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-auth">
      <div className="admin-auth__glow" aria-hidden="true" />
      <div className="admin-auth__card">
        <a className="admin-auth__brand" href="#/" aria-label={`${siteName} · 返回相册`}>
          <span className="admin-auth__mark" aria-hidden="true">
            <BrandGlyph size={24} />
          </span>
          <span>
            <span className="admin-auth__site">{siteName}</span>
            <span className="admin-auth__en">{siteNameEn}</span>
          </span>
        </a>

        <p className="section-kicker admin-auth__kicker">CONTROL ROOM</p>
        <h1 className="admin-auth__title">{isSetup ? '启用本地管理台' : '解锁管理台'}</h1>
        <p className="admin-auth__lede">
          {isSetup
            ? '先设置一个本地管理口令。它用于防止误入管理页面，不是服务器级身份认证。'
            : '输入本地管理口令，继续整理照片与世界资料。'}
        </p>

        <form className="admin-auth__form" onSubmit={submit}>
          <label className="field-label" htmlFor="admin-passphrase">
            管理口令
          </label>
          <div className="input-shell admin-auth__input">
            <Lock size={16} strokeWidth={1.7} aria-hidden="true" />
            <input
              id="admin-passphrase"
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder={isSetup ? `至少 ${ADMIN_MIN_PASSPHRASE} 个字符` : '输入管理口令'}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              autoFocus
            />
          </div>

          {isSetup ? (
            <>
              <label className="field-label" htmlFor="admin-passphrase-confirm">
                再次输入
              </label>
              <div className="input-shell admin-auth__input">
                <KeyRound size={16} strokeWidth={1.7} aria-hidden="true" />
                <input
                  id="admin-passphrase-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="确认管理口令"
                  autoComplete="new-password"
                />
              </div>
            </>
          ) : null}

          {error ? (
            <p className="admin-auth__error" role="alert">
              <ShieldAlert size={14} aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <button type="submit" className="button button--primary admin-auth__submit" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="spinner" aria-hidden="true" />
                正在处理…
              </>
            ) : isSetup ? (
              '创建管理口令并进入'
            ) : (
              '进入管理台'
            )}
          </button>
        </form>

        <p className="admin-auth__note">
          口令哈希与相册都保存在此浏览器的 localStorage / sessionStorage 中。公开部署时请使用后端认证与权限系统。
        </p>

        {!isSetup ? (
          <div className="admin-auth__reset">
            {confirmReset ? (
              <div className="admin-auth__reset-confirm">
                <p>重置后会清除本地管理口令，相册数据不会删除。确定吗？</p>
                <div>
                  <button
                    type="button"
                    className="text-button text-button--danger"
                    onClick={() => {
                      onResetCredential();
                      setConfirmReset(false);
                      setPassphrase('');
                      setError('');
                    }}
                  >
                    确认重置
                  </button>
                  <button type="button" className="text-button" onClick={() => setConfirmReset(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="text-button" onClick={() => setConfirmReset(true)}>
                忘记口令？重置本地管理口令
              </button>
            )}
          </div>
        ) : null}

        <a className="admin-auth__back" href="#/">
          <ArrowLeft size={14} />
          返回相册
        </a>
      </div>
    </div>
  );
}
