import '../../styles/advanced.css';
import type { AlbumApi } from '../../hooks/useAlbum';
import { getDesktopBridge } from '../../platform';
import { AdminPageHead, AdminPanel } from '../AdminUI';
import { AiPanel } from './AiPanel';
import { EasyTierPanel } from './EasyTierPanel';
import { TransferPanel } from './TransferPanel';

export function AdvancedSettingsPage({ album }: { album: AlbumApi }) {
  const desktop = Boolean(getDesktopBridge());

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="ADVANCED · 高级设置"
        title="组网、传图与 AI"
        description="通过 EasyTier 虚拟组网把原图 P2P 发给好友，并让视觉模型为照片生成回忆总结。所有密钥只保存在本机。"
      />

      {!desktop ? (
        <AdminPanel kicker="DESKTOP ONLY" title="仅桌面客户端可用">
          <p className="admin-panel__note">
            图片传输、EasyTier 组网与 AI 图像总结需要在桌面客户端中使用；网页版不加载这些隐私设置。
          </p>
        </AdminPanel>
      ) : (
        <>
          <EasyTierPanel />
          <TransferPanel album={album} />
          <AiPanel album={album} />
          <AdminPanel kicker="SAFETY" title="使用提醒">
            <ul className="advanced-safety">
              <li>AI Key、网络密钥与传图分享码使用系统加密保存在本机，不随存储库迁移。</li>
              <li>P2P 传图仅应在可信的 EasyTier 网络中使用；分享码只发给信任的好友。</li>
              <li>AI 生成会把照片预览与备注发送给你配置的 API，可能产生费用。</li>
              <li>只有支持图片输入的视觉模型才能生成总结；本地判断仅供参考，可手动确认。</li>
            </ul>
          </AdminPanel>
        </>
      )}
    </div>
  );
}
