import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Download,
  FolderOpen,
  KeyRound,
  Loader2,
  Network,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { getDesktopBridge, type EasyTierConfigView, type EasyTierLogEntry } from '../../platform';
import { useToast } from '../../hooks/useToast';
import { AdminPanel } from '../AdminUI';

interface FormState {
  corePath: string;
  cliPath: string;
  networkName: string;
  peers: string[];
  ipv4: string;
  listenerPort: number;
  rpcPort: number;
  autoStart: boolean;
  noTun: boolean;
  customArgs: string;
}

function formFrom(config: EasyTierConfigView): FormState {
  return {
    corePath: config.corePath || '',
    cliPath: config.cliPath || '',
    networkName: config.networkName || '',
    peers: config.peers?.length ? [...config.peers] : [''],
    ipv4: config.ipv4 || '',
    listenerPort: config.listenerPort || 11010,
    rpcPort: config.rpcPort || 15888,
    autoStart: config.autoStart === true,
    noTun: config.noTun === true,
    customArgs: config.customArgs || '',
  };
}

function randomHex(bytes: number) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function EasyTierPanel() {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const [config, setConfig] = useState<EasyTierConfigView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [logs, setLogs] = useState<EasyTierLogEntry[]>([]);
  const [download, setDownload] = useState<{ phase: string; percent: number } | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void bridge.easytier.getConfig().then((next) => {
      if (!alive) return;
      setConfig(next);
      setForm(formFrom(next));
      setLogs(next.status?.logs || []);
    });
    const offStatus = bridge.easytier.onStatus((status) => {
      setConfig((prev) => (prev ? { ...prev, status } : prev));
    });
    const offLog = bridge.easytier.onLog((entry) => {
      setLogs((prev) => [...prev.slice(-199), entry]);
    });
    const offDownload = bridge.easytier.onDownloadProgress((progress) => {
      setDownload({ phase: progress.phase, percent: progress.percent });
    });
    return () => {
      alive = false;
      offStatus();
      offLog();
      offDownload();
    };
  }, [bridge]);

  const status = config?.status;
  const detection = config?.detection;
  const shareSecret = secret || config?.networkSecret || '';
  const canStart = Boolean(form?.corePath) && Boolean(form?.networkName) && Boolean(shareSecret);

  const applyConfig = (next: EasyTierConfigView) => {
    setConfig(next);
    setForm(formFrom(next));
    setSecret('');
  };

  const save = async (): Promise<boolean> => {
    if (!bridge || !form) return false;
    setBusy('save');
    try {
      const next = await bridge.easytier.setConfig({
        ...form,
        peers: form.peers.map((peer) => peer.trim()).filter(Boolean),
        networkSecret: secret || undefined,
      });
      applyConfig(next);
      setMessage({ ok: true, text: '网络设置已保存。' });
      return true;
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const detect = async () => {
    if (!bridge) return;
    setBusy('detect');
    try {
      const result = await bridge.easytier.detect();
      const next = await bridge.easytier.getConfig();
      applyConfig(next);
      setMessage({
        ok: result.found,
        text: result.found
          ? `已找到 EasyTier ${result.version || ''}${result.wintun ? '（驱动齐全）' : '（缺少 wintun.dll，TUN 模式可能不可用）'}`
          : '没有找到 EasyTier 组件，请选择或下载。',
      });
    } finally {
      setBusy(null);
    }
  };

  const chooseCore = async () => {
    if (!bridge) return;
    setBusy('choose');
    try {
      const result = await bridge.easytier.chooseCore();
      if (result.ok && result.config) {
        applyConfig(result.config);
        setMessage({ ok: true, text: '已使用所选 EasyTier 组件。' });
      }
    } finally {
      setBusy(null);
    }
  };

  const downloadComponents = async () => {
    if (!bridge) return;
    setBusy('download');
    setDownload({ phase: 'download', percent: 0 });
    try {
      const result = await bridge.easytier.download();
      if (result.ok) {
        const next = await bridge.easytier.getConfig();
        applyConfig(next);
        setMessage({ ok: true, text: `EasyTier ${result.version || ''} 已下载完成。` });
      } else if (!result.canceled) {
        setMessage({ ok: false, text: result.error || '下载失败。' });
      }
    } finally {
      setBusy(null);
      setDownload(null);
    }
  };

  const start = async () => {
    if (!bridge) return;
    if (!form?.corePath) {
      setMessage({ ok: false, text: '请先检测、选择或下载 EasyTier 组件。' });
      return;
    }
    if (!form.networkName) {
      setMessage({ ok: false, text: '请填写网络名称。' });
      return;
    }
    if (!shareSecret) {
      setMessage({ ok: false, text: '请填写或生成网络密钥。' });
      return;
    }
    setBusy('start');
    try {
      await save();
      const result = await bridge.easytier.start();
      if (result.ok) {
        setMessage({
          ok: true,
          text: result.warning || 'EasyTier 已启动，正在等待对端。',
        });
      } else {
        setMessage({ ok: false, text: result.error || '启动失败。' });
        if (result.needsElevation) {
          pushToast({
            tone: 'warning',
            title: '需要管理员权限',
            description: 'TUN 模式需要创建虚拟网卡；可改用免 TUN 模式或以管理员身份重启。',
          });
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!bridge) return;
    setBusy('stop');
    try {
      await bridge.easytier.stop();
      setMessage({ ok: true, text: 'EasyTier 已停止。' });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!bridge) return;
    setBusy('test');
    try {
      const result = await bridge.easytier.test();
      if (result.ok) {
        const current = result.status;
        setMessage({
          ok: true,
          text: current
            ? `运行中 · 直连 ${current.directCount} · 中继 ${current.relayCount} · 本机 ${current.selfIp || '等待分配 IP'}`
            : 'EasyTier 连接正常。',
        });
      } else {
        setMessage({ ok: false, text: result.error || '测试失败。' });
      }
    } finally {
      setBusy(null);
    }
  };

  const elevate = async () => {
    if (!bridge) return;
    const confirmed = window.confirm(
      '将以管理员权限重新启动客户端，用于创建 EasyTier 虚拟网卡。当前离线任务会结束，继续吗？',
    );
    if (!confirmed) return;
    await bridge.easytier.elevate();
  };

  const generateIdentity = () => {
    if (!form) return;
    const suffix = randomHex(2);
    setForm({
      ...form,
      networkName: form.networkName || `vrchat-album-${suffix}`,
      ipv4: form.ipv4 || `10.144.144.${10 + Math.floor(Math.random() * 240)}`,
    });
    setSecret(randomHex(16));
  };

  const copyShare = async () => {
    if (!form) return;
    const text = [
      'VRchat时间轴纪念相册 · EasyTier 组网信息',
      `网络名称：${form.networkName || '(未填写)'}`,
      `网络密钥：${shareSecret || '(未填写)'}`,
      `虚拟 IPv4：${form.ipv4 || '(DHCP)'}`,
      `Peer 列表：${form.peers.filter(Boolean).join(' , ') || '(未填写)'}`,
      `监听端口：${form.listenerPort}`,
    ].join('\n');
    const ok = await copyText(text);
    pushToast({
      tone: ok ? 'success' : 'warning',
      title: ok ? '组网信息已复制' : '复制失败',
      description: ok ? '请通过可信渠道发给好友。' : '请手动选择文本复制。',
    });
  };

  const copyToml = async () => {
    if (!bridge) return;
    const result = await bridge.easytier.toml();
    const ok = await copyText(result.text);
    pushToast({
      tone: ok ? 'success' : 'warning',
      title: ok ? 'TOML 已复制' : '复制失败',
      description: `EasyTier 配置（${result.license}）`,
    });
  };

  const statusText = useMemo(() => {
    if (!status?.running) return '未运行';
    if (status.selfIp) return `运行中 · ${status.selfIp}`;
    return '运行中 · 等待虚拟 IP';
  }, [status]);

  if (!bridge) {
    return (
      <AdminPanel kicker="EASYTIER" title="虚拟组网">
        <p className="admin-panel__note">仅桌面客户端可用。</p>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel kicker="EASYTIER · P2P NETWORK" title="虚拟组网（EasyTier）">
      <div className={`admin-status-line${status?.running ? ' is-live' : ''}`}>
        <span className="admin-status-line__dot" aria-hidden="true" />
        {statusText}
        {detection?.found ? ` · 组件 ${detection.version || '已找到'}` : ' · 未找到组件'}
        {detection?.elevated ? ' · 管理员权限' : ' · 普通权限'}
      </div>

      <div className="advanced-component">
        <div className="advanced-component__path">
          <span>
            <Terminal size={14} aria-hidden="true" />
            核心组件
          </span>
          <code title={form?.corePath || ''}>{form?.corePath || '尚未选择 easytier-core.exe'}</code>
        </div>
        <div className="advanced-actions">
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => void detect()}
            disabled={busy !== null}
          >
            {busy === 'detect' ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
            检测组件
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void chooseCore()}
            disabled={busy !== null}
          >
            <FolderOpen size={14} />
            选择 core
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void downloadComponents()}
            disabled={busy !== null}
          >
            {busy === 'download' ? <Loader2 size={14} className="spinner" /> : <Download size={14} />}
            下载组件
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => void bridge.easytier.openFolder()}
          >
            打开目录
          </button>
        </div>
        {download ? (
          <div className="advanced-progress">
            <span>
              {download.phase === 'extract' ? '正在解压组件…' : '正在下载 EasyTier 组件…'}
            </span>
            <strong>{download.percent}%</strong>
          </div>
        ) : null}
        <p className="field-hint">
          组件来源：官方 GitHub Releases，许可证 LGPL-3.0。TUN 模式需要管理员权限；免 TUN
          模式可被访问但不能主动发起连接。
        </p>
      </div>

      {form ? (
        <>
          <div className="admin-form advanced-form">
            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label" htmlFor="easytier-network-name">
                  网络名称
                </label>
                <div className="input-shell">
                  <Network size={15} aria-hidden="true" />
                  <input
                    id="easytier-network-name"
                    value={form.networkName}
                    onChange={(event) => setForm({ ...form, networkName: event.target.value })}
                    placeholder="vrchat-album-xxxx"
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="easytier-secret">
                  网络密钥
                </label>
                <div className="input-shell">
                  <KeyRound size={15} aria-hidden="true" />
                  <input
                    id="easytier-secret"
                    type={showSecret ? 'text' : 'password'}
                    value={secret || config?.networkSecret || ''}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="32 位以上随机字符串"
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowSecret((value) => !value)}
                  >
                    {showSecret ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>
            </div>

            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label" htmlFor="easytier-ipv4">
                  虚拟 IPv4
                </label>
                <div className="input-shell">
                  <input
                    id="easytier-ipv4"
                    value={form.ipv4}
                    onChange={(event) => setForm({ ...form, ipv4: event.target.value })}
                    placeholder="10.144.144.2（留空则 DHCP）"
                    spellCheck={false}
                  />
                </div>
                <p className="field-hint">每个好友必须使用不同的虚拟 IP。</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="easytier-port">
                  监听端口
                </label>
                <div className="input-shell">
                  <input
                    id="easytier-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.listenerPort}
                    onChange={(event) =>
                      setForm({ ...form, listenerPort: Number(event.target.value) || 11010 })
                    }
                  />
                </div>
                <p className="field-hint">默认 TCP/UDP 11010；首次监听需放行 Windows 防火墙。</p>
              </div>
            </div>

            <div className="field">
              <div className="field-label-row">
                <span className="field-label">Peer / 服务器列表</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setForm({ ...form, peers: [...form.peers, ''] })}
                >
                  <Plus size={13} />
                  添加节点
                </button>
              </div>
              <div className="advanced-peer-list">
                {form.peers.map((peer, index) => (
                  <div className="advanced-peer-row" key={`peer-${index}`}>
                    <input
                      value={peer}
                      onChange={(event) => {
                        const peers = [...form.peers];
                        peers[index] = event.target.value;
                        setForm({ ...form, peers });
                      }}
                      placeholder="tcp://公共节点或好友公网地址:11010"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="icon-button icon-button--small"
                      onClick={() =>
                        setForm({
                          ...form,
                          peers: form.peers.filter((_, itemIndex) => itemIndex !== index),
                        })
                      }
                      aria-label="移除节点"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="advanced-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setForm({ ...form, peers: [...form.peers, 'tcp://public.easytier.cn:11010'] })}
                >
                  添加公共节点示例
                </button>
                <span className="field-hint">公共节点可用性不保证，建议自建共享节点。</span>
              </div>
            </div>

            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label">启动选项</label>
                <label className="library-panel__checkbox">
                  <input
                    type="checkbox"
                    checked={form.autoStart}
                    onChange={(event) => setForm({ ...form, autoStart: event.target.checked })}
                  />
                  <span>随客户端自动启动</span>
                </label>
                <label className="library-panel__checkbox advanced-checkbox-warning">
                  <input
                    type="checkbox"
                    checked={form.noTun}
                    onChange={(event) => setForm({ ...form, noTun: event.target.checked })}
                  />
                  <span>免 TUN 模式（无需管理员，但不能主动发起）</span>
                </label>
              </div>
              <div className="field">
                <label className="field-label">RPC 端口</label>
                <div className="input-shell">
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.rpcPort}
                    onChange={(event) =>
                      setForm({ ...form, rpcPort: Number(event.target.value) || 15888 })
                    }
                  />
                </div>
                <p className="field-hint">仅本地 127.0.0.1 使用，冲突时换一个。</p>
              </div>
            </div>

            <details className="admin-details">
              <summary>自定义启动参数 / TOML</summary>
              <div className="field">
                <textarea
                  className="note-textarea"
                  rows={2}
                  value={form.customArgs}
                  onChange={(event) => setForm({ ...form, customArgs: event.target.value })}
                  placeholder="例如 --latency-first --mtu 1420"
                />
              </div>
              <button type="button" className="text-button" onClick={() => void copyToml()}>
                <Copy size={13} />
                复制等价 TOML
              </button>
            </details>

            <div className="admin-form__footer">
              <button
                type="button"
                className="text-button"
                onClick={() => void generateIdentity()}
              >
                <RefreshCw size={13} />
                生成一组身份
              </button>
              <button type="button" className="text-button" onClick={() => void copyShare()}>
                <Copy size={13} />
                复制分享信息
              </button>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void save()}
                disabled={busy !== null}
              >
                {busy === 'save' ? <Loader2 size={14} className="spinner" /> : null}
                保存网络设置
              </button>
            </div>
          </div>

          <div className="advanced-actions advanced-actions--main">
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void start()}
              disabled={busy !== null || status?.running || !canStart}
            >
              {busy === 'start' ? <Loader2 size={14} className="spinner" /> : <Play size={14} />}
              启动 EasyTier
            </button>
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void stop()}
              disabled={busy !== null || !status?.running}
            >
              <Square size={13} />
              停止
            </button>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void test()}
              disabled={busy !== null || !status?.running}
            >
              {busy === 'test' ? <Loader2 size={14} className="spinner" /> : <ShieldCheck size={14} />}
              测试连接
            </button>
            {!detection?.elevated ? (
              <button type="button" className="text-button" onClick={() => void elevate()}>
                以管理员身份重启
              </button>
            ) : null}
          </div>

          {message ? (
            <p className={`advanced-message${message.ok ? ' is-ok' : ' is-error'}`} role="status">
              {message.ok ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
              {message.text}
            </p>
          ) : null}

          <div className="advanced-grid">
            <div className="advanced-stat">
              <span>本机虚拟 IP</span>
              <strong>{status?.selfIp || '—'}</strong>
            </div>
            <div className="advanced-stat">
              <span>直连对端</span>
              <strong>{status?.directCount ?? 0}</strong>
            </div>
            <div className="advanced-stat">
              <span>中继对端</span>
              <strong>{status?.relayCount ?? 0}</strong>
            </div>
            <div className="advanced-stat">
              <span>权限</span>
              <strong>{detection?.elevated ? '管理员' : '普通用户'}</strong>
            </div>
          </div>

          <div className="advanced-peer-table">
            <table>
              <thead>
                <tr>
                  <th>虚拟 IP</th>
                  <th>主机</th>
                  <th>路径</th>
                  <th>延迟</th>
                  <th>丢包</th>
                  <th>NAT</th>
                </tr>
              </thead>
              <tbody>
                {(status?.peers || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="advanced-empty">
                      还没有对端。确认好友已加入同一网络、Peer 列表/端口可达。
                    </td>
                  </tr>
                ) : (
                  status?.peers.map((peer) => (
                    <tr key={peer.ipv4}>
                      <td>{peer.ipv4}</td>
                      <td>{peer.hostname || '—'}</td>
                      <td>{peer.direct ? '直连' : `中继 (${peer.cost})`}</td>
                      <td>{peer.latencyMs ? `${peer.latencyMs} ms` : '—'}</td>
                      <td>{peer.loss || '—'}</td>
                      <td>{peer.nat || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <details className="admin-details advanced-logs">
            <summary>
              <Terminal size={13} aria-hidden="true" />
              运行日志（{logs.length}）
            </summary>
            <pre>{logs.slice(-80).map((entry) => `[${entry.stream}] ${entry.text}`).join('\n') || '暂无日志'}</pre>
          </details>
        </>
      ) : null}
    </AdminPanel>
  );
}
