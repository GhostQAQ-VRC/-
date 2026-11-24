import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  ImagePlus,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react';
import type { PhotoDraft } from '../types';
import { isoFromDateTimeLocal, toDateTimeLocalValue } from '../utils/date';
import {
  formatFileSize,
  loadRemoteImage,
  normalizeImageUrl,
  prepareImage,
  validateImageFile,
  type RemoteImageInfo,
} from '../services/imageUpload';
import { extractWorldId } from '../services/worldService';
import { getDesktopBridge } from '../platform';
import { desktopDraftsToPhotoDrafts } from '../platform/importPhotos';
import { useToast } from '../hooks/useToast';
import { Modal } from './Modal';

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (draft: PhotoDraft) => void;
}

type SourceMode = 'file' | 'url';

function remoteImageParts(src: string): { name: string; host: string } {
  try {
    const url = new URL(src);
    const rawName = url.pathname.split('/').filter(Boolean).pop() ?? '';
    let name = rawName;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      // Keep the encoded segment if it is malformed.
    }
    return { name: name || url.hostname, host: url.hostname };
  } catch {
    return { name: '网络图片', host: '' };
  }
}

function freshDateValue(): string {
  return toDateTimeLocalValue(new Date().toISOString());
}

export function UploadDialog({ open, onClose, onAdd }: UploadDialogProps) {
  const { pushToast } = useToast();
  const desktop = getDesktopBridge();
  const [sourceMode, setSourceMode] = useState<SourceMode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [remotePreview, setRemotePreview] = useState<RemoteImageInfo | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [urlError, setUrlError] = useState('');
  const [dateValue, setDateValue] = useState(freshDateValue);
  const [dateTouched, setDateTouched] = useState(false);
  const [note, setNote] = useState('');
  const [worldInput, setWorldInput] = useState('');
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [desktopImporting, setDesktopImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const remoteRequestRef = useRef(0);
  const parsedWorldId = extractWorldId(worldInput);
  const normalizedUrl = normalizeImageUrl(imageUrl);
  const remoteParts = remotePreview ? remoteImageParts(remotePreview.src) : null;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!open) {
      remoteRequestRef.current += 1;
      setSourceMode('file');
      setFile(null);
      setPreviewUrl(null);
      setImageUrl('');
      setRemotePreview(null);
      setRemoteLoading(false);
      setUrlError('');
      setDateValue(freshDateValue());
      setDateTouched(false);
      setNote('');
      setWorldInput('');
      setError('');
      setPreparing(false);
      setDragging(false);
    }
  }, [open]);

  const reset = () => {
    remoteRequestRef.current += 1;
    setSourceMode('file');
    setFile(null);
    setPreviewUrl(null);
    setImageUrl('');
    setRemotePreview(null);
    setRemoteLoading(false);
    setUrlError('');
    setDateValue(freshDateValue());
    setDateTouched(false);
    setNote('');
    setWorldInput('');
    setError('');
    setPreparing(false);
    setDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const close = () => {
    if (preparing || desktopImporting) return;
    reset();
    onClose();
  };

  const acceptFile = (nextFile: File) => {
    const validation = validateImageFile(nextFile);
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    if (!dateTouched) {
      const stamp = nextFile.lastModified
        ? new Date(nextFile.lastModified).toISOString()
        : new Date().toISOString();
      setDateValue(toDateTimeLocalValue(stamp));
    }
  };

  /** Desktop path: copy originals into the library, recognize metadata, add. */
  const importDesktop = async (paths?: string[]) => {
    if (!desktop || desktopImporting) return;
    setDesktopImporting(true);
    setError('');
    try {
      const result =
        paths && paths.length
          ? await desktop.media.importFiles(paths)
          : await desktop.media.pickAndImport();
      if (result.canceled) return;
      if (result.drafts.length === 0) {
        setError(result.error ?? result.errors[0]?.message ?? '没有可导入的照片。');
        return;
      }
      for (const draft of desktopDraftsToPhotoDrafts(result.drafts)) onAdd(draft);
      pushToast({
        tone: 'success',
        title: `已导入 ${result.drafts.length} 张照片`,
        description: result.errors.length
          ? `${result.errors.length} 张未能导入：${result.errors[0].message}`
          : '日期与地图 ID 已自动识别，原图已复制到存储库。',
      });
      reset();
      onClose();
    } catch (caught) {
      setError((caught as Error).message || '导入失败。');
    } finally {
      setDesktopImporting(false);
    }
  };

  const openPicker = () => fileInputRef.current?.click();

  const switchSource = (next: SourceMode) => {
    if (preparing) return;
    setSourceMode(next);
    setError('');
    setUrlError('');
    if (!dateTouched) {
      if (next === 'url') {
        setDateValue(freshDateValue());
      } else if (file) {
        const stamp = file.lastModified
          ? new Date(file.lastModified).toISOString()
          : new Date().toISOString();
        setDateValue(toDateTimeLocalValue(stamp));
      }
    }
  };

  const handleUrlChange = (value: string) => {
    remoteRequestRef.current += 1;
    setImageUrl(value);
    setRemotePreview(null);
    setRemoteLoading(false);
    setUrlError('');
    if (error) setError('');
  };

  const loadRemotePreview = async (): Promise<RemoteImageInfo | null> => {
    if (preparing) return null;
    const normalized = normalizeImageUrl(imageUrl);
    if (!normalized) {
      setUrlError('请粘贴以 http:// 或 https:// 开头的图片直链。');
      setRemotePreview(null);
      return null;
    }
    const requestId = ++remoteRequestRef.current;
    setImageUrl(normalized);
    setUrlError('');
    setRemoteLoading(true);
    try {
      const info = await loadRemoteImage(normalized);
      if (requestId !== remoteRequestRef.current) return null;
      setRemotePreview(info);
      return info;
    } catch (caught) {
      if (requestId === remoteRequestRef.current) {
        setUrlError((caught as Error).message || '无法读取这个图片链接。');
        setRemotePreview(null);
      }
      return null;
    } finally {
      if (requestId === remoteRequestRef.current) setRemoteLoading(false);
    }
  };

  const clearRemote = () => {
    remoteRequestRef.current += 1;
    setImageUrl('');
    setRemotePreview(null);
    setRemoteLoading(false);
    setUrlError('');
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (preparing || remoteLoading) return;
    if (sourceMode === 'file' && !file) {
      setError('请先选择一张照片。');
      return;
    }
    if (sourceMode === 'url' && !normalizedUrl) {
      setUrlError('请粘贴以 http:// 或 https:// 开头的图片直链。');
      return;
    }
    if (worldInput.trim() && !parsedWorldId) {
      setError(
        '世界链接中没有找到有效的 World ID。可以清空这一栏，或粘贴完整的世界链接。',
      );
      return;
    }
    setPreparing(true);
    setError('');
    setUrlError('');
    try {
      const trimmedNote = note.trim();
      let draft: PhotoDraft;
      if (sourceMode === 'file' && file) {
        const prepared = await prepareImage(file);
        draft = {
          src: prepared.src,
          width: prepared.width,
          height: prepared.height,
          capturedAt: isoFromDateTimeLocal(dateValue),
          note: trimmedNote,
          worldId: parsedWorldId ?? undefined,
          alt: trimmedNote
            ? `VRChat 记忆：${trimmedNote}`
            : `VRChat 记忆照片：${file.name.replace(/\.[^.]+$/, '')}`,
          isUploaded: true,
        };
      } else {
        const normalized = normalizedUrl!;
        let info =
          remotePreview && remotePreview.src === normalized ? remotePreview : null;
        if (!info) {
          try {
            info = await loadRemoteImage(normalized);
          } catch (caught) {
            setUrlError((caught as Error).message || '无法读取这个图片链接。');
            return;
          }
        }
        const parts = remoteImageParts(normalized);
        setRemotePreview(info);
        draft = {
          src: normalized,
          width: info.width,
          height: info.height,
          capturedAt: isoFromDateTimeLocal(dateValue),
          note: trimmedNote,
          worldId: parsedWorldId ?? undefined,
          alt: trimmedNote
            ? `VRChat 记忆：${trimmedNote}`
            : `VRChat 链接照片：${parts.name}`,
          isUploaded: true,
          isRemote: true,
        };
      }
      onAdd(draft);
      pushToast({
        tone: 'success',
        title: '已收进时光轴',
        description:
          sourceMode === 'url'
            ? parsedWorldId
              ? '图片链接与 World ID 已保存；可在照片详情里识别世界资料。'
              : '图片链接已保存，图片会从原站加载。'
            : parsedWorldId
              ? 'World ID 已记录，可在照片详情里识别世界资料。'
              : '新的星光已经落在时间轴上。',
      });
      reset();
      onClose();
    } catch (caught) {
      const message = (caught as Error).message || '照片处理失败，请换一张再试。';
      if (sourceMode === 'url') setUrlError(message);
      else setError(message);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <Modal open={open} onClose={close} labelledBy="upload-title" className="upload-modal">
      <button
        type="button"
        className="modal-close icon-button"
        onClick={close}
        aria-label="关闭上传对话框"
        disabled={preparing}
      >
        <X size={18} />
      </button>

      <header className="upload-header">
        <p className="eyebrow">
          <Sparkles size={13} aria-hidden="true" />
          NEW MEMORY
          <span className="eyebrow__divider" aria-hidden="true" />
          思い出を一枚
        </p>
        <h2 className="upload-title" id="upload-title">
          收录一段新记忆
        </h2>
        <p className="upload-subtitle">
          {sourceMode === 'file'
            ? '照片会压缩后保存在浏览器里，不会上传到任何服务器。'
            : '只保存图片链接，图片仍由原站提供；请确认链接可以公开访问。'}
        </p>
      </header>

      <form onSubmit={handleSave} className="upload-form" aria-busy={preparing || remoteLoading}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) acceptFile(selected);
          }}
        />

        <div className="upload-source-switch" role="group" aria-label="照片来源">
          <button
            type="button"
            className={`upload-source-switch__button${sourceMode === 'file' ? ' is-active' : ''}`}
            onClick={() => switchSource('file')}
            aria-pressed={sourceMode === 'file'}
            disabled={preparing}
          >
            <UploadCloud size={14} strokeWidth={1.7} aria-hidden="true" />
            本地图片
          </button>
          <button
            type="button"
            className={`upload-source-switch__button${sourceMode === 'url' ? ' is-active' : ''}`}
            onClick={() => switchSource('url')}
            aria-pressed={sourceMode === 'url'}
            disabled={preparing}
          >
            <Link2 size={14} strokeWidth={1.7} aria-hidden="true" />
            图片链接
          </button>
        </div>

        {sourceMode === 'file' ? (
          desktop ? (
            <div className="upload-desktop">
              <button
                type="button"
                className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
                onClick={() => void importDesktop()}
                disabled={desktopImporting}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const paths = Array.from(event.dataTransfer.files || [])
                    .map((item) => desktop.media.getPathForFile(item))
                    .filter(Boolean);
                  if (paths.length) void importDesktop(paths);
                }}
                aria-describedby="upload-dropzone-hint"
              >
                <span className="upload-dropzone__rings" aria-hidden="true" />
                <span className="upload-dropzone__icon" aria-hidden="true">
                  {desktopImporting ? (
                    <Loader2 size={26} strokeWidth={1.4} className="spinner" />
                  ) : (
                    <UploadCloud size={26} strokeWidth={1.4} />
                  )}
                </span>
                <span className="upload-dropzone__title">
                  {desktopImporting ? '正在处理照片…' : '选择照片，或把文件拖进来'}
                </span>
                <span className="upload-dropzone__hint" id="upload-dropzone-hint">
                  支持 JPG、PNG、WebP、AVIF、HEIC · 单张体积不设上限
                </span>
                <span className="upload-dropzone__privacy">
                  <ShieldCheck size={13} aria-hidden="true" />
                  原图复制进存储库 · 自动识别日期与 World ID
                </span>
              </button>
              <p className="upload-desktop__note">
                桌面客户端会保留原图，并生成最长边 {1600}px 的显示预览；
                识别结果可以在管理台继续修正。
              </p>
            </div>
          ) : file && previewUrl ? (
            <div className="upload-preview">
              <img src={previewUrl} alt="待上传照片预览" />
              <span className="upload-preview__shade" aria-hidden="true" />
              <div className="upload-preview__meta">
                <span className="upload-preview__name">{file.name}</span>
                <span className="upload-preview__size">{formatFileSize(file.size)}</span>
              </div>
              <div className="upload-preview__actions">
                <button type="button" className="button button--glass button--tiny" onClick={openPicker}>
                  <RefreshCw size={13} />
                  更换
                </button>
                <button
                  type="button"
                  className="button button--danger button--tiny"
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl(null);
                    setError('');
                  }}
                >
                  移除
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`upload-dropzone${dragging ? ' is-dragging' : ''}`}
              onClick={openPicker}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) acceptFile(dropped);
              }}
              aria-describedby="upload-dropzone-hint"
            >
              <span className="upload-dropzone__rings" aria-hidden="true" />
              <span className="upload-dropzone__icon" aria-hidden="true">
                <UploadCloud size={26} strokeWidth={1.4} />
              </span>
              <span className="upload-dropzone__title">把照片拖到这里，或点击选择</span>
              <span className="upload-dropzone__hint" id="upload-dropzone-hint">
                支持 JPG、PNG、WebP、AVIF · 单张不超过 20MB
              </span>
              <span className="upload-dropzone__privacy">
                <ShieldCheck size={13} aria-hidden="true" />
                仅在本地处理
              </span>
            </button>
          )
        ) : (
          <div className="upload-url">
            <label className="field-label" htmlFor="upload-image-url">
              图片链接
            </label>
            <div className={`input-shell upload-url__field${normalizedUrl ? ' has-value' : ''}`}>
              <Link2 size={16} strokeWidth={1.7} aria-hidden="true" />
              <input
                id="upload-image-url"
                type="text"
                inputMode="url"
                value={imageUrl}
                onChange={(event) => handleUrlChange(event.target.value)}
                placeholder="https://example.com/photo.jpg"
                autoComplete="off"
                spellCheck={false}
                disabled={preparing}
                aria-describedby="upload-url-hint"
                aria-invalid={Boolean(urlError)}
              />
              {remotePreview ? (
                <CheckCircle2
                  className="upload-url__check"
                  size={15}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="upload-url__actions">
              <button
                type="button"
                className="button button--soft button--tiny"
                onClick={() => void loadRemotePreview()}
                disabled={!imageUrl.trim() || remoteLoading || preparing}
              >
                {remoteLoading ? (
                  <Loader2 size={13} className="spinner" aria-hidden="true" />
                ) : (
                  <ImagePlus size={13} aria-hidden="true" />
                )}
                {remoteLoading ? '正在读取…' : '预览图片'}
              </button>
              <span className="field-hint" id="upload-url-hint">
                支持 http(s) 图片直链；只保存链接，不把图片文件写入相册存储。
              </span>
            </div>
            {urlError ? (
              <p className="upload-url__error" role="alert">
                {urlError}
              </p>
            ) : null}
            {remotePreview ? (
              <div className="upload-preview upload-preview--remote">
                <img src={remotePreview.src} alt="链接图片预览" />
                <span className="upload-preview__shade" aria-hidden="true" />
                <div className="upload-preview__meta">
                  <span className="upload-preview__name">
                    {remoteParts?.name ?? '网络图片'}
                  </span>
                  <span className="upload-preview__size">
                    {remoteParts?.host ? `${remoteParts.host} · ` : ''}
                    {remotePreview.width}×{remotePreview.height}
                  </span>
                </div>
                <div className="upload-preview__actions">
                  <button
                    type="button"
                    className="button button--glass button--tiny"
                    onClick={() => void loadRemotePreview()}
                    disabled={remoteLoading || preparing}
                  >
                    <RefreshCw size={13} />
                    重新读取
                  </button>
                  <button
                    type="button"
                    className="button button--danger button--tiny"
                    onClick={clearRemote}
                    disabled={preparing}
                  >
                    移除
                  </button>
                </div>
              </div>
            ) : (
              <div className={`upload-url__placeholder${remoteLoading ? ' is-loading' : ''}`}>
                {remoteLoading ? (
                  <Loader2 size={20} className="spinner" aria-hidden="true" />
                ) : (
                  <Link2 size={20} strokeWidth={1.5} aria-hidden="true" />
                )}
                <span>
                  {remoteLoading ? '正在读取链接图片…' : '粘贴图片直链后，点击「预览图片」'}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="upload-fields">
          <div className="field">
            <label className="field-label" htmlFor="upload-date">
              拍摄时间
            </label>
            <div className="input-shell input-shell--datetime">
              <input
                id="upload-date"
                type="datetime-local"
                value={dateValue}
                onChange={(event) => {
                  setDateValue(event.target.value);
                  setDateTouched(true);
                }}
              />
            </div>
            <p className="field-hint">
              {sourceMode === 'file'
                ? '默认使用图片文件的修改时间，可以手动调整。'
                : '链接照片没有本地修改时间，默认使用当前时间。'}
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="upload-world">
              关联世界 <span className="field-optional">选填</span>
            </label>
            <div className={`input-shell${parsedWorldId ? ' has-value' : ''}`}>
              <Link2 size={16} strokeWidth={1.7} aria-hidden="true" />
              <input
                id="upload-world"
                value={worldInput}
                onChange={(event) => {
                  setWorldInput(event.target.value);
                  if (error) setError('');
                }}
                placeholder="粘贴世界链接或 wrld_… ID"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {parsedWorldId ? (
              <p className="parsed-chip">
                <CheckCircle2 size={13} aria-hidden="true" />
                已识别 <code>{parsedWorldId}</code>
              </p>
            ) : (
              <p className="field-hint">若世界已在资料库中，保存时会自动关联；否则可在详情里识别。</p>
            )}
          </div>
        </div>

        <div className="field">
          <div className="field-label-row">
            <label className="field-label" htmlFor="upload-note">
              备注
            </label>
            <span className="char-count">{note.length}/240</span>
          </div>
          <textarea
            id="upload-note"
            className="note-textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={240}
            rows={3}
            placeholder="记下当时的光线、声音，或者一起看风景的人…"
          />
        </div>

        {error ? (
          <p className="upload-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="upload-footer">
          <p className="upload-privacy">
            {sourceMode === 'file' ? (
              <ShieldCheck size={14} aria-hidden="true" />
            ) : (
              <Link2 size={14} aria-hidden="true" />
            )}
            {sourceMode === 'file'
              ? desktop
                ? '原图保存在本地存储库'
                : '照片只在当前浏览器保存'
              : '只保存图片链接'}
          </p>
          <div className="upload-footer__actions">
            <button type="button" className="button button--ghost" onClick={close} disabled={preparing}>
              取消
            </button>
            {desktop && sourceMode === 'file' ? null : (
              <button
                type="submit"
                className="button button--primary"
                disabled={
                  preparing ||
                  remoteLoading ||
                  (sourceMode === 'file' ? !file : !imageUrl.trim())
                }
              >
                {preparing ? (
                  <>
                    <Loader2 size={16} className="spinner" aria-hidden="true" />
                    {sourceMode === 'url' ? '正在读取链接…' : '正在冲洗照片…'}
                  </>
                ) : (
                  <>
                    <ImagePlus size={16} aria-hidden="true" />
                    收进时间轴
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </form>
    </Modal>
  );
}
