import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe2,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Unlink,
  X,
} from 'lucide-react';
import type { Photo, WorldInfo, WorldLibraryEntry, WorldLookupFailure } from '../types';
import {
  DEMO_LOOKUP_HINT,
  extractWorldId,
  lookupWorld,
  vrchatWorldUrl,
  worldInfoFromLibrary,
} from '../services/worldService';
import { useToast } from '../hooks/useToast';
import { SafeImage } from './SafeImage';

interface WorldPanelProps {
  photo: Photo;
  onUpdate: (patch: Partial<Photo>) => void;
  library: WorldLibraryEntry[];
  apiBase: string;
  onOpenAdmin?: () => void;
  /** Admin editor: world changes only apply when the photo is saved. */
  deferCommit?: boolean;
}

type PanelMode = 'view' | 'input' | 'manual';

function sourceLabel(source: WorldInfo['source']): string {
  if (source === 'api') return '实时 API';
  if (source === 'demo') return '内置资料';
  if (source === 'manual') return '手动填写';
  return '本地资料';
}

function errorTitle(code: WorldLookupFailure['code']): string {
  switch (code) {
    case 'invalid':
      return 'World ID 格式不正确';
    case 'not-found':
      return '资料库中没有这个世界';
    case 'timeout':
      return '世界查询超时';
    case 'bad-response':
      return '接口返回的数据不完整';
    default:
      return '世界识别失败';
  }
}

export function WorldPanel({
  photo,
  onUpdate,
  library,
  apiBase,
  onOpenAdmin,
  deferCommit = false,
}: WorldPanelProps) {
  const { pushToast } = useToast();
  const [mode, setMode] = useState<PanelMode>('view');
  const [input, setInput] = useState('');
  const [error, setError] = useState<WorldLookupFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [manualError, setManualError] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const manualRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimer = useRef<number | null>(null);

  const parsedId = useMemo(() => extractWorldId(input), [input]);
  const manualId = parsedId ?? photo.worldId ?? photo.world?.id ?? '';
  const apiEnabled = Boolean(apiBase.trim());
  const deferSuffix = deferCommit ? '（保存照片后生效）' : '';

  useEffect(() => {
    setMode('view');
    setInput('');
    setError(null);
    setLoading(false);
    setManualName('');
    setManualAuthor('');
    setManualError('');
    setConfirmingRemove(false);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [photo.id]);

  useEffect(() => {
    if (mode === 'input') {
      const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (mode === 'manual') {
      const frame = window.requestAnimationFrame(() => manualRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [mode]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const openInput = () => {
    setInput(photo.world?.id || photo.worldId || '');
    setError(null);
    setMode('input');
  };

  const openManual = () => {
    setManualName(photo.world?.name ?? '');
    setManualAuthor(photo.world?.author ?? '');
    setManualError('');
    setMode('manual');
  };

  const closeForm = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setError(null);
    setMode('view');
  };

  const assignLibraryEntry = (entry: WorldLibraryEntry) => {
    onUpdate({
      world: worldInfoFromLibrary(entry),
      worldId: entry.id || undefined,
      worldLookup: entry.source === 'manual' ? 'manual' : 'resolved',
      worldRef: entry.key,
    });
    setMode('view');
    pushToast({
      tone: 'success',
      title: '已从资料库关联世界',
      description: `${entry.name}${entry.id ? ' · 已记录 World ID' : ''}${deferSuffix}`,
    });
  };

  const handleLookup = async (event?: FormEvent) => {
    event?.preventDefault();
    if (loading) return;
    const id = extractWorldId(input);
    if (!id) {
      setError({
        status: 'error',
        code: 'invalid',
        worldId: '',
        message:
          '没有在输入中找到有效的 World ID。请粘贴 VRChat 世界链接，或形如 wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx 的 ID。',
      });
      return;
    }
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await lookupWorld(input, {
        signal: controller.signal,
        library,
        apiBase,
      });
      if (result.status === 'ok') {
        onUpdate({
          world: result.world,
          worldId: result.world.id || undefined,
          worldLookup: result.world.source === 'manual' ? 'manual' : 'resolved',
          worldRef: undefined,
        });
        const sourceText =
          result.source === 'live'
            ? '后端代理实时查询'
            : result.world.source === 'demo'
              ? '本地资料库 · 内置资料'
              : '本地世界资料库';
        pushToast({
          tone: 'success',
          title: '世界识别成功',
          description: `${result.world.name} · ${sourceText}${deferSuffix}`,
        });
        setMode('view');
      } else {
        setError(result);
        if (!photo.world) {
          onUpdate({
            worldId: result.worldId || id,
            world: null,
            worldLookup: 'failed',
            worldRef: undefined,
          });
        }
      }
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        setError({
          status: 'error',
          code: 'network',
          worldId: id,
          message: '世界识别过程出现意外错误，请再试一次。',
        });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const cancelLookup = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const handleKeepIdOnly = () => {
    const id = parsedId ?? photo.worldId;
    if (!id) return;
    onUpdate({
      world: null,
      worldId: id,
      worldLookup: 'failed',
      worldRef: undefined,
    });
    setMode('view');
    setError(null);
    pushToast({
      title: '已保留 World ID',
      description: '资料还没有识别，可以稍后重试或在管理台补充世界资料。',
    });
  };

  const handleManualSave = (event: FormEvent) => {
    event.preventDefault();
    const name = manualName.trim();
    if (!name) {
      setManualError('请填写世界名称。');
      return;
    }
    const id = manualId;
    const world: WorldInfo = {
      id,
      name,
      author: manualAuthor.trim() || undefined,
      description: photo.world?.source === 'manual' ? photo.world.description : undefined,
      source: 'manual',
    };
    onUpdate({
      world,
      worldId: id || undefined,
      worldLookup: 'manual',
      worldRef: photo.world?.source === 'manual' ? photo.worldRef : undefined,
    });
    setMode('view');
    setError(null);
    pushToast({
      tone: 'success',
      title: '世界资料已保存',
      description: `${name} · 手动填写${deferSuffix}`,
    });
  };

  const handleRemove = () => {
    onUpdate({ world: null, worldId: undefined, worldLookup: 'none', worldRef: undefined });
    setConfirmingRemove(false);
    setMode('view');
    pushToast({
      title: '已解除世界关联',
      description: `这张照片回到了自由的状态。${deferSuffix}`,
    });
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      pushToast({ title: 'World ID 已复制' });
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({
        tone: 'warning',
        title: '复制失败',
        description: '可以手动选中 World ID 后复制。',
      });
    }
  };

  const renderForm = () => (
    <div className="world-form">
      <div className="world-form__head">
        <div>
          <p className="section-kicker">WORLD LOOKUP</p>
          <h4>{photo.world ? '更换关联世界' : '识别世界资料'}</h4>
        </div>
        <button
          type="button"
          className="icon-button icon-button--small"
          onClick={closeForm}
          aria-label="关闭世界编辑"
        >
          <X size={15} />
        </button>
      </div>

      <form onSubmit={handleLookup}>
        <label className="field-label" htmlFor="world-id-input">
          世界链接或 World ID
        </label>
        <div className={`input-shell${parsedId ? ' has-value' : ''}`}>
          <Link2 size={16} strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={inputRef}
            id="world-id-input"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) setError(null);
            }}
            placeholder="https://vrchat.com/home/world/wrld_…"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="world-id-hint"
            disabled={loading}
          />
        </div>
        <p className="field-hint" id="world-id-hint">
          粘贴世界链接或 ID；离线模式会从本地世界资料库识别。
        </p>

        {parsedId ? (
          <p className="parsed-chip">
            <CheckCircle2 size={14} aria-hidden="true" />
            已识别 <code>{parsedId}</code>
          </p>
        ) : input.trim() ? (
          <p className="field-hint field-hint--warn">还没有找到有效的 World ID，请检查链接。</p>
        ) : null}

        {!apiEnabled ? (
          <div className="demo-hint">
            <Info size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>
              离线识别：从本地世界资料库检索。没有命中时，可以手动录入或在管理台补充资料。
            </span>
            <button
              type="button"
              className="demo-hint__fill"
              onClick={() => setInput(DEMO_LOOKUP_HINT)}
            >
              填入内置 ID
            </button>
          </div>
        ) : (
          <p className="field-hint">
            查询会通过已配置的后端代理完成，浏览器不会直接接触私密 API 凭据。
          </p>
        )}

        {library.length > 0 ? (
          <div className="library-picker">
            <label className="field-label" htmlFor="world-library-picker">
              或从本地资料库选择
            </label>
            <div className="select-shell">
              <Globe2 size={15} strokeWidth={1.7} aria-hidden="true" />
              <select
                id="world-library-picker"
                value=""
                onChange={(event) => {
                  const entry = library.find((item) => item.key === event.target.value);
                  if (entry) assignLibraryEntry(entry);
                }}
                disabled={loading}
              >
                <option value="">选择一个已收录的世界…</option>
                {library.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.name}
                    {entry.id ? ` · ${entry.id.slice(5, 13)}…` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="world-loading" aria-live="polite">
            <span className="orbit-spinner" aria-hidden="true" />
            <div>
              <p className="world-loading__title">正在穿过世界边界…</p>
              <p className="world-loading__text">
                {apiEnabled ? '正在请求后端代理。' : '正在检索本地世界资料库。'}
              </p>
            </div>
            <button type="button" className="text-button" onClick={cancelLookup}>
              取消
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="world-error" role="alert">
            <AlertTriangle size={17} strokeWidth={1.8} aria-hidden="true" />
            <div className="world-error__body">
              <p className="world-error__title">{errorTitle(error.code)}</p>
              <p className="world-error__text">{error.message}</p>
              <div className="world-error__actions">
                <button type="button" className="text-button" onClick={() => void handleLookup()}>
                  <RefreshCw size={13} />
                  再试一次
                </button>
                <button type="button" className="text-button" onClick={openManual}>
                  手动填写名称
                </button>
                {onOpenAdmin && !apiEnabled ? (
                  <button type="button" className="text-button" onClick={onOpenAdmin}>
                    去管理台添加世界
                  </button>
                ) : null}
                {parsedId && !photo.world ? (
                  <button type="button" className="text-button" onClick={handleKeepIdOnly}>
                    仅保留 World ID
                  </button>
                ) : null}
                {photo.world ? (
                  <button type="button" className="text-button" onClick={closeForm}>
                    保留当前关联
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="form-actions">
          <button type="button" className="button button--ghost button--small" onClick={closeForm}>
            取消
          </button>
          <button type="submit" className="button button--primary button--small" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={15} className="spinner" aria-hidden="true" />
                正在识别…
              </>
            ) : (
              <>
                <Search size={15} aria-hidden="true" />
                识别世界
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );

  const renderManualForm = () => (
    <div className="world-form">
      <div className="world-form__head">
        <div>
          <p className="section-kicker">MANUAL WORLD</p>
          <h4>手动填写世界资料</h4>
        </div>
        <button
          type="button"
          className="icon-button icon-button--small"
          onClick={() => setMode('view')}
          aria-label="关闭手动填写"
        >
          <X size={15} />
        </button>
      </div>

      <form onSubmit={handleManualSave}>
        <p className="manual-note">
          <Info size={14} aria-hidden="true" />
          手动资料会写入本地世界资料库，不会同步到 VRChat；可在管理台继续完善。
        </p>
        <label className="field-label" htmlFor="manual-world-name">
          世界名称 <span className="field-required">必填</span>
        </label>
        <div className="input-shell">
          <Globe2 size={16} strokeWidth={1.7} aria-hidden="true" />
          <input
            ref={manualRef}
            id="manual-world-name"
            value={manualName}
            onChange={(event) => {
              setManualName(event.target.value);
              if (manualError) setManualError('');
            }}
            placeholder="例如：月灯りの杜"
            maxLength={80}
            autoComplete="off"
          />
        </div>
        <label className="field-label" htmlFor="manual-world-author">
          作者 / 创作者 <span className="field-optional">选填</span>
        </label>
        <div className="input-shell">
          <span className="input-shell__glyph" aria-hidden="true">
            @
          </span>
          <input
            id="manual-world-author"
            value={manualAuthor}
            onChange={(event) => setManualAuthor(event.target.value)}
            placeholder="世界的作者名称"
            maxLength={60}
            autoComplete="off"
          />
        </div>
        {manualId ? (
          <p className="parsed-chip">
            <CheckCircle2 size={14} aria-hidden="true" />
            会同时保留 World ID <code>{manualId}</code>
          </p>
        ) : (
          <p className="field-hint">没有 World ID 也可以保存，只是无法在 VRChat 中直接打开。</p>
        )}
        {manualError ? (
          <p className="field-error" role="alert">
            {manualError}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setMode('input')}
          >
            返回识别
          </button>
          <button type="submit" className="button button--primary button--small">
            保存世界资料
          </button>
        </div>
      </form>
    </div>
  );

  return (
    <section className="world-panel" aria-labelledby="world-panel-title">
      <div className="world-panel__head">
        <div>
          <p className="section-kicker">WORLD LINK</p>
          <h3 id="world-panel-title">关联的 VRChat 世界</h3>
        </div>
        <span
          className={`mode-badge${apiEnabled ? ' mode-badge--live' : ''}`}
          title={
            apiEnabled
              ? '世界资料会通过已配置的后端代理查询。'
              : '未配置代理，识别使用本地世界资料库。'
          }
        >
          <span className="mode-badge__dot" aria-hidden="true" />
          {apiEnabled ? '联网查询' : '本地资料库'}
        </span>
      </div>

      {mode === 'input' ? renderForm() : mode === 'manual' ? renderManualForm() : null}

      {mode === 'view' && photo.world ? (
        <div className="world-card">
          <div className="world-card__media">
            {photo.world.thumbnail ? (
              <SafeImage src={photo.world.thumbnail} alt="" loading="lazy" />
            ) : (
              <span className="world-card__media-fallback" aria-hidden="true">
                <Globe2 size={30} strokeWidth={1.3} />
              </span>
            )}
            <span className={`source-badge source-badge--${photo.world.source}`}>
              {sourceLabel(photo.world.source)}
            </span>
          </div>

          <div className="world-card__content">
            <div className="world-card__title-row">
              <h4>{photo.world.name}</h4>
              {photo.world.source === 'demo' ? (
                <span
                  className="world-card__demo-mark"
                  title="内置起始世界资料，可在管理台编辑"
                >
                  BUILT-IN
                </span>
              ) : null}
            </div>
            <p className="world-card__by">
              {photo.world.author ? `by ${photo.world.author}` : '作者未知'}
              {photo.world.capacity ? (
                <>
                  <span className="dot-sep" aria-hidden="true">
                    ·
                  </span>
                  {photo.world.capacity} 人世界
                </>
              ) : null}
            </p>
            {photo.world.description ? (
              <p className="world-card__desc">{photo.world.description}</p>
            ) : null}
            {photo.world.id ? (
              <div className="world-id-row">
                <span className="world-id-row__label">WORLD ID</span>
                <code title={photo.world.id}>{photo.world.id}</code>
                <button
                  type="button"
                  className="icon-button icon-button--tiny"
                  onClick={() => void copyId(photo.world?.id ?? '')}
                  aria-label={copied ? 'World ID 已复制' : '复制 World ID'}
                  title="复制 World ID"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
            ) : null}
            <div className="world-card__actions">
              <button type="button" className="text-button" onClick={openInput}>
                <RefreshCw size={13} />
                更换世界
              </button>
              {photo.world.id && photo.world.source !== 'demo' ? (
                <a
                  className="text-button"
                  href={vrchatWorldUrl(photo.world.id)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink size={13} />
                  在 VRChat 打开
                </a>
              ) : null}
              <button
                type="button"
                className="text-button text-button--danger"
                onClick={() => setConfirmingRemove(true)}
              >
                <Unlink size={13} />
                解除关联
              </button>
            </div>

            {confirmingRemove ? (
              <div className="inline-confirm" role="alert">
                <p>解除后，这张照片会回到「未关联世界」状态。</p>
                <div className="inline-confirm__actions">
                  <button
                    type="button"
                    className="button button--danger button--tiny"
                    onClick={handleRemove}
                  >
                    确认解除
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--tiny"
                    onClick={() => setConfirmingRemove(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}

            <p className={`world-disclaimer world-disclaimer--${photo.world.source}`}>
              {photo.world.source === 'demo'
                ? '以上资料来自内置起始世界库，可在管理台编辑为你的真实世界资料。'
                : photo.world.source === 'api'
                  ? '资料经后端代理获取，可能因缓存或世界更新而与 VRChat 当前状态略有差异。'
                  : photo.world.source === 'manual'
                    ? '这是手动填写的世界资料，不会自动同步 VRChat 的信息。'
                    : '来自本地世界资料库，不会自动与 VRChat 同步。'}
            </p>
          </div>
        </div>
      ) : null}

      {mode === 'view' && !photo.world && photo.worldId ? (
        <>
          <div className="world-pending">
            <span className="world-pending__icon" aria-hidden="true">
              <Link2 size={22} strokeWidth={1.5} />
            </span>
            <div className="world-pending__body">
              <h4>World ID 已保留，资料还未识别</h4>
              <p>可以重新查询、从资料库选择，或手动填写世界名称；ID 会继续保留。</p>
              <code>{photo.worldId}</code>
            </div>
          </div>
          <div className="world-pending__actions">
            <button type="button" className="button button--soft button--small" onClick={openInput}>
              <Search size={14} />
              重新识别
            </button>
            <button type="button" className="button button--ghost button--small" onClick={openManual}>
              手动填写名称
            </button>
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={() => setConfirmingRemove(true)}
            >
              移除关联
            </button>
          </div>
          {confirmingRemove ? (
            <div className="inline-confirm" role="alert">
              <p>移除后，World ID 也会从这张照片中删除。</p>
              <div className="inline-confirm__actions">
                <button
                  type="button"
                  className="button button--danger button--tiny"
                  onClick={handleRemove}
                >
                  确认移除
                </button>
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={() => setConfirmingRemove(false)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {mode === 'view' && !photo.world && !photo.worldId ? (
        <div className="world-empty">
          <span className="world-empty__icon" aria-hidden="true">
            <Globe2 size={26} strokeWidth={1.4} />
          </span>
          <h4>这张照片还没有关联世界</h4>
          <p>
            粘贴 VRChat 世界链接或 World ID，从本地资料库识别，或手动录入世界资料。
          </p>
          <button type="button" className="button button--soft button--small" onClick={openInput}>
            <Link2 size={14} />
            关联世界
          </button>
          <p className="world-empty__note">
            {apiEnabled
              ? '查询将经由已配置的后端代理完成。'
              : '未配置代理：识别使用本地世界资料库，可在管理台维护。'}
          </p>
        </div>
      ) : null}
    </section>
  );
}
