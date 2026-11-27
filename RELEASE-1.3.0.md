# 时光轴相册 v1.3.0 · 第二批功能（含 1.2.0 第一批）

> 生成时间：2026-11-27
> 版本：**1.3.0**（功能版本，累积两批）
> 基线：1.1.3（第二轮安全加固）
> 说明：1.2.0 作为第一批功能只在本机构建，未单独发布；**1.3.0 包含 1.2.0 + 第二批全部功能**。
>
> **状态：1.3.0 未单独发布，功能已并入 1.4.0，见 [RELEASE-1.4.0.md](RELEASE-1.4.0.md)。**

---

## 一、第二批新增（6 项）

### 手机端

**M4 本地相册备份 / 恢复**
- 设置 →「数据与备份」在手机上真正可用：
  - **导出元数据**：`ACTION_CREATE_DOCUMENT` 选择位置，写入备份 JSON。
  - **导出完整库备份**：`album.json` + `originals/` + `previews/` 打成 ZIP，经系统文件选择器保存。
  - **导入备份**：`ACTION_OPEN_DOCUMENT` 选择 JSON / ZIP；ZIP 自动解压回 `mobile-library`，读取 `album.json` 后进入现有的替换/合并确认流程。
- 安全：ZIP 只接受 `album.json`、`originals/`、`previews/`；zip-slip canonical 校验；最多 20,000 条目 / 解压后 2GB；JSON 上限 30MB。
- 原图解码失败时不再先落入 `originals/`（先校验临时文件，成功后才移动）。

**M5 系统分享入口**
- 其他 App（相册、微信等）分享图片到本 App：`ACTION_SEND` / `ACTION_SEND_MULTIPLE`（仅 `image/*`）。
- 原生导入到私有相册 → 生成缩略图 → 通过 `library:imported` 同款草稿合并进时间轴；重复内容哈希自动跳过。
- 若分享时处于配对电脑页，会自动回到本地相册；锁屏状态仍会先要求解锁。

**M6 应用锁**
- 设备设置了锁屏密码时，启动本地相册、从后台返回超过 10 秒、或从电脑页返回本地时，使用系统设备凭据（PIN/图案/密码，支持设备生物识别）解锁。
- 锁定时显示不透明遮罩，`FLAG_SECURE` 阻止截图/最近任务快照；解开后恢复。
- 无锁屏密码的设备不强制锁定；打开扫码/文件选择器不会触发误锁。

### PC 端

**P4 库健康检查**
- 存储库设置新增「库健康检查」：
  - 缺失原图、未引用缩略图、重复相册路径、快速哈希重复、回收站占用；
  - 只读诊断；可安全清理孤儿缩略图、清空回收站（二次确认）、从相册移除缺失记录；
  - 不会删除任何仍被引用的原图或缩略图。

**P5 幻灯片 / 今日回忆 + Windows 壁纸**
- 顶栏新增幻灯片按钮：全屏轮播、Ken Burns 动效、播放/暂停、上一张/下一张、随机、4/6/10/15 秒间隔、照片信息、进度条。
- 「今天」模式自动筛出往年同月同日的回忆；没有时提示切回全部。
- 详情页新增「设为壁纸」（Windows 桌面端）：sharp 转 JPEG（2560 内）→ 写入 userData/wallpapers → PowerShell `SystemParametersInfo`；唯一文件名避免旧文件被系统锁定。

**P6 托盘 / 开机自启 / 关闭到托盘**
- 系统托盘菜单：显示主窗口、扫描存储库、导入照片、打开设置、退出。
- 默认「关闭窗口时最小化到托盘」，后台手机同步、自动导入、投送继续运行；窗口启用 `backgroundThrottling: false`，隐藏时仍能处理导入事件与保存。
- 「开机自动启动」写入 `app.setLoginItemSettings`（仅打包后的 Windows 客户端生效）。
- 托盘图标作为 `dist/tray-icon.png` 打包并在 asarUnpack 中保留；托盘创建在打包后冒烟中验证通过。

---

## 二、1.2.0 第一批（已包含在 1.3.0）

- M1 手机 → 电脑回传（认证端点、magic-byte、去重、原生 OkHttp 流式上传）
- M2 投送通知 + 后台 SSE 保活
- M3 手机本地相册多选/批量保存/分享/删除
- P1 监视文件夹自动导入
- P2 重复照片完整 SHA-256 检测 + 回收站
- P3 批量编辑 + 用户标签/收藏/智能相册

详见 [RELEASE-1.2.0.md](RELEASE-1.2.0.md)。

---

## 三、验证结果

| 验证项 | 结果 |
|---|---|
| `npm run test:desktop` | **60/60 通过**（新增 health 回归；连续多轮通过） |
| `npm run build` | 通过（TS + Vite 双入口） |
| 桌面冒烟 | exit 0，**28 张截图** + 新面板/健康扫描/收藏持久化/批量编辑/幻灯片断言 |
| 打包后 EXE 冒烟 | exit 0，28 张截图 + **托盘创建成功**（`[desktop] tray ready`） |
| Android `assembleRelease` | BUILD SUCCESSFUL |
| APK 校验 | `com.hoshikuzu.mobile` / versionCode **7** / 1.3.0 / minSdk 26 / targetSdk 34 |
| APK 内前端 | `1.3.0-mobile` |
| 托盘图标 | `app.asar.unpacked/dist/tray-icon.png` 存在 |

**新增回归**：
- `desktop/services/__tests__/health.test.cjs`：缺失/孤儿缩略图/重复路径/重复哈希/回收站统计，清理只删孤儿，清空回收站；
- 既有 60 项测试全部通过。

---

## 四、产物与 SHA-256

| 资产 | 本地路径 | 大小 | SHA-256 |
|---|---|---|---|
| 桌面安装版 | `release/VRchat时间轴纪念相册-1.3.0-x64.exe` | 126 MB | `1e2d42def1fc35b71ed0923021b0d0bf5f619efe8d51fb69c9e817e775434240` |
| 桌面便携版 | `release/VRchat-Timeline-Album-1.3.0-portable.exe` | 115 MB | `16a895fe2876b01dd1f0a0392a3adcdce79e6c253248bfbb65c7e1507253dc23` |
| Android APK | `mobile-android/apk/VRchat-Timeline-Album-Mobile-1.3.0.apk` | 4.5 MB | `29a7e4ab16a7bc3670dfefcddbe4754d64aa8aebf1962925d19c57493301251a` |

> 发布时建议把安装版重命名为 `VRchat-Timeline-Album-1.3.0-x64-setup.exe`，与应用内更新检查匹配。

---

## 五、已知限制 / 待真机验证

1. **手机功能仍未真机验证**：回传、系统分享、备份/恢复、设备凭据锁、投送通知均通过 TypeScript/Java 编译与共享前端构建；本机无可用模拟器。
2. **应用锁依赖设备已有锁屏密码**；无锁屏的设备无法启用。未接入独立 App PIN（后续可加 BiometricPrompt/PIN 兜底）。
3. **备份 ZIP 导出无进度条**；大库可能在系统文件选择器出现前等待较久（JS 超时 5 分钟）。
4. **ZIP 导入直接解压到 `mobile-library`**，若压缩包中途损坏会留下部分文件；album.json 缺失会报错，不会替换相册。
5. **M2 后台保活不是前台服务**：厂商省电策略仍可能杀进程；通知权限被拒绝时只有应用内浮层。
6. **P5 壁纸**只在 Windows 生效；sharp 不支持的格式（如部分 HEIC）会报错。未在自动化中实际修改桌面壁纸（避免影响当前桌面）。
7. **P6 托盘/开机自启**：托盘创建已在打包冒烟中验证；开机自启仅在打包客户端生效，未做真实重启验证。
8. **P2 回收站**暂无 App 内恢复 UI，需要在 `.hoshikuzu/trash` 手动找回。
9. 安装包/APK 仍未代码签名；APK 为 debug key 的 release 变体，可直接覆盖 1.2.0/1.1.x 同签名版本。
10. **Robolectric / 真机**仍未跑通；Android 原生路径需要一台真实设备做最终点击验证。

---

## 六、一句话结论

**1.3.0 在 1.2.0 六项功能之上补齐手机备份恢复、系统分享、应用锁，以及桌面健康检查、幻灯片/今日回忆、壁纸、托盘/自启；60 项测试、桌面与打包后冒烟（含托盘）、Android release 构建全部通过，产物已就绪，等待发布确认。**
