import { useState } from 'react';
import { ArrowUp, Database, HardDrive, Plus, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import { BrandGlyph } from './BrandGlyph';

interface FooterProps {
  siteName: string;
  siteNameEn: string;
  photoCount: number;
  worldApiEnabled: boolean;
  onUpload: () => void;
  onReset: () => void;
}

export function Footer({
  siteName,
  siteNameEn,
  photoCount,
  worldApiEnabled,
  onUpload,
  onReset,
}: FooterProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <footer className="site-footer" id="about">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <span className="footer-brand__mark" aria-hidden="true">
              <BrandGlyph size={22} />
            </span>
            <h2 className="footer-brand__name">{siteName}</h2>
            <p className="footer-brand__en">{siteNameEn} · MEMORY ARCHIVE</p>
            <p className="footer-brand__quote">
              「記憶は、星のように遠くて、すぐそこにある。」
            </p>
            <p className="footer-brand__text">
              一本属于 VRChat 旅人的时光相册。记录世界之间的相遇，也记录当时一起看风景的人。
            </p>
            <button type="button" className="button button--soft button--small" onClick={onUpload}>
              <Plus size={14} />
              再收录一段记忆
            </button>
          </div>

          <div className="footer-col">
            <p className="section-kicker">ABOUT THE ALBUM</p>
            <h3>关于这本相册</h3>
            <p>
              时间轴里的每一张照片都可以写下备注、关联 VRChat 世界，并在之后随时回来修改。
              目前共有 <strong>{photoCount}</strong> 段记忆被收藏在这里。
            </p>
            <ul className="footer-list">
              <li>
                <Sparkles size={14} aria-hidden="true" />
                按年 / 月浏览，搜索备注、世界或日期
              </li>
              <li>
                <Database size={14} aria-hidden="true" />
                世界识别封装为独立适配层
              </li>
              <li>
                <ShieldCheck size={14} aria-hidden="true" />
                无后端依赖，数据留在浏览器
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <p className="section-kicker">DATA & LOOKUP</p>
            <h3>资料与查询</h3>
            <div className={`footer-mode${worldApiEnabled ? ' is-live' : ''}`}>
              <span className="footer-mode__dot" aria-hidden="true" />
              {worldApiEnabled ? '后端代理已配置' : '本地资料库模式'}
            </div>
            <p>
              {worldApiEnabled
                ? '世界资料会通过已配置的后端代理获取，前端不保存任何私密凭据。'
                : '未配置世界查询代理，识别使用本地世界资料库；可在管理台新增、编辑或删除世界资料。'}
            </p>
            <p className="footer-storage">
              <HardDrive size={14} aria-hidden="true" />
              照片、备注与世界关联保存在 localStorage。
            </p>
            <div className="footer-reset">
              {confirmingReset ? (
                <div className="footer-reset__confirm">
                  <p>恢复起始相册会覆盖当前所有改动，确定吗？</p>
                  <div>
                    <button
                      type="button"
                      className="text-button text-button--danger"
                      onClick={() => {
                        onReset();
                        setConfirmingReset(false);
                      }}
                    >
                      确认恢复
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setConfirmingReset(false)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setConfirmingReset(true)}
                  >
                    <RotateCcw size={13} />
                    恢复起始相册
                  </button>
                  <a className="text-button footer-admin-link" href="#/admin">
                    <Sparkles size={13} />
                    进入管理台
                  </a>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>
            © {new Date().getFullYear()} {siteName} · 非官方 VRChat 同人作品，与 VRChat Inc. 无关联。
          </p>
          <p>
            起始照片与内置世界资料可在管理台清理；未配置查询代理时，世界资料来自本地世界资料库，
            不是实时 VRChat API 返回结果。
          </p>
          <a href="#top" className="footer-top">
            回到顶部
            <ArrowUp size={13} />
          </a>
        </div>
      </div>
    </footer>
  );
}
