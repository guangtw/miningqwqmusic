# Mining唱片行 · Windows 客户端

基于 [guangtw/miningqwqmusic](https://github.com/guangtw/miningqwqmusic) 的 WinUI 3 桌面客户端。保留唱片行原有的视觉、音乐库、账号和播放体验，正式服务地址为 `https://echo.miningqwq.cn/`。

## 直接运行

打开 `artifacts/MiningQwQMusic-win-x64/MiningQwQMusic.exe`。发行目录包含 .NET 与 Windows App SDK 运行时，不要求用户安装开发工具；请保留完整目录。需要系统中的 WebView2 Evergreen Runtime 和联网访问音乐服务。

当前提供 Windows x64 便携版，采用 unpackaged 模型，无需旁加载证书。未签名、未提交 Microsoft Store。Windows 11 为当前实测环境，Windows 10 的兼容性尚未实机验证。

## Windows 适配

- 前端覆盖整个窗口，只保留右上角原生最小化、最大化和关闭按钮；没有额外顶栏、菜单、渐变遮罩或整条顶部留白。
- 顶部空白区域支持原生拖动、双击最大化和 Snap，按实际 DPI 与网页交互控件位置更新区域；详情页的收起按钮和窄屏导航局部避开系统按钮。
- 单实例：再次启动唤回已有窗口；默认关闭到系统托盘，音乐和下载继续。托盘菜单支持打开窗口、播放/暂停、切歌和彻底退出；资源管理器重启后重新注册图标。
- 关闭行为、全屏、下载任务、重新加载和退出自然合并进网站原有“唱机调校”页，复用原来的字段与分段按钮样式。仅在客户端能力握手成功后加入，不使用 User-Agent 猜测，不显示平台识别提示；普通浏览器不受影响。
- 保留原站的 Media Session 系统媒体键、歌曲信息和封面，托盘菜单提供播放、上一首、下一首入口。
- Windows“另存为”和原生下载提示；音源跨域导致网页下载回退到外链时，可在原生对话框选择“下载文件”。下载任务列表是打开时的状态快照。退出会取消未完成任务。
- 原生加载、网络故障重试和播放器崩溃恢复页面。
- 壳层不显示快捷键提示，菜单与关于页不加入快捷键文案。

图标直接使用主仓库最新的“赭红封套 + 花体 M + 黑胶”正式图标；应用、安装器、快捷方式和托盘保持一致。来源提交与原图 SHA-256 记录在 `src/MiningQwQMusic/Assets/BrandSource.json`。`scripts/update-icon.ps1` 仅缩放正式 PNG 生成 Windows ICO，不重新绘制。

## 浏览器界面处理

WebView2 仅提供内容渲染，不启动 Edge 窗口。所有设置在首次导航之前生效：关闭密码保存、通用自动填充、浏览器快捷键、默认右键菜单、开发者工具、状态栏、内置错误页面、默认脚本弹窗和浏览器缩放控件。脚本 alert/confirm/prompt 转为 WinUI 对话框；下载不会显示浏览器下载面板。只在用户点击原生对话框“打开链接”后才调用默认浏览器。

应用使用 `%LOCALAPPDATA%\MiningQwQMusic\WebView2` 独立数据目录，不共享用户 Edge 配置。Cookie 和站点自己的登录会话仍然持久保存。网页权限请求默认拒绝；证书错误取消导航。顶层导航与消息桥仅信任精确的 HTTPS 正式站点来源，拒绝相似域名、其他端口、内置浏览器协议和本地文件链接。不通过关闭浏览器安全功能实现适配。

## 开发与验证

工具：.NET 8 SDK、WinUI 开发环境；Node.js 仅用于桥接脚本测试。NuGet 依赖版本固定在项目文件。

```powershell
git submodule update --init
dotnet build src/MiningQwQMusic/MiningQwQMusic.csproj -p:Platform=x64
dotnet run --project tests/ShellPolicy.Tests/ShellPolicy.Tests.csproj
node --test tests/desktop-bridge.test.cjs tests/desktop-settings.test.cjs
.\scripts\build.ps1 -Run
```

可选安装到当前用户并创建开始菜单入口：`scripts\install.ps1`；加 `-DesktopShortcut` 创建桌面快捷方式。不会添加开机启动或修改默认浏览器。

Windows 源码位于主仓库的 `desktop/windows/`。客户端运行时加载正式网站，网站可独立更新，无需因每次网页发布重新打包客户端。此版本依赖线上服务，未内置 Next.js BFF 或私有音源密钥。原站设置页结构、播放按钮或路由改变后应复测接入脚本。

## Windows Release

安装版 EXE、便携版 ZIP 和 `SHA256SUMS.txt` 发布到同仓库的 `windows-v*` Release。源码和网站统一维护，发布版本相互独立，不执行网站的生产部署脚本。

```powershell
.\scripts\package.ps1 -Version 1.0.0 -SourceCommit (git rev-parse HEAD)
```

打包安装器还需要 Inno Setup 6.5 或更高版本。安装器按当前用户安装，提供开始菜单、桌面快捷方式和系统卸载入口，保留应用数据。Windows 11 为当前实测环境；发行文件尚未代码签名。

## 数据与限制

客户端设置保存至 `%LOCALAPPDATA%\MiningQwQMusic\settings.json`。`app.log` 仅记录操作名称、异常类型与错误码，不记录 URL、Cookie、密码或歌曲数据。清除该目录会删除客户端登录与本地音乐库，请在操作前自行备份。

本地验证覆盖构建、真实窗口启动、原生菜单、设置、站点加载与导航边界。账号登录/注册需要用户自行操作；真实音源可用性、付费歌曲、服务端授权和特定设备的系统媒体控件取决于原网站和系统。

实现所依据的 Microsoft 文档：[WinUI WebView2](https://learn.microsoft.com/windows/apps/develop/ui/controls/webview2)、[WebView2 与 Edge 的功能差异](https://learn.microsoft.com/microsoft-edge/webview2/concepts/browser-features)、[原生标题栏](https://learn.microsoft.com/windows/apps/develop/ui/controls/title-bar)。
