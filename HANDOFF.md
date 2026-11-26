# VRchat时间轴纪念相册 · 开发交接说明

> 最后更新：2026-11-26
> 项目目录：`G:/AI/Zcode/网页/时光轴相册DS4.1F`
> 形态：**线上网页 + 本地 Electron 客户端 + 局域网手机客户端**，共用同一套 `src/`
> 客户端文档：`desktop/README.md`

---

## 0. 最近交付摘要（1.1.1 手机客户端同款前端 → 1.0.2，下一个对话先读）

### 1.1.1 手机客户端与桌面前端同款（本轮，最新）

- **同款前端**：APK 不再使用独立简化手机 UI，而是加载与桌面同一套 React 前端（公开时间轴、照片详情、管理台、站点设置、外观/特效、三档加载策略、AI 面板、云同步面板）。新增 `mobile-client.html` / `parityEntry.tsx` / `installMobileBridge.ts`，移动端只做比例与间距适配（`mobile-parity.css`）。
- **本地优先**：APK 启动即进入本地相册，不需要电脑。相册数据保存在 WebView 本地存储；系统相册导入由原生 `MobileLibrary` 复制原图、生成 WebP 缩略图、读取 EXIF/文件名日期与 `wrld_`；原图/缩略图通过 `WebViewAssetLoader` 的 `/media/` 服务，保留桌面的缩略图/原图加载逻辑。
- **平台桥**：移动端实现与 `DesktopBridge` 同名的 album/library/media 接口、Android Keystore 密钥存储、OkHttp 原生 HTTP（支持 WebDAV 自定义方法）、AI 四协议（OpenAI / Anthropic / Gemini / Ollama）与云同步（WebDAV、网站、Google Drive API、百度网盘 API）。依赖桌面云盘客户端同步文件夹的四种 folder 模式在手机上不适用，未列入手机端提供商。
- **可选连接电脑**：公开站头部「连接电脑」打开原生扫码/地址页；配对后 WebView 加载桌面 `/m`，保留 SSE 投送、长按上滑保存、硬件返回与原生下载。连接不是启动前置。
- **名称同步**：APK 名称 `VRchat时间轴纪念相册`，站内短名 `时间轴纪念相册`，与桌面客户端一致。
- **桌面专属且手机不适用项隐藏**：EasyTier/TUN、P2P 传图、网络代理、桌面更新卡、手机同步服务端页、VRChat 官方封面面板。
- **验证**：Web 构建通过；Android `assembleRelease` 通过；Robolectric **8/8** 通过；APK `aapt`/`apksigner` 校验通过（package `com.hoshikuzu.mobile`、versionName 1.1.1、minSdk 26、targetSdk 34、v2 签名）；390×844 Electron 预览验证同款首页、无桌面标题栏、连接入口、本地导入、原图详情、AI test/models/generate/batch、WebDAV/网站同步 mock 通过。本机无 AEHD/WHPX，**未做真机/模拟器启动**；真机扫码、相册导入、AI/云同步真实账号仍需手机验证。

### 1.0.0 → 1.0.2 摘要

- **视频背景**：背景特效新增「视频背景」。导入 MP4 / WebM / MOV 等常见视频，客户端自动判断是否需要压缩；体积大或容器不友好时在渲染层用 Canvas + MediaRecorder 重编码为 VP9/VP8 WebM，**去除音轨（画面无损）**、长边限制 1920px、按目标体积选择最高码率，必要时二次降码率；客户端存 `<库>/.hoshikuzu/backgrounds/<sha1>.webm` 并通过 `hoshikuzu-media://background/` 播放，网页版存 IndexedDB。首帧 poster 随设置保存，视频解码前/失败时显示。
- **照片横竖识别**：新增 `PhotoOrientation` 与 `utils/orientation.ts`，用 `width/height`（扫描时已按 EXIF 旋转）区分 portrait / landscape / square。时间轴卡片、画廊、密排相册、首页精选卡片都按方向使用 3:4 / 4:3 / 1:1 画框；竖图卡片会收窄并靠近中轴，不再统一裁成 4:3。
- **方向校正（1.0.1）**：部分手机竖拍 / VRChat 手机相机截图会把竖画面以 1920×1080 横向像素保存，且没有 EXIF 标记，无法仅凭宽高自动判断。`Photo.rotation`（0/90/180/270）记录仅显示的旋转，卡片悬浮操作可一键向左 90°，详情页「照片方向」可左右旋转/重置；旋转后宽高自动交换并按竖图显示，原图字节不变。卡片/首页/详情使用容器查询单位旋转 `<img>`，不生成新原图。
- **AI 方向检测（1.0.2）**：按「角色自拍时头顶朝上；没有人物时按 16:9 风景照不旋转」的规则调用已配置的视觉模型。只检测没有 rotation 的 16:9 横图；照片详情有「AI 检测方向」，高级设置 → AI 面板有「AI 校正方向」批量任务。模型只判断头顶朝向，程序换算顺时针角度（朝右→270、朝左→90、朝下→180）；置信度低于 0.45 不自动改。无模型/无 Key 时保留手动旋转。
- **更新检测（1.0.2）**：桌面客户端启动后通过当前代理请求 GitHub `releases/latest`，发现更高版本时右下角弹出「发现新版本」，可下载安装包或查看更新说明；站点设置新增「检查更新」卡片。版本比较、仓库 URL 白名单与安装包选择有单测；按版本记住“稍后”，不会重复打扰。
- **网络代理管理**：管理台 → 站点设置新增「网络代理」。模式：跟随系统 / 不使用 / HTTP / SOCKS5 / PAC / 自定义规则，可设置绕过地址、测试连通性。代理同时应用到默认会话与 VRChat 专用持久会话；测试后自动恢复已保存配置。
- **VRChat 官方世界封面**：世界资料库新增「从 VRChat 拉取世界封面」。登录官方账号（支持 TOTP / 邮箱 2FA）后批量读取所有有效 `wrld_…` 的名称、作者、简介、人数与封面；封面压缩为 512px WebP data URL 写回 `WorldLibraryEntry.thumbnail`，离线可显示。密码可选 safeStorage 记住，登出清除。
- **验证**：`npm run build` 通过；`npm run test:desktop` **41 项通过**（代理 5 + 方向解析 3 + AI 方向 mock 1 + 更新检测 4）；`npm run desktop:smoke` 通过，新增横竖卡片断言、**横躺竖拍样张旋转断言（卡片 + 详情）**、视频背景 IPC + `hoshikuzu-media://background` 200、代理 6 模式应用/恢复、**GitHub 更新检查 IPC（ok，latest=1.0.2；与当前版本相同不提示）**、世界资料库官方面板渲染与 `01c-rotation.png` / `01d-rotation-detail.png` / `03f-worlds.png` / `01b-timeline.png` 截图；更新横幅用 1.0.0 版本号实测显示正常。
- **接手顺序**：第 2 节恢复命令 → 第 4 节存储库/配置 → 第 8 节验证状态 → 第 10 节改动约束。默认外观「暮色紫 · 星轨交错 · 星轨」不要破坏。

### 当前现场状态（2026-11-26）

- **本轮版本 1.1.1**：桌面与 Android 客户端代码版本一致；GitHub Release `v1.1.1` 已发布（latest）。
- **Release**：<https://github.com/GhostQAQ-VRC/-/releases/tag/v1.1.1>；资产：`VRchat-Timeline-Album-1.1.1-portable.exe`、`VRchat-Timeline-Album-1.1.1-x64-setup.exe`、`VRchat-Timeline-Album-Mobile-1.1.1.apk`、`...apk.sha256`。
- **APK**：`mobile-android/apk/VRchat-Timeline-Album-Mobile-1.1.1.apk`（约 4.4MB，debug key 签名的 release 变体，可直接侧载）；`release/VRchat-Timeline-Album-Mobile-1.1.1.apk` 为同一文件。
- **桌面测试包**：`release/VRchat-Timeline-Album-1.1.1-portable.exe`（约 99MB）、`release/VRchat时间轴纪念相册-1.1.1-x64.exe`（约 108MB，未签名）、`release/win-unpacked/`。
- **手机端能力**：本地相册（导入/缩略图/备注/旋转/删除/搜索/年份筛选）、同款外观/特效/加载策略、AI 四协议、云同步 WebDAV/网站/Google Drive API/百度网盘 API、可选连接电脑（扫码配对 + SSE 投送 + 原生保存）。
- **未验证**：真机安装/相机扫码/系统相册导入、Android 8/9 存储权限、Android Keystore 在真机上的加解密、AI/云同步真实账号、锁屏/后台 SSE、不同厂商 WebView；本机无 AEHD/WHPX，模拟器无法启动。
- 开发机 SDK：`G:/AI/Zcode/android-sdk`；Gradle 8.7：`G:/AI/Zcode/gradle-8.7`；JDK 21：`C:/Program Files/Java/dragonwell-21.0.5.0.5+9-GA`；Robolectric 离线 jar：`G:/AI/Zcode/robolectric-deps`。
- 发布方式：源码 push `main`；桌面安装包/便携版/APK 作为 GitHub Release 资产（不能提交进 git 的安装包）。当前 latest 为 `v1.1.1`。
- GitHub 仓库 `GhostQAQ-VRC/-`；GCM 已登录，系统代理 `127.0.0.1:32437` 可访问 GitHub。

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
- 客户端手机同步：**局域网手机客户端（扫码配对）/ SSE 双端同步 / 长按上滑投送 / 实时查看或保存到手机**
- 手机客户端：**独立懒加载 `/m` 页面**，时间轴、搜索筛选、全屏查看、长按上滑保存、投送接收浮层
- 背景：**9 种**（新增循环视频背景；银河黑洞为实验性背景，默认隐藏）
- 照片卡片：**按原图横竖方向自适应画框**（3:4 / 4:3 / 1:1）；**横躺竖拍可一键旋转校正并持久化**
- 客户端更新：**启动自动检查 GitHub Release**，发现新版本弹出下载提示；设置页可手动检查
- AI 方向：**按角色头顶朝上 / 16:9 风景不旋转的规则**，用视觉模型单张或批量校正方向
- 默认外观：**暮色紫 · 星轨交错 · 星轨**（7 主题 × 4 布局）
- `npm run build` 已通过；`npm run test:desktop` **47 项通过**
- 客户端冒烟已通过（含横竖卡片、横躺竖拍旋转、视频背景 IPC/协议、代理模式、更新检查、世界资料库官方面板、**手机同步二维码/手机页面/SSE 投送/桌面手势**）；`release/win-unpacked` 本轮已用 1.1.1 代码重新打包
- 线上稳定版仍为 1.0.2；本轮 1.1.1 为桌面 + 手机客户端，待发布新 Release
- 本地测试产物：`release/VRchat-Timeline-Album-Mobile-1.1.1.apk`（约 4.4MB，Android 客户端）、`release/VRchat-Timeline-Album-1.1.1-portable.exe`（约 99MB）、`release/VRchat时间轴纪念相册-1.1.1-x64.exe`（约 108MB）、`release/win-unpacked/`；便携版与 unpacked 均以 `HOSHIKUZU_SMOKE=1` 完整跑通（exit 0，含手机同步 4 张截图）
- GitHub 仓库：<https://github.com/GhostQAQ-VRC/->
- Release 下载（1.0.2）：<https://github.com/GhostQAQ-VRC/-/releases/tag/v1.0.2>
  - `VRchat-Timeline-Album-1.0.2-x64-setup.exe`（NSIS，约 107MB，未签名）
  - `VRchat-Timeline-Album-1.0.2-portable.exe`（便携版，约 99MB）

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
- **照片方向校正**：卡片悬浮「向左旋转 90°」；详情页「照片方向」支持向左/向右旋转与重置；旋转只改显示、不改原图，随相册保存
- **AI 方向检测**：按「角色头顶朝上 / 无人物时 16:9 风景不旋转」规则调用视觉模型；详情单张 + AI 面板批量（仅无 rotation 的 16:9 横图）
- **更新检测**：启动后经代理请求 GitHub Release；右下角提示新版本并可直接下载安装包；设置页「检查更新」
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
  - **照片方向校正**：`Photo.rotation`（0/90/180/270）仅影响显示；卡片一键向左 90°，详情页左右旋转/重置；旋转后宽高交换并自动切换画框，原图不改
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

`Photo` 新增可选字段：`mediaKind`、`libraryPath`、`previewPath`、`fileBytes`、`contentHash`、`metaSource`、`worldInstanceId`、`worldIdSource`（`scan` / `ai` / `manual`）、`rotation`（`0` / `90` / `180` / `270`，仅显示旋转）、`missing`、`managedCopy`、`syncState`；AI 总结字段：`aiSummary`、`aiTags`、`aiModel`、`aiUpdatedAt`、`aiState`、`aiError`。

`AlbumSettings` 新增：`backgroundEffect`（9 种，含 `video`）、`experimentalEffects`（实验性背景开关，默认 `false`）、`customBackgroundSrc`、`customBackgroundName`（上传背景压缩后的 data URL，随相册/备份保存）、`customVideoKey`（客户端为 `.hoshikuzu/backgrounds/` 文件名，网页为 IndexedDB key）、`customVideoName`、`customVideoPoster`（首帧 JPEG data URL）、`customVideoMime`、`customVideoBytes`、`customVideoWidth/Height`。

`hoshikuzu-media://` 新增 `background/<sha1>.webm|mp4` 主机名，只读取库内 `.hoshikuzu/backgrounds/`；校验文件名格式并支持 Range 请求。

桌面端加载时把相对路径水合为：
`hoshikuzu-media://preview/<hash>.webp`、`hoshikuzu-media://original/<相对路径>` 或 `hoshikuzu-media://background/<sha1>.webm`。

客户端配置（窗口位置、当前库路径、onboarding、AI/传输/EasyTier/云同步/代理/VRChat 设置）：`%APPDATA%/hoshikuzu-album/config.json`；便携版在 exe 同级 `data/`。`secrets` 段只存 `safeStorage` 加密后的密文：`aiApiKey`、`transferToken`、`easytierSecret`、`syncWebdavPassword`、`syncGoogleClientSecret`、`syncGoogleAccessToken`、`syncGoogleRefreshToken`、`syncBaiduSecretKey`、`syncBaiduAccessToken`、`syncBaiduRefreshToken`、`syncWebsiteToken`、`vrchatPassword`。

代理配置位于 `config.proxy`：`mode`（`system` / `none` / `http` / `socks5` / `pac` / `custom`）、`httpUrl`、`socksUrl`、`pacUrl`、`customRules`、`bypass`。VRChat 配置位于 `config.vrchat`：`username`、`apiBase`（默认 `https://api.vrchat.cloud`）。登录 Cookie 存在 `persist:hoshikuzu-vrchat` 分区。

云同步配置位于 `config.sync`：`cloud`（provider、folderRoot、baseFolder、WebDAV 地址/用户名、Google Client ID、百度 AppKey/应用目录、跳过已同步、上传元数据）、`website`（endpoint、includePreviewImages、maxPayloadMb）、`state.cloud` / `state.website`（最近同步时间、结果、数量）。云盘去重清单在库内 `.hoshikuzu/sync/manifest.json`，可重置；`hoshikuzu-library.json` 的 `sync.lastSyncAt/provider` 会在成功后更新。

手机同步配置位于 `config.mobile`：`enabled`（下次启动自动开启）、`port`（默认 7880）、`preferredIp`（局域网网卡地址）、`receiveMode`（`stream` / `save`）。配对令牌不入库，每次开启随机生成，仅保存在主进程内存；手机 Cookie 有效期 12 小时。

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
    useMobileCast.tsx           # 桌面手机同步状态订阅、投送动作与提示
    useAdminAuth.ts
    useHashRoute.ts
    useToast.tsx
  mobile/
    entry.ts                    # 判断 /m 入口（仅手机客户端加载）
    api.ts                      # 手机端相册类型、配对请求、原图/缩略图、保存到手机
    MobileApp.tsx               # 手机时间轴、搜索筛选、全屏查看、长按上滑保存、投送浮层、模式切换
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
    UpdateNotice.tsx            # 右下角新版本提示（下载 / 更新说明 / 稍后）
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
    MobilePage.tsx              # 手机同步：开关、二维码、局域网地址、设备、投送方式
    SettingsPage.tsx            # 桌面备份 / 网页备份迁移
    NetworkPanel.tsx            # 网络代理：6 种模式、绕过地址、连通性测试
    UpdateCard.tsx              # 检查更新、下载安装包
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
    mobile-sync.css             # 手机同步管理页（二维码、模式卡、设备、网络字段）
    mobile-client.css           # 手机客户端独立样式（时间轴、查看器、投送浮层、safe-area）
    cast.css                    # 桌面长按上滑投送层、卡片投送提示、详情投送按钮
    effects.css                 # 动态背景层、亚克力、极光、自定义背景
    orientation.css             # 照片旋转画框、详情旋转、方向面板
    update.css                  # 右下角新版本提示
desktop/
  main.cjs                      # 窗口、协议（含 background）、IPC、菜单、扫描/导入/备份、冒烟
  preload.cjs                   # window.hoshikuzu.desktop（library/media/backup/background/network/vrchat/ai/easytier/transfer/mobile）
  config.cjs                    # 配置深合并 + safeStorage 密钥
  dev.cjs / smoke.cjs / make-icon.cjs / run-tests.cjs
  ipc/advanced.cjs              # AI / EasyTier / 传输 IPC 与自动启动
  ipc/mobile.cjs                # 手机同步 IPC：开关/端口/二维码/投送/断开/自动启动
  ipc/network.cjs               # 代理与 VRChat 官方资料 IPC
  ipc/update.cjs                # GitHub Release 更新检查、启动提示、打开下载页
  services/
    ai.cjs                      # 四协议、模型列表、视觉判断、主备、图片预处理、AI 方向检测
    mobile-sync.cjs             # 手机客户端 HTTP/SSE 服务：静态 SPA、配对、相册 API、Range 原图、投送
    transfer.cjs                # 接收 HTTP、令牌、串行入库；发送流式上传
    easytier.cjs                # 组件检测/下载/参数/启动/状态/日志/提权
    sync.cjs                    # 云同步 IPC、配置、密钥、任务状态
    sync-core.cjs               # 纯同步引擎：日期文件夹、folder/WebDAV/Google/Baidu、网站同步
    proxy-config.cjs            # 纯代理规则映射（可单测）
    network.cjs                 # Electron 会话代理应用、resolveProxy、连通性测试
    vrchat.cjs                  # 官方登录/2FA/状态/世界查询/封面下载与批量任务
    update-check.cjs            # 版本比较、仓库 URL 白名单、安装包选择（纯函数）
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
mobile-android/                 # Android APK 工程（完整原生外壳）
  app/src/main/java/com/hoshikuzu/mobile/
    MainActivity.java           # 连接页、zxing 扫码、WebView、错误/返回/常亮
    SaveBridge.java             # window.HoshikuzuAndroid.saveUrl 桥
    NativeDownloader.java       # Cookie 流式下载 → Downloads/Hoshikuzu（MediaStore / 旧版）
  app/src/main/res/             # 深色连接页、图标、主题、网络安全配置
  app/src/test/                 # Robolectric 8 项测试
  apk/                          # 已构建 APK + SHA-256（可侧载）
  README.md                     # 构建、安装、权限与测试说明
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
   - 方向校正（1.0.1）：`Photo.rotation` 与 `photoRotation/orientedDimensions/rotatePhoto`；卡片 `photo-card--rotate-*` + 一键向左 90°，`Hero` `feature-card--rotate-*`，详情 `detail-media--rotate-*` + 「照片方向」左右旋转/重置。`styles/orientation.css` 用 `container-type: size` + `cqw/cqh` 交换图片宽高后再 `rotate()`，卡片保持 `object-fit: cover`，详情用 `contain` 完整显示；原图字节不变，旋转随相册/备份保存。
   - 网络代理：`proxy-config.cjs` 纯规则映射（单测覆盖 6 模式）；`network.cjs` 应用 `setProxy` 到默认会话与 `persist:hoshikuzu-vrchat`，`closeAllConnections` 使切换即时生效；`ipc/network.cjs` 提供 get/set/test IPC，测试后恢复已保存配置；`NetworkPanel.tsx` 提供模式、地址、绕过与测试 UI。
   - VRChat 官方封面：`vrchat.cjs` 使用独立持久会话登录（Basic + TOTP/emailotp）、检查状态、登出清 Cookie；`/worlds/{id}` 读取官方字段；封面仅允许 `*.vrchat.cloud|com` 并压缩 512px WebP data URL；`fetchCovers` 220ms 间隔、最多 500 个、可取消；`ipc/network.cjs` 暴露 IPC；`VRChatPanel.tsx` 提供登录/2FA/记住密码/进度/取消；`useAlbum.applyWorldCovers` 合并官方资料且不覆盖人工名称。
   - 单测新增 5 项代理规则映射（总计 33 项）；冒烟新增横竖卡片、`background` IPC + 协议 200、代理 6 模式应用/恢复、世界资料库官方面板断言与 `01b-timeline.png` / `03f-worlds.png` 截图。
22. **AI 方向检测与更新提示（1.0.2）**：
   - AI 方向：`ai.cjs` 新增 `buildOrientationPrompt` / `parseOrientationResponse` / `detectOrientation`。提示词明确「只看角色头顶（发旋/耳朵上方）朝向，不判断面朝哪边；没有人物主体时按 16:9 风景处理 rotation=0」。解析器只信 `head` 并自行换算（right→270、left→90、down→180），低置信度（<0.45）不自动改。IPC `ai:detect-orientation` 与批量 `mode='orientation'`；只处理无 rotation 且宽高比 1.68–1.86 的横图。详情页「AI 检测方向」，AI 面板「AI 校正方向」批量按钮与进度。
   - 更新提示：`update-check.cjs` 纯函数（版本比较、仓库 URL 白名单、setup/portable 资产选择）+ `ipc/update.cjs`（经 `network.networkSession()` 请求 GitHub `releases/latest`，15s 超时、5 分钟缓存、启动 4.5s 后检查、smoke 跳过自动检查）；`UpdateNotice` 右下角横幅显示版本/体积/下载/说明/稍后，按版本记录 dismissed；设置页 `UpdateCard` 手动检查。
   - 单测新增 8 项（AI 方向解析 3、AI 方向 mock 1、更新检测 4；总计 41 项）；冒烟 `settings extras` 验证 `update.check()` 返回 ok 且 latest=1.0.2，并用 1.0.0 版本号实测右下角更新横幅。
23. **手机客户端与局域网双端同步（1.1.x）**：
   - `mobile-sync.cjs`：独立 HTTP 服务（默认 7880），提供 `/m/<token>` 配对、`/m` SPA、`/api/mobile/hello|album|events|mode|leave`、`/api/mobile/photos/:id/thumb|original`（Range + 下载文件名）。SSE 活跃设备数为 0 时投送返回明确错误；`album` 保存后广播刷新；模式切换双向广播。
   - `buildMobileAlbum` 只输出手机可读字段和同源 URL，跳过缺失/内嵌 data URL 照片，保留 rotation、世界名与安全的原图文件名；不泄露 libraryPath、previewPath、AI 状态或活动日志。
   - `ipc/mobile.cjs`：开启/关闭、端口/网卡/模式、二维码（`qrcode` 生成 data URL）、刷新令牌、投送、断开设备、启动自动恢复；`config.mobile` 保存 enabled/port/preferredIp/receiveMode。
   - 桌面 UI：管理台新增「手机同步」页（`MobilePage.tsx` + `mobile-sync.css`），含二维码、局域网网卡选择、端口、模式卡、在线设备、使用步骤；`PhotoCard` 长按 380ms + 上滑 56px 投送层（`cast.css` + portal），卡片手机按钮与详情「投送到手机」；`useMobileCast` 统一状态订阅、投送与 toast。
   - 手机 UI：`/m` 独立懒加载 chunk，`MobileApp.tsx` 含两列月分组时间轴、搜索/年份/世界筛选、全屏查看左右滑动、长按上滑保存、投送接收层（实时查看 / 保存 / 关闭）、顶部在线状态与模式弹层；`api.ts` 处理配对、SSE、原图下载（Web Share 可用时分享，否则 blob 下载）、文件名与方向比例。
   - 安全/性能：HttpOnly + SameSite=Strict 配对 Cookie（12h）、令牌每次开启随机；`no-store` 原图、内容寻址缩略图缓存；复用 repository 的 realpath 越界防护；手机端不碰桌面 localStorage；`src/mobile` 不进入公开站首屏。
   - 单测新增 6 项（总计 47）；冒烟新增 4 张截图与二维码、390×844 手机页面、SSE 在线、投送浮层、双端模式同步、桌面长按上滑释放与 toast 断言。
   - **Android APK**：`mobile-android/` 原生工程；`MainActivity` 连接页（扫码/手动/粘贴/记住地址）、WebView 加载 `/m`、403 配对过期/网络错误回到连接页、返回键先关网页浮层再弹刷新/切换/退出、连接后常亮；`SaveBridge` + `NativeDownloader` 用 WebView Cookie 流式保存原图（MediaStore / 旧版权限），网页 `src/mobile/native.ts` 检测桥并优先走原生保存；`mobile-android/README.md` 记录构建与安装。APK `1.1.1`（4.4MB，debug key 的 release 变体，minSdk 26/targetSdk 34）已放入 `mobile-android/apk/` 与 `release/`；Robolectric 8 项测试通过，`aapt`/`apksigner` 校验通过。受限于本机没有可用的 Android 模拟器加速，尚未真机启动。

---


## 8. 验证状态

已通过：

- `npm run build`（TypeScript + Vite；管理台已拆分懒加载 chunk）
- `npm run test:desktop`（47 项）：
  - 存储：XMP、VRCX JSON、文件名、PNG chunk、mtime、扫描/预览/统计、ZIP 备份恢复
  - 缩略图：缓存目录/预设校验、`hash_边_q质量` 命名、旧名兼容、扫描跳过缓存目录、样张不进库、原图字节不变
  - **手机同步：手机相册裁剪/排序/相对 URL/原图文件名、缺失/内嵌照片跳过、featured 清理、模式与 Cookie 归一化、网卡排序、配对 401→Cookie→302、缩略图/原图/Range、模式切换、SSE 投送送达、原图只读（`mobile-sync.test.cjs`）**
  - 云同步：日期文件夹/清单去重/强制重传/元数据、网站 payload 与 Bearer 鉴权、WebDAV MKCOL/PUT、原图只读
  - 代理：6 种模式规范化、host:port 解析、HTTP→fixed_servers、SOCKS5/自定义规则、PAC/system/direct 映射（`network.test.cjs`）
  - 方向：AI 方向提示词包含头顶/16:9 规则、解析器 head→rotation 映射、landscape 强制 0、mock 视觉模型返回 head=right→270（`ai.test.cjs`）
  - 更新：版本比较、仓库 URL 白名单、setup/portable 资产选择、当前版本不低于最新时不提示（`update.test.cjs`）
  - AI：四协议端点/请求体、模型列表、视觉过滤、JSON 解析、主备切换、World ID 响应解析与识图识别（本地 mock，无真实 Key）
  - 传输：本地接收/发送、令牌 401、重复去重、路径安全
  - EasyTier：组件资产选择、启动参数、TOML、状态解析、自定义参数
- `npm run desktop:smoke`：新品牌/标题栏、自动扫描 4 张（含 1 张 300×480 竖图、1 张横躺竖拍样张）、**横竖卡片断言（portrait=1 / landscape=3 / 首页精选竖图）**、**横躺竖拍旋转断言（卡片一键 270°、画框变竖、详情图片旋转且不溢出）**、XMP/JSON 识别 2 个世界、外观面板与动态背景（实验性黑洞/雨幕/亚克力/极光）、**视频背景卡片**、实验性开关的隐藏/显示门控、管理台概览/照片/设置（懒加载 CSS 正常）、**6 种代理模式应用与恢复**、**视频背景 IPC 写入 + `hoshikuzu-media://background/` 返回 200 + 删除**、**GitHub 更新检查 IPC（ok，latest=1.0.2；当前 1.1.0 不提示；另用 1.0.0 版本号实测右下角横幅显示）**、**世界资料库 VRChat 官方面板/API 地址字段**、云同步页渲染与 7 个 provider、WebDAV 密钥 safeStorage 写入、云同步状态、**手机同步开启/二维码 data URL/390×844 手机页面渲染 4 张/SSE“电脑在线”/投送浮层/双端模式同步/桌面长按上滑投送层与成功 toast**、高级设置（EasyTier/接收/发送/AI/AI 识图批量面板）、safeStorage 写入验证、亮色主题
- `npm run desktop:smoke:onboarding`：第 1 步首启向导
- `npm run desktop:smoke:thumbnails`：第 2 步 5 档卡片、随机样张 A/B、生成进度 17/17 并提示完成、建立 `缩略图缓存`、扫描后时间轴缩略图可显示；未滚动时网格加载 0 张、滚动后预测加载 12 张；切换实时模式仅 4 张、预先模式预取 17/17、切回预测恢复 12 张；点开详情后原图 `naturalWidth>0` 且状态显示「原图」
- `npm run desktop:dev`：Vite + Electron 开发模式，标题栏渲染、`data-desktop` 生效、无 CSP 告警
- `release/win-unpacked/VRchat时间轴纪念相册.exe`：1.1.1 重新打包后以 `HOSHIKUZU_SMOKE=1` 启动，完整冒烟通过（exit 0）；1.0.2 包此前也已验证
- `release/VRchat-Timeline-Album-1.1.1-portable.exe`：1.1.1 便携测试版，以 `HOSHIKUZU_SMOKE=1` 启动并通过完整冒烟（exit 0，生成手机同步截图）；与 `release/win-unpacked` 同源
- `release/VRchat时间轴纪念相册-1.1.1-x64.exe`：1.1.1 NSIS 本地测试包（未签名，未上传）
- `mobile-android/apk/VRchat-Timeline-Album-Mobile-1.1.1.apk`：Android 客户端；`aapt` 确认 package/version/minSdk/targetSdk/launchable activity，`apksigner` v2 校验通过；Robolectric **8/8** 通过
- `release/VRchat时间轴纪念相册-1.0.2-x64.exe` / `release/VRchat-Timeline-Album-1.0.2-portable.exe`：线上 Release `v1.0.2`（未签名）
- 60MP（10000×6000）JPEG：扫描成功，缩略图限制为 1600×960，原图不受影响
- 存储 CLI：14 张示例图扫描、14 张预览、统计
- EasyTier 官方组件下载实测：v2.6.4 Windows x86_64 包下载、SHA-256 校验、解压、递归检测到 `easytier-core.exe` / `easytier-cli.exe` / `wintun.dll`，版本 2.6.4
- 标准桌面冒烟 27 张截图（新增手机同步 `03g-mobile-sync.png`、手机页面 `03h-mobile-client.png`、投送浮层 `03i-mobile-incoming.png`、桌面投送层 `03j-mobile-cast.png`）

尚未做真实环境验证（下次继续）：

- **Android APK 真机**：安装/启动、相机扫码、WebView 配对 Cookie、投送接收、两种保存模式（Downloads/Hoshikuzu 实际落点）、Android 8/9 存储权限、后台/锁屏 SSE、返回键浮层关闭；本机无 AEHD/WHPX，模拟器无法启动
- 真实手机扫码配对、iOS Safari / Android Chrome 的下载/保存流程、手机长时间保持前台时的 SSE 稳定性、203 张库在手机上的滚动性能
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
- 有些手机竖拍 / VRChat 手机相机截图会把画面以 1920×1080 横向像素保存，且没有 EXIF 旋转标记；程序无法仅凭像素尺寸判断内容方向，需要在卡片或详情里手动旋转一次。旋转角度随照片保存，重新扫描不会丢失。
- AI 方向检测需要先在高级设置配置视觉模型（API Key + 模型）；会按张调用第三方视觉 API，产生费用。只检测 16:9 横图，低置信度（<0.45）不会自动旋转；模型误判时可用手动旋转覆盖。
- 更新检测通过 GitHub API（经当前代理）读取最新 Release；大陆网络未配置代理时可能失败。安装包需手动下载安装，不做静默自动更新；安装包未签名。
- VRChat 官方 API 需要登录；密码登录受 VRChat 自身风控与 2FA 限制，不保证所有账号可用。封面以 data URL 写入世界资料，数量很多时会增大 `hoshikuzu-library.json`（每张约 10–30KB）。
- 代理测试会实际请求 VRChat `config`，网络不通时只影响测试结果；PAC 与自定义规则依赖 Chromium 规则语法。代理地址中暂不支持内嵌用户名/密码，请使用免认证的本地代理端口。
- 银河黑洞是实验性背景，默认隐藏，需在管理台开启「实验性背景」；依赖 WebGL，不可用时回退 CSS；动态背景在 `prefers-reduced-motion` 下静态化。
- **手机同步只监听局域网 HTTP（非 HTTPS）**：Web Share / 剪贴板 API 在部分浏览器不可用，保存走浏览器下载；iOS 切到后台会挂起页面导致 SSE 断开，回到前台会自动重连并重新拉取相册；Windows 防火墙未放行端口时手机打不开；投送模式目前是全局设置，所有已连接手机共享。二维码链接本身即配对凭证，服务开启期间请勿公开分享。
- **Android APK**：`minSdk 26`（Android 8+），`targetSdk 34`；release 变体使用本机 debug key 签名，适合侧载测试，不适合上架。APK 默认进入**本地相册**，不要求连接电脑；连接电脑是可选的 `/m` 远程/投送模式。Android 8/9 首次保存会请求存储权限，Android 10+ 存到 `下载/Hoshikuzu/`。WebView 在锁屏/后台仍会被系统限制，投送只在页面保持前台时最可靠；真机相册导入、AI/云同步账号、不同厂商 WebView 兼容性尚未验证。
- P2P 接收端绑定 `0.0.0.0`，依赖分享码保护；只应在可信虚拟网络使用。
- `safeStorage` 绑定 Windows 用户；便携盘换机后需重新输入密钥。
- 未做代码签名与自动更新；安装时可能触发 SmartScreen。
- 起始照片与内置世界为虚构示例。

---

## 10. 继续开发时

- 保持默认「暮色紫 · 星轨交错」不被破坏。
- **共享改动**：`src/` 下的 UI / 数据模型 / `albumStorage`；改完同时验证网页与客户端。
- **客户端专属**：`desktop/**`、`src/platform/**`、`src/hooks/useDesktopLibrary.tsx`、`src/hooks/useDesktopServices.tsx`、`src/admin/advanced/**`、`src/styles/desktop.css`、`src/styles/advanced.css`。
- **手机客户端**：`src/mobile/**` 只在 `/m` 入口懒加载；不要从公开站组件静态 import，也不要让手机端走 `useAlbum`/localStorage。改相册字段时同步 `buildMobileAlbum`（`desktop/services/mobile-sync.cjs`）与 `src/mobile/api.ts` 的 `MobilePhoto`；改配对/投送/媒体路由后跑 `desktop/services/__tests__/mobile-sync.test.cjs` 与 `npm run desktop:smoke`（含 4 张手机相关截图）。桌面投送手势在 `PhotoCard.tsx` + `useMobileCast.tsx` + `styles/cast.css`，长按阈值 380ms、上滑阈值 56px，改动时保留按钮/详情两条等价入口。
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
  - `Photo.rotation`（0/90/180/270）是仅显示旋转；必须同步 `types.ts`、`albumStorage.sanitizePhoto`、`utils/orientation.ts`、`PhotoCard/Hero/PhotoDetailDialog` 与 `styles/orientation.css`。旋转后宽高交换由 `orientedDimensions` 处理，卡片用容器查询单位 `cqw/cqh` 交换 `<img>` 宽高再 `rotate()`，详情用 `object-fit: contain`。
  - 旋转不得改写原图或缩略图文件；`applyScan` 必须保留 `previous.rotation`。备份/网页同步会随 `Photo` 自动携带。
- **AI 方向检测**：提示词只要求模型判断“头顶指向”（up/right/down/left），角度换算必须在 `parseOrientationResponse` 完成（right→270、left→90、down→180），不要依赖模型算术。`landscape` 强制 rotation=0；selfie 非零旋转置信度 <0.45 不自动应用。批量只处理无 rotation 且宽高比 1.68–1.86 的横图；改提示词后跑 `ai.test.cjs`。
- **更新检测**：版本比较/资产选择/URL 白名单在 `desktop/services/update-check.cjs`（纯函数，跑 `update.test.cjs`）；网络与 IPC 在 `desktop/ipc/update.cjs`，必须走 `network.networkSession()` 以复用代理。只允许打开 `https://github.com/GhostQAQ-VRC/-/releases/` 下的链接；不得静默下载/安装。客户端版本号由 `package.json` 决定，发布新版本时同步 `package-lock.json` 与 Release tag。
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
- Release：<https://github.com/GhostQAQ-VRC/-/releases/tag/v1.0.2>
- 安装版资产：`VRchat-Timeline-Album-1.0.2-x64-setup.exe`（111,958,507 bytes）
- 便携版资产：`VRchat-Timeline-Album-1.0.2-portable.exe`（103,148,926 bytes）

包含：源码、`dist`、`desktop/**`、`build/icon.*`、README / HANDOFF / electron-builder 配置；不包含 `node_modules`、`release`、`.smoke*`、`.tmp-*`、`.zcode`。

---

## 12. 下一个对话建议

本版本已交付：网页 + Electron 客户端、独立存储库、两步首启与 5 档缩略图、三档图片加载策略、照片横竖识别与横躺竖拍旋转校正、AI 方向检测（角色头顶规则 / 16:9 风景不旋转）、客户端更新提示、EasyTier/P2P、AI 总结与 AI 识图 World ID、9 种动态背景（含视频背景）、实验性黑洞、紫月品牌图标、云盘/网站云同步、网络代理管理、VRChat 官方世界封面拉取、**局域网手机客户端（扫码配对 / SSE 双端同步 / 长按上滑投送 / 实时查看或保存到手机）**。下面是下一轮建议，按优先级排列：

接手第一件事：让用户安装 **1.1.1 APK**（`mobile-android/apk/VRchat-Timeline-Album-Mobile-1.1.1.apk`），先验证**不连接电脑**的本地相册：系统相册导入、缩略图/原图、搜索/年份、外观/特效/加载策略、AI 设置与生成、WebDAV/Google/百度同步。再验证可选的「连接电脑」扫码、SSE 投送与原生保存。APK 尚未真机验证；如果装不上，先检查 Android 版本（需 8+）与未知来源安装权限。用户 2026-11-24 08:35/08:36 的几张 1920×1080 横躺竖拍照片仍需要一次手动旋转或 AI 方向检测。AI 方向需要先配置视觉模型（当前便携配置只有 API Key，没有模型/Base URL）。

1. **真实环境验证（P0）**
   - **手机同步真机**：iPhone Safari 与 Android Chrome 各扫码一次，验证 12h Cookie 重开、二维码刷新后旧链接失效、页面切后台再回来 SSE 重连、原图查看/长按保存/下载文件名、投送两种模式；再用 203 张真实库测滚动与首屏时间。
   - 用真实视觉模型跑一次「AI 校正方向」：验证角色头顶规则、16:9 风景不旋转、低置信度回退与批量费用；重点测试侧面自拍、多人合照、远景小人物。
   - 用真实 VRChat 账号跑一次登录（含 TOTP/邮箱 2FA）与「拉取全部封面」，分别测试系统代理 / HTTP / SOCKS5 / PAC；确认中国大陆网络下的超时与 429 提示是否清晰。
   - 发布新版后启动旧版客户端，验证右下角更新提示、下载链接与“稍后”记忆；未配置代理时确认手动检查的错误提示。
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
