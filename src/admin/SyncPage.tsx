import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  FolderOpen,
  Globe2,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import '../styles/sync.css';
import type { AlbumApi } from '../hooks/useAlbum';
import { getDesktopBridge } from '../platform';
import type {
  SyncConfigView,
  SyncDoneResult,
  SyncProgress,
  SyncTarget,
  SyncTestResult,
} from '../platform';
import { useToast } from '../hooks/useToast';
import { AdminPageHead, AdminPanel, formatAdminDate, formatBytes } from './AdminUI';

interface SyncPageProps {
  album: AlbumApi;
}

interface CloudFormState {
  provider: string;
  folderRoot: string;
  baseFolder: string;
  skipExisting: boolean;
  uploadMetadata: boolean;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  googleClientId: string;
  googleClientSecret: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  baiduAppKey: string;
  baiduAppName: string;
  baiduSecretKey: string;
  baiduAccessToken: string;
  baiduRefreshToken: string;
  clearWebdavPassword: boolean;
  clearGoogleClientSecret: boolean;
  clearGoogleAccessToken: boolean;
  clearGoogleRefreshToken: boolean;
  clearBaiduSecretKey: boolean;
  clearBaiduAccessToken: boolean;
  clearBaiduRefreshToken: boolean;
}

interface WebsiteFormState {
  endpoint: string;
  includePreviewImages: boolean;
  maxPayloadMb: number;
  websiteToken: string;
  clearWebsiteToken: boolean;
}

function cloudFormFromConfig(config: SyncConfigView): CloudFormState {
  return {
    provider: config.cloud.provider,
    folderRoot: config.cloud.folderRoot,
    baseFolder: config.cloud.baseFolder,
    skipExisting: config.cloud.skipExisting,
    uploadMetadata: config.cloud.uploadMetadata,
    webdavUrl: config.cloud.webdavUrl,
    webdavUsername: config.cloud.webdavUsername,
    webdavPassword: '',
    googleClientId: config.cloud.googleClientId,
    googleClientSecret: '',
    googleAccessToken: '',
    googleRefreshToken: '',
    baiduAppKey: config.cloud.baiduAppKey,
    baiduAppName: config.cloud.baiduAppName,
    baiduSecretKey: '',
    baiduAccessToken: '',
    baiduRefreshToken: '',
    clearWebdavPassword: false,
    clearGoogleClientSecret: false,
    clearGoogleAccessToken: false,
    clearGoogleRefreshToken: false,
    clearBaiduSecretKey: false,
    clearBaiduAccessToken: false,
    clearBaiduRefreshToken: false,
  };
}

function websiteFormFromConfig(config: SyncConfigView): WebsiteFormState {
  return {
    endpoint: config.website.endpoint,
    includePreviewImages: config.website.includePreviewImages,
    maxPayloadMb: config.website.maxPayloadMb,
    websiteToken: '',
    clearWebsiteToken: false,
  };
}

function SecretField({
  id,
  label,
  value,
  hasSaved,
  cleared,
  onChange,
  onClear,
}: {
  id: string;
  label: string;
  value: string;
  hasSaved: boolean;
  cleared: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="field sync-secret">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="sync-secret__row">
        <KeyRound size={14} aria-hidden="true" />
        <input
          id={id}
          className="admin-input"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={hasSaved && !cleared ? '已保存，留空不修改' : '尚未保存'}
        />
        {hasSaved ? (
          <button
            type="button"
            className="text-button"
            onClick={onClear}
            disabled={cleared}
          >
            {cleared ? '将清除' : '清除'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SyncProgressPanel({
  progress,
  target,
}: {
  progress: SyncProgress | null;
  target: SyncTarget;
}) {
  if (!progress) return null;
  const total = progress.total || 0;
  const current = progress.current || 0;
  const percent =
    progress.phase === 'done'
      ? 100
      : total > 0
        ? Math.min(99, Math.round((current / total) * 100))
        : progress.phase === 'discover' || progress.phase === 'collect'
          ? 6
          : 0;
  const indeterminate =
    percent <= 6 && progress.phase !== 'done' && total === 0;
  return (
    <div className={`sync-progress${progress.phase === 'error' ? ' is-error' : ''}`}>
      <div
        className={`sync-progress__bar${indeterminate ? ' is-indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="sync-progress__meta">
        <span>{progress.message || '正在同步…'}</span>
        <strong>{progress.phase === 'done' ? '完成' : `${percent}%`}</strong>
      </div>
      <div className="sync-progress__stats">
        <span>
          {target === 'cloud' ? '照片' : '数据'} {current} / {total || '—'}
        </span>
        {typeof progress.uploaded === 'number' ? (
          <span>上传 {progress.uploaded}</span>
        ) : null}
        {typeof progress.skipped === 'number' ? (
          <span>跳过 {progress.skipped}</span>
        ) : null}
        {typeof progress.failed === 'number' && progress.failed > 0 ? (
          <span className="is-error">失败 {progress.failed}</span>
        ) : null}
        {progress.bytes ? (
          <span>
            {formatBytes(progress.bytesDone || 0)} / {formatBytes(progress.bytes)}
          </span>
        ) : null}
        {progress.date ? <span>{progress.date}</span> : null}
        {progress.file ? <span className="sync-progress__file">{progress.file}</span> : null}
      </div>
    </div>
  );
}

export function SyncPage({ album }: SyncPageProps) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const [config, setConfig] = useState<SyncConfigView | null>(null);
  const [cloud, setCloud] = useState<CloudFormState | null>(null);
  const [website, setWebsite] = useState<WebsiteFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<SyncTarget | null>(null);
  const [testResults, setTestResults] = useState<Record<SyncTarget, SyncTestResult | null>>({
    cloud: null,
    website: null,
  });
  const [progress, setProgress] = useState<Record<SyncTarget, SyncProgress | null>>({
    cloud: null,
    website: null,
  });
  const [done, setDone] = useState<Record<SyncTarget, SyncDoneResult | null>>({
    cloud: null,
    website: null,
  });
  const [runningTarget, setRunningTarget] = useState<SyncTarget | null>(null);
  const [full, setFull] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadConfig = async (applyForms = true) => {
    if (!bridge) return;
    try {
      const next = await bridge.sync.getConfig();
      setConfig(next);
      if (applyForms) {
        setCloud(cloudFormFromConfig(next));
        setWebsite(websiteFormFromConfig(next));
      }
      setRunningTarget(next.status.running || null);
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '无法读取云同步设置',
        description: (error as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    if (!bridge) return undefined;
    const offProgress = bridge.sync.onProgress((next) => {
      setProgress((previous) => ({ ...previous, [next.target]: next }));
    });
    const offDone = bridge.sync.onDone((result) => {
      setDone((previous) => ({ ...previous, [result.target]: result }));
      setRunningTarget(null);
      setProgress((previous) => ({
        ...previous,
        [result.target]: {
          target: result.target,
          phase: 'done',
          current: result.uploaded ?? result.photos ?? 0,
          total: result.uploaded ?? result.photos ?? 0,
          uploaded: result.uploaded,
          skipped: result.skipped,
          failed: result.failed,
          bytes: result.bytes,
          canceled: result.canceled,
          message: result.canceled
            ? '同步已取消'
            : result.ok
              ? '同步完成'
              : result.error || '同步失败',
        },
      }));
      void loadConfig(false);
      pushToast({
        tone: result.canceled ? 'warning' : result.ok ? 'success' : 'danger',
        title: result.canceled
          ? '同步已取消'
          : result.ok
            ? result.target === 'cloud'
              ? '云盘同步完成'
              : '网站同步完成'
            : '同步失败',
        description:
          result.error ||
          (result.target === 'cloud'
            ? `上传 ${result.uploaded ?? 0} 张，跳过 ${result.skipped ?? 0} 张${
                result.failed ? `，失败 ${result.failed} 张` : ''
              }`
            : result.uploaded || result.photos
              ? `网站已接收 ${result.photos ?? 0} 张照片的数据`
              : undefined),
      });
    });
    const offStatus = bridge.sync.onStatus((status) => {
      setConfig((previous) => (previous ? { ...previous, status } : previous));
      setRunningTarget(status.running || null);
    });
    const offConfig = bridge.sync.onConfig((next) => {
      setConfig(next);
      setCloud(cloudFormFromConfig(next));
      setWebsite(websiteFormFromConfig(next));
    });
    return () => {
      offProgress();
      offDone();
      offStatus();
      offConfig();
    };
  }, [bridge, pushToast]);

  const providerInfo = useMemo(
    () => config?.providers.find((provider) => provider.id === cloud?.provider) || null,
    [config, cloud?.provider],
  );
  const providerKind = providerInfo?.kind || 'folder';

  const saveConfig = async (): Promise<boolean> => {
    if (!bridge || !cloud || !website) return false;
    setSaving(true);
    try {
      const next = await bridge.sync.setConfig({
        cloud: {
          provider: cloud.provider,
          folderRoot: cloud.folderRoot,
          baseFolder: cloud.baseFolder,
          skipExisting: cloud.skipExisting,
          uploadMetadata: cloud.uploadMetadata,
          webdavUrl: cloud.webdavUrl,
          webdavUsername: cloud.webdavUsername,
          googleClientId: cloud.googleClientId,
          baiduAppKey: cloud.baiduAppKey,
          baiduAppName: cloud.baiduAppName,
          webdavPassword: cloud.webdavPassword.trim() || undefined,
          googleClientSecret: cloud.googleClientSecret.trim() || undefined,
          googleAccessToken: cloud.googleAccessToken.trim() || undefined,
          googleRefreshToken: cloud.googleRefreshToken.trim() || undefined,
          baiduSecretKey: cloud.baiduSecretKey.trim() || undefined,
          baiduAccessToken: cloud.baiduAccessToken.trim() || undefined,
          baiduRefreshToken: cloud.baiduRefreshToken.trim() || undefined,
          clearWebdavPassword: cloud.clearWebdavPassword || undefined,
          clearGoogleClientSecret: cloud.clearGoogleClientSecret || undefined,
          clearGoogleAccessToken: cloud.clearGoogleAccessToken || undefined,
          clearGoogleRefreshToken: cloud.clearGoogleRefreshToken || undefined,
          clearBaiduSecretKey: cloud.clearBaiduSecretKey || undefined,
          clearBaiduAccessToken: cloud.clearBaiduAccessToken || undefined,
          clearBaiduRefreshToken: cloud.clearBaiduRefreshToken || undefined,
        },
        website: {
          endpoint: website.endpoint,
          includePreviewImages: website.includePreviewImages,
          maxPayloadMb: website.maxPayloadMb,
          websiteToken: website.websiteToken.trim() || undefined,
          clearWebsiteToken: website.clearWebsiteToken || undefined,
        },
      });
      setConfig(next);
      setCloud(cloudFormFromConfig(next));
      setWebsite(websiteFormFromConfig(next));
      return true;
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '保存同步设置失败',
        description: (error as Error).message,
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const test = async (target: SyncTarget) => {
    if (!bridge || testing) return;
    const saved = await saveConfig();
    if (!saved) return;
    setTesting(target);
    setTestResults((previous) => ({ ...previous, [target]: null }));
    try {
      const result = await bridge.sync.test({ target });
      setTestResults((previous) => ({ ...previous, [target]: result }));
      pushToast({
        tone: result.ok ? 'success' : 'danger',
        title: result.ok ? '连接测试通过' : '连接测试失败',
        description: result.message,
      });
    } catch (error) {
      const message = (error as Error).message;
      setTestResults((previous) => ({ ...previous, [target]: { ok: false, message } }));
      pushToast({ tone: 'danger', title: '连接测试失败', description: message });
    } finally {
      setTesting(null);
    }
  };

  const start = async (target: SyncTarget) => {
    if (!bridge || runningTarget) return;
    const saved = await saveConfig();
    if (!saved) return;
    setProgress((previous) => ({
      ...previous,
      [target]: {
        target,
        phase: target === 'cloud' ? 'discover' : 'collect',
        current: 0,
        total: album.photos.length,
        message: target === 'cloud' ? '正在准备云盘同步…' : '正在准备网站数据…',
      },
    }));
    setDone((previous) => ({ ...previous, [target]: null }));
    try {
      const result = await bridge.sync.start({
        target,
        full: target === 'cloud' ? full : undefined,
        album: album.data,
      });
      if (!result.ok) {
        setRunningTarget(null);
        pushToast({
          tone: 'danger',
          title: '无法开始同步',
          description: result.error,
        });
        return;
      }
      setRunningTarget(target);
    } catch (error) {
      setRunningTarget(null);
      pushToast({
        tone: 'danger',
        title: '无法开始同步',
        description: (error as Error).message,
      });
    }
  };

  const cancel = async () => {
    if (!bridge) return;
    await bridge.sync.cancel();
    pushToast({ tone: 'warning', title: '正在取消同步…' });
  };

  const resetManifest = async () => {
    if (!bridge) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    const result = await bridge.sync.resetManifest();
    if (!result.ok) {
      pushToast({ tone: 'danger', title: '无法重置同步清单', description: result.error });
      return;
    }
    if (result.config) setConfig(result.config);
    pushToast({
      tone: 'success',
      title: '同步清单已重置',
      description: '下次云盘同步会重新检查并上传未在清单中的照片。',
    });
  };

  if (!bridge) {
    return (
      <div className="admin-page">
        <AdminPageHead
          kicker="CLOUD SYNC"
          title="云同步"
          description="把原图与相册数据同步到云盘或你的网站。"
        />
        <AdminPanel kicker="DESKTOP ONLY" title="仅桌面客户端可用">
          <p className="admin-panel__note">
            云盘与网站同步需要本地存储库和系统加密密钥，请在桌面客户端中配置。
          </p>
        </AdminPanel>
      </div>
    );
  }

  const cloudState = config?.state.cloud;
  const websiteState = config?.state.website;
  const cloudRunning = runningTarget === 'cloud';
  const websiteRunning = runningTarget === 'website';

  return (
    <div className="admin-page sync-page">
      <AdminPageHead
        kicker="CLOUD SYNC"
        title="云同步"
        description="把存储库中的原图按拍摄日期同步到云盘，或把当前相册数据推送到你的网站。所有密钥只保存在本机。"
      />

      <AdminPanel kicker="CLOUD DRIVE" title="云盘同步">
        <div className={`admin-status-line${config?.status.enabled ? ' is-live' : ''}`}>
          <span className="admin-status-line__dot" aria-hidden="true" />
          {config?.status.message || '尚未配置云同步'}
        </div>

        {loading || !cloud || !website ? (
          <div className="sync-loading" role="status">
            <Loader2 size={18} className="spinner" aria-hidden="true" />
            正在读取同步设置…
          </div>
        ) : (
          <>
            <div className="sync-form-grid">
              <div className="field">
                <label className="field-label" htmlFor="sync-cloud-provider">
                  同步方式
                </label>
                <select
                  id="sync-cloud-provider"
                  className="admin-select"
                  value={cloud.provider}
                  onChange={(event) =>
                    setCloud({ ...cloud, provider: event.target.value })
                  }
                >
                  {(config?.providers || []).map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <p className="field-hint">{providerInfo?.description}</p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="sync-cloud-base">
                  云端根目录
                </label>
                <input
                  id="sync-cloud-base"
                  className="admin-input"
                  value={cloud.baseFolder}
                  onChange={(event) =>
                    setCloud({ ...cloud, baseFolder: event.target.value })
                  }
                  placeholder="Hoshikuzu Album"
                  maxLength={160}
                />
                <p className="field-hint">
                  同步时会自动建立 {cloud.baseFolder || 'Hoshikuzu Album'}/YYYY-MM-DD/
                  日期文件夹，并只把对应日期的原图放进去。
                </p>
              </div>

              {providerKind === 'folder' ? (
                <div className="field sync-grid-span">
                  <label className="field-label" htmlFor="sync-cloud-folder">
                    云盘同步文件夹
                  </label>
                  <div className="sync-path-row">
                    <input
                      id="sync-cloud-folder"
                      className="admin-input"
                      value={cloud.folderRoot}
                      onChange={(event) =>
                        setCloud({ ...cloud, folderRoot: event.target.value })
                      }
                      placeholder="选择 Google Drive / 123云盘 / 百度网盘客户端的同步目录"
                    />
                    <button
                      type="button"
                      className="button button--soft button--small"
                      onClick={async () => {
                        const result = await bridge.sync.chooseFolder();
                        if (result.ok && result.path) {
                          setCloud((previous) =>
                            previous ? { ...previous, folderRoot: result.path || '' } : previous,
                          );
                        }
                      }}
                    >
                      <FolderOpen size={14} aria-hidden="true" />
                      选择文件夹
                    </button>
                  </div>
                  <p className="field-hint">
                    程序只把原图复制到该目录的日期文件夹，由云盘客户端负责上传；不会修改原图。
                  </p>
                </div>
              ) : null}

              {providerKind === 'webdav' ? (
                <>
                  <div className="field sync-grid-span">
                    <label className="field-label" htmlFor="sync-webdav-url">
                      WebDAV 地址
                    </label>
                    <input
                      id="sync-webdav-url"
                      className="admin-input"
                      value={cloud.webdavUrl}
                      onChange={(event) =>
                        setCloud({ ...cloud, webdavUrl: event.target.value })
                      }
                      placeholder="https://dav.example.com/dav/"
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="sync-webdav-user">
                      用户名
                    </label>
                    <input
                      id="sync-webdav-user"
                      className="admin-input"
                      value={cloud.webdavUsername}
                      onChange={(event) =>
                        setCloud({ ...cloud, webdavUsername: event.target.value })
                      }
                      autoComplete="username"
                    />
                  </div>
                  <SecretField
                    id="sync-webdav-password"
                    label="密码 / 应用密码"
                    value={cloud.webdavPassword}
                    hasSaved={config?.cloud.hasWebdavPassword || false}
                    cleared={cloud.clearWebdavPassword}
                    onChange={(value) =>
                      setCloud({ ...cloud, webdavPassword: value, clearWebdavPassword: false })
                    }
                    onClear={() =>
                      setCloud({ ...cloud, webdavPassword: '', clearWebdavPassword: true })
                    }
                  />
                </>
              ) : null}

              {providerKind === 'google' ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="sync-google-client">
                      OAuth Client ID
                    </label>
                    <input
                      id="sync-google-client"
                      className="admin-input"
                      value={cloud.googleClientId}
                      onChange={(event) =>
                        setCloud({ ...cloud, googleClientId: event.target.value })
                      }
                      placeholder="xxxxxxxx.apps.googleusercontent.com"
                    />
                  </div>
                  <SecretField
                    id="sync-google-secret"
                    label="OAuth Client Secret"
                    value={cloud.googleClientSecret}
                    hasSaved={config?.cloud.hasGoogleClientSecret || false}
                    cleared={cloud.clearGoogleClientSecret}
                    onChange={(value) =>
                      setCloud({
                        ...cloud,
                        googleClientSecret: value,
                        clearGoogleClientSecret: false,
                      })
                    }
                    onClear={() =>
                      setCloud({
                        ...cloud,
                        googleClientSecret: '',
                        clearGoogleClientSecret: true,
                      })
                    }
                  />
                  <SecretField
                    id="sync-google-access"
                    label="Access Token"
                    value={cloud.googleAccessToken}
                    hasSaved={config?.cloud.hasGoogleAccessToken || false}
                    cleared={cloud.clearGoogleAccessToken}
                    onChange={(value) =>
                      setCloud({
                        ...cloud,
                        googleAccessToken: value,
                        clearGoogleAccessToken: false,
                      })
                    }
                    onClear={() =>
                      setCloud({
                        ...cloud,
                        googleAccessToken: '',
                        clearGoogleAccessToken: true,
                      })
                    }
                  />
                  <SecretField
                    id="sync-google-refresh"
                    label="Refresh Token（可选，用于自动续期）"
                    value={cloud.googleRefreshToken}
                    hasSaved={config?.cloud.hasGoogleRefreshToken || false}
                    cleared={cloud.clearGoogleRefreshToken}
                    onChange={(value) =>
                      setCloud({
                        ...cloud,
                        googleRefreshToken: value,
                        clearGoogleRefreshToken: false,
                      })
                    }
                    onClear={() =>
                      setCloud({
                        ...cloud,
                        googleRefreshToken: '',
                        clearGoogleRefreshToken: true,
                      })
                    }
                  />
                  <p className="field-hint sync-grid-span">
                    需要 Google Drive API 的 drive.file 权限。仅填 Access Token
                    时，过期后需要手动更新；同时填写 Client ID / Secret / Refresh Token
                    可自动续期。
                  </p>
                </>
              ) : null}

              {providerKind === 'baidu' ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="sync-baidu-app">
                      AppKey
                    </label>
                    <input
                      id="sync-baidu-app"
                      className="admin-input"
                      value={cloud.baiduAppKey}
                      onChange={(event) =>
                        setCloud({ ...cloud, baiduAppKey: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="sync-baidu-name">
                      应用目录名（/apps/…）
                    </label>
                    <input
                      id="sync-baidu-name"
                      className="admin-input"
                      value={cloud.baiduAppName}
                      onChange={(event) =>
                        setCloud({ ...cloud, baiduAppName: event.target.value })
                      }
                      placeholder="例如 hoshikuzu"
                    />
                  </div>
                  <SecretField
                    id="sync-baidu-secret"
                    label="SecretKey"
                    value={cloud.baiduSecretKey}
                    hasSaved={config?.cloud.hasBaiduSecretKey || false}
                    cleared={cloud.clearBaiduSecretKey}
                    onChange={(value) =>
                      setCloud({
                        ...cloud,
                        baiduSecretKey: value,
                        clearBaiduSecretKey: false,
                      })
                    }
                    onClear={() =>
                      setCloud({
                        ...cloud,
                        baiduSecretKey: '',
                        clearBaiduSecretKey: true,
                      })
                    }
                  />
                  <SecretField
                    id="sync-baidu-access"
                    label="Access Token"
                    value={cloud.baiduAccessToken}
                    hasSaved={config?.cloud.hasBaiduAccessToken || false}
                    cleared={cloud.clearBaiduAccessToken}
                    onChange={(value) =>
                      setCloud({
                        ...cloud,
                        baiduAccessToken: value,
                        clearBaiduAccessToken: false,
                      })
                    }
                    onClear={() =>
                      setCloud({
                        ...cloud,
                        baiduAccessToken: '',
                        clearBaiduAccessToken: true,
                      })
                    }
                  />
                  <SecretField
                    id="sync-baidu-refresh"
                    label="Refresh Token（可选，用于自动续期）"
                    value={cloud.baiduRefreshToken}
                    hasSaved={config?.cloud.hasBaiduRefreshToken || false}
                    cleared={cloud.clearBaiduRefreshToken}
                    onChange={(value) =>
                      setCloud({
                        ...cloud,
                        baiduRefreshToken: value,
                        clearBaiduRefreshToken: false,
                      })
                    }
                    onClear={() =>
                      setCloud({
                        ...cloud,
                        baiduRefreshToken: '',
                        clearBaiduRefreshToken: true,
                      })
                    }
                  />
                  <p className="field-hint sync-grid-span">
                    需要百度网盘开放平台应用。文件会上传到 /apps/&lt;应用目录名&gt;/…
                    ；Access Token 约 30 天有效，Refresh Token 可自动续期。
                  </p>
                </>
              ) : null}
            </div>

            <div className="sync-options">
              <label className="sync-check">
                <input
                  type="checkbox"
                  checked={cloud.skipExisting}
                  onChange={(event) =>
                    setCloud({ ...cloud, skipExisting: event.target.checked })
                  }
                />
                <span>跳过已同步的照片（推荐）</span>
              </label>
              <label className="sync-check">
                <input
                  type="checkbox"
                  checked={cloud.uploadMetadata}
                  onChange={(event) =>
                    setCloud({ ...cloud, uploadMetadata: event.target.checked })
                  }
                />
                <span>同时上传 hoshikuzu-album.json 元数据</span>
              </label>
              <label className="sync-check">
                <input
                  type="checkbox"
                  checked={full}
                  onChange={(event) => setFull(event.target.checked)}
                />
                <span>重新上传全部（忽略同步清单）</span>
              </label>
            </div>

            <div className="sync-actions">
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void saveConfig()}
                disabled={saving || Boolean(runningTarget)}
              >
                {saving ? <Loader2 size={14} className="spinner" /> : null}
                保存云盘设置
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void test('cloud')}
                disabled={Boolean(testing) || Boolean(runningTarget)}
              >
                {testing === 'cloud' ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                测试连接
              </button>
              {cloudRunning ? (
                <button
                  type="button"
                  className="button button--danger button--small"
                  onClick={() => void cancel()}
                >
                  取消同步
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void start('cloud')}
                  disabled={Boolean(runningTarget) || saving}
                >
                  <CloudUpload size={15} />
                  立即同步到云盘
                </button>
              )}
            </div>

            {testResults.cloud ? (
              <p
                className={`sync-test${testResults.cloud.ok ? ' is-ok' : ' is-error'}`}
                role="status"
              >
                {testResults.cloud.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {testResults.cloud.message}
              </p>
            ) : null}

            <SyncProgressPanel progress={progress.cloud} target="cloud" />
            {done.cloud?.errors?.length ? (
              <ul className="sync-errors">
                {done.cloud.errors.slice(0, 6).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}

            <div className="sync-state-grid">
              <div>
                <span>上次云盘同步</span>
                <strong>
                  {cloudState?.lastSyncAt
                    ? formatAdminDate(cloudState.lastSyncAt)
                    : '尚未同步'}
                </strong>
              </div>
              <div>
                <span>最近结果</span>
                <strong>{cloudState?.message || '—'}</strong>
              </div>
              <div>
                <span>同步清单</span>
                <strong>{config?.manifest.count ?? 0} 项</strong>
              </div>
              <div>
                <span>云端根目录</span>
                <strong>{cloud.baseFolder || 'Hoshikuzu Album'}/日期/</strong>
              </div>
            </div>

            <div className="sync-maintenance">
              <button
                type="button"
                className="text-button"
                onClick={() => void resetManifest()}
                disabled={Boolean(runningTarget)}
              >
                <RotateCcw size={13} />
                {confirmReset ? '再次点击确认重置同步清单' : '重置云盘同步清单'}
              </button>
              <p>重置后不会删除云盘文件，下次同步会重新检查并上传缺少的照片。</p>
            </div>
          </>
        )}
      </AdminPanel>

      <AdminPanel kicker="WEBSITE" title="网站同步">
        {loading || !cloud || !website ? (
          <div className="sync-loading" role="status">
            <Loader2 size={18} className="spinner" aria-hidden="true" />
            正在读取同步设置…
          </div>
        ) : (
          <>
            <div className="sync-form-grid">
              <div className="field sync-grid-span">
                <label className="field-label" htmlFor="sync-website-endpoint">
                  同步接口地址
                </label>
                <input
                  id="sync-website-endpoint"
                  className="admin-input"
                  value={website.endpoint}
                  onChange={(event) =>
                    setWebsite({ ...website, endpoint: event.target.value })
                  }
                  placeholder="https://your-site.example.com/api/hoshikuzu/sync"
                />
                <p className="field-hint">
                  网站需要接受 POST JSON（format: hoshikuzu-album-sync）。客户端会先发送
                  kind=&quot;probe&quot; 做连接测试，再发送完整相册数据。
                </p>
              </div>
              <SecretField
                id="sync-website-token"
                label="网站令牌"
                value={website.websiteToken}
                hasSaved={config?.website.hasWebsiteToken || false}
                cleared={website.clearWebsiteToken}
                onChange={(value) =>
                  setWebsite({ ...website, websiteToken: value, clearWebsiteToken: false })
                }
                onClear={() =>
                  setWebsite({ ...website, websiteToken: '', clearWebsiteToken: true })
                }
              />
              <div className="field">
                <label className="field-label" htmlFor="sync-website-max">
                  数据上限（MB）
                </label>
                <input
                  id="sync-website-max"
                  className="admin-input"
                  type="number"
                  min={1}
                  max={1024}
                  value={website.maxPayloadMb}
                  onChange={(event) =>
                    setWebsite({
                      ...website,
                      maxPayloadMb: Math.min(1024, Math.max(1, Number(event.target.value) || 80)),
                    })
                  }
                />
              </div>
              <label className="sync-check sync-check--field">
                <input
                  type="checkbox"
                  checked={website.includePreviewImages}
                  onChange={(event) =>
                    setWebsite({ ...website, includePreviewImages: event.target.checked })
                  }
                />
                <span>内嵌缩略图（网站可直接显示；关闭后只同步数据）</span>
              </label>
            </div>

            <div className="sync-actions">
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void saveConfig()}
                disabled={saving || Boolean(runningTarget)}
              >
                {saving ? <Loader2 size={14} className="spinner" /> : null}
                保存网站设置
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => void test('website')}
                disabled={Boolean(testing) || Boolean(runningTarget)}
              >
                {testing === 'website' ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <Globe2 size={14} />
                )}
                测试连接
              </button>
              {websiteRunning ? (
                <button
                  type="button"
                  className="button button--danger button--small"
                  onClick={() => void cancel()}
                >
                  取消同步
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--primary button--small"
                  onClick={() => void start('website')}
                  disabled={Boolean(runningTarget) || saving}
                >
                  <UploadCloud size={15} />
                  立即同步到网站
                </button>
              )}
            </div>

            {testResults.website ? (
              <p
                className={`sync-test${testResults.website.ok ? ' is-ok' : ' is-error'}`}
                role="status"
              >
                {testResults.website.ok ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <AlertTriangle size={14} />
                )}
                {testResults.website.message}
              </p>
            ) : null}

            <SyncProgressPanel progress={progress.website} target="website" />

            <div className="sync-state-grid">
              <div>
                <span>上次网站同步</span>
                <strong>
                  {websiteState?.lastSyncAt
                    ? formatAdminDate(websiteState.lastSyncAt)
                    : '尚未同步'}
                </strong>
              </div>
              <div>
                <span>最近结果</span>
                <strong>{websiteState?.message || '—'}</strong>
              </div>
              <div>
                <span>照片</span>
                <strong>{album.photos.length} 张</strong>
              </div>
              <div>
                <span>内嵌缩略图</span>
                <strong>{website.includePreviewImages ? '是' : '否'}</strong>
              </div>
            </div>

            <details className="sync-contract">
              <summary>网站接口格式</summary>
              <pre>{`POST ${website.endpoint || 'https://your-site/api/hoshikuzu/sync'}
Authorization: Bearer <令牌>
Content-Type: application/json

{
  "format": "hoshikuzu-album-sync",
  "version": 1,
  "kind": "probe" | "album",
  "library": { "id": "...", "name": "..." },
  "album": { "version": 2, "photos": [...], "worlds": [...], "settings": {} }
}

连接测试发送 kind="probe"；正式同步发送 kind="album"。
返回 2xx 即视为成功，可返回 { "ok": true, "message": "..." }。`}</pre>
            </details>
          </>
        )}
      </AdminPanel>

      <AdminPanel kicker="SECURITY" title="同步与隐私">
        <ul className="sync-safety">
          <li>
            <ShieldCheck size={14} aria-hidden="true" />
            云盘同步只读取原图并复制到日期文件夹，不会修改、移动或删除存储库中的原图。
          </li>
          <li>
            <Cloud size={14} aria-hidden="true" />
            云盘客户端目录方式由对应客户端上传；API 方式只发送原图文件与
            hoshikuzu-album.json 元数据。
          </li>
          <li>
            <Globe2 size={14} aria-hidden="true" />
            网站同步会把相册数据与（可选）缩略图发送到你填写的接口；请确认该网站可信。
          </li>
          <li>
            <KeyRound size={14} aria-hidden="true" />
            所有令牌、AppSecret、WebDAV
            密码使用系统加密保存在本机，不写入存储库、不随备份导出。
          </li>
        </ul>
      </AdminPanel>
    </div>
  );
}
