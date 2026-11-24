import { useEffect, useMemo, useState } from 'react';
import {
  Database,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  Images,
  MapPin,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Trash2,
  Cloud,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import { useDesktopLibrary, useDesktopLibraryActivity } from '../hooks/useDesktopLibrary';
import { getDesktopBridge, type DesktopSyncStatus } from '../platform';
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

  useEffect(() => {
    if (!bridge || !config?.configured) {
      setSync(null);
      return undefined;
    }
    void bridge.sync.status().then(setSync).catch(() => setSync(null));
    return bridge.sync.onStatus((next) => setSync(next));
  }, [bridge, config?.configured, config?.libraryId]);

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
