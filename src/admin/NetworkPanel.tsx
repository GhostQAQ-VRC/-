import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Globe2,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import type { NetworkConfigView, ProxyConfigView, ProxyMode } from '../platform/desktopApi';
import { getDesktopBridge } from '../platform';
import { useToast } from '../hooks/useToast';
import { AdminPanel } from './AdminUI';

const MODE_OPTIONS: Array<{ id: ProxyMode; label: string; hint: string }> = [
  { id: 'system', label: '跟随系统代理', hint: '使用 Windows/macOS 系统设置中的代理与 PAC。' },
  { id: 'none', label: '不使用代理', hint: '所有请求直连。' },
  { id: 'http', label: 'HTTP 代理', hint: '适用于 Clash、v2rayN 等提供的 HTTP 端口。' },
  { id: 'socks5', label: 'SOCKS5 代理', hint: '适用于本地 SOCKS5 端口（如 1080）。' },
  { id: 'pac', label: 'PAC 脚本', hint: '按 PAC 规则自动选择代理。' },
  { id: 'custom', label: '自定义规则', hint: '直接填写 Chromium 代理规则，例如 http=127.0.0.1:7890;https=127.0.0.1:7890。' },
];

const EMPTY_PROXY: ProxyConfigView = {
  mode: 'system',
  httpUrl: '',
  socksUrl: '',
  pacUrl: '',
  customRules: '',
  bypass: '<local>',
};

export function NetworkPanel() {
  const { pushToast } = useToast();
  const bridge = getDesktopBridge();
  const [config, setConfig] = useState<NetworkConfigView | null>(null);
  const [form, setForm] = useState<ProxyConfigView>(EMPTY_PROXY);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.network
      .getConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setForm(next.proxy);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          pushToast({
            tone: 'danger',
            title: '读取代理设置失败',
            description: error.message,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, pushToast]);

  if (!bridge) {
    return (
      <AdminPanel kicker="NETWORK PROXY" title="网络代理">
        <p className="admin-panel__note">
          <ShieldCheck size={13} aria-hidden="true" />
          代理管理只在桌面客户端生效。网页版受浏览器同源策略限制，无法修改系统代理。
        </p>
      </AdminPanel>
    );
  }

  const patch = (next: Partial<ProxyConfigView>) => {
    setForm((prev) => ({ ...prev, ...next }));
    setTestResult(null);
  };

  const dirty =
    !config ||
    (Object.keys(form) as Array<keyof ProxyConfigView>).some(
      (key) => form[key] !== config.proxy[key],
    );

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const result = await bridge.network.setProxy(form);
      setConfig(result.config);
      if (result.ok) {
        setForm(result.config.proxy);
        pushToast({
          tone: 'success',
          title: '代理设置已保存并生效',
          description: result.applied ? `当前模式：${result.applied}` : undefined,
        });
      } else {
        pushToast({
          tone: 'warning',
          title: '代理没有生效',
          description: result.error,
        });
      }
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '保存代理设置失败',
        description: (error as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await bridge.network.test({ proxy: form });
      setTestResult({
        ok: result.ok,
        message: [
          result.message || (result.ok ? '连接成功。' : '连接失败。'),
          result.proxy ? `系统解析：${result.proxy}` : '',
          result.error || '',
        ]
          .filter(Boolean)
          .join(' · '),
      });
    } catch (error) {
      setTestResult({ ok: false, message: (error as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AdminPanel kicker="NETWORK PROXY" title="网络代理">
      <div className="admin-form">
        <div className={`admin-status-line${form.mode !== 'none' ? ' is-live' : ''}`}>
          <span className="admin-status-line__dot" aria-hidden="true" />
          {loading
            ? '正在读取代理设置…'
            : `当前模式：${
                MODE_OPTIONS.find((option) => option.id === form.mode)?.label ?? form.mode
              }`}
        </div>
        <p className="field-hint">
          代理会同时作用于 VRChat 官方世界资料、远程图片与世界查询代理。修改后立即应用到客户端网络会话。
        </p>

        <div className="field">
          <label className="field-label" htmlFor="proxy-mode">
            代理模式
          </label>
          <select
            id="proxy-mode"
            className="admin-select admin-select--wide"
            value={form.mode}
            onChange={(event) => patch({ mode: event.target.value as ProxyMode })}
            disabled={loading || saving}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="field-hint">
            {MODE_OPTIONS.find((option) => option.id === form.mode)?.hint}
          </p>
        </div>

        {form.mode === 'http' ? (
          <div className="field">
            <label className="field-label" htmlFor="proxy-http">
              HTTP 代理地址
            </label>
            <div className="input-shell">
              <Globe2 size={15} aria-hidden="true" />
              <input
                id="proxy-http"
                value={form.httpUrl}
                onChange={(event) => patch({ httpUrl: event.target.value })}
                placeholder="http://127.0.0.1:7890"
                spellCheck={false}
                disabled={saving}
              />
            </div>
          </div>
        ) : null}

        {form.mode === 'socks5' ? (
          <div className="field">
            <label className="field-label" htmlFor="proxy-socks">
              SOCKS5 代理地址
            </label>
            <div className="input-shell">
              <Globe2 size={15} aria-hidden="true" />
              <input
                id="proxy-socks"
                value={form.socksUrl}
                onChange={(event) => patch({ socksUrl: event.target.value })}
                placeholder="socks5://127.0.0.1:1080"
                spellCheck={false}
                disabled={saving}
              />
            </div>
          </div>
        ) : null}

        {form.mode === 'pac' ? (
          <div className="field">
            <label className="field-label" htmlFor="proxy-pac">
              PAC 脚本地址
            </label>
            <div className="input-shell">
              <Globe2 size={15} aria-hidden="true" />
              <input
                id="proxy-pac"
                value={form.pacUrl}
                onChange={(event) => patch({ pacUrl: event.target.value })}
                placeholder="https://example.com/proxy.pac"
                spellCheck={false}
                disabled={saving}
              />
            </div>
          </div>
        ) : null}

        {form.mode === 'custom' ? (
          <div className="field">
            <label className="field-label" htmlFor="proxy-custom">
              自定义代理规则
            </label>
            <div className="input-shell">
              <Network size={15} aria-hidden="true" />
              <input
                id="proxy-custom"
                value={form.customRules}
                onChange={(event) => patch({ customRules: event.target.value })}
                placeholder="http=127.0.0.1:7890;https=127.0.0.1:7890"
                spellCheck={false}
                disabled={saving}
              />
            </div>
          </div>
        ) : null}

        {form.mode !== 'system' && form.mode !== 'none' ? (
          <div className="field">
            <label className="field-label" htmlFor="proxy-bypass">
              绕过代理的地址
            </label>
            <div className="input-shell">
              <input
                id="proxy-bypass"
                value={form.bypass}
                onChange={(event) => patch({ bypass: event.target.value })}
                placeholder="<local>,localhost,127.0.0.1"
                spellCheck={false}
                disabled={saving}
              />
            </div>
            <p className="field-hint">
              使用 Chromium 规则，多条用英文逗号分隔；`&lt;local&gt;` 表示所有本地地址。
            </p>
          </div>
        ) : null}

        {testResult ? (
          <p
            className={`admin-test-result${testResult.ok ? ' is-ok' : ' is-error'}`}
            role="status"
          >
            {testResult.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {testResult.message}
          </p>
        ) : null}

        <div className="admin-form__footer">
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => void test()}
            disabled={testing || loading || saving}
          >
            {testing ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
            测试连通性
          </button>
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => void save()}
            disabled={saving || loading || !dirty}
          >
            保存并应用
          </button>
        </div>
      </div>
    </AdminPanel>
  );
}
