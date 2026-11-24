import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Wand2,
} from 'lucide-react';
import type { AlbumApi } from '../../hooks/useAlbum';
import { useDesktopServices, type AiBatchScope } from '../../hooks/useDesktopServices';
import { useToast } from '../../hooks/useToast';
import {
  getDesktopBridge,
  type AiModelInfo,
  type AiProtocol,
  type AiSettingsView,
} from '../../platform';
import { AdminPanel } from '../AdminUI';

const PROTOCOL_LABELS: Record<AiProtocol, string> = {
  openai: 'OpenAI 兼容（OpenAI / LM Studio / vLLM / OneAPI）',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  ollama: 'Ollama 本地',
};

const PROTOCOL_PLACEHOLDERS: Record<AiProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://127.0.0.1:11434',
};

interface AiForm {
  protocol: AiProtocol;
  baseUrl: string;
  primaryModel: string;
  backupModel: string;
  showAllModels: boolean;
  allowUnverifiedVision: boolean;
}

function formFrom(config: AiSettingsView): AiForm {
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    primaryModel: config.primaryModel,
    backupModel: config.backupModel,
    showAllModels: config.showAllModels === true,
    allowUnverifiedVision: config.allowUnverifiedVision === true,
  };
}

export function AiPanel({ album }: { album: AlbumApi }) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const { aiBatch, startAiBatch, cancelAiBatch } = useDesktopServices();
  const [config, setConfig] = useState<AiSettingsView | null>(null);
  const [form, setForm] = useState<AiForm | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [scope, setScope] = useState<AiBatchScope>('missing');

  useEffect(() => {
    if (!bridge) return;
    void bridge.ai.getConfig().then((next) => {
      setConfig(next);
      setForm(formFrom(next));
      setModels(next.models || []);
    });
  }, [bridge]);

  const libraryPhotos = useMemo(
    () => album.photos.filter((photo) => photo.mediaKind === 'library' && !photo.missing),
    [album.photos],
  );
  const summarized = libraryPhotos.filter((photo) => Boolean(photo.aiSummary)).length;
  const missing = libraryPhotos.length - summarized;
  const noWorld = libraryPhotos.filter((photo) => !photo.worldId && !photo.worldRef).length;

  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return models.filter((model) => {
      if (!form?.showAllModels && !model.vision) return false;
      if (!query) return true;
      return `${model.id} ${model.name}`.toLowerCase().includes(query);
    });
  }, [models, form?.showAllModels, modelSearch]);

  const primaryInfo = models.find((model) => model.id === form?.primaryModel);
  const backupInfo = models.find((model) => model.id === form?.backupModel);
  const unverifiedSelected = Boolean(
    !form?.allowUnverifiedVision &&
      ((form?.primaryModel && (!primaryInfo || !primaryInfo.vision)) ||
        (form?.backupModel && (!backupInfo || !backupInfo.vision))),
  );
  const keyReady =
    form?.protocol === 'ollama' || config?.hasApiKey || Boolean(apiKey.trim());

  const applyConfig = (next: AiSettingsView) => {
    setConfig(next);
    setForm(formFrom(next));
    setModels(next.models || []);
  };

  const save = async (): Promise<boolean> => {
    if (!bridge || !form) return false;
    setBusy('save');
    try {
      const next = await bridge.ai.setConfig({
        ...form,
        apiKey: apiKey.trim() || undefined,
        clearKey,
      });
      applyConfig(next);
      setApiKey('');
      setClearKey(false);
      setMessage({ ok: true, text: 'AI 设置已保存。' });
      return true;
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if (!bridge || !form) return;
    setBusy('test');
    setMessage(null);
    try {
      const result = await bridge.ai.test({
        protocol: form.protocol,
        baseUrl: form.baseUrl,
        apiKey: apiKey.trim() || undefined,
      });
      setMessage({
        ok: result.ok,
        text: result.message || result.error || (result.ok ? '连接成功。' : '连接失败。'),
      });
    } finally {
      setBusy(null);
    }
  };

  const fetchModels = async () => {
    if (!bridge || !form) return;
    setBusy('models');
    setMessage(null);
    try {
      const result = await bridge.ai.listModels({
        protocol: form.protocol,
        baseUrl: form.baseUrl,
        apiKey: apiKey.trim() || undefined,
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error || '获取模型失败。' });
        return;
      }
      setModels(result.models);
      setConfig((prev) =>
        prev
          ? { ...prev, models: result.models, modelsAt: new Date().toISOString() }
          : prev,
      );
      setMessage({
        ok: true,
        text: `已获取 ${result.models.length} 个模型，其中 ${result.visionCount ?? result.models.filter((model) => model.vision).length} 个被识别为视觉模型。`,
      });
      if (!result.models.some((model) => model.vision)) {
        pushToast({
          tone: 'warning',
          title: '没有识别到视觉模型',
          description: '可以开启「显示全部模型」并手动确认模型是否支持图片输入。',
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const selectProtocol = (protocol: AiProtocol) => {
    if (!form) return;
    const defaultBase = PROTOCOL_PLACEHOLDERS[protocol];
    setModels([]);
    setForm({
      ...form,
      protocol,
      baseUrl: defaultBase,
      primaryModel: '',
      backupModel: '',
    });
  };

  const setAsPrimary = (id: string) => {
    if (!form) return;
    setForm({
      ...form,
      primaryModel: id,
      backupModel: form.backupModel === id ? '' : form.backupModel,
    });
  };

  const setAsBackup = (id: string) => {
    if (!form) return;
    setForm({
      ...form,
      backupModel: id,
      primaryModel: form.primaryModel === id ? '' : form.primaryModel,
    });
  };

  const startBatch = async () => {
    setBusy('batch');
    try {
      const saved = await save();
      if (!saved) return;
      const result = await startAiBatch(scope);
      if (!result.ok) setMessage({ ok: false, text: result.error || '无法开始。' });
    } finally {
      setBusy(null);
    }
  };

  const startWorldBatch = async () => {
    setBusy('worldBatch');
    try {
      const saved = await save();
      if (!saved) return;
      const result = await startAiBatch('all', undefined, 'worldId');
      if (!result.ok) setMessage({ ok: false, text: result.error || '无法开始。' });
    } finally {
      setBusy(null);
    }
  };

  if (!bridge) {
    return (
      <AdminPanel kicker="AI VISION" title="AI 图像总结">
        <p className="admin-panel__note">仅桌面客户端可用。</p>
      </AdminPanel>
    );
  }

  return (
    <>
      <AdminPanel kicker="AI SERVICE" title="AI 服务与模型" className="advanced-ai-panel">
        <div className={`admin-status-line${config?.hasApiKey ? ' is-live' : ''}`}>
          <span className="admin-status-line__dot" aria-hidden="true" />
          {config?.hasApiKey
            ? 'API Key 已加密保存在本机'
            : form?.protocol === 'ollama'
              ? 'Ollama 本地模式（可不需要 API Key）'
              : '尚未保存 API Key'}
          {config?.modelsAt ? ` · 模型更新于 ${new Date(config.modelsAt).toLocaleString()}` : ''}
        </div>

        {form ? (
          <div className="admin-form advanced-form">
            <div className="field">
              <label className="field-label" htmlFor="ai-protocol">
                协议
              </label>
              <select
                id="ai-protocol"
                className="admin-select"
                value={form.protocol}
                onChange={(event) => selectProtocol(event.target.value as AiProtocol)}
              >
                {Object.entries(PROTOCOL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="ai-base-url">
                API Base URL
              </label>
              <div className="input-shell">
                <input
                  id="ai-base-url"
                  value={form.baseUrl}
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                  placeholder={PROTOCOL_PLACEHOLDERS[form.protocol]}
                  spellCheck={false}
                />
              </div>
              <p className="field-hint">
                OpenAI 兼容服务可填站点根地址或已包含 /v1 的地址；Ollama 填本机地址。
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="ai-api-key">
                API Key
              </label>
              <div className="input-shell">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  id="ai-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    config?.hasApiKey
                      ? '已保存（留空保持不变）'
                      : form.protocol === 'ollama'
                        ? 'Ollama 可留空'
                        : 'sk-...'
                  }
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShowKey((value) => !value)}
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
              <p className="field-hint">
                使用 Electron safeStorage（Windows DPAPI）加密，仅保存在本机，不随存储库迁移。
              </p>
              {config?.hasApiKey ? (
                <label className="library-panel__checkbox">
                  <input
                    type="checkbox"
                    checked={clearKey}
                    onChange={(event) => setClearKey(event.target.checked)}
                  />
                  <span>清除已保存的 API Key</span>
                </label>
              ) : null}
            </div>

            <div className="advanced-actions">
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void save()}
                disabled={busy !== null}
              >
                {busy === 'save' ? <Loader2 size={14} className="spinner" /> : null}
                保存设置
              </button>
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void test()}
                disabled={busy !== null}
              >
                {busy === 'test' ? <Loader2 size={14} className="spinner" /> : <CheckCircle2 size={14} />}
                测试连接
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void fetchModels()}
                disabled={busy !== null}
              >
                {busy === 'models' ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
                一键获取全部模型
              </button>
            </div>

            {message ? (
              <p className={`advanced-message${message.ok ? ' is-ok' : ' is-error'}`} role="status">
                {message.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {message.text}
              </p>
            ) : null}

            <div className="advanced-model-head">
              <div>
                <p className="field-label">主模型 / 备用模型</p>
                <p className="field-hint">
                  只有支持图片输入的视觉模型才可以生成总结；主模型失败时会自动尝试备用模型。
                </p>
              </div>
              <label className="library-panel__checkbox">
                <input
                  type="checkbox"
                  checked={form.showAllModels}
                  onChange={(event) =>
                    setForm({ ...form, showAllModels: event.target.checked })
                  }
                />
                <span>显示全部模型</span>
              </label>
            </div>

            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label" htmlFor="ai-primary">
                  主模型
                </label>
                <div className="input-shell">
                  <Cpu size={15} aria-hidden="true" />
                  <input
                    id="ai-primary"
                    value={form.primaryModel}
                    onChange={(event) =>
                      setForm({ ...form, primaryModel: event.target.value })
                    }
                    placeholder="选择或手动填写模型 ID"
                    spellCheck={false}
                  />
                  {primaryInfo?.vision ? <span className="advanced-vision-badge">视觉</span> : null}
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="ai-backup">
                  备用模型
                </label>
                <div className="input-shell">
                  <Cpu size={15} aria-hidden="true" />
                  <input
                    id="ai-backup"
                    value={form.backupModel}
                    onChange={(event) =>
                      setForm({ ...form, backupModel: event.target.value })
                    }
                    placeholder="可选；主模型失败时使用"
                    spellCheck={false}
                  />
                  {backupInfo?.vision ? <span className="advanced-vision-badge">视觉</span> : null}
                </div>
              </div>
            </div>

            {unverifiedSelected ? (
              <label className="library-panel__checkbox advanced-checkbox-warning">
                <input
                  type="checkbox"
                  checked={form.allowUnverifiedVision}
                  onChange={(event) =>
                    setForm({ ...form, allowUnverifiedVision: event.target.checked })
                  }
                />
                <span>我已确认所选模型支持图像输入（本地无法自动验证）</span>
              </label>
            ) : null}

            <div className="advanced-model-toolbar">
              <div className="input-shell advanced-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={modelSearch}
                  onChange={(event) => setModelSearch(event.target.value)}
                  placeholder="搜索模型 ID"
                />
              </div>
              <span className="field-hint">
                显示 {visibleModels.length} / {models.length} 个模型
              </span>
            </div>

            <div className="advanced-model-list">
              {visibleModels.length === 0 ? (
                <p className="advanced-empty">
                  <Cpu size={18} aria-hidden="true" />
                  还没有模型。点击「一键获取全部模型」，或手动填写模型 ID。
                </p>
              ) : (
                visibleModels.map((model) => {
                  const isPrimary = form.primaryModel === model.id;
                  const isBackup = form.backupModel === model.id;
                  return (
                    <div
                      className={`advanced-model${isPrimary ? ' is-primary' : ''}${
                        isBackup ? ' is-backup' : ''
                      }`}
                      key={model.id}
                    >
                      <div className="advanced-model__id">
                        <strong>{model.name || model.id}</strong>
                        {model.name !== model.id ? <small>{model.id}</small> : null}
                      </div>
                      <span
                        className={`advanced-model__tag${
                          model.vision ? ' is-vision' : ' is-text'
                        }`}
                      >
                        {model.vision ? '视觉' : '文本'}
                      </span>
                      <div className="advanced-model__actions">
                        <button
                          type="button"
                          className={`text-button${isPrimary ? ' is-active' : ''}`}
                          onClick={() => setAsPrimary(model.id)}
                        >
                          设为主模型
                        </button>
                        <button
                          type="button"
                          className={`text-button${isBackup ? ' is-active' : ''}`}
                          onClick={() => setAsBackup(model.id)}
                        >
                          设为备用
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="admin-form__footer">
              <p className="field-hint">
                生成时会把照片预览与备注发送到所配置的 API，可能产生费用；不会发送原图。
              </p>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void save()}
                disabled={busy !== null || unverifiedSelected}
              >
                保存主/备模型
              </button>
            </div>
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel kicker="AI BATCH" title="为照片生成回忆总结" className="advanced-batch-panel">
        <div className="advanced-grid">
          <div className="advanced-stat">
            <span>存储库照片</span>
            <strong>{libraryPhotos.length}</strong>
          </div>
          <div className="advanced-stat">
            <span>已有总结</span>
            <strong>{summarized}</strong>
          </div>
          <div className="advanced-stat">
            <span>待生成</span>
            <strong>{missing}</strong>
          </div>
          <div className="advanced-stat">
            <span>待识别 World ID</span>
            <strong>{noWorld}</strong>
          </div>
          <div className="advanced-stat">
            <span>当前任务</span>
            <strong>{aiBatch.running ? `${aiBatch.current}/${aiBatch.total}` : '空闲'}</strong>
          </div>
        </div>

        <div className="advanced-actions advanced-actions--main">
          <select
            className="admin-select"
            value={scope}
            onChange={(event) => setScope(event.target.value as AiBatchScope)}
            disabled={aiBatch.running}
          >
            <option value="missing">只补缺失的 {missing} 张</option>
            <option value="all">重新生成全部 {libraryPhotos.length} 张</option>
          </select>
          {aiBatch.running ? (
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void cancelAiBatch()}
            >
              <Square size={13} />
              停止
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={() => void startBatch()}
                disabled={
                  busy !== null ||
                  libraryPhotos.length === 0 ||
                  (!form?.primaryModel && !form?.backupModel) ||
                  !keyReady ||
                  unverifiedSelected
                }
              >
                {busy === 'batch' ? <Loader2 size={14} className="spinner" /> : <Play size={14} />}
                开始生成总结
              </button>
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void startWorldBatch()}
                disabled={
                  busy !== null ||
                  noWorld === 0 ||
                  (!form?.primaryModel && !form?.backupModel) ||
                  !keyReady ||
                  unverifiedSelected
                }
              >
                {busy === 'worldBatch' ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <Search size={14} />
                )}
                识别画面 World ID（{noWorld}）
              </button>
            </>
          )}
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void save()}
            disabled={busy !== null || aiBatch.running}
          >
            <Wand2 size={14} />
            保存当前配置
          </button>
        </div>

        {aiBatch.running ? (
          <div className="advanced-progress">
            <span>
              {aiBatch.mode === 'worldId' ? '正在识别 World ID' : '正在生成总结'}{' '}
              {aiBatch.current}/{aiBatch.total} · 成功 {aiBatch.done} · 失败 {aiBatch.failed}
            </span>
            <strong>
              {aiBatch.total
                ? Math.round((aiBatch.current / aiBatch.total) * 100)
                : 0}
              %
            </strong>
            <div className="advanced-progress__bar">
              <i
                style={{
                  width: `${
                    aiBatch.total
                      ? Math.round((aiBatch.current / aiBatch.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        ) : aiBatch.last ? (
          <p className="advanced-message is-ok">
            <Sparkles size={14} />
            {aiBatch.last.mode === 'worldId'
              ? `上次识别：找到 ${aiBatch.last.worldIds ?? 0} 个 World ID${
                  aiBatch.last.failed ? `，${aiBatch.last.failed} 张未识别/失败` : ''
                }`
              : `上次任务：成功 ${aiBatch.last.done} 张${
                  aiBatch.last.failed ? `，失败 ${aiBatch.last.failed} 张` : ''
                }`}
            {aiBatch.last.canceled ? '，已停止' : ''}
          </p>
        ) : null}

        <p className="admin-panel__note">
          <AlertTriangle size={13} aria-hidden="true" />
          批量任务会按顺序调用视觉模型；可以随时停止。离开此页面后任务仍会继续，结果会自动写回照片。
          World ID 识别会提高图片分辨率，专门读取拍立得画面上的 wrld_ 文字。
        </p>
      </AdminPanel>
    </>
  );
}
