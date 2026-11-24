import { useEffect, useState } from 'react';
import '../styles/admin.css';
import type { AlbumApi } from '../hooks/useAlbum';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { useToast } from '../hooks/useToast';
import { effectiveWorldApiBase } from '../data/settings';
import { Starfield } from '../components/Starfield';
import { UploadDialog } from '../components/UploadDialog';
import { AdminAuthScreen } from './AdminAuthScreen';
import { AdminShell } from './AdminShell';
import { DashboardPage } from './DashboardPage';
import { PhotosPage } from './PhotosPage';
import { WorldsPage } from './WorldsPage';
import { SettingsPage } from './SettingsPage';
import { AdvancedSettingsPage } from './advanced/AdvancedSettingsPage';
import { ActivityPage } from './ActivityPage';
import { SyncPage } from './SyncPage';

interface AdminAppProps {
  album: AlbumApi;
  route: string;
  navigate: (path: string) => void;
}

const PAGE_META: Record<string, { title: string; kicker: string }> = {
  '/admin': { title: '概览', kicker: 'OVERVIEW' },
  '/admin/photos': { title: '照片管理', kicker: 'PHOTOS' },
  '/admin/worlds': { title: '世界资料库', kicker: 'WORLDS' },
  '/admin/settings': { title: '站点设置', kicker: 'SETTINGS' },
  '/admin/sync': { title: '云同步', kicker: 'CLOUD SYNC' },
  '/admin/advanced': { title: '高级设置', kicker: 'ADVANCED' },
  '/admin/activity': { title: '操作记录', kicker: 'ACTIVITY' },
};

export function AdminApp({ album, route, navigate }: AdminAppProps) {
  const auth = useAdminAuth();
  const { pushToast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const apiEnabled = Boolean(effectiveWorldApiBase(album.settings));
  const meta = PAGE_META[route] ?? { title: '管理台', kicker: 'CONTROL ROOM' };

  useEffect(() => {
    document.title = `${meta.title} · ${album.settings.siteName} 管理台`;
  }, [meta.title, album.settings.siteName]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route, auth.unlocked]);

  if (!auth.unlocked) {
    return (
      <div className="admin-app admin-app--auth">
        <Starfield />
        <div className="atmosphere" aria-hidden="true" />
        <div className="grain" aria-hidden="true" />
        <AdminAuthScreen
          siteName={album.settings.siteName}
          siteNameEn={album.settings.siteNameEn}
          hasCredential={auth.hasCredential}
          onSetup={auth.setup}
          onLogin={auth.login}
          onResetCredential={auth.resetCredential}
        />
      </div>
    );
  }

  let page: React.ReactNode;
  if (route === '/admin') {
    page = <DashboardPage album={album} navigate={navigate} onUpload={() => setUploadOpen(true)} />;
  } else if (route === '/admin/photos') {
    page = (
      <PhotosPage
        album={album}
        onUpload={() => setUploadOpen(true)}
        onNavigateWorlds={() => navigate('/admin/worlds')}
      />
    );
  } else if (route === '/admin/worlds') {
    page = <WorldsPage album={album} />;
  } else if (route === '/admin/settings') {
    page = <SettingsPage album={album} auth={auth} />;
  } else if (route === '/admin/sync') {
    page = <SyncPage album={album} />;
  } else if (route === '/admin/advanced') {
    page = <AdvancedSettingsPage album={album} />;
  } else if (route === '/admin/activity') {
    page = <ActivityPage album={album} />;
  } else {
    page = (
      <div className="admin-page">
        <div className="admin-empty">
          <p className="admin-empty__title">这个管理页面不存在</p>
          <p className="admin-empty__text">返回概览，或从侧边栏选择其他页面。</p>
          <button
            type="button"
            className="button button--soft button--small"
            onClick={() => navigate('/admin')}
          >
            回到概览
          </button>
        </div>
      </div>
    );
  }

  return (
    <AdminShell
      siteName={album.settings.siteName}
      siteNameEn={album.settings.siteNameEn}
      route={route}
      title={meta.title}
      kicker={meta.kicker}
      worldApiEnabled={apiEnabled}
      storageError={album.storageError}
      onLock={auth.lock}
      onUpload={() => setUploadOpen(true)}
    >
      {page}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onAdd={(draft) => {
          const photo = album.addPhoto(draft);
          pushToast({
            tone: 'success',
            title: '照片已收录',
            description: photo.world
              ? `已自动关联世界「${photo.world.name}」。`
              : '可以在照片管理中继续完善备注与世界关联。',
          });
        }}
      />
    </AdminShell>
  );
}
