import { useEffect, useState } from 'react';
import { Copy, HardDrive, Minus, ScanLine, Square, X } from 'lucide-react';
import { getDesktopBridge } from '../platform';
import { useDesktopLibrary, useDesktopLibraryActivity } from '../hooks/useDesktopLibrary';
import { PROGRAM_NAME } from '../data/branding';
import { BrandGlyph } from './BrandGlyph';

/**
 * Frameless-window title bar. Only rendered inside the Electron client; the web
 * build keeps the native browser chrome.
 */
export function DesktopTitleBar() {
  const bridge = getDesktopBridge();
  const { config, scanning } = useDesktopLibrary();
  const { progress } = useDesktopLibraryActivity();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.window.isMaximized().then(setMaximized);
    return bridge.window.onMaximizedChange(setMaximized);
  }, [bridge]);

  if (!bridge) return null;

  const libraryLabel = config?.libraryName || (config?.libraryPath ? '存储库未初始化' : '未连接存储库');
  const libraryTitle = config?.libraryPath || '尚未选择存储库文件夹';

  return (
    <div
      className="titlebar"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        bridge.window.toggleMaximize();
      }}
    >
      <div className="titlebar__brand">
        <span className="titlebar__mark" aria-hidden="true">
          <BrandGlyph size={15} />
        </span>
        <span className="titlebar__name" title={PROGRAM_NAME}>
          {PROGRAM_NAME}
        </span>
        <span className="titlebar__divider" aria-hidden="true" />
        <span
          className={`titlebar__library${config?.configured ? '' : ' is-empty'}`}
          title={libraryTitle}
        >
          <HardDrive size={11} aria-hidden="true" />
          {libraryLabel}
        </span>
      </div>

      <div className="titlebar__drag" aria-hidden="true" />

      <div className="titlebar__status" aria-live="polite">
        {scanning ? (
          <span className="titlebar__scan">
            <ScanLine size={12} className="titlebar__spin" aria-hidden="true" />
            扫描中{progress?.total ? ` ${progress.current}/${progress.total}` : '…'}
          </span>
        ) : null}
        {!scanning && config?.unavailable ? (
          <span className="titlebar__scan is-warning">存储库不可用</span>
        ) : null}
      </div>

      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__button"
          onClick={() => bridge.window.minimize()}
          aria-label="最小化"
          title="最小化"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="titlebar__button"
          onClick={() => bridge.window.toggleMaximize()}
          aria-label={maximized ? '还原窗口' : '最大化'}
          title={maximized ? '还原窗口' : '最大化'}
        >
          {maximized ? <Copy size={12} strokeWidth={1.8} /> : <Square size={11} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className="titlebar__button is-close"
          onClick={() => bridge.window.close()}
          aria-label="关闭"
          title="关闭"
        >
          <X size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
