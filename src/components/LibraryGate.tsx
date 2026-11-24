import { useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, FolderPlus, HardDrive, MapPin, Sparkles } from 'lucide-react';
import { useDesktopLibrary } from '../hooks/useDesktopLibrary';
import { BrandGlyph } from './BrandGlyph';
import { ThumbnailSetup } from './ThumbnailSetup';

/**
 * First-run welcome screen. Step 1 connects a plain folder; step 2 creates the
 * thumbnail cache inside it. The desktop client can still be used in sample
 * mode without a library.
 */
export function LibraryGate() {
  const {
    available,
    config,
    scanning,
    chooseLibrary,
    createLibrary,
    dismissOnboarding,
  } = useDesktopLibrary();
  const [busy, setBusy] = useState<'create' | 'choose' | null>(null);
  // Remains true after setup so the wizard can show the generation progress
  // even though the library config is already marked configured.
  const [thumbSetupActive, setThumbSetupActive] = useState(false);

  useEffect(() => {
    if (config?.configured && config.thumbnailsConfigured === false) {
      setThumbSetupActive(true);
    }
  }, [config?.configured, config?.thumbnailsConfigured]);

  if (!available) return null;
  if (!config) return null;
  if (config.unavailable) {
    return (
      <div className="library-gate" role="dialog" aria-modal="true" aria-labelledby="library-gate-title">
        <div className="library-gate__card library-gate__card--error">
          <span className="library-gate__mark is-error" aria-hidden="true">
            <AlertTriangle size={24} />
          </span>
          <p className="section-kicker">LIBRARY UNAVAILABLE</p>
          <h1 id="library-gate-title">存储库暂时不在</h1>
          <p className="library-gate__lede">
            上次使用的文件夹现在无法访问。可能是移动硬盘未连接、盘符变化，或文件夹被移动。
          </p>
          <p className="library-gate__path">{config.libraryPath}</p>
          <div className="library-gate__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => {
                setBusy('choose');
                void chooseLibrary().finally(() => setBusy(null));
              }}
            >
              <FolderOpen size={16} aria-hidden="true" />
              {busy === 'choose' ? '正在打开…' : '重新定位存储库'}
            </button>
            <button
              type="button"
              className="button button--soft"
              disabled={busy !== null}
              onClick={() => {
                setBusy('create');
                void createLibrary().finally(() => setBusy(null));
              }}
            >
              <FolderPlus size={16} aria-hidden="true" />
              换一个文件夹
            </button>
          </div>
          <button
            type="button"
            className="text-button library-gate__skip"
            onClick={() => void dismissOnboarding()}
          >
            先使用示例相册
          </button>
        </div>
      </div>
    );
  }

  if (config.configured) {
    // A connected library always finishes thumbnail setup before the album is
    // shown, so the grid never has to fall back to original files. The wizard
    // stays mounted through the generation progress until the user enters.
    if (!config.thumbnailsConfigured || thumbSetupActive) {
      return <ThumbnailSetup onComplete={() => setThumbSetupActive(false)} />;
    }
    return null;
  }

  if (config.onboardingDismissed) return null;

  return (
    <div className="library-gate" role="dialog" aria-modal="true" aria-labelledby="library-gate-title">
      <div className="library-gate__card">
        <span className="library-gate__mark" aria-hidden="true">
          <BrandGlyph size={30} />
        </span>
        <p className="section-kicker">STEP 1 / 2 · VRCHAT TIMELINE · LOCAL LIBRARY</p>
        <h1 id="library-gate-title">把你的照片库，交给时间轴纪念相册</h1>
        <p className="library-gate__lede">
          先选择一个文件夹作为存储库。原图留在原地；下一步会在这个文件夹里建立缩略图缓存，
          相册只读取缓存，点开单张照片时才读取原图。
        </p>

        <ul className="library-gate__points">
          <li>
            <HardDrive size={15} aria-hidden="true" />
            <span>原图不移动、不压缩，单张体积不设上限</span>
          </li>
          <li>
            <MapPin size={15} aria-hidden="true" />
            <span>自动读取照片内自带的拍摄时间与 World ID</span>
          </li>
          <li>
            <Sparkles size={15} aria-hidden="true" />
            <span>整个文件夹可以搬到另一台电脑继续使用</span>
          </li>
        </ul>

        <div className="library-gate__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy !== null || scanning}
            onClick={() => {
              setBusy('create');
              void createLibrary().finally(() => setBusy(null));
            }}
          >
            <FolderPlus size={16} aria-hidden="true" />
            {busy === 'create' ? '正在准备…' : '新建存储库'}
          </button>
          <button
            type="button"
            className="button button--soft"
            disabled={busy !== null || scanning}
            onClick={() => {
              setBusy('choose');
              void chooseLibrary().finally(() => setBusy(null));
            }}
          >
            <FolderOpen size={16} aria-hidden="true" />
            {busy === 'choose' ? '正在打开…' : '选择已有文件夹'}
          </button>
        </div>

        <button
          type="button"
          className="text-button library-gate__skip"
          onClick={() => void dismissOnboarding()}
        >
          先看看示例相册（不连接存储库）
        </button>
        <p className="library-gate__note">
          连接后可在管理台手动启用云盘或网站同步；不配置同步时不会上传任何照片或元数据。
        </p>
      </div>
    </div>
  );
}
