import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  FlaskConical,
  FolderOpen,
  Globe2,
  KeyRound,
  LayoutTemplate,
  Palette,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AlbumApi } from '../hooks/useAlbum';
import type { AdminAuthApi } from '../hooks/useAdminAuth';
import type { ImportMode, LayoutId, ThemeId } from '../types';
import {
  estimateAlbumBytes,
  parseAlbumBackup,
  type ParsedBackup,
} from '../services/albumStorage';
import { effectiveWorldApiBase, DEFAULT_SETTINGS } from '../data/settings';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_LAYOUT,
  DEFAULT_THEME,
  LAYOUTS,
  THEMES,
  themeTone,
} from '../data/appearance';
import { DEMO_LOOKUP_HINT, lookupWorld } from '../services/worldService';
import { useToast } from '../hooks/useToast';
import { useDesktopLibrary } from '../hooks/useDesktopLibrary';
import { getDesktopBridge, type DesktopPreferences, type DesktopAutoBackupView } from '../platform';
import { isMobileRuntime } from '../platform/mobileRuntime';
import { backupFilename, downloadTextFile } from '../utils/download';
import { formatDateShort } from '../utils/date';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BackgroundEffectPicker } from '../components/BackgroundEffectPicker';
import { LibraryPanel } from './LibraryPanel';
import { NetworkPanel } from './NetworkPanel';
import { UpdateCard } from './UpdateCard';
import {
  AdminPageHead,
  AdminPanel,
  DataMini,
  StorageMeter,
  formatAdminDate,
  formatBytes,
} from './AdminUI';

interface SettingsPageProps {
  album: AlbumApi;
  auth: AdminAuthApi;
}

type DangerAction = 'samples' | 'photos' | 'reset' | null;

export function SettingsPage({ album, auth }: SettingsPageProps) {
  const { pushToast } = useToast();
  const desktop = getDesktopBridge();
  const mobile = isMobileRuntime();
  const library = useDesktopLibrary();
  const [siteName, setSiteName] = useState(album.settings.siteName);
  const [siteNameEn, setSiteNameEn] = useState(album.settings.siteNameEn);
  const [tagline, setTagline] = useState(album.settings.tagline);
  const [timelineIntro, setTimelineIntro] = useState(album.settings.timelineIntro);
  const [featuredPhotoId, setFeaturedPhotoId] = useState(album.settings.featuredPhotoId ?? '');
  const [apiBase, setApiBase] = useState(album.settings.worldApiBase);
  const [testId, setTestId] = useState(DEMO_LOOKUP_HINT);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [currentPass, setCurrentPass] = useState('');
  const [nextPass, setNextPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passError, setPassError] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [candidate, setCandidate] = useState<ParsedBackup | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  const [importError, setImportError] = useState('');
  const [danger, setDanger] = useState<DangerAction>(null);
  const [desktopPrefs, setDesktopPrefs] = useState<DesktopPreferences | null>(null);
  const [autoBackup, setAutoBackup] = useState<DesktopAutoBackupView | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!desktop || mobile || typeof desktop.app.getPreferences !== 'function') {
      setDesktopPrefs(null);
      return undefined;
    }
    let alive = true;
    void desktop.app
      .getPreferences()
      .then((preferences) => {
        if (alive) setDesktopPrefs(preferences);
      })
      .catch(() => {
        if (alive) setDesktopPrefs(null);
      });
    return () => {
      alive = false;
    };
  }, [desktop, mobile]);

  useEffect(() => {
    if (!desktop || mobile || typeof desktop.backup.getAutoConfig !== 'function') {
      setAutoBackup(null);
      return undefined;
    }
    let alive = true;
    const apply = (status: DesktopAutoBackupView) => {
      if (alive) setAutoBackup(status);
    };
    void desktop.backup
      .getAutoConfig()
      .then(apply)
      .catch(() => {
        if (alive) setAutoBackup(null);
      });
    const unsubscribe =
      typeof desktop.backup.onAutoStatus === 'function'
        ? desktop.backup.onAutoStatus(apply)
        : () => {};
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [desktop, mobile]);

  useEffect(() => {
    setSiteName(album.settings.siteName);
    setSiteNameEn(album.settings.siteNameEn);
    setTagline(album.settings.tagline);
    setTimelineIntro(album.settings.timelineIntro);
    setFeaturedPhotoId(album.settings.featuredPhotoId ?? '');
  }, [
    album.settings.siteName,
    album.settings.siteNameEn,
    album.settings.tagline,
    album.settings.timelineIntro,
    album.settings.featuredPhotoId,
  ]);

  useEffect(() => {
    setApiBase(album.settings.worldApiBase);
  }, [album.settings.worldApiBase]);

  const storageBytes = useMemo(() => estimateAlbumBytes(album.data), [album.data]);
  const appearanceIsDefault =
    album.settings.theme === DEFAULT_THEME &&
    album.settings.layout === DEFAULT_LAYOUT &&
    album.settings.backgroundEffect === DEFAULT_BACKGROUND &&
    !album.settings.experimentalEffects;

  const chooseTheme = (theme: ThemeId, name: string) => {
    if (album.settings.theme === theme) return;
    album.updateSettings({ theme });
    pushToast({ tone: 'success', title: '配色主题已应用', description: name });
  };

  const chooseLayout = (layout: LayoutId, name: string) => {
    if (album.settings.layout === layout) return;
    album.updateSettings({ layout });
    pushToast({ tone: 'success', title: '时间轴布局已应用', description: name });
  };

  const restoreAppearance = () => {
    album.updateSettings({
      theme: DEFAULT_THEME,
      layout: DEFAULT_LAYOUT,
      backgroundEffect: DEFAULT_BACKGROUND,
      experimentalEffects: false,
    });
    pushToast({ tone: 'success', title: '已恢复默认外观', description: '暮色紫 · 星轨交错 · 星轨' });
  };

  const toggleExperimental = (enabled: boolean) => {
    const fallback =
      !enabled && album.settings.backgroundEffect === 'blackhole'
        ? DEFAULT_BACKGROUND
        : album.settings.backgroundEffect;
    album.updateSettings({
      experimentalEffects: enabled,
      backgroundEffect: fallback,
    });
    pushToast({
      tone: enabled ? 'warning' : 'success',
      title: enabled ? '实验性背景已开启' : '实验性背景已关闭',
      description: enabled
        ? '「银河黑洞」已出现在背景特效中。GPU 占用较高，建议在桌面客户端使用。'
        : fallback !== album.settings.backgroundEffect
          ? '当前黑洞背景已切回星轨。'
          : '实验性背景选择已隐藏。',
    });
  };
  const sampleCount = album.photos.filter((photo) => photo.isSample).length;
  const builtinWorlds = album.worlds.filter((world) => world.builtin).length;
  const apiEnabled = Boolean(effectiveWorldApiBase(album.settings));
  const featuredPhotos = useMemo(
    () =>
      [...album.photos].sort(
        (a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
      ),
    [album.photos],
  );

  const siteDirty =
    siteName.trim() !== album.settings.siteName ||
    siteNameEn.trim() !== album.settings.siteNameEn ||
    tagline.trim() !== album.settings.tagline ||
    timelineIntro.trim() !== album.settings.timelineIntro ||
    (featuredPhotoId || null) !== album.settings.featuredPhotoId;

  const apiDirty = apiBase.trim().replace(/\/+$/, '') !== album.settings.worldApiBase;

  const saveSite = () => {
    if (!siteName.trim()) {
      pushToast({ tone: 'warning', title: '站点名称不能为空' });
      return;
    }
    album.updateSettings({
      siteName: siteName.trim(),
      siteNameEn: siteNameEn.trim() || DEFAULT_SETTINGS.siteNameEn,
      tagline: tagline.trim() || DEFAULT_SETTINGS.tagline,
      timelineIntro: timelineIntro.trim() || DEFAULT_SETTINGS.timelineIntro,
      featuredPhotoId: featuredPhotoId || null,
    });
    pushToast({ tone: 'success', title: '站点设置已保存', description: '公开相册会立即使用新的文案。' });
  };

  const restoreDefaultCopy = () => {
    setSiteName(DEFAULT_SETTINGS.siteName);
    setSiteNameEn(DEFAULT_SETTINGS.siteNameEn);
    setTagline(DEFAULT_SETTINGS.tagline);
    setTimelineIntro(DEFAULT_SETTINGS.timelineIntro);
  };

  const saveApi = () => {
    album.updateSettings({ worldApiBase: apiBase.trim().replace(/\/+$/, '') });
    setTestResult(null);
    pushToast({
      tone: 'success',
      title: '世界查询设置已保存',
      description: apiBase.trim()
        ? '新的查询会尝试使用后端代理。'
        : '已切换为本地世界资料库模式。',
    });
  };

  const testApi = async () => {
    const base = apiBase.trim().replace(/\/+$/, '');
    if (!base) {
      setTestResult({ ok: false, message: '请先填写后端代理地址。' });
      return;
    }
    const id = testId.trim();
    if (!id) {
      setTestResult({ ok: false, message: '请填写用于测试的 World ID。' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await lookupWorld(id, { apiBase: base, library: album.worlds });
      if (result.status === 'ok') {
        setTestResult({
          ok: true,
          message: `连接成功：${result.world.name}${result.world.author ? ` · ${result.world.author}` : ''}`,
        });
      } else {
        setTestResult({ ok: false, message: result.message });
      }
    } catch (caught) {
      setTestResult({
        ok: false,
        message: (caught as Error).message || '测试请求失败。',
      });
    } finally {
      setTesting(false);
    }
  };

  const exportBackup = async () => {
    if (desktop) {
      const result = await desktop.backup.exportFull();
      if (result.ok) {
        pushToast({
          tone: 'success',
          title: '完整库备份已导出',
          description: result.path,
        });
      } else if (!result.canceled) {
        pushToast({ tone: 'danger', title: '导出失败', description: result.error });
      }
      return;
    }
    downloadTextFile(backupFilename(), album.exportBackup());
    pushToast({ tone: 'success', title: '备份已导出', description: '请把 JSON 文件保存到安全的位置。' });
  };

  const exportMetadata = async () => {
    if (!desktop) {
      downloadTextFile(backupFilename(), album.exportBackup());
      pushToast({ tone: 'success', title: '备份已导出' });
      return;
    }
    const result = await desktop.backup.exportMetadata();
    if (result.ok) {
      pushToast({
        tone: 'success',
        title: '元数据备份已导出',
        description: result.path,
      });
    } else if (!result.canceled) {
      pushToast({ tone: 'danger', title: '导出失败', description: result.error });
    }
  };

  const prepareCandidate = async (text: string) => {
    const parsed = parseAlbumBackup(text);
    if (desktop) {
      // A web backup stores images as data URLs. Materialize them into the
      // current library so the imported album keeps working after the browser
      // storage is gone.
      const photos = [...parsed.data.photos];
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        if (!photo.src.startsWith('data:')) continue;
        const result = await desktop.media.importDataUrls([
          { name: photo.alt || `backup-${index}`, dataUrl: photo.src },
        ]);
        const draft = result.drafts[0];
        if (!draft) continue;
        photos[index] = {
          ...photo,
          src: draft.src,
          mediaKind: 'library',
          libraryPath: draft.libraryPath,
          previewPath: draft.previewPath,
          fileBytes: draft.fileBytes,
          contentHash: draft.contentHash,
          metaSource: photo.metaSource ?? draft.metaSource,
          isRemote: false,
          isUploaded: true,
          managedCopy: true,
        };
      }
      parsed.data.photos = photos;
    }
    setCandidate(parsed);
    setImportMode('replace');
  };

  const handleImportFile = async (file: File) => {
    setImportError('');
    if (file.size > 30 * 1024 * 1024) {
      setImportError('备份文件超过 30MB，无法导入。');
      return;
    }
    try {
      const text = await file.text();
      await prepareCandidate(text);
    } catch (caught) {
      setImportError((caught as Error).message || '无法读取这个备份文件。');
    }
  };

  const importBackup = async () => {
    if (!desktop) {
      importInput.current?.click();
      return;
    }
    setImportError('');
    const result = await desktop.backup.importFile();
    if (!result.ok) {
      if (!result.canceled) setImportError(result.error || '无法读取备份文件。');
      return;
    }
    if (result.restored) {
      pushToast({
        tone: 'success',
        title: '存储库已恢复',
        description: result.path,
      });
      return;
    }
    if (!result.text) {
      setImportError('备份文件中没有可导入的数据。');
      return;
    }
    try {
      await prepareCandidate(result.text);
    } catch (caught) {
      setImportError((caught as Error).message || '无法读取这个备份文件。');
    }
  };

  const confirmImport = () => {
    if (!candidate) return;
    album.importData(candidate.data, importMode);
    pushToast({
      tone: 'success',
      title: importMode === 'replace' ? '备份已恢复' : '备份已合并',
      description: `${candidate.data.photos.length} 张照片、${candidate.data.worlds.length} 条世界资料已处理。`,
    });
    setCandidate(null);
    setImportError('');
    if (importInput.current) importInput.current.value = '';
  };

  const changePassphrase = async () => {
    if (passBusy) return;
    setPassError('');
    if (nextPass !== confirmPass) {
      setPassError('两次输入的新口令不一致。');
      return;
    }
    setPassBusy(true);
    try {
      await auth.changePassphrase(currentPass, nextPass);
      setCurrentPass('');
      setNextPass('');
      setConfirmPass('');
      pushToast({ tone: 'success', title: '管理口令已更新' });
    } catch (caught) {
      setPassError((caught as Error).message || '更新口令失败。');
    } finally {
      setPassBusy(false);
    }
  };

  const updateDesktopPrefs = async (patch: Partial<DesktopPreferences>) => {
    if (!desktop || prefsBusy) return;
    setPrefsBusy(true);
    try {
      const result = await desktop.app.setPreferences(patch);
      setDesktopPrefs(result.preferences);
      pushToast({ tone: 'success', title: '应用行为已更新' });
    } catch (caught) {
      pushToast({
        tone: 'danger',
        title: '设置失败',
        description: (caught as Error).message || '请重试。',
      });
    } finally {
      setPrefsBusy(false);
    }
  };

  const updateAutoBackup = async (patch: {
    enabled?: boolean;
    intervalDays?: number;
    kind?: 'metadata' | 'full';
    retention?: number;
  }) => {
    if (!desktop || autoBusy) return;
    setAutoBusy(true);
    try {
      const result = await desktop.backup.setAutoConfig(patch);
      setAutoBackup(result.config);
      if (result.ok) {
        pushToast({ tone: 'success', title: '自动备份设置已更新' });
      } else {
        pushToast({
          tone: 'danger',
          title: '无法更新自动备份',
          description: result.error || '请检查备份文件夹。',
        });
      }
    } catch (caught) {
      pushToast({
        tone: 'danger',
        title: '设置失败',
        description: (caught as Error).message || '请重试。',
      });
    } finally {
      setAutoBusy(false);
    }
  };

  const chooseAutoBackupFolder = async () => {
    if (!desktop || autoBusy) return;
    setAutoBusy(true);
    try {
      const result = await desktop.backup.chooseAutoFolder();
      setAutoBackup(result.config);
      if (!result.ok && !result.canceled) {
        pushToast({
          tone: 'danger',
          title: '无法使用这个文件夹',
          description: result.error || '请选择一个存储库之外的位置。',
        });
      }
    } catch (caught) {
      pushToast({
        tone: 'danger',
        title: '选择文件夹失败',
        description: (caught as Error).message || '请重试。',
      });
    } finally {
      setAutoBusy(false);
    }
  };

  const runAutoBackupNow = async () => {
    if (!desktop || autoBusy) return;
    setAutoBusy(true);
    try {
      const result = await desktop.backup.runAutoNow();
      setAutoBackup(result.config);
      if (result.ok) {
        pushToast({
          tone: 'success',
          title: '自动备份已完成',
          description: `${formatBytes(result.bytes || 0)} · ${result.path || ''}`,
        });
      } else {
        pushToast({
          tone: 'danger',
          title: '自动备份失败',
          description: result.error || '请检查备份文件夹。',
        });
      }
    } catch (caught) {
      pushToast({
        tone: 'danger',
        title: '自动备份失败',
        description: (caught as Error).message || '请重试。',
      });
    } finally {
      setAutoBusy(false);
    }
  };

  const confirmDanger = () => {
    if (danger === 'samples') {
      album.clearSampleContent();
      pushToast({ title: '已移除起始内容', description: '你的照片与世界资料仍然保留。' });
    } else if (danger === 'photos') {
      album.clearAllPhotos();
      pushToast({ title: '已清空照片', description: '世界资料库与站点设置保留。' });
    } else if (danger === 'reset') {
      album.resetAlbum();
      pushToast({ title: '已恢复起始相册', description: '所有内容已重置为起始状态。' });
    }
    setDanger(null);
  };

  const dangerCopy = {
    samples: {
      title: '移除起始内容？',
      description: `将删除 ${sampleCount} 张起始照片，以及未被使用的 ${builtinWorlds} 条内置世界资料。你自己上传或编辑过的内容会保留。`,
      confirm: '移除起始内容',
    },
    photos: {
      title: '清空所有照片？',
      description: desktop
        ? `将移除 ${album.photos.length} 张照片记录，世界资料库与站点设置保留。原图仍留在存储库中；如需重新发现，请在存储库面板重置忽略列表。`
        : `将删除 ${album.photos.length} 张照片及其关联记录，世界资料库与站点设置会保留。此操作无法撤销。`,
      confirm: '清空照片',
    },
    reset: {
      title: '恢复起始相册？',
      description: '当前所有照片、世界资料、站点设置与操作记录都会被起始内容覆盖。请先导出备份。',
      confirm: '确认恢复',
    },
  };

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="SETTINGS · 站点设置"
        title="站点与数据"
        description="调整公开相册的文案、世界查询方式，并在这里完成备份、恢复与本地管理安全设置。"
      />


      <AdminPanel kicker="APPEARANCE" title="外观与布局" className="admin-appearance">
        <p className="admin-appearance__lede">
          配色与版式会立即保存并应用到公开相册；公开站头部的「外观」按钮也能直接切换。当前默认组合是「暮色紫 · 星轨交错」，原始样式完整保留。
        </p>

        <div className="appearance-block">
          <div className="appearance-block__head">
            <h4>
              <Palette size={15} aria-hidden="true" />
              配色主题
            </h4>
            <span>{THEMES.length} 套配色</span>
          </div>
          <div className="theme-grid">
            {THEMES.map((theme) => {
              const active = album.settings.theme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={`theme-card${active ? ' is-active' : ''}`}
                  onClick={() => chooseTheme(theme.id, theme.name)}
                  aria-pressed={active}
                >
                  <span
                    className="theme-card__preview"
                    style={{ background: theme.preview }}
                    aria-hidden="true"
                  >
                    <span className="theme-card__swatches">
                      {theme.swatches.map((swatch) => (
                        <i key={swatch} style={{ background: swatch }} />
                      ))}
                    </span>
                    {theme.id === DEFAULT_THEME ? (
                      <span className="theme-card__default">默认</span>
                    ) : null}
                  </span>
                  <span className="theme-card__body">
                    <strong>{theme.name}</strong>
                    <em>{theme.en}</em>
                    <small>{theme.description}</small>
                  </span>
                  {active ? (
                    <span className="theme-card__check" aria-hidden="true">
                      <Check size={13} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="appearance-block">
          <div className="appearance-block__head">
            <h4>
              <LayoutTemplate size={15} aria-hidden="true" />
              时间轴布局
            </h4>
            <span>公开相册</span>
          </div>
          <div className="layout-grid">
            {LAYOUTS.map((layout) => {
              const active = album.settings.layout === layout.id;
              return (
                <button
                  key={layout.id}
                  type="button"
                  className={`layout-card${active ? ' is-active' : ''}`}
                  onClick={() => chooseLayout(layout.id, layout.name)}
                  aria-pressed={active}
                >
                  <span
                    className={`layout-preview layout-preview--${layout.id}`}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="layout-card__body">
                    <strong>
                      {layout.name}
                      {layout.id === DEFAULT_LAYOUT ? <em>默认</em> : null}
                    </strong>
                    <small>{layout.description}</small>
                  </span>
                  {active ? (
                    <span className="theme-card__check" aria-hidden="true">
                      <Check size={13} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="appearance-block">
          <div className="appearance-block__head">
            <h4>
              <Sparkles size={15} aria-hidden="true" />
              背景特效
            </h4>
            <span>动态 / 自定义</span>
          </div>
          <BackgroundEffectPicker
            settings={album.settings}
            onChange={album.updateSettings}
            tone={themeTone(album.settings.theme)}
          />
          <label className="appearance-experimental">
            <input
              type="checkbox"
              checked={album.settings.experimentalEffects}
              onChange={(event) => toggleExperimental(event.target.checked)}
            />
            <span className="appearance-experimental__icon" aria-hidden="true">
              <FlaskConical size={15} />
            </span>
            <span className="appearance-experimental__copy">
              <strong>实验性背景</strong>
              <small>
                开启后才会显示「银河黑洞」等实验性特效；它们仍在调整中，GPU/显存占用较高，亮色主题下对比度可能不足。
              </small>
            </span>
          </label>
        </div>

        <div className="appearance-footer">
          <button
            type="button"
            className="text-button"
            onClick={restoreAppearance}
            disabled={appearanceIsDefault}
          >
            <RotateCcw size={13} />
            恢复默认外观
          </button>
          <a className="button button--ghost button--small" href="#/">
            预览公开相册
          </a>
        </div>
      </AdminPanel>

      {mobile ? (
        <AdminPanel kicker="LOCAL LIBRARY" title="手机本地相册">
          <p className="admin-panel__note">
            手机端照片保存在应用内，导入时自动生成缩略图；原文件仍保留在系统相册。桌面端的文件夹扫描与缩略图目录配置不适用于手机。
          </p>
        </AdminPanel>
      ) : (
        <LibraryPanel album={album} />
      )}

      <div className="admin-grid admin-grid--settings">
        <AdminPanel kicker="SITE IDENTITY" title="站点身份">
          <div className="admin-form">
            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label" htmlFor="settings-site-name">
                  中文名称
                </label>
                <div className="input-shell">
                  <input
                    id="settings-site-name"
                    value={siteName}
                    onChange={(event) => setSiteName(event.target.value)}
                    maxLength={40}
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="settings-site-name-en">
                  英文副标题
                </label>
                <div className="input-shell">
                  <input
                    id="settings-site-name-en"
                    value={siteNameEn}
                    onChange={(event) => setSiteNameEn(event.target.value)}
                    maxLength={60}
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="settings-tagline">
                  首页引言
                </label>
                <span className="char-count">{tagline.length}/240</span>
              </div>
              <textarea
                id="settings-tagline"
                className="note-textarea"
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
                rows={3}
                maxLength={240}
              />
              <p className="field-hint">支持换行，会显示在首页标题下方。</p>
            </div>

            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="settings-timeline-intro">
                  时光轴引言
                </label>
                <span className="char-count">{timelineIntro.length}/240</span>
              </div>
              <textarea
                id="settings-timeline-intro"
                className="note-textarea"
                value={timelineIntro}
                onChange={(event) => setTimelineIntro(event.target.value)}
                rows={2}
                maxLength={240}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="settings-featured">
                首页置顶照片
              </label>
              <select
                id="settings-featured"
                className="admin-select admin-select--wide"
                value={featuredPhotoId}
                onChange={(event) => setFeaturedPhotoId(event.target.value)}
              >
                <option value="">自动：最新收录</option>
                {featuredPhotos.map((photo) => (
                  <option key={photo.id} value={photo.id}>
                    {formatDateShort(photo.capturedAt)} · {photo.note.slice(0, 28) || '未写备注'}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                置顶照片会出现在公开相册首页开头的展示卡片里；留空则自动使用最新收录。
              </p>
            </div>

            <div className="admin-form__footer">
              <button type="button" className="text-button" onClick={restoreDefaultCopy}>
                <RotateCcw size={13} />
                恢复默认文案
              </button>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={saveSite}
                disabled={!siteDirty}
              >
                保存站点设置
              </button>
            </div>
          </div>
        </AdminPanel>

        <AdminPanel kicker="LIVE WORLD LOOKUP" title="世界查询代理">
          <div className="admin-form">
            <div className={`admin-status-line${apiEnabled ? ' is-live' : ''}`}>
              <span className="admin-status-line__dot" aria-hidden="true" />
              {apiEnabled ? '当前使用后端代理查询' : '当前使用本地世界资料库'}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="settings-api-base">
                代理地址（Base URL）
              </label>
              <div className="input-shell">
                <Globe2 size={15} aria-hidden="true" />
                <input
                  id="settings-api-base"
                  value={apiBase}
                  onChange={(event) => {
                    setApiBase(event.target.value);
                    setTestResult(null);
                  }}
                  placeholder="https://your-app.example.com/api"
                  spellCheck={false}
                />
              </div>
              <p className="field-hint">
                留空则使用本地资料库。代理需要实现
                <code className="admin-inline-code">GET /worlds/:worldId</code>，且不得在前端保存任何 VRChat
                凭据。
              </p>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="settings-test-id">
                测试 World ID
              </label>
              <div className="admin-test-row">
                <div className="input-shell">
                  <input
                    id="settings-test-id"
                    value={testId}
                    onChange={(event) => setTestId(event.target.value)}
                    placeholder="wrld_…"
                    spellCheck={false}
                    className="admin-mono-input"
                  />
                </div>
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={() => void testApi()}
                  disabled={testing}
                >
                  {testing ? <Loader2 size={14} className="spinner" /> : <RefreshCw size={14} />}
                  测试连接
                </button>
              </div>
            </div>

            {testResult ? (
              <p
                className={`admin-test-result${testResult.ok ? ' is-ok' : ' is-error'}`}
                role="status"
              >
                {testResult.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {testResult.message}
              </p>
            ) : null}

            <details className="admin-details">
              <summary>代理接口返回格式</summary>
              <pre>{`{
  "id": "wrld_…",
  "name": "世界名称",
  "authorName": "作者",
  "thumbnailUrl": "https://…",
  "description": "简介",
  "capacity": 32
}`}</pre>
            </details>

            <div className="admin-form__footer">
              <button type="button" className="text-button" onClick={() => setApiBase('')}>
                切换到本地资料库
              </button>
              <button
                type="button"
                className="button button--primary button--small"
                onClick={saveApi}
                disabled={!apiDirty}
              >
                保存查询设置
              </button>
            </div>
          </div>
        </AdminPanel>

        {mobile ? null : <NetworkPanel />}

        {desktop && !mobile && desktopPrefs ? (
          <AdminPanel kicker="DESKTOP" title="应用行为">
            <div className="admin-form">
              <label className="library-panel__checkbox">
                <input
                  type="checkbox"
                  checked={desktopPrefs.closeToTray}
                  onChange={(event) =>
                    void updateDesktopPrefs({ closeToTray: event.target.checked })
                  }
                  disabled={prefsBusy}
                />
                <span>关闭窗口时最小化到托盘</span>
              </label>
              <p className="field-hint">
                关闭窗口后，手机同步、自动导入与投送仍在后台运行；从托盘菜单选择「退出」才会完全退出。
              </p>
              <label className="library-panel__checkbox">
                <input
                  type="checkbox"
                  checked={desktopPrefs.launchAtLogin}
                  onChange={(event) =>
                    void updateDesktopPrefs({ launchAtLogin: event.target.checked })
                  }
                  disabled={prefsBusy}
                />
                <span>开机自动启动</span>
              </label>
              <p className="field-hint">
                仅打包后的 Windows 桌面客户端生效；开发模式不会注册启动项。
              </p>
            </div>
          </AdminPanel>
        ) : null}

        <AdminPanel kicker="DATA & BACKUP" title="数据与备份">
          <div className="admin-data-summary">
            <DataMini photos={album.photos.length} worlds={album.worlds.length} />
            <StorageMeter bytes={storageBytes} />
          </div>

          <div className="admin-action-grid">
            <button type="button" className="admin-action-card" onClick={() => void exportBackup()}>
              <Download size={18} aria-hidden="true" />
              <strong>{desktop ? '导出完整库备份' : '导出完整备份'}</strong>
              <span>
                {desktop ? '原图、预览与元数据（ZIP）' : '照片、世界、设置与操作记录'}
              </span>
            </button>
            {desktop ? (
              <button
                type="button"
                className="admin-action-card"
                onClick={() => void exportMetadata()}
              >
                <Database size={18} aria-hidden="true" />
                <strong>导出元数据</strong>
                <span>仅库元数据 JSON，体积很小</span>
              </button>
            ) : null}
            <button
              type="button"
              className="admin-action-card"
              onClick={() => {
                if (desktop) void importBackup();
                else importInput.current?.click();
              }}
            >
              <FileUp size={18} aria-hidden="true" />
              <strong>导入备份</strong>
              <span>{desktop ? '网页 JSON 或完整库 ZIP' : '替换现有数据或按 ID 合并'}</span>
            </button>
          </div>
          {desktop ? (
            <p className="field-hint">
              网页备份中的内嵌图片会写入当前存储库；完整库 ZIP 会恢复到指定文件夹并重新加载。
            </p>
          ) : null}

          {desktop && !mobile && autoBackup ? (
            <div className="auto-backup">
              <div className="auto-backup__head">
                <div>
                  <p className="field-label auto-backup__title">
                    <CalendarClock size={14} aria-hidden="true" />
                    自动备份计划
                  </p>
                  <p className="field-hint">
                    按计划静默导出到独立文件夹，只保留最近 {autoBackup.retention} 份；不会写入存储库或把旧备份再次打包。
                  </p>
                </div>
                <label className="library-panel__checkbox auto-backup__toggle">
                  <input
                    type="checkbox"
                    checked={autoBackup.enabled}
                    onChange={(event) =>
                      void updateAutoBackup({ enabled: event.target.checked })
                    }
                    disabled={autoBusy}
                  />
                  <span>{autoBackup.enabled ? '已启用' : '已关闭'}</span>
                </label>
              </div>

              <div className="auto-backup__grid">
                <div className="field">
                  <label className="field-label" htmlFor="auto-backup-interval">
                    备份频率
                  </label>
                  <select
                    id="auto-backup-interval"
                    className="admin-select"
                    value={autoBackup.intervalDays}
                    onChange={(event) =>
                      void updateAutoBackup({ intervalDays: Number(event.target.value) })
                    }
                    disabled={autoBusy}
                  >
                    <option value={1}>每天</option>
                    <option value={3}>每 3 天</option>
                    <option value={7}>每周</option>
                    <option value={14}>每两周</option>
                    <option value={30}>每 30 天</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="auto-backup-kind">
                    备份内容
                  </label>
                  <select
                    id="auto-backup-kind"
                    className="admin-select"
                    value={autoBackup.kind}
                    onChange={(event) =>
                      void updateAutoBackup({
                        kind: event.target.value === 'full' ? 'full' : 'metadata',
                      })
                    }
                    disabled={autoBusy}
                  >
                    <option value="metadata">仅元数据 JSON（快）</option>
                    <option value="full">完整库 ZIP（原图+预览）</option>
                  </select>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="auto-backup-retention">
                    保留份数
                  </label>
                  <select
                    id="auto-backup-retention"
                    className="admin-select"
                    value={autoBackup.retention}
                    onChange={(event) =>
                      void updateAutoBackup({ retention: Number(event.target.value) })
                    }
                    disabled={autoBusy}
                  >
                    <option value={2}>2 份</option>
                    <option value={3}>3 份</option>
                    <option value={5}>5 份</option>
                    <option value={10}>10 份</option>
                    <option value={20}>20 份</option>
                  </select>
                </div>
              </div>

              <p className="auto-backup__path" title={autoBackup.effectiveFolder}>
                <FolderOpen size={13} aria-hidden="true" />
                <span>
                  {autoBackup.effectiveFolder || '尚未选择备份位置'}
                  {autoBackup.usingDefaultFolder ? '（默认位置）' : ''}
                </span>
              </p>

              <div className="auto-backup__actions">
                <button
                  type="button"
                  className="button button--soft button--small"
                  onClick={() => void chooseAutoBackupFolder()}
                  disabled={autoBusy}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  更改位置
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => void runAutoBackupNow()}
                  disabled={autoBusy || autoBackup.running}
                >
                  {autoBackup.running ? (
                    <Loader2 size={14} className="spinner" aria-hidden="true" />
                  ) : (
                    <Play size={14} aria-hidden="true" />
                  )}
                  {autoBackup.running ? '备份中…' : '立即备份'}
                </button>
              </div>

              <p className="auto-backup__status">
                <span>
                  上次：{autoBackup.lastRunAt ? formatAdminDate(autoBackup.lastRunAt) : '尚未运行'}
                </span>
                <span>
                  {autoBackup.enabled
                    ? autoBackup.nextRunAt
                      ? `下次：${formatAdminDate(autoBackup.nextRunAt)}`
                      : '启用后将自动执行首次备份'
                    : '计划已暂停'}
                </span>
              </p>
              {autoBackup.lastError ? (
                <p className="field-error" role="alert">
                  {autoBackup.lastError}
                </p>
              ) : null}
            </div>
          ) : null}

          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImportFile(file);
            }}
          />
          {importError ? (
            <p className="field-error" role="alert">
              {importError}
            </p>
          ) : null}

          <div className="admin-danger-zone">
            <p className="field-label">危险操作</p>
            <div className="admin-danger-list">
              <div>
                <span>移除起始内容</span>
                <button
                  type="button"
                  className="text-button text-button--danger"
                  onClick={() => setDanger('samples')}
                  disabled={sampleCount === 0}
                >
                  {sampleCount} 张起始照片
                </button>
              </div>
              <div>
                <span>清空所有照片</span>
                <button
                  type="button"
                  className="text-button text-button--danger"
                  onClick={() => setDanger('photos')}
                  disabled={album.photos.length === 0}
                >
                  <Trash2 size={13} />
                  清空照片
                </button>
              </div>
              <div>
                <span>恢复起始相册</span>
                <button
                  type="button"
                  className="text-button text-button--danger"
                  onClick={() => setDanger('reset')}
                >
                  <RotateCcw size={13} />
                  完全重置
                </button>
              </div>
            </div>
          </div>
        </AdminPanel>

        <AdminPanel kicker="LOCAL ADMIN" title="管理口令">
          <div className="admin-form">
            <p className="admin-security-note">
              <ShieldCheck size={15} aria-hidden="true" />
              管理口令使用 PBKDF2 哈希保存在本浏览器，只用于阻止误入，不等同于服务器账号安全。
            </p>
            <div className="field">
              <label className="field-label" htmlFor="settings-current-pass">
                当前口令
              </label>
              <div className="input-shell">
                <Lock size={15} aria-hidden="true" />
                <input
                  id="settings-current-pass"
                  type="password"
                  value={currentPass}
                  onChange={(event) => setCurrentPass(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </div>
            <div className="admin-editor__row">
              <div className="field">
                <label className="field-label" htmlFor="settings-next-pass">
                  新口令
                </label>
                <div className="input-shell">
                  <KeyRound size={15} aria-hidden="true" />
                  <input
                    id="settings-next-pass"
                    type="password"
                    value={nextPass}
                    onChange={(event) => setNextPass(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="settings-confirm-pass">
                  再次输入
                </label>
                <div className="input-shell">
                  <KeyRound size={15} aria-hidden="true" />
                  <input
                    id="settings-confirm-pass"
                    type="password"
                    value={confirmPass}
                    onChange={(event) => setConfirmPass(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            </div>
            {passError ? (
              <p className="field-error" role="alert">
                {passError}
              </p>
            ) : null}
            <div className="admin-form__footer">
              <button type="button" className="text-button" onClick={auth.lock}>
                <Lock size={13} />
                立即锁定
              </button>
              <button
                type="button"
                className="button button--soft button--small"
                onClick={() => void changePassphrase()}
                disabled={passBusy || !currentPass || !nextPass}
              >
                {passBusy ? <Loader2 size={14} className="spinner" /> : null}
                更新口令
              </button>
            </div>
          </div>
        </AdminPanel>

        {mobile ? null : <UpdateCard />}
      </div>

      <AdminPanel kicker="STORAGE" title="存储概览">
        <div className="admin-storage-grid">
          <div>
            <span>照片</span>
            <strong>{album.photos.length}</strong>
          </div>
          <div>
            <span>世界资料</span>
            <strong>{album.worlds.length}</strong>
          </div>
          <div>
            <span>起始内容</span>
            <strong>{sampleCount}</strong>
          </div>
          <div>
            <span>{desktop ? '元数据体积' : '数据体积'}</span>
            <strong>{formatBytes(storageBytes)}</strong>
          </div>
          {desktop && library.stats ? (
            <>
              <div>
                <span>库原图</span>
                <strong>{formatBytes(library.stats.libraryBytes)}</strong>
              </div>
              <div>
                <span>预览缓存</span>
                <strong>{formatBytes(library.stats.previewBytes)}</strong>
              </div>
            </>
          ) : null}
          <div>
            <span>最近更新</span>
            <strong>{formatAdminDate(album.data.updatedAt)}</strong>
          </div>
        </div>
        <p className="admin-panel__note">
          <Database size={13} aria-hidden="true" />
          {desktop
            ? '桌面客户端使用独立存储库：元数据在库根目录，原图留在原文件夹，容量取决于磁盘。云盘与网站同步可在「云同步」页配置。'
            : '当前为本地优先模式。若要在多设备、多用户间共享相册，需要接入后端数据库、对象存储与账号权限系统。'}
        </p>
      </AdminPanel>

      {candidate ? (
        <Modal
          open
          onClose={() => {
            setCandidate(null);
            if (importInput.current) importInput.current.value = '';
          }}
          labelledBy="import-title"
          className="admin-modal admin-import-modal"
        >
          <div className="admin-import">
            <p className="section-kicker">RESTORE BACKUP</p>
            <h2 id="import-title">导入备份</h2>
            <p className="admin-import__lede">
              备份导出于 {formatAdminDate(candidate.exportedAt)}，包含 {candidate.data.photos.length} 张照片、
              {candidate.data.worlds.length} 条世界资料。
            </p>
            <div className="admin-import__options">
              <label className={`admin-radio${importMode === 'replace' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  data-autofocus
                />
                <span>
                  <strong>替换当前数据</strong>
                  <small>完整恢复备份，当前相册会被覆盖。</small>
                </span>
              </label>
              <label className={`admin-radio${importMode === 'merge' ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="import-mode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                <span>
                  <strong>合并数据</strong>
                  <small>按照片 ID 合并，保留当前设置，导入内容优先。</small>
                </span>
              </label>
            </div>
            {importMode === 'replace' ? (
              <p className="admin-import__warning">
                替换会覆盖当前照片、世界资料、设置与操作记录。建议先导出当前备份。
              </p>
            ) : null}
            <div className="admin-import__actions">
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => {
                  setCandidate(null);
                  if (importInput.current) importInput.current.value = '';
                }}
              >
                取消
              </button>
              <button type="button" className="button button--primary button--small" onClick={confirmImport}>
                开始导入
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        open={danger !== null}
        title={danger ? dangerCopy[danger].title : ''}
        description={danger ? dangerCopy[danger].description : ''}
        confirmLabel={danger ? dangerCopy[danger].confirm : '确认'}
        onConfirm={confirmDanger}
        onCancel={() => setDanger(null)}
      />
    </div>
  );
}
