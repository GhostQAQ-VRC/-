import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Images,
  KeyRound,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Wifi,
} from 'lucide-react';
import type { AlbumApi } from '../../hooks/useAlbum';
import { useToast } from '../../hooks/useToast';
import { getDesktopBridge, type TransferConfigView, type TransferProgress } from '../../platform';
import { SafeImage } from '../../components/SafeImage';
import { AdminPanel } from '../AdminUI';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function TransferPanel({ album }: { album: AlbumApi }) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const [config, setConfig] = useState<TransferConfigView | null>(null);
  const [receiverPort, setReceiverPort] = useState(7878);
  const [ownToken, setOwnToken] = useState('');
  const [showOwnToken, setShowOwnToken] = useState(false);
  const [target, setTarget] = useState('');
  const [targetToken, setTargetToken] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [sendSummary, setSendSummary] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.transfer.getConfig().then((next) => {
      if (!alive) return;
      setConfig(next);
      setReceiverPort(next.receiver.port);
      setOwnToken(next.token);
      setTarget(next.lastTarget || '');
    });
    const off = bridge.transfer.onProgress((next) => setProgress(next));
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);

  const libraryPhotos = useMemo(
    () => album.photos.filter((photo) => photo.mediaKind === 'library' && !photo.missing),
    [album.photos],
  );
  const filteredPhotos = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return libraryPhotos;
    return libraryPhotos.filter((photo) =>
      [photo.note, photo.alt, photo.aiSummary, photo.world?.name, photo.capturedAt]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [libraryPhotos, search]);
  const receivedCount = useMemo(
    () => album.photos.filter((photo) => photo.libraryPath?.startsWith('_inbox/transfer/')).length,
    [album.photos],
  );

  const saveReceiver = async (patch: {
    enabled?: boolean;
    port?: number;
    token?: string;
    regenerateToken?: boolean;
  }) => {
    if (!bridge) return;
    setBusy('receiver');
    try {
      const next = await bridge.transfer.setConfig({
        receiver: {
          enabled: patch.enabled,
          port: patch.port ?? receiverPort,
        },
        token: patch.token,
        regenerateToken: patch.regenerateToken,
      });
      setConfig(next);
      setOwnToken(next.token);
      setReceiverPort(next.receiver.port);
      setMessage({
        ok: next.status.running,
        text: next.status.running
          ? `接收端已开启，监听端口 ${next.status.port}`
          : '接收端已关闭。',
      });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message || '无法保存接收端设置。' });
    } finally {
      setBusy(null);
    }
  };

  const startReceiver = async () => {
    await saveReceiver({ enabled: true, token: ownToken });
  };

  const stopReceiver = async () => {
    await saveReceiver({ enabled: false });
  };

  const copyReceiveInfo = async () => {
    if (!config) return;
    const addresses = [
      ...(config.virtualIp ? [config.virtualIp] : []),
      ...config.localIps,
    ];
    const text = [
      'VRchat时间轴纪念相册 · 传图接收信息',
      `地址：${addresses.length ? addresses.map((ip) => `${ip}:${config.status.port}`).join(' 或 ') : `本机IP:${config.status.port}`}`,
      `分享码：${ownToken || '(未生成)'}`,
      '请先加入同一个 EasyTier 网络，再在发送端填写地址与分享码。',
    ].join('\n');
    const ok = await copyText(text);
    pushToast({
      tone: ok ? 'success' : 'warning',
      title: ok ? '接收信息已复制' : '复制失败',
      description: ok ? '地址与分享码只发给信任的好友。' : '请手动输入。',
    });
  };

  const testTarget = async () => {
    if (!bridge) return;
    if (!target.trim()) {
      setMessage({ ok: false, text: '请填写好友地址。' });
      return;
    }
    setBusy('test');
    try {
      const result = await bridge.transfer.testTarget({
        target: target.trim(),
        token: targetToken.trim(),
      });
      setMessage({
        ok: result.ok,
        text: result.ok
          ? `连接成功${result.libraryName ? `：${result.libraryName}` : ''}`
          : result.error || '连接失败。',
      });
    } finally {
      setBusy(null);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = filteredPhotos.every((photo) => next.has(photo.id));
      for (const photo of filteredPhotos) {
        if (allSelected) next.delete(photo.id);
        else next.add(photo.id);
      }
      return next;
    });
  };

  const send = async () => {
    if (!bridge) return;
    if (!target.trim()) {
      setMessage({ ok: false, text: '请填写好友地址（虚拟 IP:端口）。' });
      return;
    }
    if (!targetToken.trim()) {
      setMessage({ ok: false, text: '请填写对方的分享码。' });
      return;
    }
    const items = libraryPhotos
      .filter((photo) => selected.has(photo.id))
      .map((photo) => ({
        id: photo.id,
        name: photo.libraryPath?.split('/').pop() || photo.alt || 'photo',
        libraryPath: photo.libraryPath as string,
      }));
    if (items.length === 0) {
      setMessage({ ok: false, text: '请选择要发送的照片。' });
      return;
    }
    setBusy('send');
    setSendSummary(null);
    setProgress(null);
    try {
      const result = await bridge.transfer.send({
        target: target.trim(),
        token: targetToken.trim(),
        items,
      });
      setSendSummary(
        `成功 ${result.sent} 张${result.failed ? ` · 失败 ${result.failed} 张` : ''}${
          result.results.some((item) => item.duplicate) ? ' · 对方已有重复照片' : ''
        }`,
      );
      setMessage({
        ok: result.failed === 0,
        text:
          result.failed === 0
            ? '发送完成。'
            : result.results.find((item) => !item.ok)?.error || result.error || '部分发送失败。',
      });
      if (result.sent > 0) {
        setSelected(new Set());
        pushToast({
          tone: 'success',
          title: `已发送 ${result.sent} 张照片`,
          description: '对方会自动加入相册。',
        });
      }
    } finally {
      setBusy(null);
      setTimeout(() => setProgress(null), 1500);
    }
  };

  if (!bridge) {
    return (
      <AdminPanel kicker="P2P TRANSFER" title="图片传输">
        <p className="admin-panel__note">仅桌面客户端可用。</p>
      </AdminPanel>
    );
  }

  return (
    <>
      <AdminPanel kicker="P2P RECEIVER" title="接收好友的照片">
        <div className={`admin-status-line${config?.status.running ? ' is-live' : ''}`}>
          <span className="admin-status-line__dot" aria-hidden="true" />
          {config?.status.running
            ? `接收端运行中 · 端口 ${config.status.port}`
            : '接收端未开启'}
          {receivedCount ? ` · 已通过传输收到 ${receivedCount} 张` : ''}
        </div>

        <div className="advanced-form admin-form">
          <div className="admin-editor__row">
            <div className="field">
              <label className="field-label" htmlFor="transfer-port">
                监听端口
              </label>
              <div className="input-shell">
                <input
                  id="transfer-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={receiverPort}
                  onChange={(event) => setReceiverPort(Number(event.target.value) || 7878)}
                  disabled={config?.status.running}
                />
              </div>
              <p className="field-hint">好友将通过 EasyTier 虚拟 IP + 此端口连接。</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="transfer-token">
                分享码
              </label>
              <div className="input-shell">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  id="transfer-token"
                  type={showOwnToken ? 'text' : 'password'}
                  value={ownToken}
                  onChange={(event) => setOwnToken(event.target.value)}
                  placeholder="点击「生成分享码」"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowOwnToken((value) => !value)}
                >
                  {showOwnToken ? '隐藏' : '显示'}
                </button>
              </div>
              <div className="advanced-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void saveReceiver({ regenerateToken: true })}
                >
                  <RefreshCw size={13} />
                  生成新分享码
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void saveReceiver({ token: ownToken })}
                >
                  保存分享码
                </button>
                <button type="button" className="text-button" onClick={() => void copyReceiveInfo()}>
                  <Copy size={13} />
                  复制接收信息
                </button>
              </div>
            </div>
          </div>

          <div className="advanced-ip-list">
            <span>
              <Wifi size={13} aria-hidden="true" />
              虚拟网络 IP
            </span>
            <strong>{config?.virtualIp || 'EasyTier 未连接'}</strong>
            <span>局域网 IP</span>
            <strong>{config?.localIps?.join(' / ') || '—'}</strong>
          </div>

          <div className="advanced-actions advanced-actions--main">
            {config?.status.running ? (
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void stopReceiver()}
                disabled={busy !== null}
              >
                <Square size={13} />
                关闭接收端
              </button>
            ) : (
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void startReceiver()}
                disabled={busy !== null}
              >
                {busy === 'receiver' ? <Loader2 size={14} className="spinner" /> : <Play size={14} />}
                开启接收端
              </button>
            )}
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void saveReceiver({ port: receiverPort })}
              disabled={busy !== null}
            >
              应用端口
            </button>
            <span className="field-hint">
              接收到的照片会自动复制到存储库并加入相册；分享码只发给信任的好友。
            </span>
          </div>
        </div>
      </AdminPanel>

      <AdminPanel kicker="P2P SENDER" title="把照片发给好友">
        <div className="advanced-form admin-form">
          <div className="admin-editor__row">
            <div className="field">
              <label className="field-label" htmlFor="transfer-target">
                好友地址
              </label>
              <div className="input-shell">
                <Link2 size={15} aria-hidden="true" />
                <input
                  id="transfer-target"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  placeholder="10.144.144.3:7878"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="transfer-target-token">
                对方分享码
              </label>
              <div className="input-shell">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  id="transfer-target-token"
                  type="password"
                  value={targetToken}
                  onChange={(event) => setTargetToken(event.target.value)}
                  placeholder="由好友提供"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          <div className="advanced-actions">
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void testTarget()}
              disabled={busy !== null}
            >
              {busy === 'test' ? <Loader2 size={14} className="spinner" /> : <ShieldCheck size={14} />}
              测试连接
            </button>
            <span className="field-hint">
              请先确认双方 EasyTier 已连接、对方接收端已开启、Windows 防火墙已放行。
            </span>
          </div>

          <div className="advanced-photo-toolbar">
            <div className="input-shell advanced-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索备注 / 世界 / 日期"
              />
            </div>
            <button type="button" className="text-button" onClick={selectAllVisible}>
              {filteredPhotos.every((photo) => selected.has(photo.id)) ? '取消全选' : '全选'}
            </button>
            <span className="field-hint">
              已选 {selected.size} / {libraryPhotos.length} 张
            </span>
          </div>

          <div className="advanced-photo-grid">
            {filteredPhotos.length === 0 ? (
              <p className="advanced-empty">
                <Images size={18} aria-hidden="true" />
                存储库里还没有可发送的照片。
              </p>
            ) : (
              filteredPhotos.map((photo) => {
                const active = selected.has(photo.id);
                return (
                  <button
                    key={photo.id}
                    type="button"
                    className={`advanced-photo${active ? ' is-selected' : ''}`}
                    onClick={() => toggleSelected(photo.id)}
                    aria-pressed={active}
                  >
                    <SafeImage
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width ?? 480}
                      height={photo.height ?? 320}
                      loading="lazy"
                    />
                    <span className="advanced-photo__meta">
                      <strong>{photo.capturedAt.slice(0, 10)}</strong>
                      <small>{photo.world?.name || photo.note || '未关联世界'}</small>
                    </span>
                    {active ? (
                      <span className="advanced-photo__check" aria-hidden="true">
                        <CheckCircle2 size={16} />
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {progress ? (
            <div className="advanced-progress">
              <span>
                正在发送 {progress.index + 1}/{progress.total} · {progress.file}
              </span>
              <strong>{progress.percent}%</strong>
              <div className="advanced-progress__bar">
                <i style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          ) : null}

          {sendSummary ? <p className="advanced-message is-ok">{sendSummary}</p> : null}
          {message ? (
            <p className={`advanced-message${message.ok ? ' is-ok' : ' is-error'}`} role="status">
              {message.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {message.text}
            </p>
          ) : null}

          <div className="admin-form__footer">
            <span className="field-hint">
              会发送原图；单张安全上限 4GB，接收端按内容哈希自动去重。
            </span>
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void send()}
              disabled={busy !== null || selected.size === 0}
            >
              {busy === 'send' ? <Loader2 size={14} className="spinner" /> : <Send size={14} />}
              发送 {selected.size ? `(${selected.size})` : ''}
            </button>
          </div>
        </div>
      </AdminPanel>
    </>
  );
}
