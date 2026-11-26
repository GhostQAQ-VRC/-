# 时光轴相册 · Android 客户端

Android 客户端不是另做的一套简化手机 UI，而是**直接加载与桌面客户端同一套 React 前端**（公开时间轴、管理台、站点设置、外观/特效、三档图片加载策略、AI 面板、云同步面板）。移动端只做比例与间距适配；连接电脑是可选的远程/投送模式，本地相册默认可用。

APK：

- 发布下载：<https://github.com/GhostQAQ-VRC/-/releases/download/v1.1.1/VRchat-Timeline-Album-Mobile-1.1.1.apk>
- `apk/VRchat-Timeline-Album-Mobile-1.1.1.apk`
- `apk/VRchat-Timeline-Album-Mobile-1.1.1.apk.sha256`

## 架构

```text
mobile-client.html          手机端入口（与 index.html 共用 React 组件）
src/mobile/parityEntry.tsx  安装平台桥后渲染同一套 App
src/mobile/installMobileBridge.ts
                            用 Android 桥实现 DesktopBridge：
                            album / library / media / AI / sync / background / backup ...
src/mobile/aiService.ts     OpenAI / Anthropic / Gemini / Ollama 四协议
src/mobile/cloudSync.ts     WebDAV / 网站同步
src/mobile/googleSync.ts    Google Drive API（Client ID/Secret + Token）
src/mobile/baiduSync.ts     百度网盘 API（AppKey/SecretKey + Token，原生 MD5 分片）
src/mobile/mobileHttp.ts    原生 OkHttp 网络桥，绕过 WebView CORS/WebDAV 方法限制
```

Android 原生：

- `MainActivity`：默认加载 `assets/web/mobile-client.html`；可选连接页（扫码/手动地址/剪贴板）、返回键、连接后保持常亮。
- `MobileLibrary`：系统相册导入，复制原图到应用目录，生成 WebP 缩略图，读取 EXIF/文件名日期与 `wrld_`。
- `MobileMediaHandler`：通过 `WebViewAssetLoader` 的 `/media/` 提供原图/缩略图/背景，保留桌面的图片加载策略。
- `SecureStore`：Android Keystore 加密保存 AI/云同步密钥。
- `HttpBridge`：OkHttp 原生 HTTP，支持 WebDAV 自定义方法、二进制上传。
- `SaveBridge`：JS 桥（相册导入、原生下载、密钥、HTTP、可选电脑连接）。

## 功能

- **本地相册**：启动即用，不需要电脑；系统相册导入、缩略图/原图、搜索/年份筛选、备注、旋转、删除、外观/特效/加载策略与桌面一致。
- **AI**：OpenAI / Anthropic / Gemini / Ollama；模型列表、连接测试、单张总结、AI 识图 World ID、AI 方向检测、批量任务与进度/取消。
- **云同步**：WebDAV、网站同步、Google Drive API、百度网盘 API；密钥写入 Android Keystore。依赖桌面云盘客户端同步文件夹的 folder 模式在手机上不适用，因此未列出。
- **可选连接电脑**：公开站头部「连接电脑」→ 扫码/地址 → 加载桌面 `/m`；SSE 投送、长按上滑保存、原生下载到 `下载/Hoshikuzu/`。
- **桌面专属且手机不适用项隐藏**：EasyTier/TUN、P2P 传图、网络代理、桌面更新、手机同步服务端页、VRChat 官方封面面板。

## 构建

要求：

- JDK 17+（本机使用 Dragonwell 21）
- Android SDK Platform 34、Build-Tools 34.0.0
- Gradle 8.7（仓库内包含 wrapper）

**AGP 不接受含中文的工程路径。** 本仓库路径含中文，请先复制到纯 ASCII 目录再构建：

```bash
rm -rf /g/AI/Zcode/build/hoshikuzu-mobile
cp -r mobile-android /g/AI/Zcode/build/hoshikuzu-mobile
cd /g/AI/Zcode/build/hoshikuzu-mobile
printf 'sdk.dir=G:/AI/Zcode/android-sdk\n' > local.properties
export JAVA_HOME="C:/Program Files/Java/dragonwell-21.0.5.0.5+9-GA"
export ANDROID_HOME="G:/AI/Zcode/android-sdk"
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=32437 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=32437"
./gradlew.bat assembleRelease \
  -PwebDistDir="G:/AI/Zcode/网页/时光轴相册DS4.1F/dist"
```

`-PwebDistDir` 指向已执行 `npm run build` 的 `dist`；Gradle 的 `syncWebAssets` 会把它同步到 APK 的 `assets/web/`。

构建产物：

```text
app/build/outputs/apk/release/app-release.apk
```

发布版目前使用本机 debug key 签名（`signingConfig signingConfigs.debug`），可直接侧载。

## 测试

```bash
./gradlew.bat testDebugUnitTest \
  -PwebDistDir=".../dist" \
  -Drobolectric.offline=true \
  -Drobolectric.dependency.dir=G:/AI/Zcode/robolectric-deps
```

Robolectric **8 项**：默认本地页、可选连接页往返、URL 归一化、非法 scheme、下载域名限制、文件名清洗、JS 桥拒绝非 HTTP 等。

另有 `tools/mobile-preview.cjs`（Electron 390×844 预览 + mock native bridge）：验证同款首页、无桌面标题栏、连接入口、本地导入、原图详情、AI test/models/generate/batch、WebDAV/网站同步 mock。

当前机器没有可用的 Android 模拟器硬件加速（未安装 AEHD/WHPX），因此**未做真机/模拟器启动**；真机安装、系统相册导入、相机扫码、Keystore、AI/云同步真实账号仍需在手机上验证。

## 安装

1. 把 APK 传到手机（USB、网盘、聊天工具均可）。
2. 允许该来源安装未知应用。
3. 打开「VRchat时间轴纪念相册」；默认进入本地相册，不需要电脑。
4. 需要电脑上的相册/投送时，点公开站头部的「连接电脑」扫码；电脑端需开启「手机同步」。

## 文件结构

```text
mobile-android/
  app/src/main/java/com/hoshikuzu/mobile/
    MainActivity.java       # 本地页/可选连接页/扫码/WebView/返回
    MobileLibrary.java      # 相册导入、缩略图、EXIF/日期/World ID
    MobileMediaHandler.java # /media 原图/缩略图/背景
    SecureStore.java        # Android Keystore 密钥
    HttpBridge.java         # OkHttp 原生 HTTP
    SaveBridge.java         # JS 桥
    NativeDownloader.java   # 远程模式原图下载
  app/src/main/assets/web/  # 构建时同步的 dist
  app/src/test/             # Robolectric 8 项
  apk/                      # 已构建 APK + SHA-256
```
