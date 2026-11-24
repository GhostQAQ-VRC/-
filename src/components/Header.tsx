import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { LayoutDashboard, Palette, Plus, Search, Sparkles } from 'lucide-react';
import { BrandGlyph } from './BrandGlyph';
import { StarGlyph } from './StarGlyph';

interface HeaderProps {
  siteName: string;
  siteNameEn: string;
  onUpload: () => void;
  onFocusSearch: () => void;
  onToggleAppearance: () => void;
  appearanceOpen: boolean;
  appearanceButtonRef: RefObject<HTMLButtonElement | null>;
  worldApiEnabled: boolean;
}

export function Header({
  siteName,
  siteNameEn,
  onUpload,
  onFocusSearch,
  onToggleAppearance,
  appearanceOpen,
  appearanceButtonRef,
  worldApiEnabled,
}: HeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        setScrolled(window.scrollY > 28);
        frame = 0;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="container header-inner">
        <a className="brand" href="#top" aria-label={`${siteName} · 回到顶部`}>
          <span className="brand__mark" aria-hidden="true">
            <BrandGlyph size={34} />
          </span>
          <span className="brand__text">
            <span className="brand__name">{siteName}</span>
            <span className="brand__sub">{siteNameEn}</span>
          </span>
        </a>

        <nav className="site-nav" aria-label="主导航">
          <a href="#timeline">时光轴</a>
          <a href="#about">关于相册</a>
        </nav>

        <div className="header-actions">
          <button
            type="button"
            ref={appearanceButtonRef}
            className={`header-appearance${appearanceOpen ? ' is-open' : ''}`}
            onClick={onToggleAppearance}
            aria-expanded={appearanceOpen}
            aria-controls="appearance-panel"
            aria-label="外观与布局"
            title="外观与布局"
          >
            <Palette size={15} strokeWidth={1.7} aria-hidden="true" />
            <span className="header-appearance__label">外观</span>
          </button>
          <span
            className={`mode-chip${worldApiEnabled ? ' mode-chip--live' : ''}`}
            title={
              worldApiEnabled
                ? '世界资料经由已配置的后端代理查询。'
                : '未配置世界查询代理，识别使用本地世界资料库。'
            }
          >
            <span className="mode-chip__dot" aria-hidden="true" />
            {worldApiEnabled ? '联网查询' : '本地资料库'}
          </span>
          <a
            className="icon-button header-admin"
            href="#/admin"
            aria-label="进入管理台"
            title="管理台"
          >
            <LayoutDashboard size={17} strokeWidth={1.7} />
          </a>
          <button
            type="button"
            className="icon-button header-search"
            onClick={onFocusSearch}
            aria-label="搜索照片"
            title="搜索照片（按 / 键）"
          >
            <Search size={18} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="button button--primary header-upload"
            onClick={onUpload}
            aria-label="收录照片"
          >
            <Plus size={17} strokeWidth={2} aria-hidden="true" />
            <span className="header-upload__label">收录照片</span>
          </button>
        </div>
      </div>
      <div className="header-star" aria-hidden="true">
        <StarGlyph size={11} />
        <span />
        <Sparkles size={11} />
      </div>
    </header>
  );
}
