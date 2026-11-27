# 时光轴相册 v1.1.3 安全加固（第二轮复检）· 交接总结

> 用途：交给下一个对话框继续开发时直接阅读。
> 生成时间：2026-11-27
> 项目目录：`G:/AI/Zcode/网页/时光轴相册DS4.1F`
> GitHub：`GhostQAQ-VRC/-`（branch: main）

---

## 一、本轮任务

在第一轮 1.1.2 安全加固之后，对全部源码、Electron 打包产物、Android 原生层做**第二轮攻防性复检**：报告问题 → 修复 → 重新打包 → 发布。

---

## 二、版本与发布状态

| 项目 | 状态 |
|------|------|
| 版本 | **1.1.3**（原 1.1.2） |
| 桌面依赖 | Electron **45.5.0** / sharp **0.35.5** |
| Git tag | `v1.1.3` |
| Release | <https://github.com/GhostQAQ-VRC/-/releases/tag/v1.1.3>（latest，4/4 资产 uploaded） |
| APK versionCode | **5** / versionName `1.1.3` |

---

## 三、本轮发现并修复（5 项主要问题）

### H1（高危）Electron 38 自身存在多项安全公告

**问题**：Electron 38.8.6 命中 30+ 条 advisory，其中与本项目配置直接相关的是：

- *Custom protocol with `supportFetchAPI` but not `corsEnabled` allows cross-origin reads*（CVSS 7.4）
- Context isolation bypass via `Function.prototype.bind` hijack（7.5）
- Sandboxed iframe / popup sandbox 逃逸（8.2/8.3）
- `shell.openPath` 空字节路径校验绕过（6.0）

本项目 `app://` 与 `hoshikuzu-media://` 正好注册为 `supportFetchAPI: true` 且未设置 `corsEnabled`。

**修复**：

- 升级 `electron` → **45.5.0**
- `protocol.registerSchemesAsPrivileged` 为两个 scheme 增加 `corsEnabled: true`
- `serveFile()` 只对 `app://hoshikuzu`（开发模式额外允许 `DEV_URL` 的 origin）回显 `Access-Control-Allow-Origin`
- `app://` 的 HTML 响应补 `Content-Security-Policy: frame-ancestors 'none'`
- 手机同步 HTTP 响应补 `frame-ancestors 'none'` + 保留 `X-Frame-Options: DENY`

> 升级后冒烟暴露了“自定义协议跨源 fetch 被 CORS 拦截”，因此同步补了上述 CORS 响应头；缩略图预取冒烟 17/17 通过。

### H2（高危）sharp 0.34.5 命中 libvips / libheif / librsvg CVE

**问题**：sharp `0.34.5` 受 libvips（CVE-2026-33327/33328/35590/35591）、libheif、librsvg 漏洞影响。sharp 是相册处理**所有不可信图片**（P2P 接收、导入、扫描、AI、VRChat 封面）的唯一解码入口。

**修复**：升级 `sharp` → **0.35.5**。

### M1（中危）删除副本路径校验可绕过

**问题**：`media:delete-managed` 只检查 `libraryPath.startsWith('_inbox/')`，`_inbox/../other.jpg` 能通过前缀检查，解析后落在存储库其他位置，可删除 `_inbox` 之外的库内文件。

**修复**：

- 新增 `repository.resolveInsideDir(root, relativePath, dirName)`：先 resolve，再用规范化后的相对路径判断必须位于目标目录下
- `media:delete-managed` 改用该函数
- 回归测试：`desktop/library/__tests__/repository.test.cjs`

### M2（中危）PNG 文本块 zlib 炸弹

**问题**：`readPngTextChunks()` 允许 4MB 的 `zTXt/iTXt` 压缩块，`zlib.inflateSync()` 未限制输出，可解压到数 GB 撑爆主进程。

**修复**：`inflateSync(..., { maxOutputLength })`，并新增炸弹回归测试。

### M3（中危）sharp 解压炸弹防护被显式关闭

**问题**：`preview.cjs`、`ai.cjs`、`vrchat.cjs` 共 4 处 `limitInputPixels: false`，等于关闭 sharp 自带的 268MP 像素上限。

**修复**：统一改为 `MAX_INPUT_PIXELS = 0x3FFF²`（约 268MP），足以覆盖 8K VRChat 截图与全景图。

---

## 四、手机同步 / Android 边界修复

| 编号 | 问题 | 修复 |
|------|------|------|
| L1 | 局域网匿名者可用 31 次错误配对永久锁死 QR 配对 | 改为按 IP、60s 窗口、20 次失败限流；**先校验令牌再限流**，正确二维码永远可配对 |
| L2 | 手机会话令牌服务端永不过期 | 签发时记录 12h 过期，请求时自动清理；最多 256 个令牌 |
| L3 | 断开一台手机会撤销全部手机令牌 | 建立 token → deviceId 映射，只撤销该设备 |
| L4 | 二维码长效令牌可经 `x-mobile-token` 直接当 API 凭据 | 仅接受配对后签发的会话令牌 |
| L5 | Android `isLocalUrl` 不校验 scheme，`http://appassets...` 也算本地 | 强制 `https`；`isSameServer` 同时比较 scheme |
| L6 | Android 远程配对页可触发任意 http(s) 下载到手机 | DownloadListener 仅允许本地页或同一配对服务器 |
| L7 | Android 本地相册可被远程页 iframe 嵌套（点击劫持面） | `/assets/`、`/media/` 响应加 `X-Frame-Options: DENY` + `nosniff` |
| L8 | 库内符号链接可让原图服务 / 揭示文件 / AI / 云同步访问库外文件 | 全部改用 `resolveRealInside`（解析符号链接后再校验前缀） |
| L9 | 畸形 `%` 编码让 `app://`、`hoshikuzu-media://`、手机 API 抛 500 | 返回 400 |
| L10 | 开发模式 `will-navigate` 用字符串前缀，`127.0.0.1:5173.evil` 可绕过 | 改为 origin 比较 |
| L11 | P2P 限流表 / 配对失败表可被 IPv6 地址轮换撑大 | 过期清理 + 硬上限 |

---

## 五、验证结果

| 测试 | 结果 |
|------|------|
| `npm run test:desktop` | **56/56 通过**（原 49 + 新增 7 项安全回归） |
| `npm run build` | 通过（TS + Vite 双入口） |
| `npm run desktop:smoke` | **exit 0，27 张截图全链路**（含手机配对 → SSE 投送 → 长按投送） |
| `npm run desktop:smoke:thumbnails` | 通过，17/17 缩略图预取（验证新 CORS） |
| 打包后 EXE 冒烟 | **exit 0，27 张截图**（验证 asar 内 sharp/Electron 45） |
| Android `assembleRelease` | **BUILD SUCCESSFUL** |
| `npm audit --omit=dev` | **high: 0**，moderate: 5（仅 archiver 链） |
| `npm audit`（含 dev） | high: 0，moderate: 10（archiver + electron-builder 构建链） |

**新增回归测试**：

1. `resolveInsideDir` 阻断 `_inbox/../...`、`_inboxish/`、`../_inbox/`（repository.test.cjs）
2. PNG `zTXt` 炸弹被 `maxOutputLength` 拒绝（metadata.test.cjs）
3. 配对失败限流后正确 QR 仍可配对（mobile-sync.test.cjs）
4. 二维码长效令牌不能当 API 凭据（mobile-sync.test.cjs）
5. 过期会话令牌 401 并自动清理（mobile-sync.test.cjs）
6. 断开一台设备不影响另一台（mobile-sync.test.cjs）
7. 原有查询参数令牌 / Cookie 会话令牌回归保持通过

---

## 六、发布资产

| 资产 | 本地路径 | 大小 |
|------|----------|------|
| `VRchat-Timeline-Album-1.1.3-x64-setup.exe` | `release/VRchat时间轴纪念相册-1.1.3-x64.exe` | 126 MB |
| `VRchat-Timeline-Album-1.1.3-portable.exe` | `release/VRchat-Timeline-Album-1.1.3-portable.exe` | 115 MB |
| `VRchat-Timeline-Album-Mobile-1.1.3.apk` | `mobile-android/apk/VRchat-Timeline-Album-Mobile-1.1.3.apk` | 4.4 MB |
| `VRchat-Timeline-Album-Mobile-1.1.3.apk.sha256` | 同目录 | 校验文件 |

**SHA-256**：

- Setup：`3abea913e2d6e985f37eaea83edacd624eae47abc752a87defb1552fa533082d`
- Portable：`bdd7adbd685786f40d1619e72bd038cd0d8eee9f0406d2a0d6cd42d53d642760`
- APK：`2e782457cbb80fea0d2a7d1bb3bccfe946af79144b0cb6174fb31aa3e939157c`

**打包命令**：

```bash
# 桌面
npm run desktop:dist:local

# APK
cd mobile-android
JAVA_HOME="C:/Program Files/Java/dragonwell-21.0.5.0.5+9-GA" \
ANDROID_HOME="G:/AI/Zcode/android-sdk" \
"G:/AI/Zcode/gradle-8.7/bin/gradle.bat" assembleRelease --offline
```

---

## 七、未修复 / 接受风险

1. **archiver 7 的 5 项 moderate**：漏洞在 glob/minimatch 的“攻击者可控 glob 模式”路径；本项目只用固定 `**/*` 导出备份，不可触发。升级 archiver 8 是 ESM 破坏性变更，暂缓。
2. **electron-builder 的 moderate**：仅构建期工具，不进入安装包运行时代码。
3. **Android 全局允许 cleartext**：局域网手机配对必须走 HTTP，无法按 IP 段配置；已保留。AI/云同步的 http 地址属用户自行配置，默认均为 https。
4. **VRChat API Base / WebDAV / 网站同步允许 http**：用户可配置，默认 https；若配置公网 http 地址，凭据会明文传输，属用户侧风险。
5. **管理口令是前端隐私门，不是认证边界**：能访问桌面/OS 账户的人可绕过 localStorage 门禁。
6. **安装包 / APK 仍未代码签名**：NSIS 无证书；APK 仍为 debug key 的 release 变体。
7. **`/api/ping` 匿名返回应用名和版本**：为好友连接测试保留，不暴露相册数据。
8. **手机配对令牌仍在 URL 中**：一次性换会话令牌，但 HTTP 局域网仍可能被同网段嗅探；建议在可信 Wi-Fi / VPN 使用。

---

## 八、版本号改动位置（1.1.3 已全改，下次升版本照做）

1. `package.json` → `"version": "1.1.3"`
2. `desktop/preload.cjs` → `version: '1.1.3'`
3. `mobile-android/app/build.gradle` → `versionCode 5` / `versionName '1.1.3'`
4. `mobile-android/.../MainActivity.java` → `APP_VERSION`
5. `mobile-android/.../SaveBridge.java` → `appVersion()` fallback
6. `src/mobile/installMobileBridge.ts` → `version: '1.1.3-mobile'`
7. `package-lock.json` 顶层 `version` / `packages[""].version`（`npm install --package-lock-only` 自动更新）

---

## 九、需注意

1. Electron 45 对 `safeStorage.isEncryptionAvailable/encryptString/decryptString` 给出弃用警告，功能正常；后续可迁移到 async 变体。
2. 桌面安装包体积从 ~107MB 增至 ~126MB（Electron 45）。
3. 手机升级：同签名（debug key）可直接覆盖安装；旧 1.1.2 会话令牌在桌面重启/停止同步后全部失效，重新扫码即可。
4. 真机验证仍未做（本机无 AEHD/WHPX，模拟器不可用）。
5. `HANDOFF.md` 仍未补写 1.1.2 / 1.1.3 段落，本文件可替代。
