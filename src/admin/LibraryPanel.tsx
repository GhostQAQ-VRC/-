import { useEffect, useMemo, useState } from 'react';
import {
  Copy,
  Database,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  Images,
  MapPin,
  Play,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Trash2,
  Cloud,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import { useDesktopLibrary, useDesktopLibraryActivity } from '../hooks/useDesktopLibrary';
import { useToast } from '../hooks/useToast';
import {
  getDesktopBridge,
  mediaUrl,
  type AutoImportConfigView,
  type DesktopSyncStatus,
  type DuplicateGroup,
  type DuplicateProgress,
  type HealthScanResult,
} from '../platform';
import { isMobileRuntime } from '../platform/mobileRuntime';
import {
  DEFAULT_THUMBNAIL_PRESET_ID,
  IMAGE_LOADING_MODE_META,
  THUMBNAIL_PRESETS_META,
  thumbnailPresetMeta,
} from '../data/thumbnailPresets';
import { AdminPanel, formatAdminDate, formatBytes } from './AdminUI';

interface LibraryPanelProps {
  album: AlbumApi;
}

export function LibraryPanel({ album }: LibraryPanelProps) {
  const { pushToast } = useToast();
  const mobileRuntime = isMobileRuntime();
  const {
    available,
    config,
    stats,
    scanning,
    scan,
    cancelScan,
    chooseLibrary,
    createLibrary,
    openFolder,
    setOptions,
    clearPreviewCache,
    resetIgnored,
  } = useDesktopLibrary();
  const { progress, previewProgress } = useDesktopLibraryActivity();
  const bridge = getDesktopBridge();
  const [sync, setSync] = useState<DesktopSyncStatus | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [auto, setAuto] = useState<AutoImportConfigView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoError, setAutoError] = useState('');
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[]>([]);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupProgress, setDupProgress] = useState<DuplicateProgress | null>(null);
  const [dupNotice, setDupNotice] = useState('');
  const [dupKeep, setDupKeep] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<HealthScanResult | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [healthNotice, setHealthNotice] = useState('');
  const [confirmTrash, setConfirmTrash] = useState(false);

  useEffect(() => {
    if (!bridge || !config?.configured) {
      setSync(null);
      return undefined;
    }
    void bridge.sync.status().then(setSync).catch(() => setSync(null));
    return bridge.sync.onStatus((next) => setSync(next));
  }, [bridge, config?.configured, config?.libraryId]);

  useEffect(() => {
    if (!bridge || !config?.configured) {
      setAuto(null);
      return undefined;
    }
    let alive = true;
    void bridge.autoImport
      .getConfig()
      .then((view) => {
        if (alive) setAuto(view);
      })
      .catch(() => {
        if (alive) setAuto(null);
      });
    const unsubscribe = bridge.autoImport.onStatus((status) => {
      setAuto((previous) =>
        previous
          ? {
              ...previous,
              enabled: status.enabled,
              folder: status.folder,
              status,
            }
          : previous,
      );
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [bridge, config?.configured, config?.libraryId]);

  const applyAuto = async (
    action: () => Promise<{ ok: boolean; error?: string; config: AutoImportConfigView }>,
  ) => {
    if (!bridge || autoBusy) return;
    setAutoBusy(true);
    setAutoError('');
    try {
      const result = await action();
      setAuto(result.config);
      if (!result.ok && result.error) setAutoError(result.error);
    } catch (error) {
      setAutoError(error instanceof Error ? error.message : '自动导入操作失败。');
    } finally {
      setAutoBusy(false);
    }
  };

  useEffect(() => {
    if (!bridge || !config?.configured || mobileRuntime) return undefined;
    return bridge.duplicates.onProgress((progress) => setDupProgress(progress));
  }, [bridge, config?.configured, mobileRuntime]);

  const scanHealth = async () => {
    if (!bridge || healthBusy) return;
    setHealthBusy(true);
    setHealthNotice('');
    try {
      const result = await bridge.health.scan();
      setHealth(result);
      if (!result.ok) setHealthNotice(result.error || '检查失败。');
    } catch (error) {
      setHealthNotice(error instanceof Error ? error.message : '检查失败。');
    } finally {
      setHealthBusy(false);
    }
  };

  const cleanHealthPreviews = async () => {
    if (!bridge || healthBusy) return;
    setHealthBusy(true);
    setHealthNotice('');
    try {
      const result = await bridge.health.cleanPreviews();
      const next = await bridge.health.scan();
      setHealth(next);
      setHealthNotice(
        result.ok
          ? `已清理 ${result.removed} 张孤儿缩略图，释放 ${formatBytes(result.bytes)}。`
          : result.error || '清理失败。',
      );
    } catch (error) {
      setHealthNotice(error instanceof Error ? error.message : '清理失败。');
    } finally {
      setHealthBusy(false);
    }
  };

  const emptyHealthTrash = async () => {
    if (!confirmTrash) {
      setConfirmTrash(true);
      return;
    }
    setConfirmTrash(false);
    if (!bridge || healthBusy) return;
    setHealthBusy(true);
    setHealthNotice('');
    try {
      const result = await bridge.health.emptyTrash();
      const next = await bridge.health.scan();
      setHealth(next);
      setHealthNotice(
        result.ok
          ? `已清空回收站：${result.removed} 个文件，释放 ${formatBytes(result.bytes)}。`
          : result.error || '清空回收站失败。',
      );
    } catch (error) {
      setHealthNotice(error instanceof Error ? error.message : '清空回收站失败。');
    } finally {
      setHealthBusy(false);
    }
  };

  const removeMissingRecords = () => {
    const ids = health?.missingIds || [];
    if (ids.length === 0) return;
    album.deletePhotos(ids);
    setHealthNotice(`已从相册移除 ${ids.length} 条缺失文件记录。`);
    setHealth(null);
  };

  const scanDuplicates = async () => {
    if (!bridge || dupBusy) return;
    setDupBusy(true);
    setDupProgress(null);
    setDupNotice('');
    setDupGroups([]);
    try {
      const result = await bridge.duplicates.scan();
      const groups = Array.isArray(result.groups) ? result.groups : [];
      setDupGroups(groups);
      setDupKeep(
        Object.fromEntries(groups.map((group) => [group.hash, group.suggestedKeepId])),
      );
      setDupNotice(
        result.ok
          ? groups.length
            ? `发现 ${groups.length} 组重复，可回收 ${formatBytes(result.reclaimableBytes || 0)}。`
            : '没有发现重复照片。'
          : result.error || '扫描失败。',
      );
    } catch (error) {
      setDupNotice(error instanceof Error ? error.message : '扫描失败。');
    } finally {
      setDupBusy(false);
      setDupProgress(null);
    }
  };

  const trashDuplicateGroup = async (group: DuplicateGroup) => {
    if (!bridge || dupBusy) return;
    const keepId = dupKeep[group.hash] || group.suggestedKeepId;
    const items = group.entries
      .filter((entry) => entry.id !== keepId)
      .map((entry) => ({ id: entry.id, libraryPath: entry.libraryPath }));
    if (items.length === 0) return;
    setDupBusy(true);
    try {
      const result = await bridge.duplicates.trash(items);
      if (result.trashed.length > 0) {
        album.deletePhotos(result.trashed.map((entry) => entry.id));
        setDupGroups((previous) => previous.filter((item) => item.hash !== group.hash));
      }
      const failed = result.errors.length;
      setDupNotice(
        `已移入回收站 ${result.trashed.length} 张${
          failed ? `，${failed} 张失败：${result.errors[0]?.error || ''}` : ''
        }。文件在 .hoshikuzu/trash 中可手动恢复。`,
      );
      pushToast({
        tone: failed ? 'warning' : 'success',
        title: failed ? '部分重复照片处理失败' : '重复照片已移入回收站',
        description: failed
          ? result.errors[0]?.error
          : '保留的一张仍在相册中，其余可在回收站找回。',
      });
    } catch (error) {
      setDupNotice(error instanceof Error ? error.message : '移入回收站失败。');
    } finally {
      setDupBusy(false);
    }
  };

  const libraryPhotos = useMemo(
    () => album.photos.filter((photo) => photo.mediaKind === 'library'),
    [album.photos],
  );
  const withWorld = libraryPhotos.filter((photo) => Boolean(photo.worldId)).length;
  const withRecognizedDate = libraryPhotos.filter(
    (photo) => photo.metaSource && photo.metaSource !== 'mtime',
  ).length;
  const missing = libraryPhotos.filter((photo) => photo.missing).length;
  const unlinked = libraryPhotos.filter((photo) => !photo.worldId && !photo.worldRef).length;

  if (!available) return null;

  return (
    <AdminPanel kicker="LOCAL LIBRARY" title="存储库">
      <div className={`admin-status-line${config?.configured ? ' is-live' : ''}`}>
        <span className="admin-status-line__dot" aria-hidden="true" />
        {config?.configured
          ? '存储库已连接，原图留在原文件夹'
          : config?.unavailable
            ? '存储库文件夹当前不可用'
            : '尚未选择存储库文件夹'}
      </div>

      <div className="library-panel">
        <div className="library-panel__path">
          <span className="library-panel__path-label">
            <HardDrive size={14} aria-hidden="true" />
            当前存储库
          </span>
          <code className="library-panel__path-value" title={config?.libraryPath ?? ''}>
            {config?.libraryPath || '未选择'}
          </code>
        </div>

        <div className="library-panel__path">
          <span className="library-panel__path-label">
            <FolderTree size={14} aria-hidden="true" />
            缩略图缓存
          </span>
          <code className="library-panel__path-value" title={config?.thumbnailDirPath ?? ''}>
            {config?.thumbnailDirPath || '尚未建立'}
          </code>
        </div>

        <div className="library-panel__actions">
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => void chooseLibrary()}
          >
            <FolderOpen size={14} aria-hidden="true" />
            更换存储库
          </button>
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => void createLibrary()}
          >
            <FolderPlus size={14} aria-hidden="true" />
            新建存储库
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void openFolder()}
            disabled={!config?.configured}
          >
            <FolderOpen size={14} aria-hidden="true" />
            打开文件夹
          </button>
        </div>

        <div className="admin-storage-grid library-panel__stats">
          <div>
            <span>库内照片</span>
            <strong>{libraryPhotos.length}</strong>
          </div>
          <div>
            <span>库体积（原图）</span>
            <strong>{stats ? formatBytes(stats.libraryBytes) : '—'}</strong>
          </div>
          <div>
            <span>预览缓存</span>
            <strong>{stats ? formatBytes(stats.previewBytes) : '—'}</strong>
          </div>
          <div>
            <span>上次扫描</span>
            <strong>{stats?.lastScanAt ? formatAdminDate(stats.lastScanAt) : '尚未扫描'}</strong>
          </div>
        </div>

        <div className="library-panel__recognition">
          <div>
            <MapPin size={14} aria-hidden="true" />
            <span>已识别 World ID</span>
            <strong>{withWorld}</strong>
          </div>
          <div>
            <Images size={14} aria-hidden="true" />
            <span>识别到拍摄日期</span>
            <strong>{withRecognizedDate}</strong>
          </div>
          <div className={missing > 0 ? 'is-warning' : ''}>
            <Trash2 size={14} aria-hidden="true" />
            <span>文件缺失</span>
            <strong>{missing}</strong>
          </div>
          <div>
            <Database size={14} aria-hidden="true" />
            <span>未关联世界</span>
            <strong>{unlinked}</strong>
          </div>
        </div>

        <div className="library-panel__scan">
          <div className="library-panel__scan-row">
            <button
              type="button"
              className="button button--primary button--small"
              onClick={() => void scan()}
              disabled={scanning || !config?.configured}
            >
              {scanning ? (
                <ScanLine size={14} className="spinner" aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              {scanning ? '正在扫描…' : '扫描存储库'}
            </button>
            {scanning ? (
              <button
                type="button"
                className="text-button"
                onClick={() => void cancelScan()}
              >
                取消扫描
              </button>
            ) : (
              <span className="field-hint">
                只读取文件头与元数据；已识别的照片不会重复添加，手动编辑不会被覆盖。
              </span>
            )}
          </div>
          {scanning ? (
            <div className="library-panel__progress" role="status">
              <span>{progress?.message ?? '正在建立索引…'}</span>
              <span>
                {progress?.total
                  ? `${progress.current} / ${progress.total}`
                  : `${progress?.current ?? 0} 张`}
              </span>
            </div>
          ) : previewProgress &&
            previewProgress.total > 0 &&
            previewProgress.done + previewProgress.failed < previewProgress.total ? (
            <div className="library-panel__progress" role="status">
              <span>后台生成缩略图</span>
              <span>
                {previewProgress.done + previewProgress.failed} / {previewProgress.total}
                {previewProgress.failed ? ` · 失败 ${previewProgress.failed}` : ''}
              </span>
            </div>
          ) : null}
        </div>

        <div className="admin-form library-panel__options">
          <div className="admin-editor__row">
            <div className="field">
              <label className="field-label" htmlFor="library-preview-preset">
                缩略图规格
              </label>
              <select
                id="library-preview-preset"
                className="admin-select"
                value={config?.previewPreset ?? DEFAULT_THUMBNAIL_PRESET_ID}
                onChange={(event) =>
                  void setOptions({ previewPreset: event.target.value })
                }
              >
                {THUMBNAIL_PRESETS_META.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} · {preset.maxEdge}px · Q{preset.quality}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {thumbnailPresetMeta(config?.previewPreset).tagline}
                。更改后会重新生成缩略图缓存，原图不动。
              </p>
            </div>
            <div className="field">
              <label className="field-label">启动时</label>
              <label className="library-panel__checkbox">
                <input
                  type="checkbox"
                  checked={config?.autoScan ?? true}
                  onChange={(event) =>
                    void setOptions({ autoScan: event.target.checked })
                  }
                />
                <span>自动扫描存储库新增照片</span>
              </label>
              <p className="field-hint">关闭后需要手动点击「扫描存储库」。</p>
            </div>
          </div>

          <div className="field library-panel__loading">
            <label className="field-label" htmlFor="library-loading-mode">
              图片加载策略
            </label>
            <select
              id="library-loading-mode"
              className="admin-select"
              value={config?.imageLoadingMode ?? 'predictive'}
              onChange={(event) =>
                void setOptions({
                  imageLoadingMode: event.target.value as
                    | 'realtime'
                    | 'predictive'
                    | 'preload',
                })
              }
            >
              {IMAGE_LOADING_MODE_META.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
            <p className="field-hint">
              {
                IMAGE_LOADING_MODE_META.find(
                  (mode) => mode.id === (config?.imageLoadingMode ?? 'predictive'),
                )?.detail
              }
            </p>
          </div>
        </div>

        {!mobileRuntime ? (
        <div className="field library-panel__autoimport">
          <label className="field-label">
            <FolderInput size={14} aria-hidden="true" />
            自动导入截图文件夹
          </label>
          <p className="field-hint">
            绑定 VRChat 截图目录后，新截图会自动复制到存储库的 _inbox；原文件保留，不会移动或删除。
          </p>
          <div className="library-panel__path">
            <code className="library-panel__path-value" title={auto?.folder || ''}>
              {auto?.folder || '尚未选择截图文件夹'}
            </code>
            <button
              type="button"
              className="button button--soft button--small"
              onClick={() => void applyAuto(() => bridge!.autoImport.chooseFolder())}
              disabled={!bridge || autoBusy}
            >
              <FolderOpen size={14} aria-hidden="true" />
              选择文件夹
            </button>
          </div>
          <label className="library-panel__checkbox">
            <input
              type="checkbox"
              checked={auto?.enabled ?? false}
              onChange={(event) =>
                void applyAuto(() =>
                  bridge!.autoImport.setConfig({ enabled: event.target.checked }),
                )
              }
              disabled={!bridge || autoBusy || !auto?.folder}
            />
            <span>启用自动导入</span>
          </label>
          <div className="library-panel__scan-row">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => void applyAuto(() => bridge!.autoImport.scanNow())}
              disabled={!bridge || autoBusy || !auto?.folder || auto?.status.scanning}
            >
              <Play size={13} aria-hidden="true" />
              {auto?.status.scanning ? '正在扫描…' : '立即扫描'}
            </button>
            <span className="field-hint">
              {auto?.status.running ? '监视中' : '未监视'} · 已导入{' '}
              {auto?.status.importedCount ?? 0} 张
              {auto?.status.lastScanAt
                ? ` · 上次 ${formatAdminDate(auto.status.lastScanAt)}`
                : ''}
            </span>
          </div>
          {auto?.status.lastError || autoError ? (
            <p className="field-hint is-warning" role="status">
              {autoError || auto?.status.lastError}
            </p>
          ) : null}
        </div>
        ) : null}

        {!mobileRuntime ? (
          <div className="library-panel__duplicates">
            <div className="library-panel__scan-row">
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void scanDuplicates()}
                disabled={dupBusy || !config?.configured}
              >
                <Copy size={13} aria-hidden="true" />
                {dupBusy ? '正在扫描重复照片…' : '扫描重复照片'}
              </button>
              {dupProgress ? (
                <span className="field-hint">
                  {dupProgress.done} / {dupProgress.total}
                </span>
              ) : null}
            </div>
            <p className="field-hint">
              按完整文件 SHA-256 对比；处理时只移入 .hoshikuzu/trash，不会直接永久删除。
            </p>
            {dupNotice ? (
              <p className="field-hint" role="status">
                {dupNotice}
              </p>
            ) : null}
            {dupGroups.map((group) => {
              const keepId = dupKeep[group.hash] || group.suggestedKeepId;
              return (
                <div className="duplicate-group" key={group.hash}>
                  <header className="duplicate-group__head">
                    <strong>{group.entries.length} 张相同</strong>
                    <span>可回收 {formatBytes(group.reclaimableBytes)}</span>
                  </header>
                  <div className="duplicate-group__items">
                    {group.entries.map((entry) => {
                      const keep = entry.id === keepId;
                      return (
                        <label
                          className={`duplicate-item${keep ? ' is-keep' : ''}`}
                          key={entry.id}
                        >
                          <input
                            type="radio"
                            name={`dup-${group.hash}`}
                            checked={keep}
                            onChange={() =>
                              setDupKeep((previous) => ({
                                ...previous,
                                [group.hash]: entry.id,
                              }))
                            }
                          />
                          {entry.previewPath ? (
                            <img
                              src={mediaUrl('preview', entry.previewPath)}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="duplicate-item__placeholder" aria-hidden="true" />
                          )}
                          <span className="duplicate-item__meta">
                            <strong title={entry.fileName}>{entry.fileName}</strong>
                            <small>
                              {formatBytes(entry.size)}
                              {entry.capturedAt
                                ? ` · ${formatAdminDate(entry.capturedAt)}`
                                : ''}
                            </small>
                          </span>
                          {keep ? (
                            <span className="duplicate-item__keep">保留</span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => void trashDuplicateGroup(group)}
                    disabled={dupBusy}
                  >
                    保留选中，其余移入回收站
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {!mobileRuntime ? (
          <div className="library-panel__health">
            <div className="library-panel__scan-row">
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void scanHealth()}
                disabled={healthBusy || !config?.configured}
              >
                <ShieldCheck size={13} aria-hidden="true" />
                {healthBusy ? '检查中…' : '库健康检查'}
              </button>
              {health?.generatedAt ? (
                <span className="field-hint">
                  上次 {formatAdminDate(health.generatedAt)}
                </span>
              ) : null}
            </div>
            {healthNotice ? (
              <p className="field-hint" role="status">
                {healthNotice}
              </p>
            ) : null}
            {health ? (
              <div className="health-issues">
                {health.issues.map((issue) => (
                  <div
                    className={`health-issue health-issue--${issue.severity}`}
                    key={issue.id}
                  >
                    <div className="health-issue__head">
                      <strong>{issue.title}</strong>
                      {issue.count > 0 ? (
                        <span>
                          {issue.count} 项
                          {issue.bytes > 0 ? ` · ${formatBytes(issue.bytes)}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <p>{issue.detail}</p>
                    <div className="health-issue__actions">
                      {issue.id === 'missing' && (health.missingIds?.length || 0) > 0 ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={removeMissingRecords}
                        >
                          从相册移除缺失记录
                        </button>
                      ) : null}
                      {issue.id === 'orphan-previews' ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void cleanHealthPreviews()}
                          disabled={healthBusy}
                        >
                          清理孤儿缩略图
                        </button>
                      ) : null}
                      {issue.id === 'trash' ? (
                        <button
                          type="button"
                          className={`text-button${confirmTrash ? ' text-button--danger' : ''}`}
                          onClick={() => void emptyHealthTrash()}
                          disabled={healthBusy}
                        >
                          {confirmTrash ? '再次点击确认清空' : '清空回收站'}
                        </button>
                      ) : null}
                      {issue.id === 'duplicate-hashes' ? (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void scanDuplicates()}
                          disabled={dupBusy}
                        >
                          扫描重复照片
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="library-panel__maintenance">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              setConfirmClear(false);
              void clearPreviewCache();
            }}
            disabled={scanning}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {confirmClear ? '再次点击确认清理预览缓存' : '清理预览缓存'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void resetIgnored();
            }}
          >
            重置忽略列表
          </button>
        </div>

        <div className="library-panel__sync">
          <span className="library-panel__sync-head">
            <Cloud size={14} aria-hidden="true" />
            云同步
          </span>
          <p>
            {sync?.message ||
              '把原图按拍摄日期同步到云盘，或把相册数据推送到你的网站。'}
          </p>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => {
              window.location.hash = '#/admin/sync';
            }}
          >
            打开云同步设置
          </button>
        </div>
      </div>

      {scanning ? null : (
        <p className="admin-panel__note">
          <Database size={13} aria-hidden="true" />
          元数据保存在库根目录的 hoshikuzu-library.json；缩略图只写入 {config?.thumbnailDir || '缩略图缓存'}
          文件夹，可随时删除并重新生成，原图始终保持只读。
        </p>
      )}
    </AdminPanel>
  );
}
