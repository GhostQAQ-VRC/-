import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Unplug,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import {
  getDesktopBridge,
  type MobileActionResult,
  type MobileConfigView,
  type MobileLanAddress,
  type MobileReceiveMode,
  type MobileStatusView,
} from '../platform';
import { AdminPageHead, AdminPanel, AdminTag, formatAdminRelative } from './AdminUI';
import { useToast } from '../hooks/useToast';
import '../styles/mobile-sync.css';

const MODE_COPY: Record<
  MobileReceiveMode,
  { title: string; en: string; desc: string; detail: string }
> = {
  stream: {
    title: '实时查看',
    en: 'LIVE STREAM',
    desc: '电脑当临时服务器，照片随点随看',
    detail: '原图直接从电脑读取，不写入手机存储；关闭页面后不留缓存。适合大相册和存储紧张的手机。',
  },
  save: {
    title: '保存到手机',
    en: 'SAVE TO PHONE',
    desc: '投送后把原图存进手机',
    detail: '每次投送都会取回原图，手机端可保存到相册或下载目录。会占用手机空间，适合想离线留着的那几张。',
  },
};

function mergeStatus(previous: MobileConfigView | null, status: MobileStatusView): MobileConfigView {
  if (!previous) {
    return {
      enabled: status.running,
      port: status.port,
      preferredIp: status.preferredIp,
      receiveMode: status.receiveMode,
      status,
    };
  }
  return {
    ...previous,
    enabled: status.running ? previous.enabled : false,
    port: status.port,
    preferredIp: status.preferredIp,
    receiveMode: status.receiveMode,
    status,
  };
}

function deviceHint(platform: string): string {
  if (platform === 'iPhone' || platform === 'iPad') return 'Safari / 主屏幕 App';
  if (platform === 'Android') return 'Chrome / 系统浏览器';
  return platform;
}

export function MobilePage({ album }: { album: AlbumApi }) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const [config, setConfig] = useState<MobileConfigView | null>(null);
  const [qr, setQr] = useState<{ dataUrl: string; url: string; ip: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [portDraft, setPortDraft] = useState('');
  const [ipDraft, setIpDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const qrRequest = useRef(0);

  const load = useCallback(async () => {
    if (!bridge) return;
    try {
      const next = await bridge.mobile.getConfig();
      setConfig(next);
      setPortDraft(String(next.port));
      const available = next.status.lanIps.some((entry) => entry.address === next.preferredIp);
      setIpDraft(available ? next.preferredIp : next.status.activeIp || '');
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '读取手机同步设置失败',
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [bridge, pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.mobile.onStatus((status) => {
      setConfig((previous) => {
        if (!previous) return mergeStatus(null, status);
        return {
          ...previous,
          enabled: status.running,
          port: status.port,
          preferredIp: status.preferredIp,
          receiveMode: status.receiveMode,
          status,
        };
      });
    });
  }, [bridge]);

  const running = Boolean(config?.status.running);
  const status = config?.status;
  const activeIp = ipDraft || status?.activeIp || '';
  const lanIps: MobileLanAddress[] = status?.lanIps ?? [];

  useEffect(() => {
    if (!bridge || !running) {
      setQr(null);
      return;
    }
    setQr(null);
    const requestId = qrRequest.current + 1;
    qrRequest.current = requestId;
    let alive = true;
    void bridge.mobile
      .qr({ ip: activeIp || undefined })
      .then((result) => {
        if (!alive || qrRequest.current !== requestId) return;
        if (result.ok && result.dataUrl && result.url) {
          setQr({ dataUrl: result.dataUrl, url: result.url, ip: result.ip || activeIp });
        }
      })
      .catch(() => {
        // The status subscription will surface a listener failure.
      });
    return () => {
      alive = false;
    };
  }, [bridge, running, activeIp, status?.startedAt]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const applyResult = useCallback(
    (result: MobileActionResult & { config?: MobileConfigView }, successTitle: string) => {
      if (result.config) {
        setConfig(result.config);
        setPortDraft(String(result.config.port));
      }
      if (!result.ok) {
        pushToast({
          tone: 'danger',
          title: '操作没有完成',
          description: result.error,
        });
        return false;
      }
      pushToast({ tone: 'success', title: successTitle });
      return true;
    },
    [pushToast],
  );

  const toggle = async () => {
    if (!bridge || busy) return;
    setBusy('toggle');
    try {
      const result = await bridge.mobile.setConfig({ enabled: !running });
      applyResult(
        result,
        !running ? '手机同步已开启' : '手机同步已关闭',
      );
      if (!running && result.ok) setIpDraft(result.config.preferredIp || '');
    } finally {
      setBusy(null);
    }
  };

  const changeMode = async (mode: MobileReceiveMode) => {
    if (!bridge || busy || mode === status?.receiveMode) return;
    setBusy('mode');
    try {
      const result = await bridge.mobile.setConfig({ receiveMode: mode });
      applyResult(result, mode === 'stream' ? '已切换为实时查看' : '已切换为保存到手机');
    } finally {
      setBusy(null);
    }
  };

  const applyPort = async () => {
    if (!bridge || busy) return;
    const port = Number(portDraft);
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      pushToast({ tone: 'warning', title: '端口需要在 1024–65535 之间' });
      return;
    }
    setBusy('port');
    try {
      const result = await bridge.mobile.setConfig({ port });
      applyResult(result, '端口已更新');
    } finally {
      setBusy(null);
    }
  };

  const chooseIp = async (ip: string) => {
    if (!bridge || busy) return;
    setIpDraft(ip);
    setBusy('ip');
    try {
      const result = await bridge.mobile.setConfig({ preferredIp: ip });
      if (result.config) setConfig(result.config);
    } finally {
      setBusy(null);
    }
  };

  const rotate = async () => {
    if (!bridge || busy) return;
    setBusy('rotate');
    try {
      const result = await bridge.mobile.rotate();
      applyResult(result, '二维码已刷新，旧链接已失效');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    if (!bridge || busy) return;
    setBusy(`device-${id}`);
    try {
      const result = await bridge.mobile.disconnect({ id });
      applyResult(result, '已断开这台手机');
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async () => {
    const url = qr?.url || status?.url;
    if (!url) return;
    let copiedOk = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copiedOk = true;
      }
    } catch {
      // Insecure origins (plain http on a LAN) do not expose the clipboard API.
    }
    if (!copiedOk) {
      try {
        const field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        copiedOk = document.execCommand('copy');
        field.remove();
      } catch {
        copiedOk = false;
      }
    }
    if (copiedOk) {
      setCopied(true);
    } else {
      pushToast({ tone: 'warning', title: '无法写入剪贴板', description: url });
    }
  };

  const testCast = async () => {
    if (!bridge || busy) return;
    const photo =
      album.photos.find((item) => item.id === album.settings.featuredPhotoId) ??
      [...album.photos].sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
    if (!photo) {
      pushToast({ tone: 'warning', title: '相册里还没有可以投送的照片' });
      return;
    }
    setBusy('test');
    try {
      const result = await bridge.mobile.cast({ id: photo.id });
      if (result.config) setConfig(result.config);
      if (!result.ok) {
        pushToast({ tone: 'warning', title: '没有送达', description: result.error });
      } else {
        pushToast({
          tone: 'success',
          title: '投送已送达手机',
          description: result.config?.receiveMode === 'save' ? '手机端会提示保存原图。' : '手机端会实时打开这张照片。',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const mode = status?.receiveMode ?? 'stream';
  const devices = status?.devices ?? [];
  const hasIps = lanIps.length > 0;
  const lastCast = status?.lastCast;

  const ipOptions = useMemo(() => {
    const list = [...lanIps];
    if (activeIp && !list.some((item) => item.address === activeIp)) {
      list.unshift({ address: activeIp, iface: '当前', score: 0 });
    }
    return list;
  }, [lanIps, activeIp]);

  if (!bridge) {
    return (
      <div className="admin-page">
        <AdminPageHead
          kicker="MOBILE · 手机同步"
          title="手机客户端"
          description="手机客户端由桌面客户端在局域网内提供，需要在桌面客户端中开启。"
        />
        <AdminPanel kicker="DESKTOP ONLY" title="仅桌面客户端可用">
          <p className="admin-panel__note">
            手机客户端不在云端运行：电脑在局域网里临时充当服务器，手机扫码后直接读取相册。请打开桌面客户端再进入这里。
          </p>
        </AdminPanel>
      </div>
    );
  }

  return (
    <div className="admin-page mobile-sync-page">
      <AdminPageHead
        kicker="MOBILE · 手机同步"
        title="把时光轴装进手机"
        description="电脑在局域网里临时当服务器。手机扫码后打开手机客户端，相册实时同步；长按照片向上滑，就能把照片投送到手机。"
        actions={
          <button
            type="button"
            className={`button button--small ${running ? 'button--ghost' : 'button--primary'}`}
            onClick={toggle}
            disabled={busy === 'toggle'}
          >
            {busy === 'toggle' ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Power size={14} />
            )}
            {running ? '关闭手机同步' : '开启手机同步'}
          </button>
        }
      />

      <div className="mobile-status-strip">
        <span className={`mobile-status-strip__dot${running ? ' is-on' : ''}`} aria-hidden="true" />
        <div className="mobile-status-strip__body">
          <strong>
            {!running
              ? '手机同步未开启'
              : devices.length > 0
                ? `已连接 ${devices.length} 台手机`
                : '等待手机扫码'}
          </strong>
          <span>
            {!running
              ? '开启后电脑会在局域网内提供手机客户端与实时相册。'
              : devices.length > 0
                ? '保持手机页面在前台，投送会即时送达。'
                : '用手机相机扫描右侧二维码，或在浏览器打开链接。'}
          </span>
        </div>
        {running ? (
          <div className="mobile-status-strip__meta">
            <span>
              <Wifi size={13} /> {status?.libraryName || '存储库已连接'}
            </span>
            <span>
              端口 {status?.port} · {MODE_COPY[mode].title}
            </span>
          </div>
        ) : (
          <div className="mobile-status-strip__meta">
            <span>
              <WifiOff size={13} /> 仅在本机局域网生效
            </span>
          </div>
        )}
      </div>

      {status?.lastError ? (
        <p className="mobile-sync-error" role="status">
          {status.lastError}
        </p>
      ) : null}
      {running && !status?.hasLibrary ? (
        <p className="mobile-sync-warning" role="status">
          电脑还没有连接存储库。手机扫码后暂时读不到照片，请先在首启向导或存储库面板选择文件夹。
        </p>
      ) : null}

      <div className="mobile-sync-grid">
        <AdminPanel
          kicker="PAIR"
          title="扫码连接"
          className="mobile-sync-qr-panel"
          actions={
            running ? (
              <AdminTag tone={devices.length > 0 ? 'aqua' : 'gold'}>
                {devices.length > 0 ? '已连接' : '等待扫码'}
              </AdminTag>
            ) : (
              <AdminTag tone="muted">未开启</AdminTag>
            )
          }
        >
          <div className={`mobile-sync-qr${running ? '' : ' is-off'}`}>
            {running && qr?.dataUrl ? (
              <img src={qr.dataUrl} alt="手机配对二维码" width={320} height={320} />
            ) : running ? (
              <div className="mobile-sync-qr__placeholder">
                <Loader2 size={28} className="spin" />
                <span>正在生成二维码…</span>
              </div>
            ) : (
              <div className="mobile-sync-qr__placeholder">
                <QrCode size={44} strokeWidth={1.2} />
                <span>开启后生成专属二维码</span>
                <small>每次开启都会生成新的配对令牌</small>
              </div>
            )}
            {running ? (
              <span className="mobile-sync-qr__scanline" aria-hidden="true" />
            ) : null}
          </div>

          {running ? (
            <>
              <p className="mobile-sync-url">
                <code>{qr?.url || status?.url || '—'}</code>
                <button
                  type="button"
                  className="icon-button icon-button--small"
                  onClick={copyUrl}
                  title="复制链接"
                  aria-label="复制手机客户端链接"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </p>
              <div className="mobile-sync-qr__actions">
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={rotate}
                  disabled={busy === 'rotate'}
                >
                  {busy === 'rotate' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                  刷新二维码
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={testCast}
                  disabled={busy === 'test' || devices.length === 0}
                >
                  {busy === 'test' ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  投送最新一张
                </button>
              </div>
              <p className="mobile-sync-hint">
                手机与电脑需要连同一个 Wi-Fi。若扫码后打不开，请检查 Windows 防火墙是否放行端口{' '}
                {status?.port}。
              </p>
              {!hasIps ? (
                <p className="mobile-sync-warning" role="status">
                  没有检测到局域网 IPv4 地址。请先连接 Wi-Fi 或有线网络，再刷新二维码。
                </p>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              className="button button--primary mobile-sync-start"
              onClick={toggle}
              disabled={busy === 'toggle'}
            >
              {busy === 'toggle' ? <Loader2 size={15} className="spin" /> : <Smartphone size={15} />}
              开启并在手机上打开
            </button>
          )}
        </AdminPanel>

        <div className="mobile-sync-side">
          <AdminPanel kicker="DELIVERY" title="投送方式">
            <div className="mobile-mode-grid">
              {(Object.keys(MODE_COPY) as MobileReceiveMode[]).map((key) => {
                const copy = MODE_COPY[key];
                const active = mode === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`mobile-mode-card${active ? ' is-active' : ''}`}
                    onClick={() => changeMode(key)}
                    disabled={!running || busy === 'mode'}
                    aria-pressed={active}
                  >
                    <span className="mobile-mode-card__kicker">{copy.en}</span>
                    <strong>{copy.title}</strong>
                    <span>{copy.desc}</span>
                    {active ? (
                      <span className="mobile-mode-card__check">
                        <Check size={12} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="mobile-sync-hint mobile-sync-hint--mode">{MODE_COPY[mode].detail}</p>
            <div className="mobile-sync-note">
              <span className="mobile-sync-note__dot" aria-hidden="true" />
              {mode === 'stream'
                ? '实时查看不会把原图写入手机；缩略图仍会使用少量浏览器缓存，便于滚动回看。'
                : '保存到手机需要在手机端点一次「保存」。iOS 会下载到「文件」App（可在相册中再保存）；Android 会保存到浏览器下载目录。'}
            </div>
          </AdminPanel>

          <AdminPanel kicker="NETWORK" title="网络与端口">
            <div className="mobile-field">
              <label htmlFor="mobile-ip">局域网地址</label>
              <div className="mobile-ip-list">
                {ipOptions.map((entry) => (
                  <button
                    key={entry.address}
                    type="button"
                    className={`mobile-ip${entry.address === activeIp ? ' is-active' : ''}`}
                    onClick={() => chooseIp(entry.address)}
                    disabled={busy === 'ip'}
                  >
                    <span>{entry.address}</span>
                    <small>{entry.iface}</small>
                  </button>
                ))}
                {!hasIps ? <p className="mobile-sync-hint">没有检测到局域网 IPv4 地址。</p> : null}
              </div>
              <p className="mobile-sync-hint">
                优先选择 Wi-Fi 网卡。虚拟网卡（Hyper-V、VPN、EasyTier）通常无法被手机访问。
              </p>
            </div>
            <div className="mobile-field">
              <label htmlFor="mobile-port">服务端口</label>
              <div className="mobile-port-row">
                <input
                  id="mobile-port"
                  className="admin-input"
                  inputMode="numeric"
                  value={portDraft}
                  onChange={(event) => setPortDraft(event.target.value.replace(/[^\d]/g, ''))}
                  placeholder="7880"
                />
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={applyPort}
                  disabled={busy === 'port' || portDraft === String(status?.port)}
                >
                  {busy === 'port' ? <Loader2 size={14} className="spin" /> : null}
                  应用
                </button>
              </div>
              <p className="mobile-sync-hint">修改端口会重启服务并刷新二维码；默认 7880。</p>
            </div>
          </AdminPanel>
        </div>
      </div>

      <div className="mobile-sync-grid mobile-sync-grid--lower">
        <AdminPanel
          kicker="DEVICES"
          title="已连接设备"
          actions={
            devices.length > 0 ? (
              <AdminTag tone="aqua">{devices.length} 台在线</AdminTag>
            ) : (
              <AdminTag tone="muted">等待连接</AdminTag>
            )
          }
        >
          {devices.length === 0 ? (
            <div className="mobile-device-empty">
              <Smartphone size={26} strokeWidth={1.3} />
              <p>还没有手机连接。</p>
              <span>扫码后保持手机页面打开，就会出现在这里。</span>
            </div>
          ) : (
            <ul className="mobile-device-list">
              {devices.map((device) => (
                <li key={device.id} className="mobile-device">
                  <span className="mobile-device__icon">
                    <Smartphone size={16} />
                  </span>
                  <div className="mobile-device__body">
                    <strong>{device.name}</strong>
                    <span>
                      {deviceHint(device.platform)} · {device.ip}
                    </span>
                  </div>
                  <span className="mobile-device__time">
                    {formatAdminRelative(device.lastSeen)}
                  </span>
                  <button
                    type="button"
                    className="button button--ghost button--tiny"
                    onClick={() => disconnect(device.id)}
                    disabled={busy === `device-${device.id}`}
                  >
                    <Unplug size={13} />
                    断开
                  </button>
                </li>
              ))}
            </ul>
          )}
        </AdminPanel>

        <AdminPanel kicker="HOW IT WORKS" title="怎么用">
          <ol className="mobile-steps">
            <li>
              <span>01</span>
              <p>
                电脑和手机连接同一个 Wi-Fi，点「开启手机同步」。
              </p>
            </li>
            <li>
              <span>02</span>
              <p>用手机相机扫码；手机会打开局域网里的手机客户端，自动完成配对。</p>
            </li>
            <li>
              <span>03</span>
              <p>
                在电脑相册里<strong>长按照片并向上滑</strong>，松手后照片投送到手机；也可以在照片详情点「投送到手机」。
              </p>
            </li>
            <li>
              <span>04</span>
              <p>
                手机会按当前投送方式实时打开或提示保存。关闭手机页面即断开，电脑端服务不经过互联网。
              </p>
            </li>
          </ol>
          {lastCast ? (
            <p className="mobile-sync-lastcast">
              最近投送：{lastCast.note || lastCast.photoId.slice(-8)} ·{' '}
              {formatAdminRelative(lastCast.at)} · 送达 {lastCast.delivered} 台
            </p>
          ) : null}
        </AdminPanel>
      </div>
    </div>
  );
}
