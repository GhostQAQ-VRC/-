import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FolderOpen,
  FolderTree,
  HardDrive,
  Loader2,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useDesktopLibrary, useDesktopLibraryActivity } from '../hooks/useDesktopLibrary';
import { useToast } from '../hooks/useToast';
import type { ThumbnailSample } from '../platform';
import {
  DEFAULT_THUMBNAIL_PRESET_ID,
  THUMBNAIL_PRESETS_META,
  formatThumbBytes,
  thumbnailPresetMeta,
} from '../data/thumbnailPresets';
import { BrandGlyph } from './BrandGlyph';

function pathSeparator(libraryPath: string | null | undefined): string {
  return libraryPath && libraryPath.includes('\\') ? '\\' : '/';
}

function ComparePane({
  sample,
  presetId,
}: {
  sample: ThumbnailSample;
  presetId: string;
}) {
  const active = useMemo(
    () => sample.presets.find((preset) => preset.id === presetId) ?? sample.presets[0],
    [sample, presetId],
  );
  const meta = thumbnailPresetMeta(active?.id);
  const [split, setSplit] = useState(52);
  const [zoomed, setZoomed] = useState(false);
  const compareRef = useRef<HTMLDivElement>(null);

  const updateFromPointer = (clientX: number) => {
    const element = compareRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    setSplit(Math.min(96, Math.max(4, next)));
  };

  if (!active) return null;

  return (
    <div className="thumb-compare-wrap">
      <div
        ref={compareRef}
        className={`thumb-compare${zoomed ? ' is-zoomed' : ''}`}
        role="img"
        aria-label="压缩前原图与压缩后缩略图的对比，可拖动分界线"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) updateFromPointer(event.clientX);
        }}
      >
        <img
          className="thumb-compare__before"
          src={sample.originalUrl}
          alt="压缩前原图（只读）"
          draggable={false}
          decoding="async"
        />
        <div
          className="thumb-compare__after"
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        >
          <img
            src={active.url}
            alt="压缩后的缩略图"
            draggable={false}
            decoding="async"
          />
        </div>
        <span className="thumb-compare__divider" style={{ left: `${split}%` }}>
          <span className="thumb-compare__handle" aria-hidden="true" />
        </span>
        <span className="thumb-compare__tag thumb-compare__tag--a">A · 原图（只读）</span>
        <span className="thumb-compare__tag thumb-compare__tag--b">
          B · {meta.label} · {active.maxEdge}px
        </span>
        {zoomed ? <span className="thumb-compare__zoom-flag">2× 细节</span> : null}
      </div>
      <div className="thumb-compare__foot">
        <span>拖动分界线对比左右两侧；A 侧只用于本次预览，不会写入缓存。</span>
        <button
          type="button"
          className="text-button"
          onClick={() => setZoomed((value) => !value)}
          aria-pressed={zoomed}
        >
          {zoomed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {zoomed ? '恢复整张' : '放大 2× 看细节'}
        </button>
      </div>
    </div>
  );
}

export function ThumbnailSetup({ onComplete }: { onComplete?: () => void }) {
  const {
    config,
    setupThumbnails,
    sampleThumbnailPreview,
    chooseLibrary,
    scan,
    scanning,
  } = useDesktopLibrary();
  const { progress, previewProgress } = useDesktopLibraryActivity();
  const { pushToast } = useToast();
  const [dirName, setDirName] = useState('缩略图缓存');
  const [presetId, setPresetId] = useState(DEFAULT_THUMBNAIL_PRESET_ID);
  const [sample, setSample] = useState<ThumbnailSample | null>(null);
  const [sampleLoading, setSampleLoading] = useState(true);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [generationStarted, setGenerationStarted] = useState(false);
  const [indexFinished, setIndexFinished] = useState(false);
  const [scanTotal, setScanTotal] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const seenActivity = useRef(false);
  const completionAnnounced = useRef(false);

  useEffect(() => {
    if (!config) return;
    if (config.thumbnailDir && config.thumbnailDir !== '.hoshikuzu/previews') {
      setDirName(config.thumbnailDir);
    }
    if (config.previewPreset) setPresetId(config.previewPreset);
  }, [config?.libraryId, config?.thumbnailDir, config?.previewPreset]);

  useEffect(() => {
    let cancelled = false;
    setSampleLoading(true);
    setSampleError(null);
    void sampleThumbnailPreview()
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.sample) {
          setSample(result.sample);
        } else {
          setSampleError(result.error || '暂时无法生成对比样张。');
        }
      })
      .catch((error: Error) => {
        if (!cancelled) setSampleError(error.message || '暂时无法生成对比样张。');
      })
      .finally(() => {
        if (!cancelled) setSampleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sampleThumbnailPreview]);

  useEffect(() => {
    if (!generationStarted) return;
    if (progress?.phase === 'index' && progress.total) setScanTotal(progress.total);
    if (scanning || progress || (previewProgress && previewProgress.total > 0)) {
      seenActivity.current = true;
    }
    if (seenActivity.current && !scanning && !progress) setIndexFinished(true);
  }, [generationStarted, scanning, progress, previewProgress]);

  // If scanning never started (for example another queue blocked it), do not
  // leave the user on a stuck progress screen.
  useEffect(() => {
    if (!generationStarted || indexFinished) return undefined;
    const timer = window.setTimeout(() => {
      if (!seenActivity.current) setIndexFinished(true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [generationStarted, indexFinished]);

  const queueTotal = previewProgress?.total ?? 0;
  const processed = (previewProgress?.done ?? 0) + (previewProgress?.failed ?? 0);
  const complete =
    generationStarted &&
    indexFinished &&
    !scanning &&
    !progress &&
    previewProgress !== null &&
    (queueTotal === 0 || processed >= queueTotal);
  const percent = complete
    ? 100
    : !indexFinished
      ? progress?.total
        ? Math.min(95, Math.round((progress.current / progress.total) * 100))
        : 8
      : queueTotal
        ? Math.min(99, Math.round((processed / queueTotal) * 100))
        : 99;

  useEffect(() => {
    if (!complete || completionAnnounced.current) return;
    completionAnnounced.current = true;
    pushToast({
      tone: 'success',
      title: queueTotal > 0 ? '全部缩略图已生成' : '缩略图缓存已就绪',
      description:
        queueTotal > 0
          ? `共 ${queueTotal} 张缩略图，仅写入 ${config?.thumbnailDir || '缩略图缓存'}；原图未做任何修改。`
          : '存储库暂时没有照片，下次扫描新照片时会自动生成缩略图。',
    });
  }, [complete, queueTotal, config?.thumbnailDir, pushToast]);

  const activeMeta = thumbnailPresetMeta(presetId);
  const activeSample = sample?.presets.find((preset) => preset.id === presetId);
  const measuredBytes = activeSample?.bytes;
  const estimatedTotal =
    measuredBytes && sample?.imageCount ? measuredBytes * sample.imageCount : null;
  const separator = pathSeparator(config?.libraryPath);
  const cachePath = config?.libraryPath
    ? `${config.libraryPath.replace(/[\\/]+$/, '')}${separator}${dirName || '缩略图缓存'}`
    : '选择存储库后自动建立';

  const invalidName = !dirName.trim() || /[<>:"/\\|?*\u0000-\u001f]/.test(dirName);

  const submit = async () => {
    if (busy) return;
    if (invalidName) {
      setSetupError('文件夹名称只能是一层目录，不能包含 \\ / : * ? " < > | 等字符。');
      return;
    }
    setBusy(true);
    setSetupError(null);
    setGenerationError(null);
    try {
      const result = await setupThumbnails({ thumbnailDir: dirName.trim(), presetId });
      if (!result.ok || !result.config) {
        setSetupError(result.error || '无法建立缩略图缓存目录。');
        return;
      }
      setGenerationStarted(true);
      setBusy(false);
      pushToast({
        tone: 'success',
        title: '缩略图缓存已建立',
        description: `正在把全部照片压缩为缩略图，只写入 ${
          result.thumbnailDirPath || cachePath
        }；原图保持只读。`,
      });
      void scan()
        .then((scanResult) => {
          if (scanResult && !scanResult.ok) {
            setGenerationError(scanResult.error || '扫描存储库失败，缩略图尚未全部生成。');
          }
        })
        .catch((error: Error) => {
          setGenerationError(error.message || '扫描存储库失败，缩略图尚未全部生成。');
        });
    } catch (error) {
      setSetupError((error as Error).message || '无法建立缩略图缓存目录。');
    } finally {
      setBusy(false);
    }
  };

  const failed = previewProgress?.failed ?? 0;
  const statusText = complete
    ? queueTotal > 0
      ? `全部 ${queueTotal} 张缩略图已生成`
      : '缩略图缓存已就绪'
    : !indexFinished
      ? progress?.message || '正在索引存储库中的照片…'
      : queueTotal > 0
        ? `正在压缩缩略图 ${processed} / ${queueTotal}`
        : '正在准备缩略图队列…';

  if (generationStarted) {
    return (
      <div
        className="library-gate library-gate--setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="thumbnail-progress-title"
      >
        <div className="library-gate__card thumbnail-setup thumbnail-setup--progress">
          <header className="thumbnail-setup__head">
            <span className="library-gate__mark" aria-hidden="true">
              {complete ? <Check size={26} strokeWidth={2.4} /> : <BrandGlyph size={30} />}
            </span>
            <p className="section-kicker">
              STEP 2 / 2 · {complete ? 'THUMBNAILS READY' : 'GENERATING THUMBNAILS'}
            </p>
            <h1 id="thumbnail-progress-title">
              {complete ? '全部缩略图已生成' : '正在生成全部缩略图'}
            </h1>
            <p className="library-gate__lede">
              {complete
                ? '之后浏览相册只会读取缩略图；点开单张照片时才加载那一张的原图。'
                : '原图只读，正在按照你选择的规格生成缩略图。生成期间可以先进入相册，后台会继续完成。'}
            </p>
          </header>

          <section className="thumbnail-progress" aria-label="缩略图生成进度">
            <div
              className={`thumbnail-progress__bar${
                !indexFinished && !progress?.total ? ' is-indeterminate' : ''
              }`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="thumbnail-progress__meta">
              <span>{statusText}</span>
              <strong>{percent}%</strong>
            </div>
            <div className="thumbnail-progress__stats">
              <span>已索引 {scanTotal || '—'} 张</span>
              <span>
                已生成 {previewProgress?.done ?? 0}
                {queueTotal ? ` / ${queueTotal}` : ''}
              </span>
              {failed > 0 ? <span className="is-error">失败 {failed} 张</span> : null}
              <span>目录 {config?.thumbnailDir || '缩略图缓存'}</span>
              <span>
                规格 {activeMeta.label} · {activeMeta.maxEdge}px · Q{activeMeta.quality}
              </span>
            </div>
          </section>

          {generationError ? (
            <p className="thumbnail-setup__error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              {generationError}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setGenerationError(null);
                  void scan();
                }}
              >
                重试生成
              </button>
            </p>
          ) : null}

          {complete ? (
            <div className="thumbnail-progress__success" role="status">
              <Check size={20} strokeWidth={2.4} aria-hidden="true" />
              <div>
                <strong>
                  {queueTotal > 0
                    ? `全部 ${queueTotal} 张缩略图生成完成`
                    : '当前没有需要生成的照片'}
                </strong>
                <p>
                  {queueTotal > 0
                    ? `缩略图只保存在 ${
                        config?.thumbnailDir || '缩略图缓存'
                      } 目录，原始照片没有被修改、移动或覆盖。`
                    : '把照片放进存储库后重新扫描，缩略图会自动生成。'}
                  {failed > 0
                    ? ` 其中 ${failed} 张生成失败，可以重试或检查文件格式。`
                    : ''}
                </p>
              </div>
            </div>
          ) : null}

          <section className="thumbnail-setup__promise" aria-label="原图保护承诺">
            <div>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                原图永远只读：<strong>不移动、不重命名、不压缩、不删除、不上传</strong>。
              </span>
            </div>
            <div>
              <FolderTree size={16} aria-hidden="true" />
              <span>
                缩略图只写入{' '}
                <code>{config?.thumbnailDir || dirName || '缩略图缓存'}</code>
                ，离开视野后会自动释放解码内存。
              </span>
            </div>
          </section>

          <div className="thumbnail-setup__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => onComplete?.()}
            >
              {complete ? '进入相册' : '先进入相册，后台继续生成'}
            </button>
          </div>

          <p className="library-gate__note">
            {complete
              ? '提示已经全部压缩成缩略图，原图仍保持原样。'
              : '生成进度会持续保存；关闭软件后下次启动会继续补齐未完成的缩略图。'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="library-gate library-gate--setup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="thumbnail-setup-title"
    >
      <div className="library-gate__card thumbnail-setup">
        <header className="thumbnail-setup__head">
          <span className="library-gate__mark" aria-hidden="true">
            <BrandGlyph size={30} />
          </span>
          <p className="section-kicker">STEP 2 / 2 · THUMBNAIL CACHE</p>
          <h1 id="thumbnail-setup-title">为相册建立缩略图缓存</h1>
          <p className="library-gate__lede">
            相册网格只读取缩略图，原图永远不会被改动。先建一个专用的缩略图文件夹，再选择清晰度与流畅度的平衡。
          </p>
        </header>

        <section className="thumbnail-setup__section" aria-labelledby="thumb-folder-title">
          <div className="thumbnail-setup__section-head">
            <div>
              <p className="section-kicker">CACHE FOLDER</p>
              <h2 id="thumb-folder-title">缩略图文件夹</h2>
            </div>
            <span className="thumbnail-setup__badge">
              <FolderTree size={13} aria-hidden="true" />
              位于存储库内部
            </span>
          </div>
          <label className="thumbnail-setup__folder">
            <HardDrive size={15} aria-hidden="true" />
            <input
              type="text"
              value={dirName}
              maxLength={60}
              onChange={(event) => {
                setDirName(event.target.value);
                setSetupError(null);
              }}
              aria-label="缩略图文件夹名称"
              placeholder="缩略图缓存"
            />
          </label>
          <p className="thumbnail-setup__path" title={cachePath}>
            {cachePath}
          </p>
          <p className={`field-hint${invalidName ? ' is-danger' : ''}`}>
            {invalidName
              ? '文件夹名称不能为空，也不能包含 \\ / : * ? " < > | 等字符。'
              : '程序会在这里新建文件夹并写入 WebP 缩略图。可以随时整体删除，下次扫描会按照原图重新生成。'}
          </p>
        </section>

        <section className="thumbnail-setup__section" aria-labelledby="thumb-preset-title">
          <div className="thumbnail-setup__section-head">
            <div>
              <p className="section-kicker">5 PRESETS</p>
              <h2 id="thumb-preset-title">选择缩略图规格</h2>
            </div>
            <span className="thumbnail-setup__badge">选择后可对比</span>
          </div>

          <div className="thumb-preset-grid" role="radiogroup" aria-labelledby="thumb-preset-title">
            {THUMBNAIL_PRESETS_META.map((preset) => {
              const measured = sample?.presets.find((item) => item.id === preset.id)?.bytes;
              const active = preset.id === presetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`thumb-preset${active ? ' is-active' : ''}`}
                  onClick={() => setPresetId(preset.id)}
                >
                  <span className="thumb-preset__top">
                    <span className="thumb-preset__name">{preset.label}</span>
                    <span className="thumb-preset__radio" aria-hidden="true">
                      {active ? <Check size={11} strokeWidth={3} /> : null}
                    </span>
                  </span>
                  <span className="thumb-preset__spec">
                    {preset.maxEdge}px · Q{preset.quality}
                  </span>
                  <span className="thumb-preset__size">
                    {measured ? formatThumbBytes(measured) : preset.sizeHint}
                  </span>
                  <span className={`thumb-preset__meter is-cost-${preset.scrollCost}`} aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((level) => (
                      <span key={level} className={level <= preset.scrollCost ? 'is-on' : ''} />
                    ))}
                  </span>
                  <span className="thumb-preset__tagline">{preset.tagline}</span>
                  <span className="thumb-preset__scroll">{preset.scrollLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="thumbnail-setup__readout">
            <div className="thumbnail-setup__readout-main">
              <strong>
                {activeMeta.label} · 最长边 {activeMeta.maxEdge}px · 质量 {activeMeta.quality}
              </strong>
              <p>{activeMeta.detail}</p>
              <p className="thumbnail-setup__numbers">
                单张实测 {formatThumbBytes(measuredBytes)}
                {estimatedTotal
                  ? ` · 按当前库 ${sample?.imageCount ?? 0} 张估算，缓存约 ${formatThumbBytes(
                      estimatedTotal,
                    )}`
                  : ''}
              </p>
            </div>
            <div className="thumbnail-setup__readout-actions">
              <span className={`thumb-preset__scroll chip is-cost-${activeMeta.scrollCost}`}>
                流畅度 · {activeMeta.scrollLabel}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  document
                    .getElementById('thumb-compare-title')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                查看 A/B 对比 ↓
              </button>
            </div>
          </div>

          <p className="thumbnail-setup__advice">
            分辨率越高、单张解码占用的内存与时间越大，快速滚动时越容易掉帧。960–1280px
            适合上千张的大库和老机器；1600px 是默认平衡点；1920–2560px
            更适合照片不多、屏幕素质高的设备。
          </p>
        </section>

        <section className="thumbnail-setup__section" aria-labelledby="thumb-compare-title">
          <div className="thumbnail-setup__section-head">
            <div>
              <p className="section-kicker">BEFORE / AFTER</p>
              <h2 id="thumb-compare-title">看看压缩前后</h2>
            </div>
            {sample ? (
              <span className="thumbnail-setup__badge">
                随机样张 · {sample.width ?? '—'}×{sample.height ?? '—'} ·{' '}
                {formatThumbBytes(sample.originalBytes)}
              </span>
            ) : null}
          </div>

          {sampleLoading ? (
            <div className="thumbnail-sample-state" role="status">
              <Loader2 size={18} className="spinner" aria-hidden="true" />
              <span>正在从存储库随机抽取一张照片，并按 5 档规格生成对比样张…</span>
            </div>
          ) : sample ? (
            <ComparePane sample={sample} presetId={presetId} />
          ) : (
            <div className="thumbnail-sample-state is-warning">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                {sampleError || '暂时无法生成对比样张。'}
                <br />
                你仍然可以选择规格并建立缓存，缩略图会在后台生成。
              </span>
            </div>
          )}
        </section>

        <section className="thumbnail-setup__promise" aria-label="原图保护承诺">
          <div>
            <ShieldCheck size={16} aria-hidden="true" />
            <span>
              原图永远只读：<strong>不移动、不重命名、不压缩、不删除、不上传</strong>。
            </span>
          </div>
          <div>
            <FolderTree size={16} aria-hidden="true" />
            <span>
              缩略图只会写进 <code>{dirName || '缩略图缓存'}</code>，不会出现在原图所在文件夹。
            </span>
          </div>
          <div>
            <Sparkles size={16} aria-hidden="true" />
            <span>相册网格只读取缩略图；只有你点开某一张照片时，才会加载那一张的原图。</span>
          </div>
        </section>

        {setupError ? (
          <p className="thumbnail-setup__error" role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            {setupError}
          </p>
        ) : null}

        <div className="thumbnail-setup__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={busy || invalidName}
          >
            {busy ? (
              <Loader2 size={16} className="spinner" aria-hidden="true" />
            ) : (
              <ShieldCheck size={16} aria-hidden="true" />
            )}
            {busy ? '正在建立…' : '建立缩略图缓存并开始'}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void chooseLibrary()}
            disabled={busy}
          >
            <FolderOpen size={15} aria-hidden="true" />
            换一个存储库
          </button>
        </div>

        <p className="library-gate__note">
          当前选择的规格与文件夹会写入存储库的 hoshikuzu-library.json，换电脑后仍然有效。
        </p>
      </div>
    </div>
  );
}
