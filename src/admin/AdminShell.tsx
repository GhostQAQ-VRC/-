import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Cloud,
  Compass,
  Globe2,
  History,
  Images,
  LayoutDashboard,
  Lock,
  Menu,
  Plus,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { BrandGlyph } from '../components/BrandGlyph';
import { isMobileRuntime } from '../platform/mobileRuntime';

interface AdminShellProps {
  siteName: string;
  siteNameEn: string;
  route: string;
  title: string;
  kicker: string;
  worldApiEnabled: boolean;
  storageError: string | null;
  onLock: () => void;
  onUpload: () => void;
  children: ReactNode;
}

const NAV_ITEMS = [
  { path: '/admin', label: '概览', en: 'OVERVIEW', icon: LayoutDashboard },
  { path: '/admin/photos', label: '照片管理', en: 'PHOTOS', icon: Images },
  { path: '/admin/worlds', label: '世界资料库', en: 'WORLDS', icon: Globe2 },
  { path: '/admin/journey', label: '世界旅程', en: 'JOURNEY', icon: Compass },
  { path: '/admin/players', label: '玩家列表', en: 'PLAYERS', icon: Users },
  { path: '/admin/settings', label: '站点设置', en: 'SETTINGS', icon: Settings2 },
  { path: '/admin/sync', label: '云同步', en: 'CLOUD SYNC', icon: Cloud },
  { path: '/admin/mobile', label: '手机同步', en: 'MOBILE LINK', icon: Smartphone },
  { path: '/admin/advanced', label: '高级设置', en: 'ADVANCED', icon: SlidersHorizontal },
  { path: '/admin/activity', label: '操作记录', en: 'ACTIVITY', icon: History },
];

export function AdminShell({
  siteName,
  siteNameEn,
  route,
  title,
  kicker,
  worldApiEnabled,
  storageError,
  onLock,
  onUpload,
  children,
}: AdminShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const mobile = isMobileRuntime();
  const navItems = mobile
    ? NAV_ITEMS.filter((item) => item.path !== '/admin/mobile')
    : NAV_ITEMS;

  useEffect(() => {
    setNavOpen(false);
  }, [route]);

  return (
    <div className="admin-app">
      <div className="atmosphere" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <button
        type="button"
        className={`admin-scrim${navOpen ? ' is-open' : ''}`}
        aria-label="关闭导航"
        onClick={() => setNavOpen(false)}
      />

      <aside className={`admin-sidebar${navOpen ? ' is-open' : ''}`}>
        <div className="admin-sidebar__brand">
          <a className="admin-brand" href="#/admin" aria-label="管理台首页">
            <span className="admin-brand__mark" aria-hidden="true">
              <BrandGlyph size={20} />
            </span>
            <span className="admin-brand__text">
              <span className="admin-brand__name">{siteName}</span>
              <span className="admin-brand__sub">{siteNameEn}</span>
            </span>
          </a>
          <button
            type="button"
            className="icon-button icon-button--small admin-sidebar__close"
            onClick={() => setNavOpen(false)}
            aria-label="关闭导航"
          >
            <X size={16} />
          </button>
        </div>

        <div className="admin-sidebar__label">CONTROL ROOM</div>
        <nav className="admin-nav" aria-label="管理台导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = route === item.path;
            return (
              <a
                key={item.path}
                href={`#${item.path}`}
                className={`admin-nav__item${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
                <span>{item.label}</span>
                <span className="admin-nav__en">{item.en}</span>
              </a>
            );
          })}
        </nav>

        <div className="admin-sidebar__footer">
          <div className={`admin-mode${worldApiEnabled ? ' is-live' : ''}`}>
            <span className="admin-mode__dot" aria-hidden="true" />
            {worldApiEnabled ? '联网查询已启用' : '本地资料库模式'}
          </div>
          <a className="admin-sidebar__link" href="#/">
            <ArrowLeft size={14} aria-hidden="true" />
            返回相册
          </a>
          <button type="button" className="admin-sidebar__link" onClick={onLock}>
            <Lock size={14} aria-hidden="true" />
            锁定管理台
          </button>
          <p className="admin-sidebar__version">VRCHAT TIMELINE · ADMIN V2</p>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button
            type="button"
            className="icon-button admin-topbar__menu"
            onClick={() => setNavOpen(true)}
            aria-label="打开导航"
          >
            <Menu size={18} />
          </button>
          <div className="admin-topbar__title">
            <p className="section-kicker">{kicker}</p>
            <h1>{title}</h1>
          </div>
          <div className="admin-topbar__actions">
            <span className={`admin-mode-pill${worldApiEnabled ? ' is-live' : ''}`}>
              <span aria-hidden="true" />
              {worldApiEnabled ? '联网查询' : '本地资料库'}
            </span>
            <button type="button" className="button button--primary button--small" onClick={onUpload}>
              <Plus size={15} aria-hidden="true" />
              <span className="admin-hide-sm">收录照片</span>
            </button>
            <a className="button button--ghost button--small admin-return" href="#/">
              <ArrowLeft size={14} aria-hidden="true" />
              <span className="admin-hide-sm">返回相册</span>
            </a>
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={onLock}
              aria-label="锁定管理台"
              title="锁定管理台"
            >
              <Lock size={15} />
            </button>
          </div>
        </header>

        <main className="admin-content" id="admin-content">
          {storageError ? (
            <div className="admin-alert" role="status">
              {storageError}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
