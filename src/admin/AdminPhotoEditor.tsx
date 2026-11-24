import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  FolderOpen,
  ImageOff,
  Loader2,
  Save,
  ScanText,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type { Photo, PhotoMetaSource } from '../types';
import { effectiveWorldApiBase } from '../data/settings';
import { getDesktopBridge } from '../platform';
import { useToast } from '../hooks/useToast';
import { toDateTimeLocalValue } from '../utils/date';
import { Modal } from '../components/Modal';
import { SafeImage } from '../components/SafeImage';
import { WorldPanel } from '../components/WorldPanel';

interface AdminPhotoEditorProps {
  photoId: string | null;
  album: AlbumApi;
  onClose: () => void;
  onNavigateWorlds: () => void;
}

function worldSignature(photo: Photo): string {
  return JSON.stringify([
    photo.worldRef ?? '',
    photo.worldId ?? '',
    photo.world?.name ?? '',
    photo.world?.author ?? '',
    photo.world?.description ?? '',
    photo.world?.thumbnail ?? '',
    photo.world?.capacity ?? '',
    photo.world?.source ?? '',
  ]);
}

const META_SOURCE_LABELS: Record<PhotoMetaSource, string> = {
  xmp: '照片内嵌 XMP',
  json: 'VRCX JSON',
  exif: 'EXIF',
  filename: '文件名',
  mtime: '文件修改时间',
  none: '未识别',
  manual: '手动设置',
};

function metaSourceLabel(source?: PhotoMetaSource): string {
  return source ? META_SOURCE_LABELS[source] : '未记录';
}

export function AdminPhotoEditor({
  photoId,
  album,
  onClose,
  onNavigateWorlds,
}: AdminPhotoEditorProps) {
  const { pushToast } = useToast();
  const photo = photoId ? album.photos.find((item) => item.id === photoId) : undefined;
  const [draft, setDraft] = useState<Photo | null>(photo ?? null);
  const [dateValue, setDateValue] = useState('');
  const [note, setNote] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const [guard, setGuard] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [worldRunning, setWorldRunning] = useState(false);

  useEffect(() => {
    if (!photo) return;
    setDraft(photo);
    setDateValue(toDateTimeLocalValue(photo.capturedAt));
    setNote(photo.note);
    setAlt(photo.alt);
    setError('');
    setGuard(false);
    setConfirmingDelete(false);
  }, [photo?.id]);

  const dirty = useMemo(() => {
    if (!photo || !draft) return false;
    return (
      note !== photo.note ||
      alt !== photo.alt ||
      dateValue !== toDateTimeLocalValue(photo.capturedAt) ||
      worldSignature(draft) !== worldSignature(photo)
    );
  }, [photo, draft, note, alt, dateValue]);

  const requestClose = () => {
    if (dirty) {
      setGuard(true);
      return;
    }
    onClose();
  };

  if (!photo || !draft) return null;

  const save = () => {
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      setError('拍摄时间格式不正确。');
      return;
    }
    const patch: Partial<Photo> = {
      capturedAt: parsed.toISOString(),
      note: note.trim(),
      alt: alt.trim() || `VRChat 记忆照片：${photo.capturedAt.slice(0, 10)}`,
    };
    if (worldSignature(draft) !== worldSignature(photo)) {
      patch.world = draft.world ?? null;
      patch.worldId = draft.worldId;
      patch.worldLookup = draft.worldLookup;
      patch.worldRef = draft.worldRef;
    }
    album.updatePhoto(photo.id, patch);
    pushToast({ tone: 'success', title: '照片已更新', description: '管理台的修改已写入本地相册。' });
    onClose();
  };

  const remove = () => {
    album.deletePhoto(photo.id);
    pushToast({ title: '照片已删除', description: '这张照片已从相册中移除。' });
    onClose();
  };

  const removeManagedCopy = async () => {
    const api = getDesktopBridge();
    if (!api || !photo.contentHash) return;
    const result = await api.media.deleteManaged(photo.contentHash);
    if (result.ok) {
      album.updatePhoto(photo.id, { managedCopy: false, missing: true });
      pushToast({
        tone: 'success',
        title: '本地副本已删除',
        description: '相册记录仍然保留；如需移除记录，请使用删除照片。',
      });
    } else {
      pushToast({
        tone: 'danger',
        title: '无法删除本地副本',
        description: result.error,
      });
    }
  };

  const generateAiSummary = async () => {
    const api = getDesktopBridge();
    if (!api || aiRunning) return;
    setAiRunning(true);
    album.updatePhoto(photo.id, { aiState: 'running', aiError: undefined });
    try {
      const result = await api.ai.generate({
        item: {
          id: photo.id,
          previewPath: photo.previewPath,
          libraryPath: photo.libraryPath,
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
        context: {
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
      });
      if (result.ok) {
        album.updatePhoto(photo.id, {
          aiSummary: result.summary,
          aiTags: result.tags,
          aiModel: result.model,
          aiUpdatedAt: result.generatedAt,
          aiState: 'done',
          aiError: undefined,
        });
        pushToast({
          tone: 'success',
          title: 'AI 回忆总结已生成',
          description: result.model ? `模型：${result.model}` : undefined,
        });
      } else {
        album.updatePhoto(photo.id, {
          aiState: 'error',
          aiError: result.error,
        });
        pushToast({
          tone: 'danger',
          title: 'AI 生成失败',
          description: result.error,
        });
      }
    } catch (error) {
      album.updatePhoto(photo.id, {
        aiState: 'error',
        aiError: (error as Error).message,
      });
      pushToast({
        tone: 'danger',
        title: 'AI 生成失败',
        description: (error as Error).message,
      });
    } finally {
      setAiRunning(false);
    }
  };

  const recognizeWorldId = async () => {
    const api = getDesktopBridge();
    if (!api || worldRunning) return;
    setWorldRunning(true);
    try {
      const result = await api.ai.recognizeWorldId({
        item: {
          id: photo.id,
          previewPath: photo.previewPath,
          libraryPath: photo.libraryPath,
          capturedAt: photo.capturedAt,
          worldName: photo.world?.name,
          note: photo.note,
        },
      });
      if (result.ok && result.worldId) {
        album.updatePhoto(photo.id, {
          worldId: result.worldId,
          world: {
            id: result.worldId,
            name: result.worldName || `待补充世界 · ${result.worldId.slice(0, 16)}`,
            source: 'local',
          },
          worldLookup: 'resolved',
          worldIdSource: 'ai',
        });
        pushToast({
          tone: 'success',
          title: 'AI 已识别画面上的 World ID',
          description: `${result.worldName || result.worldId}${result.model ? ` · ${result.model}` : ''}`,
        });
      } else {
        pushToast({
          tone: 'warning',
          title: '没有识别到 World ID',
          description: result.error || '请确认图片上的文字清晰可见。',
        });
      }
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: 'World ID 识别失败',
        description: (error as Error).message,
      });
    } finally {
      setWorldRunning(false);
    }
  };

  return (
    <Modal
      open
      onClose={requestClose}
      labelledBy="admin-photo-title"
      className="admin-modal admin-photo-editor"
    >
      <div className="admin-editor">
        <div className="admin-editor__media">
          <SafeImage
            src={photo.missing ? null : photo.src}
            alt={photo.alt}
            fallback={
              <span className="admin-editor__missing" aria-hidden="true">
                <ImageOff size={28} />
              </span>
            }
          />
          <span className="admin-editor__media-shade" aria-hidden="true" />
          <div className="admin-editor__media-meta">
            <span>
              {photo.isSample
                ? '起始内容'
                : photo.isUploaded
                  ? photo.isRemote
                    ? '链接照片'
                    : '本地收录'
                  : '相册照片'}
            </span>
            <span>
              {photo.isRemote
                ? '网络链接'
                : photo.mediaKind === 'library'
                  ? `存储库原图 · ${metaSourceLabel(photo.metaSource)}`
                  : photo.src.startsWith('data:')
                    ? '内嵌图片'
                    : '静态资源'}
            </span>
          </div>
        </div>

        <div className="admin-editor__body">
          <button
            type="button"
            className="admin-editor__close icon-button icon-button--small"
            onClick={requestClose}
            aria-label="关闭照片编辑"
          >
            <X size={16} />
          </button>

          <header className="admin-editor__header">
            <p className="section-kicker">PHOTO RECORD</p>
            <h2 id="admin-photo-title">编辑照片</h2>
            <p>拍摄时间、备注与世界关联会同步到公开时间轴。</p>
          </header>

          {photo.mediaKind === 'library' ? (
            <div className="admin-editor__recognition">
              <div>
                <span>存储库路径</span>
                <code title={photo.libraryPath ?? ''}>{photo.libraryPath ?? '—'}</code>
              </div>
              <div>
                <span>识别来源</span>
                <strong>{metaSourceLabel(photo.metaSource)}</strong>
              </div>
              <div>
                <span>内容指纹</span>
                <code>{photo.contentHash ? photo.contentHash.slice(0, 12) : '—'}</code>
              </div>
              {photo.missing ? (
                <p className="field-error">原图文件已缺失，相册记录仍然保留。</p>
              ) : null}
              <div className="admin-editor__recognition-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={!photo.libraryPath}
                  onClick={() => {
                    if (photo.libraryPath) {
                      void getDesktopBridge()?.library.revealFile(photo.libraryPath);
                    }
                  }}
                >
                  <FolderOpen size={13} aria-hidden="true" />
                  在文件夹中显示
                </button>
                {photo.managedCopy && photo.contentHash ? (
                  <button
                    type="button"
                    className="text-button text-button--danger"
                    onClick={() => void removeManagedCopy()}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    删除本地副本
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {getDesktopBridge() && photo.mediaKind === 'library' ? (
            <div className="admin-editor__ai">
              <div className="admin-editor__ai-head">
                <span>
                  <Sparkles size={13} aria-hidden="true" />
                  AI 回忆总结
                </span>
                {photo.aiState === 'running' || aiRunning ? (
                  <span>
                    <Loader2 size={12} className="spinner" aria-hidden="true" />
                    生成中
                  </span>
                ) : photo.aiModel ? (
                  <span>{photo.aiModel}</span>
                ) : null}
              </div>
              {photo.aiSummary ? (
                <p className="admin-editor__ai-summary">{photo.aiSummary}</p>
              ) : (
                <p className="field-hint">还没有 AI 总结。</p>
              )}
              {photo.aiTags?.length ? (
                <div className="admin-editor__ai-tags">
                  {photo.aiTags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
              {photo.aiError ? (
                <p className="field-error" role="alert">
                  {photo.aiError}
                </p>
              ) : null}
              <div className="admin-editor__recognition-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void generateAiSummary()}
                  disabled={aiRunning || photo.aiState === 'running'}
                >
                  {aiRunning ? (
                    <Loader2 size={13} className="spinner" aria-hidden="true" />
                  ) : (
                    <Sparkles size={13} aria-hidden="true" />
                  )}
                  {photo.aiSummary ? '重新生成' : '用 AI 生成总结'}
                </button>
                {!photo.worldId || !photo.world || photo.worldLookup === 'failed' ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void recognizeWorldId()}
                    disabled={worldRunning}
                  >
                    {worldRunning ? (
                      <Loader2 size={13} className="spinner" aria-hidden="true" />
                    ) : (
                      <ScanText size={13} aria-hidden="true" />
                    )}
                    AI 识别画面 World ID
                  </button>
                ) : null}
                {photo.aiSummary ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      album.updatePhoto(photo.id, {
                        aiSummary: undefined,
                        aiTags: undefined,
                        aiModel: undefined,
                        aiUpdatedAt: undefined,
                        aiState: 'none',
                        aiError: undefined,
                      })
                    }
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="admin-editor__fields">
            <div className="field">
              <label className="field-label" htmlFor="admin-photo-date">
                <CalendarDays size={13} aria-hidden="true" />
                拍摄时间
              </label>
              <div className="input-shell input-shell--datetime">
                <input
                  id="admin-photo-date"
                  type="datetime-local"
                  value={dateValue}
                  onChange={(event) => setDateValue(event.target.value)}
                  data-autofocus
                />
              </div>
            </div>

            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="admin-photo-note">
                  备注
                </label>
                <span className="char-count">{note.length}/240</span>
              </div>
              <textarea
                id="admin-photo-note"
                className="note-textarea"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={4}
                maxLength={240}
                placeholder="写下这段记忆的备注…"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="admin-photo-alt">
                图片替代文本
              </label>
              <div className="input-shell">
                <input
                  id="admin-photo-alt"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  maxLength={180}
                  placeholder="描述照片内容，供屏幕阅读器使用"
                />
              </div>
            </div>
          </div>

          <WorldPanel
            photo={draft}
            onUpdate={(patch) => setDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
            library={album.worlds}
            apiBase={effectiveWorldApiBase(album.settings)}
            onOpenAdmin={onNavigateWorlds}
            deferCommit
          />

          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          {confirmingDelete ? (
            <div className="inline-confirm" role="alert">
              <p>删除后，这张照片会从公开时间轴与本地存储中移除，无法撤销。</p>
              <div className="inline-confirm__actions">
                <button type="button" className="button button--danger button--tiny" onClick={remove}>
                  确认删除
                </button>
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={() => setConfirmingDelete(false)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <footer className="admin-editor__footer">
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={14} />
              删除照片
            </button>
            <div className="admin-editor__actions">
              <button type="button" className="button button--ghost button--small" onClick={requestClose}>
                取消
              </button>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={save}
                disabled={!dirty}
              >
                <Save size={15} />
                保存修改
              </button>
            </div>
          </footer>
        </div>
      </div>

      {guard ? (
        <div className="admin-editor-guard" role="alert">
          <p>还有未保存的修改，确定要关闭吗？</p>
          <div>
            <button type="button" className="text-button" onClick={() => setGuard(false)}>
              继续编辑
            </button>
            <button type="button" className="button button--danger button--tiny" onClick={onClose}>
              放弃并关闭
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
