# 时光轴相册 · Android 客户端

手机端 APK 是局域网手机客户端的原生外壳：原生连接页负责扫码/输入电脑地址，配对成功后用 WebView 打开电脑提供的 `/m` 手机版。照片、投送和接收方式都复用同一套手机网页；保存原图通过原生桥直接写入手机下载目录。

APK 文件：

- `apk/VRchat-Timeline-Album-Mobile-1.1.0.apk`
- `apk/VRchat-Timeline-Album-Mobile-1.1.0.apk.sha256`

## 功能

- 启动页：扫描电脑二维码、手动输入地址、从剪贴板粘贴；记住上一次连接的地址。
- 相机扫码使用 `zxing-android-embedded`，自动识别 `http://<IP>:7880/m/<令牌>` 配对链接。
- WebView 加载手机版：时间轴、搜索、年份/世界筛选、全屏查看、投送接收浮层、接收方式切换。
- 原生保存桥：把原图流式写入 `下载/Hoshikuzu/`，沿用库内文件名；Android 10+ 使用 MediaStore，Android 8/9 使用运行时存储权限。
- 硬件返回键优先关闭网页里的查看器/投送浮层/模式弹层，再处理网页历史，最后弹出「刷新 / 切换电脑 / 退出」。
- 连接页会处理：电脑未开启、网络不可达、配对过期（HTTP 403）、电脑服务异常（5xx）。
- 连接期间保持屏幕常亮（仅在前台、页面加载完成后）。
- 纯局域网 HTTP，不使用互联网；配对令牌与 HttpOnly Cookie 由桌面端校验。

## 构建

要求：

- JDK 17+（本机使用 Dragonwell 21）
- Android SDK Platform 34、Build-Tools 34.0.0
- Gradle 8.7（仓库内包含 wrapper）

**Android Gradle Plugin 不接受含中文的工程路径。** 如果仓库路径含中文（本仓库就是），请先把 `mobile-android` 复制到纯 ASCII 目录再构建：

```bash
# Git Bash 示例
rm -rf /g/AI/Zcode/build/hoshikuzu-mobile
cp -r mobile-android /g/AI/Zcode/build/hoshikuzu-mobile
cd /g/AI/Zcode/build/hoshikuzu-mobile
printf 'sdk.dir=G:/AI/Zcode/android-sdk\n' > local.properties
./gradlew.bat assembleRelease
```

Windows CMD / PowerShell 也可以用 `robocopy` 或直接复制。首次构建需要下载 Gradle/AndroidX/zxing 依赖；如果使用代理：

```bash
export GRADLE_OPTS="-Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=32437 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=32437"
```

构建产物：

```text
app/build/outputs/apk/release/app-release.apk
```

发布版目前使用本机 debug key 签名（`signingConfig signingConfigs.debug`），可以直接侧载安装；如果要正式分发，请在 `app/build.gradle` 里换成自己的 keystore，并妥善保存。

## 测试

`mobile-android` 包含 Robolectric 单元测试（7 项）：

```bash
./gradlew.bat testDebugUnitTest \
  -Drobolectric.offline=true \
  -Drobolectric.dependency.dir=<包含 android-all-instrumented jar 的目录>
```

覆盖：首启连接页显示、二维码/裸地址归一化、非法 scheme 拒绝、下载文件名清洗、HTTP 保存仅允许当前电脑、JS 桥拒绝非 HTTP。

当前机器没有可用的 Android 模拟器硬件加速（未安装 AEHD/WHPX），因此 APK 用 Robolectric + `aapt`/`apksigner` 静态校验；真机安装、相机扫码和实际下载路径仍需在手机上验证。

## 安装

1. 把 APK 传到手机（USB、网盘、聊天工具均可）。
2. 在系统设置中允许该来源安装未知应用。
3. 打开「时光轴相册」。
4. 电脑端：管理台 → 手机同步 → 开启；手机与电脑连同一个 Wi-Fi。
5. 点「扫描电脑上的二维码」，或手动输入页面显示的链接。

APK 只是客户端外壳，**电脑端必须保持手机同步开启**；关闭电脑或退出桌面客户端后，手机会显示连接失败/配对过期。

## 文件结构

```text
mobile-android/
  app/src/main/java/com/hoshikuzu/mobile/
    MainActivity.java       # 连接页、扫码、WebView、错误与返回处理
    SaveBridge.java         # window.HoshikuzuAndroid JS 桥
    NativeDownloader.java   # 原图下载到 Downloads/Hoshikuzu
  app/src/main/res/         # 连接页布局、主题、图标
  app/src/test/             # Robolectric 测试
  apk/                      # 已构建 APK 与 SHA-256
```
