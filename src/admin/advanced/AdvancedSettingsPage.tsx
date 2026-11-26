import '../../styles/advanced.css';
import type { AlbumApi } from '../../hooks/useAlbum';
import { getDesktopBridge } from '../../platform';
import { isMobileRuntime } from '../../platform/mobileRuntime';
import { AdminPageHead, AdminPanel } from '../AdminUI';
import { AiPanel } from './AiPanel';
import { EasyTierPanel } from './EasyTierPanel';
import { TransferPanel } from './TransferPanel';

export function AdvancedSettingsPage({ album }: { album: AlbumApi }) {
  const desktop = Boolean(getDesktopBridge());
  const mobile = isMobileRuntime();

  return (
    <div className="admin-page">
      <AdminPageHead
        kicker="ADVANCED · 高级设置"
        title={mobile ? 'AI 与移动端设置' : '组网、传图与 AI'}
        description={
          mobile
            ? '手机端保留 AI 图像总结、AI 识图与方向检测；EasyTier 组网和 P2P 传图属于桌面网络能力，不在此显示。'
            : '通过 EasyTier 虚拟组网把原图 P2P 发给好友，并让视觉模型为照片生成回忆总结。所有密钥只保存在本机。'
        }
      />

      {!desktop ? (
        <AdminPanel kicker="DESKTOP ONLY" title="仅桌面客户端可用">
          <p className="admin-panel__note">
            图片传输、EasyTier 组网与 AI 图像总结需要在桌面客户端中使用；网页版不加载这些隐私设置。
          </p>
        </AdminPanel>
      ) : (
        <>
          {mobile ? null : <EasyTierPanel />}
          {mobile ? null : <TransferPanel album={album} />}
          <AiPanel album={album} />
          <AdminPanel kicker="SAFETY" title="使用提醒">
            <ul className="advanced-safety">
              <li>AI Key 使用 Android 加密存储保存在本机，不随相册迁移。</li>
              {mobile ? null : (
                <li>P2P 传图仅应在可信的 EasyTier 网络中使用；分享码只发给信任的好友。</li>
              )}
              <li>AI 生成会把照片预览与备注发送给你配置的 API，可能产生费用。</li>
              <li>只有支持图片输入的视觉模型才能生成总结；本地判断仅供参考，可手动确认。</li>
            </ul>
          </AdminPanel>
        </>
      )}
    </div>
  );
}
