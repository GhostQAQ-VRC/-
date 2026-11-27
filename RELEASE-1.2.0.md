# 时光轴相册 v1.2.0 · 手机客户端优化 + PC 新功能

> 生成时间：2026-11-27
> 版本：**1.2.0**（功能版本）
> 基线：1.1.3（第二轮安全加固）
>
> **状态：1.2.0 未单独发布，功能已并入 1.3.0，见 [RELEASE-1.3.0.md](RELEASE-1.3.0.md)。**

---

## 一、本轮交付（第一批 6 项）

### 手机端

**M1 手机 → 电脑回传**
- 手机本地相册进入多选模式后，可把原图回传到已配对的电脑。
- 桌面新增认证端点 `POST /api/mobile/upload`：
  - 只接受配对会话 Cookie；
  - 200MB/张上限、Content-Length 校验；
  - 复用 `ingest.importReceivedFile` 的 magic-byte 校验与内容哈希去重；
  - 导入到 `_inbox/transfer/<日期>/`，通过 `library:imported` 事件交给渲染进程并入相册。
- Android 新增 `uploadManaged` 原生桥：OkHttp 流式上传 + 配对 Cookie，不经过 base64。
- 上传后桌面时间轴即时出现新照片并弹 toast；重复照片自动跳过。

**M2 投送通知 + 后台保活**
- Android 新增通知渠道「电脑投送」，锁屏/切后台收到投送时发系统通知（文字 + 震动），点开回到 App。
- 权限：`POST_NOTIFICATIONS`（Android 13+ 启动时请求）、`VIBRATE`。
- 后台时不再 `pauseTimers()`（仅远程相册模式），SSE 连接可短时间保持；重连仍由 EventSource 负责。
- 最近一次投送写入 localStorage（10 分钟 TTL），从通知返回或 WebView 重载后仍能看到投送浮层。

**M3 手机本地相册批量管理**
- 右上角新增「多选」按钮；照片卡片点击切换选择。
- 底部批量栏：保存到系统相册、系统分享、回传电脑、删除。
- 原生新增：
  - `saveManaged`：从 App 私有 `mobile-library/originals` 直接写入 MediaStore / Downloads；
  - `shareManaged`：FileProvider + `ACTION_SEND(_MULTIPLE)` 系统分享面板；
  - `deleteManaged` 配合相册删除，清理不再被引用的原图/缩略图。
- 详情页新增「保存到手机」「分享」按钮。
- 删除照片时只在同一内容哈希不再被其他记录引用时才清理文件。

### PC 端

**P1 监视文件夹自动导入**
- 存储库设置新增「自动导入截图文件夹」。
- `fs.watch(recursive)` + 30 秒安全轮询（掉线/休眠后仍能补扫）。
- 新截图复制到 `_inbox/<日期>`，源文件保留；quick-hash 去重，已忽略的照片不会复活。
- 监视目录不能位于存储库内部，也不能包含存储库（防止自我复制）。
- 单次最多导入 80 张，超出自动续扫；导入后走 `library:imported` 即时入库。

**P2 重复照片检测 / 回收站**
- 存储库设置新增「扫描重复照片」。
- 按**完整文件 SHA-256** 分组（不是采样哈希），显示每组缩略图、大小、可回收空间。
- 每组可选择保留哪一张，其余移入 `.hoshikuzu/trash/<时间戳>/<原相对路径>`，不永久删除。
- 保护：同一路径仍被其他相册记录引用时拒绝移动。
- 处理成功后自动从相册移除对应记录。

**P3 批量编辑 + 用户标签 / 收藏 / 智能相册**
- 照片管理批量栏新增「批量编辑」：
  - 改世界（或清除关联）、改拍摄日期、追加备注、添加标签、清空标签、收藏/取消收藏；
  - 留空字段不覆盖原数据。
- 用户标签：详情页可添加/移除（最多 20 个、每个 24 字），搜索和筛选均包含标签。
- 收藏：详情页、照片卡片、管理表格均可一键收藏；新增「只看收藏 / 未收藏」筛选。
- 智能相册：把当前搜索、世界、来源、排序、标签、收藏筛选保存为命名预设（最多 20 个），一键恢复。
- 智能相册与标签/收藏写入 `hoshikuzu-library.json`，随备份导入导出。

---

## 二、验证结果

| 验证项 | 结果 |
|---|---|
| `npm run test:desktop` | **59/59 通过**（新增手机回传、自动导入、重复检测回归） |
| `npm run build` | 通过（TS + Vite 双入口） |
| `npm run desktop:smoke` | exit 0，27 张截图全链路 + 新面板/批量编辑/收藏持久化断言 |
| 打包后 EXE 冒烟 | exit 0，27 张截图 + 新面板/批量编辑断言（asar 内 sharp/Electron 45） |
| Android `assembleRelease` | BUILD SUCCESSFUL |
| APK 校验 | `com.hoshikuzu.mobile` / versionCode **6** / 1.2.0 / minSdk 26 / targetSdk 34 |
| APK 内前端 | `1.2.0-mobile` |
| `npm audit --omit=dev` | high: 0，moderate: 5（archiver 链，当前用法不可触发） |

**新增测试**：
- `desktop/services/__tests__/mobile-sync.test.cjs`：手机上传导入、去重、MZ 伪装拒绝、未授权 401；
- `desktop/services/__tests__/auto-import.test.cjs`：自动导入一次、源文件保留、重复不导入、目录包含校验；
- `desktop/services/__tests__/duplicates.test.cjs`：完整哈希分组、回收站移动、保留文件不丢。

---

## 三、产物与 SHA-256

| 资产 | 本地路径 | 大小 | SHA-256 |
|---|---|---|---|
| 桌面安装版 | `release/VRchat时间轴纪念相册-1.2.0-x64.exe` | 126 MB | `e4a70e5330452934519d20c825a395c2e981f43154a16d1b98cc3b43655d1b6d` |
| 桌面便携版 | `release/VRchat-Timeline-Album-1.2.0-portable.exe` | 115 MB | `b6a14591cdc7c3354e9cdf05bd1f8f9a087b5e5f1cf3dd85da2b20c69620abee` |
| Android APK | `mobile-android/apk/VRchat-Timeline-Album-Mobile-1.2.0.apk` | 4.5 MB | `0298fe9ed9c48bbf4b4a368b4993c8cc9c5a15306a89554dce055e1be42ac723` |

> 建议上传 Release 时把安装版重命名为 `VRchat-Timeline-Album-1.2.0-x64-setup.exe`（与应用内更新检查的 `x64-setup.exe` 匹配）。

---

## 四、已知限制 / 待真机验证

1. **M2 不是前台服务**：短时间后台可保持 SSE，但 Android 厂商省电策略仍可能杀进程；若要 100% 后台可靠，需要后续加 Foreground Service 或 FCM。
2. **M1 回传**依赖电脑端手机同步正在运行、会话未过期（12 小时）；电脑端需打开客户端窗口才能即时入相册，关闭时文件仍在 `_inbox`，下次启动扫描会补入。
3. **M3 保存/分享**在 Android 8/9 需要存储权限（沿用现有请求流程）；Android 10+ 走 MediaStore。尚未真机验证。
4. **P1** 的 `fs.watch` 在 Linux/网络盘上可能只靠 30 秒轮询；单次 80 张上限。
5. **P2** 全文件 SHA-256 扫描大库需要时间；回收站暂无 App 内恢复 UI，需在 `.hoshikuzu/trash` 手动找回。
6. **P3** 智能相册最多 20 个；用户标签最多 20 个/张。
7. 安装包/APK 仍未代码签名；APK 仍是 debug key 的 release 变体，可直接覆盖 1.1.3。
8. 手机本地相册的多选/回传 UI 已通过 TypeScript/Android 编译与共享前端构建，但**未做真机点击验证**（本机无模拟器）。

---

## 五、主要改动文件

```
desktop/services/mobile-sync.cjs        # /api/mobile/upload、会话内导入队列
desktop/ipc/mobile.cjs                  # importReceived / library:imported
desktop/services/auto-import.cjs        # 监视文件夹服务（新增）
desktop/ipc/auto-import.cjs             # 自动导入 IPC（新增）
desktop/services/duplicates.cjs         # 完整哈希重复检测 + 回收站（新增）
desktop/ipc/duplicates.cjs              # 重复检测 IPC（新增）
desktop/main.cjs / preload.cjs / config.cjs
src/mobile/managedActions.ts            # 手机保存/分享/回传封装（新增）
src/mobile/native.ts / installMobileBridge.ts / MobileApp.tsx
src/PublicSite.tsx                      # 手机本地相册多选栏
src/components/PhotoCard.tsx / Timeline.tsx / PhotoDetailDialog.tsx / Header.tsx
src/hooks/useAlbum.ts                   # updatePhotos / 标签收藏归一化 / 文件清理
src/admin/PhotosPage.tsx                # 标签/收藏筛选、智能相册、批量编辑入口
src/admin/BulkEditDialog.tsx            # 批量编辑弹窗（新增）
src/admin/LibraryPanel.tsx              # 自动导入 + 重复照片面板
src/types.ts / src/data/settings.ts / src/utils/filters.ts
mobile-android/.../MobileActions.java   # 保存/分享/上传（新增）
mobile-android/.../CastNotifier.java    # 投送通知（新增）
mobile-android/.../SaveBridge.java / MainActivity.java / AndroidManifest.xml / file_paths.xml
```

---

## 六、一句话结论

**1.2.0 完成手机回传、投送通知、手机批量管理，以及 PC 自动导入、重复照片回收站、批量编辑/标签/收藏/智能相册六项功能；59 项测试、桌面与打包后冒烟、Android release 构建全部通过，产物已在本机就绪，等待发布确认。**
