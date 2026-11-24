import { useEffect, useRef, type RefObject } from 'react';
import {
  Check,
  Grid3X3,
  LayoutGrid,
  LayoutList,
  Orbit,
  RotateCcw,
  X,
} from 'lucide-react';
import type { AlbumSettings, BackgroundEffectId, LayoutId, ThemeId } from '../types';
import {
  BACKGROUND_EFFECTS,
  DEFAULT_BACKGROUND,
  DEFAULT_LAYOUT,
  DEFAULT_THEME,
  LAYOUTS,
  THEMES,
  themeTone,
} from '../data/appearance';
import { BackgroundEffectPicker } from './BackgroundEffectPicker';

interface AppearancePanelProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeId;
  layout: LayoutId;
  backgroundEffect: BackgroundEffectId;
  customBackgroundSrc?: string;
  customBackgroundName?: string;
  customVideoKey?: string;
  customVideoName?: string;
  customVideoPoster?: string;
  customVideoBytes?: number;
  experimentalEffects: boolean;
  onChange: (patch: Partial<AlbumSettings>) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const LAYOUT_ICONS = {
  starlight: Orbit,
  gallery: LayoutGrid,
  ledger: LayoutList,
  sheet: Grid3X3,
} as const;

export function AppearancePanel({
  open,
  onClose,
  theme,
  layout,
  backgroundEffect,
  customBackgroundSrc,
  customBackgroundName,
  customVideoKey,
  customVideoName,
  customVideoPoster,
  customVideoBytes,
  experimentalEffects,
  onChange,
  triggerRef,
}: AppearancePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
      window.cancelAnimationFrame(frame);
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  const isDefault =
    theme === DEFAULT_THEME &&
    layout === DEFAULT_LAYOUT &&
    backgroundEffect === DEFAULT_BACKGROUND;
  const currentTheme = THEMES.find((item) => item.id === theme) ?? THEMES[0];
  const currentLayout = LAYOUTS.find((item) => item.id === layout) ?? LAYOUTS[0];
  const currentBackground =
    BACKGROUND_EFFECTS.find((item) => item.id === backgroundEffect) ?? BACKGROUND_EFFECTS[0];

  const close = () => {
    onClose();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div
      className="appearance-panel"
      id="appearance-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="appearance-panel-title"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="appearance-panel__head">
        <div>
          <p className="section-kicker">APPEARANCE</p>
          <h3 id="appearance-panel-title">外观与布局</h3>
        </div>
        <button
          type="button"
          className="icon-button icon-button--small"
          onClick={close}
          aria-label="关闭外观面板"
        >
          <X size={15} />
        </button>
      </div>
      <p className="appearance-panel__hint">
        切换会立即保存到当前浏览器，下次打开仍然保留。
      </p>

      <div className="quick-group">
        <span className="quick-group__label">配色主题</span>
        <div className="quick-themes">
          {THEMES.map((item) => {
            const active = item.id === theme;
            return (
              <button
                key={item.id}
                type="button"
                className={`quick-theme${active ? ' is-active' : ''}`}
                onClick={() => onChange({ theme: item.id })}
                aria-pressed={active}
                title={item.description}
              >
                <span
                  className={`quick-theme__swatch${item.tone === 'light' ? ' is-light' : ''}`}
                  style={{ background: item.preview }}
                  aria-hidden="true"
                >
                  {active ? <Check size={12} /> : null}
                </span>
                <span className="quick-theme__name">{item.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="quick-group">
        <span className="quick-group__label">时间轴布局</span>
        <div className="quick-layouts">
          {LAYOUTS.map((item) => {
            const active = item.id === layout;
            const Icon = LAYOUT_ICONS[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className={`quick-layout${active ? ' is-active' : ''}`}
                onClick={() => onChange({ layout: item.id })}
                aria-pressed={active}
                title={item.description}
              >
                <Icon size={15} strokeWidth={1.7} aria-hidden="true" />
                <span>{item.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="quick-group">
        <span className="quick-group__label">背景特效</span>
        <BackgroundEffectPicker
          settings={{
            backgroundEffect,
            experimentalEffects,
            customBackgroundSrc,
            customBackgroundName,
            customVideoKey,
            customVideoName,
            customVideoPoster,
            customVideoBytes,
          }}
          onChange={onChange}
          tone={themeTone(theme)}
          compact
        />
      </div>

      <div className="appearance-panel__footer">
        <button
          type="button"
          className="text-button"
          onClick={() =>
            onChange({
              theme: DEFAULT_THEME,
              layout: DEFAULT_LAYOUT,
              backgroundEffect: DEFAULT_BACKGROUND,
            })
          }
          disabled={isDefault}
        >
          <RotateCcw size={12} />
          恢复默认外观
        </button>
        <span className="quick-saved" aria-live="polite">
          <span aria-hidden="true" />
          自动保存 · {currentTheme.name} / {currentLayout.name} / {currentBackground.name}
        </span>
      </div>
    </div>
  );
}
