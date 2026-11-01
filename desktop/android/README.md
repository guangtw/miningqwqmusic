# Mining唱片行 · Android 客户端

与 `desktop/windows/` 同仓库维护的独立 Android WebView 工程。加载正式站点 `https://echo.miningqwq.cn/`，沿用网站现有页面、账号、音乐库、播放器、设置与提醒体系。没有额外顶栏、地址栏、浏览器菜单或自建错误页，不需要部署网站或在手机运行 Next.js。

## 安装

从本仓库 `android-v*` Release 下载 `MiningQwQMusic-android-v*.apk`。支持 Android 8.0/API 26 及以上，通用 APK，不限定 ARM/x86 架构。需要联网和可用的 Android System WebView；系统首次安装 APK 时可能要求允许当前来源安装应用。

应用 ID：`cn.miningqwq.music`。使用独立应用数据目录，Cookie 与站点自己的登录状态持久保存，不共享 Edge/Chrome 用户资料。卸载会删除应用登录与本地数据。

## 壳层策略

- 使用 Android `WebView`，没有 Edge/WebView2、Chrome Custom Tabs、TWA 或外部浏览器 Intent。
- 首次导航前同时在根容器和 WebView 设置 `IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS`，并关闭旧密码/表单保存。Android 11+ 同时排除内容捕获；注入脚本对动态表单关闭自动填充、拒绝 Credential Management 请求，避免密码保险箱或保存密码入口。
- 原生层拦截 JavaScript alert/confirm/prompt/beforeunload、新窗口、地理定位、网页权限、HTTP 认证与客户端证书提示；没有默认浏览器弹窗。网站自己的 React 弹窗、Toast 和账号表单继续使用原有实现。
- 隐藏滚动条、禁止长按浏览器菜单、关闭缩放控件与 WebView 调试。保留 Android 状态栏、手势导航和系统键盘，适配刘海、安全区与键盘高度。
- 顶层导航与原生消息只接受精确的正式 HTTPS 来源；拒绝外站、非标准端口、带用户信息的 URL、`intent:`、`file:` 和浏览器内部协议，不调用默认浏览器。新窗口内的站内链接改为当前页面导航；外链不打开。
- 保持安全浏览、HTTPS 校验与混合内容限制。网络/证书错误不显示 Chromium 默认错误页，不另建提醒体系；主页面首次加载失败时只保留应用背景，每 10 秒及网络恢复/返回应用时重试。已加载页面的接口提醒由网站原有逻辑处理。
- 用户主动选择头像或导入文件时，使用 Android 系统文件选择器。下载通过 Android 下载服务或受来源约束的消息桥保存，支持网页 Blob 下载，不打开浏览器下载页。Android 10+ 保存至 `Download/MiningQwQMusic/`；Android 8–9 保存至应用专属外部 Downloads 目录。Blob 单文件上限 256 MiB，按块确认传输以限制内存。
- Android 返回键先返回站内历史，首页返回桌面；不额外加入退出确认弹窗。

没有新增网页提醒、重绘前端、修改服务端或引入私有音源密钥。此版是轻量 WebView 壳层，未实现原生前台播放服务；长时间后台/锁屏保活和不同厂商的省电策略尚不作保证。系统安装提示、系统文件选择器与第三方输入法本身的界面属于 Android 系统行为。

## 构建与验证

环境：JDK 17/21、Android SDK Platform 35、Build Tools 35.0.0；项目内固定 Gradle 8.12.1、AGP 8.9.1 与 AndroidX WebKit 1.12.1。设置 `ANDROID_HOME`，或通过未提交的 `local.properties` 指定 SDK。

```powershell
cd desktop/android
.\gradlew.bat assembleDebug
.\gradlew.bat testDebugUnitTest lintDebug
# 启动安卓模拟器或连接启用 USB 调试的设备后：
.\gradlew.bat connectedDebugAndroidTest
```

测试覆盖来源边界、首次导航前的自动填充配置、新窗口与外链拦截、实际网页中的脚本弹窗/动态密码表单、网络错误页隐藏以及 Blob 文件写入 Downloads 后的内容校验。测试中的网站页面使用真实正式站点，不创建账号或提交登录表单。

## 签名与发布

```powershell
# 首次生成发行密钥。已有密钥时必须恢复并复用，不能重新生成。
.\scripts\init-signing.ps1
.\scripts\package.ps1 -Version 1.0.0 -SourceCommit (git rev-parse HEAD)
```

`signing.properties`、发行密钥、SDK 路径、构建目录和 `artifacts/` 都在 Git 忽略列表。首次生成的密钥与签名配置恢复副本保存在 `%LOCALAPPDATA%\MiningQwQMusicAndroid\signing\`；请私下备份，后续版本复用同一密钥才能覆盖升级。密钥和密码不得上传 GitHub。

APK、`SHA256SUMS.txt` 与 `build-info.json` 发布到同仓库独立的 `android-v*` Release。源码位于 `desktop/android/`，网站发布仍使用原有流程；打包安卓不运行网站部署脚本。
