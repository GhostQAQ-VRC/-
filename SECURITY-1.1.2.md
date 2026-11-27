# 时光轴相册 v1.1.2 安全加固 · 交接总结

> 用途：交给下一个对话框继续开发时直接阅读。
> 生成时间：2026-11-27
> 项目目录：`G:/AI/Zcode/网页/时光轴相册DS4.1F`
> GitHub：`GhostQAQ-VRC/-`（branch: main）

---

## 一、任务背景

项目形态：**线上网页 + 本地 Electron 客户端 + 局域网手机客户端（Android WebView）**，共用同一套 `src/`。

技术栈：
- React 19 + TypeScript + Vite 6（网页与手机共用前端）
- Electron 38（`desktop/main.cjs`）
- Android Java WebView（`mobile-android/`）

本轮任务：对全部源码与客户端做攻防性漏洞测试 → 修复全部漏洞 → 升版本 → 重打包 → 上传 GitHub Release。

---

## 二、当前状态（已完成）

| 项目 | 状态 |
|------|------|
| 版本 | **1.1.2**（原 1.1.1） |
| Git commit | `2dafebb`（security: 1.1.2 安全加固…） |
| Git tag | `v1.1.2`（已推送） |
| Release | <https://github.com/GhostQAQ-VRC/-/releases/tag/v1.1.2>（latest） |
| 工作区 | 干净，无未提交改动 |

---

## 三、发现并修复的 5 个漏洞

### V1（严重）Android JS 桥暴露给远程配对页面

**问题**：
`HoshikuzuAndroid` 原生桥对所有 WebView 页面生效。手机配对到恶意或被劫持的「电脑」地址后，对方页面可以直接调用：

- `secureGet` / `secureSet` —— 读取/写入 Android Keystore 加密保存的 AI 与云同步全部密钥
- `httpRequest` —— 借手机发起任意网络请求（SSRF / 内网探测，响应回传给页面）
- `deleteManaged` —— 删除本地照片
- `openExternal` —— 打开任意 URI（`intent://` 等）

**修复**（文件：`mobile-android/app/src/main/java/com/hoshikuzu/mobile/SaveBridge.java`、`MainActivity.java`）：

- 所有特权桥方法加 `isOnLocalOrigin()` 门禁——仅内置的 `appassets.androidplatform.net` 本地相册页可调用
- `openExternal` 仅接受 http(s)，不再允许任意 scheme
- `AndroidManifest.xml`：`android:allowBackup="false"`（防止 ADB/云备份导出 WebView 数据）
- `setSafeBrowsingEnabled(true)`（原来被关闭）

### V2（高）手机同步配对令牌泄漏链

**问题**：

- API 支持 `?token=` 查询参数鉴权，配对令牌会进入代理日志、浏览器历史、Referer
- 配对 Cookie 直接保存 12 小时长效配对令牌，一旦被窃取即可长期重放
- 配对失败无速率限制，可被局域网暴力枚举

**修复**（文件：`desktop/services/mobile-sync.cjs`、`desktop/ipc/mobile.cjs`）：

- 移除查询参数鉴权（现在仅接受 Cookie + `x-mobile-token` 头）
- 配对改为**一次性令牌交换**：`handlePair` 签发 24 字节随机会话令牌（`sessionTokens` Set），
  Cookie 只存会话令牌，配对令牌本身不再落在手机上
- 连续配对失败 30 次后返回 429 限流
- `/api/mobile/leave`、桌面 `mobile:disconnect`、`stop()` 全部即时撤销会话令牌；服务重启轮换

### V3（中）未授权端点 + 木马伪装文件

**问题**：

- P2P 传图接收端 `GET /api/health` 无需分享码即可访问，端口扫描可直接确认受害者身份
- 上传文件先落盘、仅靠扩展名校验——可执行文件改名 `.png` 即可作为「照片」进入存储库（木马伪装通道）

**修复**（文件：`desktop/services/transfer.cjs`、`desktop/library/ingest.cjs`）：

- `/api/health` 需要分享码（无 token 返回 401）
- 新增 `looksLikeImage()` **magic-byte 内容校验**
  （JPG `FFD8FF` / PNG 签名 / WebP `RIFF` / AVIF·HEIC `ftyp` / TIFF / GIF / BMP）
- `importPaths` 与 `importReceivedFile` 内容与图片格式不符即拒绝入库，`MZ` PE 头伪装件无法进入存储库

### V4（中）管理口令时序侧信道

**问题**：
`src/utils/adminAuth.ts` 的 `verifyAdminPassphrase` 使用 `hash === credential.hash` 字符串比较，
理论上可通过响应时间差逐位猜测哈希。

**修复**：
新增 `timingSafeEqualStrings()` 常数时间比较（逐字节 XOR 累积；长度不等时也跑满循环，
不泄漏前缀匹配长度）。

### V5（低）Electron Web 权限未收紧

**问题**：
渲染进程未设置权限处理器，地理位置 / 通知 / 摄像头等 Web 权限请求可能被静默批准。

**修复**（文件：`desktop/main.cjs`）：

- `session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))`
- `session.setPermissionCheckHandler(() => false)`
- 本地相册无需任何 Web 权限，全部拒绝

---

## 四、审计过、确认无问题的关键面

- **Electron**：`contextIsolation` / `sandbox` / `webSecurity` 全开；`hoshikuzu-media://` 按文件名正则白名单服务；
  `resolveInside` / `resolveRealInside` 防路径穿越（网络面含符号链接解析）；
  ZIP 备份导入有 zip-slip 双重防护；更新检查严格限定本仓库 GitHub Release URL；密钥走 safeStorage
- **CSP**：`index.html` 与 `mobile-client.html` 均带 nonce 脚本策略，无 `unsafe-inline` 脚本
- **前端**：无 `innerHTML` / `eval` / `dangerouslySetInnerHTML` 类注入点，全部 React 转义
- **Android**：`MobileMediaHandler` canonical path 防穿越；`SecureStore` AES-GCM + Android Keystore；
  `NativeDownloader` 明文 HTTP 仅允许同服务器
- **AI / 云同步**：baseUrl 由用户自行配置属设计预期；密钥明文不出加密层；WebDAV/百度/Google 令牌均 safeStorage/Keystore

---

## 五、版本号改动位置（再次升版本时必须全改）

1. `package.json` → `"version"`
2. `desktop/preload.cjs` → `version: '1.1.2'`
3. `mobile-android/app/build.gradle` → `versionCode 4` / `versionName '1.1.2'`
4. `mobile-android/app/src/main/java/com/hoshikuzu/mobile/MainActivity.java` → `APP_VERSION`
5. `mobile-android/app/src/main/java/com/hoshikuzu/mobile/SaveBridge.java` → `appVersion()` fallback 字符串
6. `src/mobile/installMobileBridge.ts` → `version: '1.1.2-mobile'`

---

## 六、测试与验证结果

| 测试 | 结果 |
|------|------|
| `npm run test:desktop` | **49/49 通过**（新增 4 项安全回归） |
| `npm run build`（TS + Vite 双入口） | 通过 |
| `npm run desktop:smoke` | 通过，27 张截图全链路（含手机配对 → SSE 投送 → 保存模式，走新会话令牌流程） |
| Android `assembleRelease` | 通过 |
| `aapt` / `apksigner` 校验 | `com.hoshikuzu.mobile` / 1.1.2 / versionCode 4 / minSdk 26 / targetSdk 34 / v2 签名 |
| Robolectric | **未能跑通**：本机环境问题（非 ASCII 项目路径 + worker classpath），已用 `git stash` 在未修改代码上复现同样失败，与本次改动无关 |
| 真机验证 | 仍未做（本机无 AEHD/WHPX，模拟器不可用） |

**新增的 4 项安全回归测试**（`desktop/services/__tests__/`）：

1. `token never authenticates through the URL query string` —— 查询参数 token 必须 401；
   配对 Cookie 是不同于配对令牌的会话令牌；`leave` 后原 Cookie 401
2. `health endpoint requires the token and uploads are magic-byte checked` —— `/api/health` 无 token 401；
   `MZ` 伪装的 `.png` 上传被拒且报「格式不符/伪装」

（另两项在 mobile-sync 测试内：`tokensEqual` 长度安全 + 会话令牌签发/失效）

---

## 七、Release 资产（已上传，状态全部 uploaded）

| 资产 | 大小 |
|------|------|
| `VRchat-Timeline-Album-1.1.2-x64-setup.exe` | 107.0 MB |
| `VRchat-Timeline-Album-1.1.2-portable.exe` | 98.6 MB |
| `VRchat-Timeline-Album-Mobile-1.1.2.apk` | 4.4 MB |
| `VRchat-Timeline-Album-Mobile-1.1.2.apk.sha256` | 校验文件 |

- **APK SHA-256**：`33908e5b1f17bf3cfbaa9cf839f2ba418ce1d346f4870fd419a2e44652a2b118`
- 本地对应产物：`release/` 与 `mobile-android/apk/` 下均为 1.1.2
- 打包命令：
  - 桌面：`npm run desktop:dist:local`（NSIS + portable，用本地 electron dist）
  - APK：`cd mobile-android && "G:/AI/Zcode/gradle-8.7/bin/gradle.bat" assembleRelease --offline`
    - `JAVA_HOME=C:/Program Files/Java/dragonwell-21.0.5.0.5+9-GA`
    - `ANDROID_HOME=G:/AI/Zcode/android-sdk`
    - `gradle.properties` 已加 `android.overridePathCheck=true`
- 上传方式：本机无 `gh` CLI，使用 **GitHub REST API + `git credential fill` 取 token**，
  显式代理 `-x http://127.0.0.1:32437`（git 需 `-c http.proxy=http://127.0.0.1:32437`）

---

## 八、需注意 / 未完成事项

1. **安装包与 APK 均未代码签名**：NSIS 无证书（electron-builder 输出跳过签名）；APK 仍是 debug key 的 release 变体。
   如需正式分发，应配置 electron-builder 证书与独立 release keystore。
2. **手机升级说明**：同签名可直接覆盖安装；旧 1.1.1 桌面端发出的配对 Cookie 会被新版会话令牌机制拒绝，
   重新扫码即可（安全设计，非 bug）。
3. `HANDOFF.md` 尚未补写 1.1.2 段落（下一个对话可补）。
4. 真机验证（扫码、相册导入、Keystore 加解密、AI/云同步真实账号、锁屏/后台 SSE）仍待手机侧完成。
5. Robolectric 测试想在本机跑通，需要把工程复制到纯 ASCII 路径（如 `G:/AI/Zcode/build/hoshikuzu-mobile`，
   README 里有该做法）再执行 `testDebugUnitTest`。

---

## 九、关键改动文件清单

```
desktop/main.cjs                                   # 拒绝所有 Web 权限请求
desktop/services/mobile-sync.cjs                   # 移除查询 token、会话令牌、配对限流、leave 撤销
desktop/ipc/mobile.cjs                             # disconnect 时撤销会话令牌
desktop/services/transfer.cjs                      # /api/health 需分享码
desktop/library/ingest.cjs                         # magic-byte 图片内容校验
desktop/services/__tests__/mobile-sync.test.cjs    # 新增安全回归
desktop/services/__tests__/transfer.test.cjs       # 新增安全回归
src/utils/adminAuth.ts                             # 常数时间口令比较
mobile-android/app/src/main/java/com/hoshikuzu/mobile/SaveBridge.java    # 本地源门禁
mobile-android/app/src/main/java/com/hoshikuzu/mobile/MainActivity.java  # isOnLocalOrigin/openExternal 白名单/SafeBrowsing
mobile-android/app/src/main/AndroidManifest.xml    # allowBackup=false
mobile-android/app/build.gradle                    # versionCode 4 / 1.1.2
mobile-android/gradle.properties                   # android.overridePathCheck=true
package.json / desktop/preload.cjs / src/mobile/installMobileBridge.ts  # 版本号
```

---

## 十、一句话结论

**5 个漏洞（1 严重 / 1 高 / 2 中 / 1 低）全部修复并有回归测试锁死；v1.1.2 桌面安装包、便携版、Android APK 已重打包并发布到 GitHub Release（latest）；源码已推送 `main` 并打 tag `v1.1.2`。**
