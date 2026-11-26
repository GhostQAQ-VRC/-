# VRchat时间轴纪念相册 · 本地客户端

Electron 桌面客户端，与网页共用同一套 `src/` UI 与数据模型。客户端额外提供：

- 自定义标题栏（无边框窗口、窗口状态记忆、单实例）
- 用户自选/新建的**独立存储库**文件夹
- 递归扫描照片、读取 VRChat 照片内嵌的拍摄时间与 World ID
- 原图落盘（不压缩、不设体积上限）+ 独立缩略图缓存（5 档规格，点开单张才加载原图）
- **EasyTier 虚拟组网 + P2P 原图传输**（分享码、自动入库、去重）
- **AI 视觉模型回忆总结**（OpenAI 兼容 / Anthropic / Gemini / Ollama，主/备模型）
- **AI 识图 World ID**（读取 VRChat 拍立得画面中印出的 `wrld_…` 并自动关联世界）
- **VRChat 官方世界资料**：登录官方账号后批量拉取资料库中 World ID 的名称、作者、简介与封面（512px WebP 入库，离线可用）
- **网络代理管理**：跟随系统 / 直连 / HTTP / SOCKS5 / PAC / 自定义规则，可测试连通性，作用于官方 API 与渲染层远程请求
- 动态背景与自定义背景（与网页共用，7 主题 × 4 布局；银河黑洞为实验性背景，须在管理台开启；新增循环视频背景）
- 照片横竖识别：按原图比例区分横图 / 竖图 / 方图，避免竖拍自拍被统一裁成横向
- 照片方向校正：卡片一键向左旋转 90°，详情页可向左 / 向右旋转或重置；只改变显示，原图不变
- **AI 方向检测**：按「角色头顶朝上；没有人物时 16:9 风景不旋转」的规则调用视觉模型，单张或批量校正 16:9 横图
- **更新提示**：启动后经当前代理检查 GitHub Release，发现新版本时右下角提示下载；设置页可手动检查
- 原生文件对话框、拖入导入、整库 ZIP 备份、网页 JSON 备份迁移
- 云同步：云盘（客户端目录 / WebDAV / Google Drive API / 百度网盘 API）按日期上传原图；网站同步 POST 相册数据
## 快速开始

```bash
npm install
npm run desktop:icon       # 生成 build/icon.png + build/icon.ico（ICO 需要 Pillow）
npm run desktop:dev        # 启动 Vite + Electron（开发）
npm run desktop:smoke      # 生产构建 + 自动截图冒烟测试
npm run desktop:pack       # 生成 release/win-unpacked（免安装目录）
npm run desktop:dist       # 生成 NSIS 安装包 + 便携版
```

首次启动会显示存储库向导：新建/选择一个文件夹，或先用示例相册体验。

当前构建产物（`release/`）：

- `VRchat时间轴纪念相册-1.0.2-x64.exe`：NSIS 安装包（未签名）
- `VRchat-Timeline-Album-1.0.2-portable.exe`：便携版
- `win-unpacked/`：免安装目录

## 存储库结构

原图**留在原地，不移动、不压缩、不删除**。客户端只建立索引，并把显示用缩略图写入你在首启第 2 步指定的新文件夹：

```text
<你选择的文件夹>/
  hoshikuzu-library.json          # 权威元数据（相册、世界、设置、同步状态）
  缩略图缓存/                      # 首启第 2 步新建的缩略图目录（可改名）
    <contentHash>_<边>_q<质量>.webp # 只读原图生成的 WebP，可随时删除并重建
  .hoshikuzu/
    index.json                    # 扫描缓存（按路径 + 修改时间复用）
    backups/metadata-*.json       # 自动元数据备份，保留最近 10 份
    sync/manifest.json            # 云盘同步去重清单，可重置
    backgrounds/<sha1>.webm       # 视频背景（自动去音轨、按质量压缩后缓存）
  _inbox/YYYY-MM-DD/              # 客户端导入的新图副本（源文件不动）
  <你原有的照片目录结构>           # 只读索引
```

旧版本存储库仍然使用 `.hoshikuzu/previews/<contentHash>.webp`，升级后继续可读。

`hoshikuzu-library.json`：

```json
{
  "format": "hoshikuzu-library",
  "version": 1,
  "library": {
    "id": "…",
    "name": "我的照片库",
    "createdAt": "…",
    "thumbnailDir": "缩略图缓存",
    "thumbnailsConfigured": true,
    "previewPreset": "balanced",
    "previewMaxEdge": 1600,
    "previewQuality": 82,
    "imageLoadingMode": "predictive",
    "autoScan": true,
    "watch": false,
    "ignoredHashes": []
  },
  "album": { "version": 2, "photos": [], "worlds": [], "settings": {}, "activity": [] },
  "sync": { "enabled": false, "provider": "none", "endpoint": "", "lastSyncAt": null }
}
```

`sync.lastSyncAt` / `sync.provider` 会在云盘或网站同步成功后更新；详细配置与密钥在客户端 `config.json`，去重清单在 `.hoshikuzu/sync/manifest.json`。
```

整个文件夹可以拷到另一台电脑，重新选择为存储库即可继续使用；卸载客户端不会删除库内数据。

## 照片识别规则

按以下来源识别拍摄时间与 World ID（`wrld_…`）：

1. PNG 的 `iTXt` / `tEXt` / `zTXt` 文本块
   - `XML:com.adobe.xmp`：VRChat 原生 XMP
   - `Description`：VRCX 写入的 JSON（`world.id`、`world.name`、`Timestamp` 等）
2. JPEG / WebP / HEIC 等的 EXIF / XMP（通过 `exifr`）
3. VRChat 文件名：`VRChat_2024-05-01_20-30-45.123_1920x1080.png`
4. 文件名中的 `wrld_…`
5. 文件修改时间（最后兜底）

每条照片会记录 `metaSource`（xmp / json / exif / filename / mtime），管理台可查看来源。扫描不会覆盖你手动改过的拍摄时间或世界关联；重新扫描只刷新派生字段。

识别到 World ID 时，会自动在「世界资料库」建立条目（名称取图片元数据或短 ID 占位），并把照片关联过去。

## 图片与显示

- 原图：不压缩、不设体积上限（受磁盘容量限制），客户端只读。
- 首启第 2 步会在存储库根目录新建缩略图文件夹，并提供 5 档规格（会把原图随机抽一张做 A/B 对比，并给出实测体积与滚动流畅度提示）：
  - 羽量 960px / Q66：最轻，老机器与大库最流畅
  - 轻快 1280px / Q74：笔记本与核显推荐
  - 均衡 1600px / Q82：默认
  - 清晰 1920px / Q86：高分屏，滚动略重
  - 细腻 2560px / Q90：接近原图，低配快速滚动可能卡顿
- **网格、卡片、首屏、管理台列表只加载缩略图**；缩略图未生成时显示占位，绝不回退到原图。
- **只有点开单张照片详情时**，才会请求该照片的原图，并在缩略图上淡入；详情背景仍用缩略图，不会重复加载原图。
- **照片方向**：卡片按原图比例使用横图 / 竖图 / 方图画框。部分手机竖拍或 VRChat 手机相机截图会把竖画面存成 1920×1080 横向像素，且没有 EXIF 旋转标记；这类文件无法仅凭宽高自动判断。卡片悬浮操作有「向左旋转 90°」，详情页的「照片方向」可以向左 / 向右旋转或重置，也可以点「AI 检测方向」让视觉模型按“角色头顶朝上”规则判断；旋转只改变相册显示，原图字节不变，并随相册保存。
- 首启第 2 步确认规格后会立即开始全库生成，向导内显示索引/压缩进度条；完成时提示「全部 N 张缩略图已生成」，也可先进入相册让后台继续。
- 三种图片加载策略（管理台 → 站点设置 → 存储库）：
  - **实时加载**：只加载视口附近的缩略图，离开后立即释放解码图，占用最低；
  - **预测加载（默认）**：可见照片 + 按滚动方向预取约 10–20 张（约 5%）；高分辨率规格会自动减少预测张数以控制显存；
  - **预先加载**：后台用低并发 `fetch` 把所有缩略图字节读入缓存，但不提前解码，因此不会明显增加 GPU；之后滚动直接从缓存读取。
- 时间轴卡片由统一加载器门控：不在窗口内的 `<img>` 会被卸载，释放 GPU 解码内存；滚动回来时从缩略图缓存快速恢复。
- 缩略图在后台生成（并发按 CPU 核数自适应，最多 2）；文件名为 `hash_边_q质量.webp`，可同时存在不同规格，切换规格不会读错旧缓存。
- 缩略图协议带 `immutable` 缓存头，滚回已看过的照片无需重新解码；清理缓存后可重新生成。

## 动态背景与自定义背景

入口：公开站头部「外观」或管理台 → 站点设置 → 外观与布局。背景与配色、布局独立组合，选择后写入相册设置并即时生效。

- **星轨**（默认）：Canvas 星尘漂移与偶尔的流星。
- **雨幕**：Canvas 雨丝 + 玻璃水滴；雨滴落到屏幕后沿玻璃滑落并留下水痕。亮色主题使用浅色水雾/水珠。
- **亚克力**：磨砂玻璃面板、柔和流动光与边缘高光；亮/暗主题分别有对应的亚克力层。
- **银河黑洞**（实验性）：默认隐藏。管理台 → 站点设置 →「实验性背景」开启后，才会出现在公开站外观面板与设置页的背景列表中；关闭开关时若正在使用会回退到星轨。WebGL 片元着色器实时绘制事件视界、光子环、倾斜吸积盘、多普勒增亮、引力透镜、闪烁星空、流星与被吸入的螺旋尘埃；黑洞中心缓慢左右漂移。WebGL 不可用时自动回退到 CSS 径向渐变 + 星轨。
- **樱吹雪 / 极光 / 萤火**：Canvas/DOM 动画，支持 `prefers-reduced-motion` 静态回退。
- **自定义图片**：上传 JPG / PNG / WebP / AVIF，客户端在渲染层压缩到最长边 1920px，保存为 `settings.customBackgroundSrc` data URL（上限约 4.5MB）；可替换或移除。
- **视频背景**：导入 MP4 / WebM / MOV 等常见格式。小于 24MB 且为网页友好容器时直接使用；更大的文件会在渲染层用 Chromium 解码 + MediaRecorder 重编码为 VP9/VP8 WebM：去除音轨（画面无损）、长边限制 1920px、按目标体积选择最高可用码率，必要时做一次 65% 码率的高质量二次压缩。客户端把结果写入 `<库>/.hoshikuzu/backgrounds/<sha1>.webm`，`settings.customVideoKey` 指向该文件；网页版写入 IndexedDB。首帧会保存为 poster data URL，视频解码前/失败时显示。
- 动态层固定为 `z-index: -2` 且 `pointer-events: none`，不阻挡交互；深色特效配浅色主题时会提示对比度风险。

## 网络代理

管理台 → 站点设置 →「网络代理」。代理同时作用于客户端默认会话（渲染层远程图片、世界查询代理）与 VRChat 官方 API 专用会话（`persist:hoshikuzu-vrchat`）。

| 模式 | 说明 |
| --- | --- |
| 跟随系统 | 使用 Windows/macOS 的系统代理与 PAC。 |
| 不使用代理 | 所有请求直连。 |
| HTTP | 例如 `http://127.0.0.1:7890`，同时用于 http 与 https（CONNECT）。 |
| SOCKS5 | 例如 `socks5://127.0.0.1:1080`，DNS 由代理解析。 |
| PAC | 填写 PAC 脚本的 http(s) 地址。 |
| 自定义规则 | 直接输入 Chromium 代理规则，如 `http=10.0.0.2:3128;https=10.0.0.2:3128`。 |

所有模式都可设置绕过地址（默认 `<local>`，保证本地开发服务器与库协议直连）。「测试连通性」会临时应用当前表单、解析实际代理规则并请求 VRChat 官方 `/api/1/config`，测试结束后自动恢复已保存配置。代理设置保存在客户端配置 `config.proxy` 中，不写入相册。暂不支持在代理地址中内嵌用户名/密码，请使用免认证的本地代理端口。

## VRChat 官方世界资料

管理台 → 世界资料库 →「从 VRChat 拉取世界封面」。

1. 使用 VRChat 用户名/邮箱 + 密码登录官方 API；支持 TOTP 或邮箱两步验证。
2. 「记住密码」会用系统 `safeStorage` 把密码加密写入本机配置（`secrets.vrchatPassword`），不上传、不写入相册或备份；登出会清除密码与登录 Cookie。
3. 点击「拉取全部封面」后，客户端按顺序请求资料库中所有有效 `wrld_…`，读取官方名称、作者、简介、人数与封面；每个封面压缩为 512px WebP data URL 写回 `WorldLibraryEntry.thumbnail`，之后离线可显示。
4. 人工改过的世界名称不会被覆盖；封面、作者、缺失简介与 `fetchedAt` 会刷新，`source` 标记为 `api`。世界资料更新会同步到所有关联照片。
5. 请求间隔约 220ms，最多 500 个 ID；可随时取消。API 默认 `https://api.vrchat.cloud`，高级选项里可改成自建镜像。

登录 Cookie 保存在独立持久会话中，关闭客户端后通常仍然有效；VRChat 会话过期后重新登录即可。

## 导入与删除

- 通过标题栏菜单 `Ctrl+O`、公开站「收录照片」或拖入文件导入。
- 新导入的图片会**复制**到 `_inbox/<日期>/`，源文件不动。
- 删除相册记录**不会删除原图**；该内容哈希会写入 `ignoredHashes`，避免下次扫描自动复活。
- 客户端复制进 `_inbox` 的副本可在照片编辑器里单独「删除本地副本」。
- 文件被移动/删除后，记录会标记「文件缺失」；修复文件后重新扫描即可恢复。
- 「重置忽略列表」后，下次扫描会重新发现之前移除的照片。

## 备份与恢复

- **导出完整库备份（ZIP）**：包含原图、预览、`hoshikuzu-library.json`。导出前会显示估算体积。
- **导出元数据**：只包含 `hoshikuzu-library.json`，体积很小。
- **导入备份**：
  - 完整库 ZIP：选择目标文件夹解压并切换为该存储库，窗口自动重载。
  - 网页 JSON 备份：内嵌的 data URL 图片会写入当前存储库并生成预览，链接照片保持链接。
- 自动元数据备份位于 `.hoshikuzu/backups/`，最多保留 10 份。

## EasyTier 虚拟组网

入口：管理台 → **高级设置**（`#/admin/advanced`）→ 虚拟组网。

- 组件：`easytier-core.exe` + `easytier-cli.exe` + `wintun.dll`（TUN 模式）。支持：
  - 自动检测 PATH / 常见安装目录；
  - 手动选择 `easytier-core.exe`（自动推导同目录 cli/DLL）；
  - 从官方 GitHub Releases 一键下载 `easytier-windows-x86_64-v*.zip`（约 31MB，**LGPL-3.0**，显示来源并校验官方 SHA-256 digest）。
- 组件目录：`%APPDATA%/hoshikuzu-album/components/easytier/`；便携版为 exe 同级 `data/components/easytier/`。
- 网络参数：
  - 网络名称 / 网络密钥（请使用 32 位以上随机值）；
  - 虚拟 IPv4（每个好友必须不同；留空则 DHCP）；
  - Peer/服务器列表（`tcp://host:11010`、`udp://host:11010`，可重复）；
  - 监听端口（默认 TCP/UDP 11010）、RPC 端口（默认 127.0.0.1:15888）；
  - 自动启动、免 TUN、自定义启动参数。
- **TUN 模式需要管理员权限**：创建 Wintun 虚拟网卡、加载 WinDivert 驱动。客户端会在启动前检测权限，并提供「以管理员身份重启」按钮（PowerShell `Start-Process -Verb RunAs`）。
- **免 TUN 模式**无需管理员：可被其他节点通过虚拟 IP 访问（TCP/UDP/ICMP），但本节点不能主动发起连接；适合仅接收端场景。
- 状态：`easytier-cli -p 127.0.0.1:<rpc> -o json peer list` / `node info`；`cost=1` 为直连 P2P，`cost>=2` 为 relay。界面显示本机虚拟 IP、对端、延迟/丢包/NAT 与日志。
- 公共节点：界面提供 `tcp://public.easytier.cn:11010` 示例，但官方不保证长期可用；建议自建共享节点。
- Windows 防火墙：首次监听会提示放行 11010 TCP/UDP；也可以手动加入站规则。
- 配置（非密钥部分）在 `%APPDATA%/hoshikuzu-album/config.json` 的 `easytier` 段；网络密钥使用 `safeStorage` 加密存于 `secrets.easytierSecret`。

## P2P 图片传输

双方都需要：桌面客户端 + 加入同一 EasyTier 网络 + 各自的虚拟 IP。

1. 接收方在高级设置 → 接收好友的照片：
   - 生成/填写分享码，开启接收端（默认端口 7878）；
   - 复制「虚拟 IP:端口 + 分享码」给好友；
   - 收到图片后自动复制到 `<存储库>/_inbox/transfer/<日期>/`，识别日期/World ID、生成预览并加入相册。
2. 发送方：
   - 填写好友地址（如 `10.144.144.3:7878`）与对方分享码；
   - 「测试连接」确认可达；
   - 选择照片（支持搜索/全选），发送原图；逐张进度与失败原因。
3. 传输协议：`POST /api/upload?name=...`，原始字节流，`Authorization: Bearer <分享码>`；接收端串行写临时文件，按内容哈希去重，单张 4GB 安全上限。
4. 安全：
   - 分享码 32 位随机 hex，`safeStorage` 加密保存；
   - `timingSafeEqual` 校验、单 IP 速率限制、文件名清洗、路径穿越校验；
   - 服务绑定 `0.0.0.0`，请只在可信虚拟网络使用；不要公开端口到公网。

## 手机客户端（局域网）

入口：管理台 → 手机同步。

1. 开启后桌面在局域网监听 HTTP（默认 7880，可在页面修改），同时提供手机 SPA `/m`、相册 API 与 SSE 事件流；页面显示可选的局域网网卡（Wi-Fi 优先）、二维码与链接。
2. 手机与电脑连同一个 Wi-Fi，扫码打开 `http://<IP>:<port>/m/<临时令牌>`；服务端校验令牌后写入 HttpOnly + SameSite=Strict Cookie（12 小时）并跳转 `/m`。二维码只在本机生成，每次开启/刷新都会轮换。
3. 手机端实时读取存储库相册：按月分组、搜索、年份/世界筛选、全屏查看；缩略图与按需原图由 `hoshikuzu` 手机服务提供，原图响应 `no-store`，不会写入手机存储。
4. 投送：
   - 电脑相册卡片长按 380ms 后向上滑 56px 松手；或卡片手机按钮 / 详情「投送到手机」；
   - SSE `cast` 事件送达所有在线手机，手机显示投送浮层；
   - 接收方式 `stream`（实时查看，不占手机空间）/ `save`（下载原图），可在任一端切换并实时同步。
5. 手机端长按照片向上滑可保存当前照片；保存使用浏览器下载，iOS 落在「文件」，Android 落在浏览器下载目录。
6. **Android APK**：`mobile-android/apk/VRchat-Timeline-Album-Mobile-1.1.0.apk`（约 2.8MB，Android 8+，debug key 签名）。原生连接页支持扫码/手动地址/剪贴板，配对后加载同一套手机版；保存原图由原生桥写入 `下载/Hoshikuzu/`（Android 10+ MediaStore，Android 8/9 请求存储权限）。硬件返回键会优先关闭查看器/投送浮层/模式弹层。APK 仍需电脑端开启手机同步。构建与安装见 `mobile-android/README.md`。
7. 安全与网络：
   - 仅局域网，不经过互联网；未开启或退出客户端即断开；
   - 配对令牌每次随机生成，Cookie HttpOnly；媒体读取复用存储库的 realpath 越界防护；
   - Windows 防火墙未放行端口时手机无法访问；投送模式目前是全局设置；二维码链接即配对凭证，请勿分享。

## AI 图像总结

入口：管理台 → 高级设置 → AI 服务与模型 / 为照片生成回忆总结。

- 协议：
  - OpenAI 兼容（OpenAI / LM Studio / vLLM / OneAPI）：`GET /models`、`POST /chat/completions`；
  - Anthropic：`GET /v1/models`、`POST /v1/messages`；
  - Gemini：`GET /v1beta/models`、`POST /v1beta/models/{model}:generateContent`；
  - Ollama：`GET /api/tags`、`POST /api/chat`，并读取 `/api/show` 的 `capabilities` 判断视觉能力。
- API Key：
  - 使用 Electron `safeStorage`（Windows DPAPI）加密，保存在本机 `config.json` 的 `secrets.aiApiKey`；
  - 渲染层只拿到 `hasApiKey`，不会回传明文；
  - 便携版换机/换用户后可能无法解密，需要重新输入。
- 模型：
  - 「一键获取全部模型」自动归一化并标记视觉能力；
  - 默认只显示视觉模型，可开启「显示全部模型」；
  - 视觉判断是启发式（Ollama 优先用 capabilities），非视觉模型必须勾选「我已确认该模型支持图像输入」才能使用；
  - 主模型失败自动尝试备用模型。
- 生成：
  - 输入优先使用存储库预览，缺失时用原图；统一转 1024px JPEG 发送，不发送原图；
  - 中文总结 1–3 句 + 3–5 个标签，保存到照片 `aiSummary/aiTags/aiModel/aiUpdatedAt/aiState`；
  - 支持详情/管理台单张生成，或高级设置批量生成（可停止，离开页面继续执行）；
  - 会把预览与备注发送给所配置的 API，可能产生费用；请确认服务可信。

### AI 识图 World ID

VRChat 的拍立得照片会把 World ID 印在画面边框上，可能不在 PNG 元数据里。客户端提供视觉 OCR 兜底：

- 照片详情、管理台照片编辑器：「AI 识图 World ID」；仅对缺少/未解析世界的照片显示。
- 高级设置 → AI 批量面板：「识别画面 World ID（N）」，统计所有缺少 World ID 的库内照片，逐张识别，可停止。
- 图片预处理为最长边 2048px JPEG，提示模型只读取印在照片上的 `wrld_` 文本；返回后经 `wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 正则校验。
- 成功后建立/复用世界资料条目，关联照片，并写入 `worldIdSource: 'ai'`；不会覆盖已手动关联或已解析的世界。
- 单张识别与批量识别都使用主模型，失败自动切换备用模型；调用会计入第三方 API 费用。
- 画面模糊、反光、ID 被裁切时可能失败或读错；重要照片请在管理台复核，必要时手动修正 World ID。

### AI 方向检测

针对“竖拍画面被保存成 1920×1080 横向像素、且没有 EXIF 旋转标记”的 VRChat 手机自拍：

- 规则：画面里有角色主体时，以角色**头顶**（发旋/耳朵上方）朝上为准；没有人物主体时按 **16:9 风景照**处理，rotation=0 不旋转。
- 模型只返回头顶朝向 `up/right/down/left/none`，客户端换算旋转角度：朝右→270°、朝左→90°、朝下→180°；不会让模型自己做算术。
- 照片详情 →「照片方向」→「AI 检测方向」：单张检测，成功后写入 `rotation`。
- 高级设置 → AI 批量面板 →「AI 校正方向（N）」：只处理没有 rotation、宽高比约 16:9 的横图，逐张检测、可停止，结果自动写回照片。
- `landscape` 结果强制不旋转；selfie 非零旋转置信度低于 0.45 时不自动应用，保留手动校正。
- 需要先在高级设置配置视觉模型（API Key + 主模型）；会按张调用第三方视觉 API，产生费用。

## 更新检测

客户端启动约 4.5 秒后，会通过当前网络代理请求：

`https://api.github.com/repos/GhostQAQ-VRC/-/releases/latest`

- 如果最新 Release 的版本号高于当前客户端，右下角显示「发现新版本 vX.Y.Z」，提供「下载更新」（直接打开 setup 资产）和「更新说明」；点 × 表示稍后，同一版本不会重复提示。
- 管理台 → 站点设置 →「检查更新」可手动检查；失败时会提示检查网络/代理。
- 只允许打开本仓库 `github.com/GhostQAQ-VRC/-/releases/` 下的链接；不做静默下载或自动安装。
- 安装包未做代码签名，更新后首次运行可能触发 Windows SmartScreen。

## 命令行（存储系统可独立使用）

存储引擎不依赖 UI，可以单独扫描/检查一个文件夹：

```bash
node tools/library-cli.cjs scan <文件夹> --previews
node tools/library-cli.cjs previews <文件夹>
node tools/library-cli.cjs stats <文件夹>
node tools/library-cli.cjs inspect <图片文件>
```

## 云同步

入口：管理台 → 云同步（`#/admin/sync`）。所有同步均为手动触发，原图只读。

### 云盘同步

每次同步会自动建立 `<云端根目录>/YYYY-MM-DD/` 日期文件夹，只把该拍摄日期的原图复制/上传进去；`.hoshikuzu/sync/manifest.json` 记录已同步文件，默认跳过，可强制重传或重置清单。可选同时上传 `hoshikuzu-album.json` 元数据。

支持方式：

- **云盘客户端同步文件夹**：通用目录、Google Drive、123云盘、百度网盘。选择对应客户端的本地同步目录，程序只复制到日期文件夹，由云盘客户端上传。
- **WebDAV / NAS**：Basic Auth，适用于坚果云、Nextcloud、Alist、群晖等。
- **Google Drive API**：OAuth Access Token，可选 Client ID/Secret + Refresh Token 自动续期；上传到 My Drive 的指定根目录。
- **百度网盘 API**：AppKey/SecretKey + Access/Refresh Token，上传到 `/apps/<应用目录名>/<根目录>/<日期>/`，支持 4MB 分片。

单文件上限 256MB；日期文件夹位于云端根目录下。文件夹方式的同步目录不能位于存储库内部，避免副本被再次扫描。

### 网站同步

把当前相册数据 `POST` 到你填写的接口：

```http
POST <endpoint>
Authorization: Bearer <令牌>
Content-Type: application/json

{
  "format": "hoshikuzu-album-sync",
  "version": 1,
  "kind": "probe" | "album",
  "library": { "id": "...", "name": "..." },
  "album": { "version": 2, "photos": [...], "worlds": [...], "settings": {} }
}
```

- 连接测试发送 `kind="probe"`；正式同步发送 `kind="album"`。
- 返回任意 2xx 即视为成功，可返回 `{ "ok": true, "message": "..." }`。
- 默认把库内照片缩略图转成 `data:image/webp;base64,...` 内嵌，网站可直接显示；也可关闭，仅同步元数据。
- 数据上限可配置（默认 80MB）；超限会停止并提示。
- 需要自建后端；客户端不附带服务端。

### 密钥

WebDAV 密码、Google Client Secret / Access Token / Refresh Token、百度 SecretKey / Access Token / Refresh Token、网站令牌均使用 `safeStorage` 加密后写入本机 `config.json` 的 `secrets`，不进入存储库、不随备份导出。

## 安全说明

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`。
- 生产环境通过自定义 `app://` 协议加载构建产物，媒体通过 `hoshikuzu-media://` 读取，并做 `realpath` 目录穿越校验。
- 外链在系统浏览器打开；窗口级文件拖放被拦截，不会导航离开应用。
- AI API Key、传图分享码、EasyTier 网络密钥都使用 Electron `safeStorage` 加密后写入本机 `config.json`，不进入存储库、不随备份导出；渲染层只拿到是否已配置与需要的分享信息。
- P2P 接收端要求分享码（`timingSafeEqual`），并做速率限制、文件名清洗、路径穿越校验；服务绑定 `0.0.0.0`，只应在可信虚拟网络使用。
- EasyTier 是外部进程（LGPL-3.0），由客户端按参数启动/停止；TUN 模式需要管理员权限。下载组件时会显示来源并校验 SHA-256（若官方 API 提供）。
- AI 生成会把照片预览与备注发送到用户配置的 API；没有内置任何第三方密钥。
- 管理口令仍是本地 UI 门锁（PBKDF2），不是服务器级认证。
- 未做代码签名；安装/运行时 Windows 可能显示 SmartScreen 提示。

## 已知限制

- 只支持单一存储库（一次一个根目录）。
- 不监听文件夹变更（`watch` 字段预留）；新增照片需要扫描或重新打开客户端。
- 世界名称/作者若不在图片元数据中，会先以 World ID 占位，可在管理台补全。
- 首次扫描大库会读取文件头并按需生成预览，耗时取决于文件数量与磁盘速度。
- `%APPDATA%/hoshikuzu-album/config.json` 保存窗口位置、当前库路径、EasyTier/AI 设置与加密密钥；相册元数据不在客户端目录。
- 便携版会把配置放在 exe 同级的 `data/` 目录；`safeStorage` 绑定 Windows 用户，换机后需重新输入密钥。
- EasyTier 组件需下载或手动准备；TUN 模式需要管理员，免 TUN 不能主动发起；公共中继不保证可用，n2n 暂未接入。
- AI 视觉能力判断是启发式；非视觉模型必须手动确认，主进程仍会阻止未确认的模型。生成会产生第三方 API 费用。
- AI 识图 World ID 依赖画面印字清晰度，可能失败或误识别；不会覆盖人工关联，识别结果建议复核。
- 银河黑洞是实验性背景，默认关闭，需要在管理台开启；依赖 WebGL，低端 GPU 上可能占用较高，禁用 WebGL 时回退到 CSS 背景。
- 自定义背景以 data URL 存入相册设置，过大图片会被压缩。
- P2P 接收端与发送端都需要本客户端运行；分享码泄露会让同一虚拟网络内的人尝试上传。
