# VRchat时间轴纪念相册 · 开发交接说明

> 最后更新：2026-11-25
> 项目目录：`G:/AI/Zcode/网页/时光轴相册DS4.1F`
> 形态：**线上网页 + 本地 Electron 客户端**，共用同一套 `src/`
> 客户端文档：`desktop/README.md`

---

## 0. 本轮交付摘要（下一个对话先读）

- **视频背景**：背景特效新增「视频背景」。导入 MP4 / WebM / MOV 等常见视频，客户端自动判断是否需要压缩；体积大或容器不友好时在渲染层用 Canvas + MediaRecorder 重编码为 VP9/VP8 WebM，**去除音轨（画面无损）**、长边限制 1920px、按目标体积选择最高码率，必要时二次降码率；客户端存 `<库>/.hoshikuzu/backgrounds/<sha1>.webm` 并通过 `hoshikuzu-media://background/` 播放，网页版存 IndexedDB。首帧 poster 随设置保存，视频解码前/失败时显示。
- **照片横竖识别**：新增 `PhotoOrientation` 与 `utils/orientation.ts`，用 `width/height`（扫描时已按 EXIF 旋转）区分 portrait / landscape / square。时间轴卡片、画廊、密排相册、首页精选卡片都按方向使用 3:4 / 4:3 / 1:1 画框；竖图卡片会收窄并靠近中轴，不再统一裁成 4:3。
- **网络代理管理**：管理台 → 站点设置新增「网络代理」。模式：跟随系统 / 不使用 / HTTP / SOCKS5 / PAC / 自定义规则，可设置绕过地址、测试连通性。代理同时应用到默认会话与 VRChat 专用持久会话；测试后自动恢复已保存配置。
- **VRChat 官方世界封面**：世界资料库新增「从 VRChat 拉取世界封面」。登录官方账号（支持 TOTP / 邮箱 2FA）后批量读取所有有效 `wrld_…` 的名称、作者、简介、人数与封面；封面压缩为 512px WebP data URL 写回 `WorldLibraryEntry.thumbnail`，离线可显示。密码可选 safeStorage 记住，登出清除。
- **验证**：`npm run build` 通过；`npm run test:desktop` **33 项通过**（新增 5 项代理规则映射）；`npm run desktop:smoke` 通过，新增横竖卡片断言、视频背景 IPC + `hoshikuzu-media://background` 200、代理 6 模式应用/恢复、世界资料库官方面板渲染与 `03f-worlds.png` / `01b-timeline.png` 截图；`npm run desktop:pack` 重新生成 `release/win-unpacked`，打包版以 `HOSHIKUZU_SMOKE=1` 启动同样通过（exit 0）。
- **接手顺序**：第 2 节恢复命令 → 第 4 节存储库/配置 → 第 8 节验证状态 → 第 10 节改动约束。默认外观「暮色紫 · 星轨交错 · 星轨」不要破坏。

---

## 1. 项目概览

「VRchat时间轴纪念相册」是面向 VRChat 玩家的时光相册，日式 ACG / 虚拟旅行手帐视觉。

- React 19 + TypeScript + Vite 6；Electron 38 客户端
- 自定义 CSS、lucide-react、Cormorant Garamond / Manrope
- Hash 路由：`#/`、`#/admin`、`#/admin/photos`、`#/admin/sync`、`#/admin/advanced` 等
- 网页：localStorage，无后端也可运行
- 客户端：独立存储库、原图落盘、缩略图缓存、原生对话框
- 客户端高级设置：**EasyTier 虚拟组网 / P2P 传图 / AI 图像总结 / AI 识图 World ID**
- 客户端网络：**网络代理管理（系统/直连/HTTP/SOCKS5/PAC/自定义）** + **VRChat 官方世界封面拉取**
- 客户端云同步：**云盘日期文件夹同步 / 网站数据同步**
- 背景：**9 种**（新增循环视频背景；银河黑洞为实验性背景，默认隐藏）
- 照片卡片：**按原图横竖方向自适应画框**（3:4 / 4:3 / 1:1）
- 默认外观：**暮色紫 · 星轨交错 · 星轨**（7 主题 × 4 布局）
- `npm run build` 已通过；`npm run test:desktop` **33 项通过**
- 客户端冒烟已通过（含横竖卡片、视频背景 IPC/协议、代理模式、世界资料库官方面板）；`release/win-unpacked` 已用本轮代码重新打包并启动冒烟通过；NSIS + 便携版已重新生成并上传到 GitHub Release `v1.0.0`
- GitHub 仓库：<https://github.com/GhostQAQ-VRC/->
- Release 下载：<https://github.com/GhostQAQ-VRC/-/releases/tag/v1.0.0>
  - `VRchat-Timeline-Album-1.0.0-x64-setup.exe`（NSIS，约 107MB，未签名）
  - `VRchat-Timeline-Album-1.0.0-portable.exe`（便携版，约 99MB）

---

## 2. 恢复与启动

```bash
cd "G:/AI/Zcode/网页/时光轴相册DS4.1F"
npm install
npm run dev -- --port 5174 --strictPort     # 网页开发
npm run build                                # 网页 + 客户端渲染层

npm run desktop:dev                          # Vite + Electron
npm run desktop:smoke                        # 构建 + 自动截图
npm run desktop:smoke:onboarding             # 首次启动第 1 步向导截图
npm run desktop:smoke:thumbnails             # 第 2 步缩略图向导 + A/B + 原图加载验证
npm run desktop:pack                         # release/win-unpacked
npm run desktop:dist                         # NSIS + 便携版（需要能下载 electron 包）
npm run desktop:dist:local                   # NSIS + 便携版（使用本地 node_modules/electron/dist）
npm run test:desktop                         # 客户端单测（存储/缩略图/云同步/AI/传输/EasyTier）
npm run library:cli -- scan <文件夹>          # 独立 CLI
```

备份包不包含 `node_modules`、`release`，解压后需重新 `npm install`。

项目不是 Git 仓库；历史版本通过 `../_backups/` 下的 tar.gz 归档。

---

## 3. 已完成功能

### 公开相册（网页 + 客户端共用）

- 按年 / 月分组的时间轴、发光星轨、月份牌、自动显现动画
- 搜索备注 / 世界 / 作者 / 日期；按世界 / 未关联 / 待识别筛选；排序
- 左右交替卡片、年份胶囊、月份轨道、超宽屏年份轨
- 照片详情：大图、备注编辑、键盘翻页、删除、世界关联与识别
- 本地图片与图片链接两种收录方式（网页）
- 照片置顶：卡片 / 详情 / 管理台；失效引用自动清理
- 7 套主题 + 4 种布局 + 9 种动态背景，公开站头部「外观」入口
- 动态背景：星轨、雨幕（玻璃水滴滑落）、亚克力、樱吹雪、极光、萤火、自定义图片、循环视频；实验性银河黑洞（WebGL）需在管理台开启后显示
- 照片横竖识别：按 `width/height` 区分 portrait / landscape / square，时间轴、画廊、密排、首页精选按 3:4 / 4:3 / 1:1 显示；竖图卡片收窄并靠近中轴
- 空相册、无结果、存储受限、图片加载失败占位

### 管理台

- 本地口令 PBKDF2 + sessionStorage 8 小时
- 概览、照片管理、世界资料库、站点设置、云同步、操作记录
- 照片搜索 / 筛选（含存储库 / 文件缺失）/ 分页 / 批量操作 / 编辑 / 置顶
- 世界资料新增编辑删除、封面、关联传播
- **从 VRChat 官方拉取世界封面**：登录官方账号（TOTP / 邮箱 2FA），批量读取全部 World ID 的名称/作者/简介/人数/封面；封面压缩为 512px WebP data URL 入库，离线可用；人工名称不被覆盖，`source='api'`
- **网络代理管理**：系统 / 直连 / HTTP / SOCKS5 / PAC / 自定义规则 + 绕过地址 + 连通性测试；同时作用于默认会话和 VRChat 持久会话
- 站点文案、世界代理、备份导入导出、危险操作、口令修改、锁定

### 本地客户端（Electron）

- **自定义标题栏**：拖拽、最小化 / 最大化 / 关闭、库名与扫描状态、窗口状态记忆、单实例
- **独立存储库**：选择或新建文件夹；`hoshikuzu-library.json` + `.hoshikuzu/` 缓存；原图原地不动
- **递归扫描**：PNG `iTXt` 的 `XML:com.adobe.xmp`（VRChat）、`Description` JSON（VRCX）、EXIF/XMP、VRChat 文件名、文件时间
- **自动识别**：拍摄时间、`wrld_…` World ID、世界名/实例 ID；自动建立世界资料并关联
- **原图 + 缩略图**：原图只读、永不修改；首启第 2 步在存储库内新建缩略图缓存目录，5 档规格（960/1280/1600/1920/2560），随机抽一张图做 A/B 压缩前后对比并给出实测体积/滚动流畅度提示；网格与列表只加载缩略图，点开单张详情才加载原图
- **全库预压缩进度**：确认第 2 步规格后立即开始全库生成；向导内显示索引进度与缩略图进度条，完成后提示「全部 N 张缩略图已生成」，也可先进入相册后台继续
- **三种图片加载策略**（管理台 → 站点设置 → 存储库）：实时加载（只加载视口附近）、预测加载（默认，按滚动方向预取约 10–20 张/5%，并按解码显存预算自动减少张数）、预先加载（后台低并发 `fetch` 全部缩略图字节，不提前解码）；离开窗口的 `<img>` 会卸载以释放 GPU 解码内存
- **导入**：原生对话框 / 拖入；复制到 `_inbox/<日期>/`，源文件不动
- **删除语义**：删记录不删原图；忽略哈希防止重扫复活；受管副本可单独删除
- **缺失文件**：标记 `missing`，不自动删记录
- **备份**：元数据 JSON / 完整库 ZIP（含原图与预览）/ 网页 JSON 迁移
- **云同步**（管理台 → 云同步）：
  - **云盘同步**：Google Drive / 123云盘 / 百度网盘客户端同步文件夹、WebDAV、Google Drive API、百度网盘 API；每次同步自动建立 `<根目录>/YYYY-MM-DD/` 日期文件夹，只上传对应日期的原图；本地清单去重，可强制重传；可选上传 `hoshikuzu-album.json` 元数据
  - **网站同步**：把当前相册数据 POST 到自定义网站接口，可选把缩略图内嵌为 data URL；网站返回 2xx 即成功
  - 令牌/AppSecret/WebDAV 密码通过 `safeStorage` 加密，不写入存储库或备份
- **高级设置**（`#/admin/advanced`）：
  - EasyTier 组件检测/选择/一键下载（官方 GitHub、LGPL-3.0、SHA-256）、网络/Peer/虚拟 IP/端口、启动/停止/测试/日志、TUN/免 TUN、管理员提权
  - P2P 传图：接收端分享码、虚拟/局域网 IP、发送端目标测试、原图流式上传、自动入库与哈希去重
  - AI 总结：OpenAI 兼容 / Anthropic / Gemini / Ollama、一键拉取模型、视觉过滤、主/备模型、单张与批量、可停止
  - AI 识图 World ID：读取拍立得画面印出的 `wrld_…`，单张与批量识别，自动建立/关联世界并标记 `worldIdSource='ai'`
  - 动态背景：星轨 / 雨幕 / 亚克力 / 樱吹雪 / 极光 / 萤火 / 自定义图片 / 循环视频；银河黑洞为实验性 WebGL 背景，默认隐藏
  - **视频背景**：MP4 / WebM / MOV 等；≤24MB 且网页格式直接使用，否则 Canvas + MediaRecorder 重编码 VP9/VP8 WebM（去音轨、长边 1920、按目标体积选最高码率、必要时二次压缩）；客户端写 `<库>/.hoshikuzu/backgrounds/<sha1>.webm`，网页写 IndexedDB，首帧 poster 随设置保存
  - **照片横竖识别**：扫描已按 EXIF 旋转的 width/height → portrait / landscape / square；卡片与首页精选使用 3:4 / 4:3 / 1:1
  - **网络代理**：系统 / 直连 / HTTP / SOCKS5 / PAC / 自定义 + 绕过地址 + 测试；应用到默认会话与 `persist:hoshikuzu-vrchat`
  - **VRChat 官方资料**：登录（TOTP/邮箱 2FA）、批量拉取全部 World ID 的名称/作者/简介/人数/封面、512px WebP 入库、可取消、密码可选 safeStorage 记住
  - 实验性背景：设置页开关，默认关闭；关闭时黑洞选项隐藏，若正在使用则回退星轨
  - 密钥：AI Key、传图分享码、EasyTier 网络密钥、VRChat 密码均用 `safeStorage` 加密存本机，不入库、不随备份导出
- 安全：`contextIsolation`、`sandbox`、`nodeIntegration:false`、`app://` 与 `hoshikuzu-media://` 协议、目录穿越/realpath 校验、外链系统浏览器
- 独立存储 CLI：`tools/library-cli.cjs`（scan / previews / stats / inspect）

---

## 4. 存储库规范

```text
<库根目录>/
  hoshikuzu-library.json          # 权威元数据 + 库配置
  缩略图缓存/                      # 首启第 2 步新建；只放缩略图，可改名/整体删除
    <hash>_<边>_q<质量>.webp       # 只读原图生成的 WebP，永不回写原图
  .hoshikuzu/
    index.json                    # 扫描缓存（size + mtime）
    backups/metadata-*.json       # 自动备份，保留 10 份
    previews/                     # 旧版缩略图位置，兼容读取
    sync/manifest.json            # 云盘同步去重清单，可重置
    backgrounds/<sha1>.webm       # 视频背景缓存（自动去音轨、高质量压缩）
  _inbox/YYYY-MM-DD/              # 客户端导入副本
  _inbox/transfer/YYYY-MM-DD/     # P2P 接收到的照片
  <用户原有目录>                   # 只读索引，不移动
```

`hoshikuzu-library.json` 顶层：`format: hoshikuzu-library`、`version: 1`、`library`、`album`（AlbumData v2）、`sync`。`library` 新增：`thumbnailDir`、`thumbnailsConfigured`、`previewPreset`、`previewQuality`、`imageLoadingMode`（`realtime` / `predictive` / `preload`）；`previewMaxEdge` 仍保留用于兼容。

`Photo` 新增可选字段：`mediaKind`、`libraryPath`、`previewPath`、`fileBytes`、`contentHash`、`metaSource`、`worldInstanceId`、`worldIdSource`（`scan` / `ai` / `manual`）、`missing`、`managedCopy`、`syncState`；AI 总结字段：`aiSummary`、`aiTags`、`aiModel`、`aiUpdatedAt`、`aiState`、`aiError`。

`AlbumSettings` 新增：`backgroundEffect`（9 种，含 `video`）、`experimentalEffects`（实验性背景开关，默认 `false`）、`customBackgroundSrc`、`customBackgroundName`（上传背景压缩后的 data URL，随相册/备份保存）、`customVideoKey`（客户端为 `.hoshikuzu/backgrounds/` 文件名，网页为 IndexedDB key）、`customVideoName`、`customVideoPoster`（首帧 JPEG data URL）、`customVideoMime`、`customVideoBytes`、`customVideoWidth/Height`。

`hoshikuzu-media://` 新增 `background/<sha1>.webm|mp4` 主机名，只读取库内 `.hoshikuzu/backgrounds/`；校验文件名格式并支持 Range 请求。

桌面端加载时把相对路径水合为：
`hoshikuzu-media://preview/<hash>.webp`、`hoshikuzu-media://original/<相对路径>` 或 `hoshikuzu-media://background/<sha1>.webm`。

客户端配置（窗口位置、当前库路径、onboarding、AI/传输/EasyTier/云同步/代理/VRChat 设置）：`%APPDATA%/hoshikuzu-album/config.json`；便携版在 exe 同级 `data/`。`secrets` 段只存 `safeStorage` 加密后的密文：`aiApiKey`、`transferToken`、`easytierSecret`、`syncWebdavPassword`、`syncGoogleClientSecret`、`syncGoogleAccessToken`、`syncGoogleRefreshToken`、`syncBaiduSecretKey`、`syncBaiduAccessToken`、`syncBaiduRefreshToken`、`syncWebsiteToken`、`vrchatPassword`。

代理配置位于 `config.proxy`：`mode`（`system` / `none` / `http` / `socks5` / `pac` / `custom`）、`httpUrl`、`socksUrl`、`pacUrl`、`customRules`、`bypass`。VRChat 配置位于 `config.vrchat`：`username`、`apiBase`（默认 `https://api.vrchat.cloud`）。登录 Cookie 存在 `persist:hoshikuzu-vrchat` 分区。

云同步配置位于 `config.sync`：`cloud`（provider、folderRoot、baseFolder、WebDAV 地址/用户名、Google Client ID、百度 AppKey/应用目录、跳过已同步、上传元数据）、`website`（endpoint、includePreviewImages、maxPayloadMb）、`state.cloud` / `state.website`（最近同步时间、结果、数量）。云盘去重清单在库内 `.hoshikuzu/sync/manifest.json`，可重置；`hoshikuzu-library.json` 的 `sync.lastSyncAt/provider` 会在成功后更新。

---

## 5. 网页数据与存储

| 键名 | 内容 |
| --- | --- |
| `hoshikuzu-album-v2` | 照片、世界资料库、站点设置、操作记录 |
| `hoshikuzu-album-v1` | 旧版数据（迁移后保留） |
| `hoshikuzu-appearance-v1` | 主题 / 布局首屏缓存 |
| `hoshikuzu-admin-credential-v1` | PBKDF2 盐与哈希 |
| `hoshikuzu-admin-session-v1`（sessionStorage） | 管理解锁状态，8 小时 |

`AlbumData` 仍为 v2；客户端仅追加可选字段，网页读取不受影响。备份格式仍是 `hoshikuzu-album-backup` v2。

---

## 6. 主要代码入口

```text
src/
  App.tsx                       # 路由、主题、DesktopLibraryProvider、标题栏、菜单命令
  PublicSite.tsx                # 公开相册
  types.ts                      # Photo/AlbumData/Settings/LibraryScanResult…
  platform/
    desktopApi.ts               # preload 桥接类型 + getDesktopBridge
    media.ts                    # 库照片 src 水合、媒体 URL
    importPhotos.ts             # 桌面导入 → PhotoDraft
    index.ts
  hooks/
    useAlbum.ts                 # 核心数据、applyScan、applyPreviews、applyAiResults、忽略哈希
    useDesktopLibrary.tsx       # 库配置、自动扫描、预览/进度事件（活动进度拆到独立 Context）
    useThumbnailLoader.tsx      # 实时/预测/预先三档加载、可见窗口、方向预测、解码释放、预取
    useDesktopServices.tsx      # P2P 收到照片自动入库、AI 批量事件与结果回填
    useAdminAuth.ts
    useHashRoute.ts
    useToast.tsx
  services/
    albumStorage.ts             # 网页 localStorage / 桌面同步 IPC 适配
    imageUpload.ts              # 网页压缩 / URL 校验
    videoBackground.ts          # 视频探测、首帧 poster、MediaRecorder 智能压缩
    backgroundVideoStore.ts     # 网页版 IndexedDB 视频背景存储
    worldService.ts
    sync/index.ts               # 说明：实际同步在 desktop/services/sync.cjs
  utils/
    orientation.ts              # width/height → portrait / landscape / square
  components/
    DesktopTitleBar.tsx         # 自定义标题栏（全名）
    BrandGlyph.tsx              # 紫月 + 星轨品牌图标
    LibraryGate.tsx             # 首次启动：第 1 步选择存储库 / 不可用提示
    ThumbnailSetup.tsx          # 首启第 2 步：缩略图目录、5 档规格、随机样张 A/B
    BackgroundEffectPicker.tsx  # 外观面板/管理台的背景选择、自定义图片/视频上传与压缩进度
    backgrounds/                # Starfield / RainEffect / BlackHoleEffect / Sakura / Fireflies / VideoBackground / BackgroundStage
    SafeImage.tsx               # 图片失败占位 + 解码后淡入
    Header/Hero/Timeline/PhotoCard/PhotoDetailDialog/UploadDialog…
  admin/
    LibraryPanel.tsx            # 存储库面板（扫描、识别统计、缩略图规格/加载策略、云同步入口）
    SyncPage.tsx                # 云同步：云盘 / 网站两种同步设置、进度与结果
    SettingsPage.tsx            # 桌面备份 / 网页备份迁移
    NetworkPanel.tsx            # 网络代理：6 种模式、绕过地址、连通性测试
    VRChatPanel.tsx             # VRChat 官方登录、批量封面拉取与进度
    WorldsPage.tsx              # 世界资料库 + VRChat 官方资料面板
    DashboardPage.tsx           # 存储库状态
    advanced/                   # 高级设置：EasyTier / 传图 / AI
      AdvancedSettingsPage.tsx
      EasyTierPanel.tsx
      TransferPanel.tsx
      AiPanel.tsx
  styles/
    desktop.css                 # 标题栏、向导、库面板、布局偏移
    advanced.css                # 高级设置与 AI 展示
    sync.css                    # 云同步页表单、进度、接口说明
    effects.css                 # 动态背景层、亚克力、极光、自定义背景
desktop/
  main.cjs                      # 窗口、协议（含 background）、IPC、菜单、扫描/导入/备份、冒烟
  preload.cjs                   # window.hoshikuzu.desktop（library/media/backup/background/network/vrchat/ai/easytier/transfer）
  config.cjs                    # 配置深合并 + safeStorage 密钥
  dev.cjs / smoke.cjs / make-icon.cjs / run-tests.cjs
  ipc/advanced.cjs              # AI / EasyTier / 传输 IPC 与自动启动
  ipc/network.cjs               # 代理与 VRChat 官方资料 IPC
  services/
    ai.cjs                      # 四协议、模型列表、视觉判断、主备、图片预处理
    transfer.cjs                # 接收 HTTP、令牌、串行入库；发送流式上传
    easytier.cjs                # 组件检测/下载/参数/启动/状态/日志/提权
    sync.cjs                    # 云同步 IPC、配置、密钥、任务状态
    sync-core.cjs               # 纯同步引擎：日期文件夹、folder/WebDAV/Google/Baidu、网站同步
    proxy-config.cjs            # 纯代理规则映射（可单测）
    network.cjs                 # Electron 会话代理应用、resolveProxy、连通性测试
    vrchat.cjs                  # 官方登录/2FA/状态/世界查询/封面下载与批量任务
  library/
    ingest.cjs                  # 导入/接收统一管线（prepareDraft/importReceivedFile）
    png-chunks.cjs              # PNG tEXt/iTXt/zTXt
    metadata.cjs                # XMP/JSON/EXIF/文件名 → 日期 + World ID
    quick-hash.cjs
    scan.cjs                    # 递归扫描、缓存、去重、进度
    preview.cjs                 # sharp 预览 + 队列
    repository.cjs              # library.json 原子读写、备份、忽略列表、realpath
    backup.cjs                  # 元数据 / 完整 ZIP / ZIP 恢复
  __tests__/                    # node:test（含 library 与 services）
  README.md                     # 客户端详细文档
tools/library-cli.cjs           # 独立存储引擎 CLI
electron-builder.yml
```

---

## 7. 最近改动记录

1. **客户端架构**：共享 `src/`，`desktop/` 仅外壳与存储引擎；网页行为不变。
2. **存储库**：用户选文件夹、元数据全在库内、原图不动、预览缓存、扫描缓存、自动备份。
3. **识别**：VRChat PNG XMP（`XML:com.adobe.xmp`）、VRCX `Description` JSON、EXIF/XMP、文件名、mtime；`metaSource` 可追溯。
4. **UI**：自定义标题栏、首启向导、存储库面板、桌面导入、识别信息、缺失/忽略、统计、图片失败占位。
5. **备份**：元数据 / 完整 ZIP / ZIP 恢复 / 网页 JSON 迁移（data URL 落盘）。
6. **同步数据预留 → 已实现**：早期预留 `SyncProvider` + `sync` 字段；本轮在 item 20 完成云盘与网站同步。
7. **安全**：`app://` + `hoshikuzu-media://`、CSP、sandbox、拖放导航拦截。
8. **构建**：`base: './'`、CSP nonce、`theme-boot.js` 外置、Electron 打包配置。
9. **稳定性**：ZIP 恢复改为 `unzipper` 流式解压 + 目标文件夹覆盖确认；打包改用预生成 `build/icon.ico`（`tools/make_icon.py`，需要 Pillow），避开 Electron 图标转换工具的偶发崩溃。
10. **更名与图标**：产品名改为「VRchat时间轴纪念相册」，站内短名「时间轴纪念相册」；紫月+星轨 SVG 图标与 `BrandGlyph`（沿用上一版最受认可的紫月视觉）；保留所有内部键/协议以兼容旧数据。
11. **EasyTier / P2P**：组件检测、手动选择、官方下载+SHA-256、网络/Peer/虚拟 IP 配置、TUN/免 TUN、管理员提权、状态/日志；接收端 HTTP + 分享码 + 自动入库，发送端流式原图。
12. **AI 总结**：四协议适配、模型拉取、视觉过滤、主备模型、单张/批量、取消；API Key/分享码/网络密钥 safeStorage；照片卡片/详情/管理台展示与搜索。
13. **地基重构**：抽出 `desktop/library/ingest.cjs`，修复 `currentLibraryRoot` 为空时的导入问题；`resolveRealInside` 防 symlink 逃逸；config 深合并与 `secrets`。
14. **动态背景**：`BackgroundEffectId` 与 `backgroundEffect` 设置、8 种背景选择器、自定义背景上传压缩；星轨/雨幕（玻璃水滴）/亚克力/樱吹雪/极光/萤火；`BackgroundStage` 与 `effects.css`；首屏 `theme-boot.js` 同步背景，减少刷新闪烁。
15. **银河黑洞**：`BlackHoleEffect` WebGL 着色器（事件视界、光子环、吸积盘、上方弯折光弧、星海闪烁、流星、横向漂移），CSS 回退与文字可读性遮罩；自检时已去掉环的扰动、减弱盘面扭曲并缩小比例，保证视界/光子环保持正圆。
16. **AI 识图 World ID**：独立 OCR prompt（2048px）、`wrld_` 正则校验、`recognizeWorldId` 主备模型；详情/编辑器按钮、AI 批量面板统计与批量识别；`attachRecognizedWorlds` 创建/关联世界并标记 `worldIdSource='ai'`，不覆盖人工关联。
17. **实验性背景开关**：`experimentalEffects` 默认关闭，黑洞卡片从公开站外观面板与管理台背景列表中隐藏；设置页新增「实验性背景」开关，关闭时自动回退星轨。`theme-boot.js` 首屏也不会绘制未开启的实验背景。
18. **图标回退**：恢复上一版最受认可的紫月+星轨图标，重新生成 `build/icon.png` / `build/icon.ico`；站内 `BrandGlyph` 同步为紫月。已从打包后的 exe 提取图标确认。
19. **缩略图体系与显示流畅度（本轮）**：
   - 首启改为两步：选存储库 → 在库内新建缩略图缓存目录 + 选 5 档规格；随机抽一张库内照片做 A/B 压缩前后对比（可拖动分界线、2× 细节），显示实测单张体积、预估整库缓存体积与 5 级滚动流畅度/卡顿提示。
   - 缩略图与存储库解耦：`thumbnailDir`（默认 `缩略图缓存`）位于库根目录，扫描自动跳过；文件名改为 `hash_边_q质量.webp`，改规格不会命中旧缓存；原图只读，单测校验字节不变。
   - 确认规格后立即开始全库生成：首启向导内显示索引/压缩进度条、已生成/失败数量与目录，完成后提示「全部 N 张缩略图已生成」；可先进入相册让后台继续。主进程把逐张预览事件合并成批量 IPC，进度事件节流。
   - 网格/卡片/首屏/管理台列表只读取缩略图，不再回退原图；点开单张详情才请求原图，并在缩略图上淡入，背景仍用缩略图。
   - 三种图片加载策略：`realtime`（视口附近）、`predictive`（默认，可见 + 滚动方向约 10–20 张/5%，按解码显存预算收缩）、`preload`（后台 `fetch` 全部缩略图字节，不提前解码）；离开窗口即卸载 `<img>` 释放解码内存；管理台可视化切换。
   - 性能：预览协议 `immutable` 缓存、缩略图队列按 CPU 自适应并发 + libvips 线程上限、`content-visibility` 跳过屏外时间轴条目、共享 IntersectionObserver、时间轴卡片 memo、搜索筛选 `useDeferredValue`、相册保存 320ms 合并、后台预览批量 `startTransition`、活动/预览进度独立 Context 避免整页重渲染、图片解码淡入、Sakura/Fireflies 后台暂停、Canvas DPR 2→1.5。
   - 首屏拆包：管理台（含 AI/EasyTier 面板与样式）改为懒加载，公开站初始 JS 585KB→456KB、CSS 238KB→186KB。
   - 新增 `npm run desktop:smoke:thumbnails`：验证 5 档卡片、A/B 样张、生成进度 17/17、网格 0 张原图、预测加载 12 张、实时 4 张、预取 17/17、详情原图加载；`win-unpacked` 打包版同样通过。
20. **云同步（本轮）**：
   - 新增管理台「云同步」页（`#/admin/sync`）：
     - 云盘：云盘客户端同步文件夹（通用 / Google Drive / 123云盘 / 百度网盘）、WebDAV、Google Drive API、百度网盘 API
     - 网站：自定义 POST 接口，支持 probe 测试、Bearer 令牌、可选内嵌缩略图与数据上限
   - 云盘同步按 `capturedAt` 分日期：每轮先建立 `<baseFolder>/YYYY-MM-DD/`，只上传该日期原图；本地清单 `.hoshikuzu/sync/manifest.json` 去重，可强制重传/重置；可选上传 `hoshikuzu-album.json`
   - 双层实现：`sync-core.cjs` 纯引擎（folder/WebDAV/Google v3/百度 precreate+分片+create），`sync.cjs` 负责 Electron IPC、safeStorage 密钥、任务取消与状态
   - 网站同步把库内照片缩略图转 data URL、去掉本地路径后随相册 JSON 一起 POST；返回 2xx 视为成功
   - 新增 3 项同步单测：日期文件夹/去重/重传、网站 payload/鉴权、WebDAV MKCOL+PUT；总计 28 项通过
21. **视频背景 / 横竖识别 / 代理 / VRChat 官方封面（本轮）**：
   - 视频背景：`BackgroundEffectId` 新增 `video`；`services/videoBackground.ts` 探测、截首帧 poster、MediaRecorder VP9/VP8 重编码（去音轨、长边 1920、按目标体积选码率、>36MB 时 65% 码率二次压缩）；`backgroundVideoStore.ts` 用 IndexedDB 存网页版；桌面新增 `background:save-video` / `background:delete-video` IPC 与 `hoshikuzu-media://background/<sha1>.webm|mp4` 协议；`VideoBackground.tsx` 负责播放与失败/poster 回退；`BackgroundEffectPicker` 增加视频卡片、压缩进度与取消。
   - 横竖识别：`utils/orientation.ts` 按 `width/height` 判定 portrait/landscape/square；`PhotoCard` 输出 `photo-card--*`，`Hero` 输出 `feature-card--*`；timeline/layouts/hero CSS 分别使用 3:4、4:3、1:1 画框，竖图卡片收窄并靠中轴；扫描器原本已按 EXIF 旋转并记录尺寸，无需改库。
   - 网络代理：`proxy-config.cjs` 纯规则映射（单测覆盖 6 模式）；`network.cjs` 应用 `setProxy` 到默认会话与 `persist:hoshikuzu-vrchat`，`closeAllConnections` 使切换即时生效；`ipc/network.cjs` 提供 get/set/test IPC，测试后恢复已保存配置；`NetworkPanel.tsx` 提供模式、地址、绕过与测试 UI。
   - VRChat 官方封面：`vrchat.cjs` 使用独立持久会话登录（Basic + TOTP/emailotp）、检查状态、登出清 Cookie；`/worlds/{id}` 读取官方字段；封面仅允许 `*.vrchat.cloud|com` 并压缩 512px WebP data URL；`fetchCovers` 220ms 间隔、最多 500 个、可取消；`ipc/network.cjs` 暴露 IPC；`VRChatPanel.tsx` 提供登录/2FA/记住密码/进度/取消；`useAlbum.applyWorldCovers` 合并官方资料且不覆盖人工名称。
   - 单测新增 5 项代理规则映射（总计 33 项）；冒烟新增横竖卡片、`background` IPC + 协议 200、代理 6 模式应用/恢复、世界资料库官方面板断言与 `01b-timeline.png` / `03f-worlds.png` 截图。

---


## 8. 验证状态

已通过：

- `npm run build`（TypeScript + Vite；管理台已拆分懒加载 chunk）
- `npm run test:desktop`（33 项）：
  - 存储：XMP、VRCX JSON、文件名、PNG chunk、mtime、扫描/预览/统计、ZIP 备份恢复
  - 缩略图：缓存目录/预设校验、`hash_边_q质量` 命名、旧名兼容、扫描跳过缓存目录、样张不进库、原图字节不变
  - 云同步：日期文件夹/清单去重/强制重传/元数据、网站 payload 与 Bearer 鉴权、WebDAV MKCOL/PUT、原图只读
  - 代理：6 种模式规范化、host:port 解析、HTTP→fixed_servers、SOCKS5/自定义规则、PAC/system/direct 映射（`network.test.cjs`）
  - AI：四协议端点/请求体、模型列表、视觉过滤、JSON 解析、主备切换、World ID 响应解析与识图识别（本地 mock，无真实 Key）
  - 传输：本地接收/发送、令牌 401、重复去重、路径安全
  - EasyTier：组件资产选择、启动参数、TOML、状态解析、自定义参数
- `npm run desktop:smoke`：新品牌/标题栏、自动扫描 3 张（含 1 张 300×480 竖图）、**横竖卡片断言（portrait=1 / landscape=2 / 首页精选竖图）**、XMP/JSON 识别 2 个世界、外观面板与动态背景（实验性黑洞/雨幕/亚克力/极光）、**视频背景卡片**、实验性开关的隐藏/显示门控、管理台概览/照片/设置（懒加载 CSS 正常）、**6 种代理模式应用与恢复**、**视频背景 IPC 写入 + `hoshikuzu-media://background/` 返回 200 + 删除**、**世界资料库 VRChat 官方面板/API 地址字段**、云同步页渲染与 7 个 provider、WebDAV 密钥 safeStorage 写入、云同步状态、高级设置（EasyTier/接收/发送/AI/AI 识图批量面板）、safeStorage 写入验证、亮色主题
- `npm run desktop:smoke:onboarding`：第 1 步首启向导
- `npm run desktop:smoke:thumbnails`：第 2 步 5 档卡片、随机样张 A/B、生成进度 17/17 并提示完成、建立 `缩略图缓存`、扫描后时间轴缩略图可显示；未滚动时网格加载 0 张、滚动后预测加载 12 张；切换实时模式仅 4 张、预先模式预取 17/17、切回预测恢复 12 张；点开详情后原图 `naturalWidth>0` 且状态显示「原图」
- `npm run desktop:dev`：Vite + Electron 开发模式，标题栏渲染、`data-desktop` 生效、无 CSP 告警
- `release/win-unpacked/VRchat时间轴纪念相册.exe`：本轮 `desktop:pack` 重新打包后以 `HOSHIKUZU_SMOKE=1` 启动，完整冒烟通过（exit 0），横竖卡片、视频背景 IPC/协议、代理模式、世界资料库官方面板均正常
- `release/VRchat时间轴纪念相册-1.0.0-x64.exe` / `release/VRchat-Timeline-Album-1.0.0-portable.exe`：本轮已重新生成并上传到 GitHub Release `v1.0.0`（未签名）
- 60MP（10000×6000）JPEG：扫描成功，缩略图限制为 1600×960，原图不受影响
- 存储 CLI：14 张示例图扫描、14 张预览、统计
- EasyTier 官方组件下载实测：v2.6.4 Windows x86_64 包下载、SHA-256 校验、解压、递归检测到 `easytier-core.exe` / `easytier-cli.exe` / `wintun.dll`，版本 2.6.4
- 标准桌面冒烟 21 张截图（新增 `01b-timeline.png` 横竖时间轴、`03f-worlds.png` VRChat 官方面板）

尚未做真实环境验证（下次继续）：

- 真实 VRChat 账号登录（含 TOTP/邮箱 2FA）、官方 API 拉取封面、代理下的大陆网络连通性
- 视频背景真实压缩效果：长视频重编码耗时、二次压缩体积/画质、不同编码容器兼容性
- 云同步真实账号联调：Google Drive OAuth、百度网盘开放平台、123云盘客户端同步目录、真实网站接口
- 两台机器真实 EasyTier 组网 + P2P 传图（已验证组件下载/检测；未启动 TUN/双机传输）
- 真实 AI API Key 的模型拉取、批量总结与拍立得 World ID 识图（已用本地 mock 覆盖协议、解析与识图路径）
- NSIS 安装包实际安装（只构建、未执行安装）

冒烟截图：

- `desktop/.smoke/*.png`
- `desktop/.smoke-onboarding/*.png`
- `desktop/.smoke-thumbnails/*.png`

---

## 9. 已知限制

- 单一存储库；不支持多库合并浏览。
- 不监听文件夹变化（`watch` 预留）；新图需重新扫描。
- World 名称/作者若不在图片元数据中，先以短 ID 占位，需手动补全。
- 首次扫描大库需读取文件头并按需生成缩略图，耗时取决于文件数量；生成期间滚动不会加载原图，未生成的照片显示占位。
- 首启第 2 步的 5 档样张会读取一张原图并临时生成 5 个 WebP（位于系统临时目录，退出即清理）；超大 60MP 原图的样张加载可能慢一两秒。
- 修改缩略图规格会清空旧缩略图并重新生成；大库重建需要时间，但原图不受影响。
- 预先加载模式会为全部缩略图发起一次 `fetch`（只读字节、不解码）；首次预取受磁盘速度限制，之后依赖 Chromium 缓存。
- 预测加载的张数会按缩略图规格自动收缩（2560px 约 10 张），以控制解码显存；极低端设备建议选择「实时加载」或较小的缩略图规格。
- 网页版仍受 localStorage 约 5MB 限制；客户端无此限制。网页版视频背景存 IndexedDB，不占用 localStorage，但清除站点数据会丢失。
- 云盘 API（Google Drive / 百度网盘）未使用真实账号联调：单测覆盖了请求构造与错误处理，实际 OAuth/应用权限仍需用户自行申请；123云盘通过客户端同步文件夹接入。
- 网站同步需要你自己的后端实现 `POST` 接口（格式见云同步页）；仓库内没有附带服务端。
- 单个云盘文件上限 256MB；更大的原图会在同步结果中标记失败。
- 云盘客户端文件夹模式依赖对应客户端完成上传，程序只负责复制到日期文件夹。
- 云盘同步为手动触发，不做后台定时同步；网站同步为整库推送，不做双向合并。
- EasyTier 组件需下载/手动选择；TUN 需管理员，免 TUN 不能主动发起；公共中继不保证可用；n2n 未接入。
- AI 视觉能力判断是启发式；非视觉模型需手动确认；生成会产生第三方 API 费用。
- AI 识图 World ID 依赖照片印字清晰度，可能失败或误读；不会覆盖人工/已解析关联，结果需复核。
- 视频背景压缩在渲染层实时完成（Canvas 30fps + MediaRecorder），时长越长耗时越接近视频本身时长；音频会被移除（背景循环不需要声音）。长视频即使压缩后仍可能占用较大空间，导入时会显示实际体积。
- 旧版导入且没有记录 `width/height` 的照片会按横向 4:3 显示；重新扫描存储库后会补上尺寸并按真实方向显示。
- VRChat 官方 API 需要登录；密码登录受 VRChat 自身风控与 2FA 限制，不保证所有账号可用。封面以 data URL 写入世界资料，数量很多时会增大 `hoshikuzu-library.json`（每张约 10–30KB）。
- 代理测试会实际请求 VRChat `config`，网络不通时只影响测试结果；PAC 与自定义规则依赖 Chromium 规则语法。代理地址中暂不支持内嵌用户名/密码，请使用免认证的本地代理端口。
- 银河黑洞是实验性背景，默认隐藏，需在管理台开启「实验性背景」；依赖 WebGL，不可用时回退 CSS；动态背景在 `prefers-reduced-motion` 下静态化。
- P2P 接收端绑定 `0.0.0.0`，依赖分享码保护；只应在可信虚拟网络使用。
- `safeStorage` 绑定 Windows 用户；便携盘换机后需重新输入密钥。
- 未做代码签名与自动更新；安装时可能触发 SmartScreen。
- 起始照片与内置世界为虚构示例。

---

## 10. 继续开发时

- 保持默认「暮色紫 · 星轨交错」不被破坏。
- **共享改动**：`src/` 下的 UI / 数据模型 / `albumStorage`；改完同时验证网页与客户端。
- **客户端专属**：`desktop/**`、`src/platform/**`、`src/hooks/useDesktopLibrary.tsx`、`src/hooks/useDesktopServices.tsx`、`src/admin/advanced/**`、`src/styles/desktop.css`、`src/styles/advanced.css`。
- **新增 AI/P2P 后**：
  - AI 字段（`aiSummary/aiTags/aiModel/aiUpdatedAt/aiState/aiError`）必须同步 `types.ts`、`albumStorage.sanitizePhoto`、`useAlbum.addPhoto/applyScan/applyAiResults`、搜索文本与备份迁移。
  - 密钥只放 `config.cjs` 的 `secrets`（safeStorage），绝不能写入 `hoshikuzu-library.json` 或备份。
  - EasyTier CLI 参数集中在 `desktop/services/easytier.cjs` 的 `buildLaunchArgs/buildToml`；改参数后跑 `desktop/services/__tests__/easytier.test.cjs`。
  - P2P 协议在 `desktop/services/transfer.cjs`；改接收逻辑时跑 `transfer.test.cjs`，并检查 `ingest.importReceivedFile` 的去重/路径安全。
  - AI 协议适配在 `desktop/services/ai.cjs`；改端点/请求体时跑 `ai.test.cjs`（本地 mock，不需要真实 Key）。
  - AI 识图 World ID 的提示词、2048px 预处理与 `wrld_` 正则都在 `ai.cjs`；改返回格式时同步 `parseWorldIdResponse`、`ai.test.cjs` 与 `AiPanel` 的批量结果处理。
- **新增/修改背景特效时**：
  - 效果 ID 同步 `src/types.ts`、`src/data/appearance.ts`、`src/data/settings.ts`、`public/theme-boot.js` 的白名单；否则首屏缓存会回退默认。
  - 重动画必须响应 `prefers-reduced-motion`；Canvas/WebGL 清理 RAF 与监听器；黑洞需保留无 WebGL 时的 CSS/星轨回退。
  - 实验性背景由 `AlbumSettings.experimentalEffects` 控制；新增实验背景时必须同步 `BackgroundEffectPicker` 过滤、`normalizeSettings` 回退、`theme-boot.js` 首屏校验与设置页开关。
  - 自定义背景只在渲染层压缩为 data URL（≤4.5MB），不要写入存储库文件或主进程配置。
  - **视频背景**：效果 ID `video` 必须同步 `types.ts`、`appearance.ts`、`settings.ts`、`theme-boot.js`；`settings.customVideoKey` 只是文件名/IndexedDB key，真正文件在 `.hoshikuzu/backgrounds/`，不要写进相册 JSON。桌面保存走 `background:save-video`（校验 WebM/MP4 magic、sha1 命名、≤200MB），播放走 `hoshikuzu-media://background/`；网页版走 IndexedDB。视频必须去掉音轨、循环 `muted playsInline`，并在 `prefers-reduced-motion` 下只显示 poster。CSP 的 `media-src` 必须保留 `blob:` 与 `hoshikuzu-media:`。
- **照片方向**：统一用 `src/utils/orientation.ts` 的 `photoOrientation()`，不要在各组件里重复判断。新增卡片/列表样式时按 `photo-card--portrait / --landscape / --square` 给 3:4、4:3、1:1 画框；竖图卡片保持收窄并靠中轴。尺寸来自扫描器（已按 EXIF 旋转）或上传时的 naturalWidth/Height，不要手动写死 4:3。
- **代理与 VRChat**：
  - 纯规则映射放 `desktop/services/proxy-config.cjs`，改完跑 `network.test.cjs`；Electron 会话应用放 `network.cjs`，必须同时应用到 `session.defaultSession` 与 `persist:hoshikuzu-vrchat`，并在 `setProxy` 后 `closeAllConnections`。
  - 代理测试使用 `testProxy` 后要恢复已保存配置，避免“测试但未保存”改变运行时网络。
  - VRChat 凭据只放 `config.vrchat.username` 与 `config.secrets.vrchatPassword`（safeStorage）；不得写入 `hoshikuzu-library.json`、备份或日志。登出必须清 Cookie 与密码。
  - 封面下载只允许 `*.vrchat.cloud` / `*.vrchat.com` 的 https 图片；压缩 512px WebP data URL。批量任务限 500 个、约 220ms 间隔、可取消；401 立即中止并提示重新登录。
  - `applyWorldCovers` 不覆盖人工世界名称；封面优先使用下载后的 data URL，避免把需要登录的远程 URL 写进世界资料。
- **品牌**：内部 `hoshikuzu-*`、`appId`、`app://`、`hoshikuzu-media://`、`window.hoshikuzu` 不能随显示名修改；显示名在 `src/data/branding.ts`、`desktop/main.cjs`、`electron-builder.yml`。
- 修改 `Photo` 字段时同步：
  - `src/types.ts`
  - `src/services/albumStorage.ts` 的 `sanitizePhoto`
  - `src/hooks/useAlbum.ts` 的 `addPhoto/applyScan/applyAiResults`
  - `desktop/library/scan.cjs` 的 seed 结构
  - `desktop/library/ingest.cjs` 的 draft 结构
  - `desktop/README.md` 与本节
- **缩略图/显示约束**：
  - 网格、卡片、首屏、管理台列表、详情背景只能使用 `photoSrc()` / `photo.src`（缩略图）；`photoOriginalSrc()` 只允许在 `PhotoDetailDialog` 这类“用户已点开单张照片”的场景使用。
  - 缩略图规格 ID/分辨率/质量必须同时改 `desktop/library/constants.cjs` 与 `src/data/thumbnailPresets.ts`；改质量或分辨率时文件名签名会变化，旧缓存由 `set-options` 清理。
  - 缩略图目录只能是库根目录下的一层文件夹（`repository.sanitizeThumbnailDir`）；扫描必须跳过它，新增缓存目录时同步 `walkImages` 的 `skipDirs`。
  - 任何缩略图/样张流程都不得写入原图路径；单测 `thumbnail.test.cjs` 会校验原图字节不变。
  - 新增列表图片时给 `SafeImage` 加 `loading="lazy"`（首屏/详情除外），并避免在列表请求 `hoshikuzu-media://original/`。
  - 时间轴卡片图片由 `useThumbnailLoader` 统一门控；不要在卡片里直接设置 `src` 或 `loading="lazy"`，否则会绕过三种加载模式。
  - 新增 `imageLoadingMode` 等库配置时同步：`desktop/library/constants.cjs`、`repository.cjs` 的默认/校验、`src/platform/desktopApi.ts`、`main.cjs` 的 base config 与 `LibraryPanel`。
  - **云同步**：引擎在 `desktop/services/sync-core.cjs`（无 Electron 依赖，便于单测），IPC/密钥在 `sync.cjs`；新增 provider 时同步 `CLOUD_PROVIDERS`、`createCloudProvider`、`SyncPage` 表单与 `src/platform/desktopApi.ts` 类型。
  - 云盘同步必须只在 `capturedAt` 日期文件夹内写副本；任何情况下不得写入原图路径。文件夹 provider 需继续禁止选择存储库内部目录。
  - 密钥只放 `config.secrets`（`syncWebdavPassword`、`syncGoogle*`、`syncBaidu*`、`syncWebsiteToken`），不能写进 `hoshikuzu-library.json` 或备份。
  - 网站接口变更时同步 `runWebsiteSync` payload、`SyncPage` 接口说明、`sync.test.cjs` 与 `desktop/README.md`。
  - 预取使用 `fetch`，需要 `index.html` CSP 的 `connect-src` 包含 `hoshikuzu-media:`；修改 CSP 时保留它。
- 修改识别规则时同时跑 `npm run test:desktop`，并补充真实 VRChat 样本。
- 修改媒体协议/路径时检查 `desktop/main.cjs` 的 `resolveInside` 与 `hoshikuzu-media` 处理器。
- 每次交付前：`npm run build` + `npm run test:desktop` + `npm run desktop:smoke`；打包改动后再跑 `npm run desktop:pack` 并启动 `release/win-unpacked`。
- 打包依赖：`sharp` 必须保持在 `dependencies`，并在 `asarUnpack` 中；渲染层依赖（react/lucide/fontsource）在 `devDependencies`，由 Vite 打包，避免进入 app.asar。

---

## 11. 备份

最新交接备份（上一轮云同步交付时生成，不含本轮视频/代理/VRChat 改动）：

`G:/AI/Zcode/网页/_backups/时光轴相册DS4.1F_云同步交接_20261125_0607.tar.gz`（约 2.5MB）

本轮交付前如需归档，请按同样范围重新打包到 `../_backups/`。

代码仓库与发布：

- 源码：<https://github.com/GhostQAQ-VRC/->
- Release：<https://github.com/GhostQAQ-VRC/-/releases/tag/v1.0.0>
- 安装版资产：`VRchat-Timeline-Album-1.0.0-x64-setup.exe`（111,950,504 bytes）
- 便携版资产：`VRchat-Timeline-Album-1.0.0-portable.exe`（103,149,496 bytes）

包含：源码、`dist`、`desktop/**`、`build/icon.*`、README / HANDOFF / electron-builder 配置；不包含 `node_modules`、`release`、`.smoke*`、`.tmp-*`、`.zcode`。

---

## 12. 下一个对话建议

本版本已交付：网页 + Electron 客户端、独立存储库、两步首启与 5 档缩略图、三档图片加载策略、照片横竖识别、EasyTier/P2P、AI 总结与 AI 识图 World ID、9 种动态背景（含视频背景）、实验性黑洞、紫月品牌图标、云盘/网站云同步、网络代理管理、VRChat 官方世界封面拉取。下面是下一轮建议，按优先级排列：

1. **真实环境验证（P0）**
   - 用真实 VRChat 账号跑一次登录（含 TOTP/邮箱 2FA）与「拉取全部封面」，分别测试系统代理 / HTTP / SOCKS5 / PAC；确认中国大陆网络下的超时与 429 提示是否清晰。
   - 视频背景：用 1–5 分钟的 MP4/MOV 与 4K 素材各跑一次，记录压缩耗时、最终体积、画质主观评价；确认 `prefers-reduced-motion` 下只显示 poster。
   - 云同步：用真实 Google Drive OAuth 凭据、百度网盘开放平台应用各跑一次日期文件夹上传；用 123云盘客户端同步目录跑一次；再搭一个真实网站接口验证 `hoshikuzu-album-sync` 接收。
   - 两台机器加入同一 EasyTier 网络，测试 TUN/免 TUN、双机 P2P 上传、去重、4GB 大文件与防火墙。
   - 用真实视觉模型 API 跑一张 VRChat 拍立得：验证模型拉取、主/备切换、总结质量、World ID OCR 准确率与费用。
   - 实际执行 NSIS 安装/卸载，确认图标、快捷方式、升级覆盖与 SmartScreen 行为。
2. **云同步增强（P1）**
   - Google/百度 OAuth 授权码/设备码内置流程，减少手动粘贴 token。
   - 定时/增量自动同步、失败重试、断点续传（>256MB 原图）、同步日志页面。
   - 网站同步的双向合并与账号体系；提供 Node/Express 示例后端。
2. **AI 质量与成本（P1）**
   - 为 World ID OCR 增加多模型投票/置信度阈值，减少反光/裁切导致的误识别。
   - 批量总结加入并发可调、失败重试、费用估算与按世界/年份筛选。
3. **黑洞实验背景（P2，可选）**
   - 当前是电影化 2D 合成，形状已稳定；如继续追求物理感，可再研究真实测地线渲染/预渲染纹理，并做低端 GPU 性能分级。
   - 保持默认隐藏，只有 `experimentalEffects` 开启时可用。
4. **性能与体验（P2）**
   - 大库扫描进度、预览队列与窗口后台节流；黑洞/雨幕在低端机的帧率上限与降级策略。
   - 移动端/窄窗口的外观面板滚动与实验开关提示。
5. **线上能力（P3）**
   - 云同步已接入云盘与网站两种形式；下一步可做定时自动同步、双向合并、Google/百度真实账号联调与网站服务端示例。
6. **发布工程（P3）**
   - 代码签名、自动更新、崩溃上报、版本号与安装包差异说明。

接手时先读第 2 节恢复命令、第 8 节验证状态、第 10 节改动约束；默认外观「暮色紫 · 星轨交错 · 星轨」不要破坏。
