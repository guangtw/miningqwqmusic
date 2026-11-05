# 客户端下载

正式站点为 `https://echo.miningqwq.cn`，所有接口公开读取，无需登录或会员权限。

普通浏览器显示客户端下载页和设置入口；Windows WebView2 客户端、带 `MiningQwQMusicAndroid/<版本>` UA 的 Android 客户端隐藏该入口，直接访问 `#/download` 也回到设置，不请求安装包清单。歌曲下载与原生下载任务功能照常保留。此规则属于网页逻辑，现有 EXE/APK 加载更新后的站点即生效，无需为隐藏入口重打安装包。

## 前端接入

`GET /api/downloads` 返回本站通用信封：

```json
{
  "code": 0,
  "message": "ok",
  "traceId": "每次请求的跟踪标识",
  "data": {
    "schemaVersion": 1,
    "platforms": [
      {
        "platform": "windows",
        "name": "Windows",
        "version": "1.0.0",
        "architecture": "x64",
        "releaseTag": "windows-v1.0.0",
        "publishedAt": "2026-11-01T13:30:25Z",
        "downloadUrl": "/api/downloads/windows",
        "artifacts": [
          {
            "variant": "installer",
            "fileName": "MiningQwQMusic-Windows-1.0.0-x64-Setup.exe",
            "size": 88154103,
            "sha256": "4f17b68163dba7b7aefbd0f89b70afbb832ac98bf4f764c3554a107587dbd92b",
            "contentType": "application/vnd.microsoft.portable-executable",
            "url": "/downloads/clients/MiningQwQMusic-Windows-1.0.0-x64-Setup.exe",
            "downloadUrl": "/api/downloads/windows?variant=installer"
          }
        ]
      }
    ]
  }
}
```

上面仅展示 Windows 对象；真实 `platforms` 同时包含 Android。Android 的 `platform=android`、`architecture=universal`、`variant=apk`，当前版本 `1.0.3`。Windows 只提供 EXE 安装版；**不要设计便携版下载入口**。APK 是安装包，不是应用商店链接。版本、大小、哈希以接口为准，不要在前端硬编码；`size` 单位是字节，`publishedAt` 为 UTC ISO 时间。

优先使用普通链接 `<a href={platform.downloadUrl}>` 发起下载。不要 `fetch(...).blob()` 将大文件载入内存；也不需要将文件交给 Next/账户接口中转。稳定地址返回 **307**，重定向到本站对应版本的不可变文件地址，Nginx 设置 `Content-Disposition: attachment`，浏览器接管下载。Android 使用 `/api/downloads/android`；Windows 使用 `/api/downloads/windows`。需要绑定页面当时展示的确切版本时，使用 `artifact.url`。

`GET`、`HEAD` 都支持稳定下载入口；Windows 显式 `?variant=installer` 和 Android `?variant=apk` 也可使用。未知平台/类型（包括 `portable`）返回 HTTP **404**，通用错误信封 `code=4041`、`retryable=false`；不存在的版本文件同样不会跳到 GitHub。下载失败时保留重试入口即可。当前只提供 Android 和 Windows x64，不据此声称支持 iOS、macOS 或 Windows ARM64 原生客户端。

列表及稳定入口均 `Cache-Control: no-store`，避免新版本上线后仍下载旧包。文件 URL 按版本固定，响应长期缓存，支持 `Content-Length`、`HEAD`、ETag 和单段 Range/206 断点续传。接口没有下载统计或下载完成回调；点击不能当作安装成功。网站 PWA Service Worker 不缓存这些大文件。

## 文件来源与维护

唯一发布清单是 `src/lib/client-downloads/catalog.json`。包来自仓库 `guangtw/miningqwqmusic` 的正式平台 Release，而非网站 `echo-*` 源码发布包。已按 GitHub Release 资产的大小、SHA-256 核验原包，不重新压缩或改写安装包。

运维同步命令（在具备 GitHub CLI 和既有 SSH 配置的 Windows 开发机执行）：

```powershell
node ops/scripts/sync-client-downloads.mjs
```

脚本读取固定清单，下载校验后经 SCP 上传，服务端再次核验，然后安装文件及限定为精确文件路径的 Nginx 规则；`nginx -t` 失败恢复原规则。**不要在访客请求、播放器请求或页面定时器里触发同步**。同步不读取账户数据，也不请求网易音源。当前同步器拒绝 ZIP，仅接受 EXE/APK。

生产文件位于 `/www/wwwroot/miningqwqmusic/shared/client-downloads/`，Nginx 配置位于 `/www/server/panel/vhost/nginx/extension/www.echo.miningqwq.cn/echo-client-<文件名>.conf`。两者均独立于网站 `current` 发布软链接，后续部署与回滚网站不会删除安装包。只暴露清单中的精确文件路径，不开放目录浏览或任意文件代理。旧版本保留已有文件/规则供已发出的固定链接继续使用；同名内容不同的文件拒绝覆盖。清单升版时先同步文件并验证，再提交清单、按仓库标准流程部署网站，避免 API 指向尚未上传的文件。

验收命令：

```powershell
node ops/scripts/verify-client-downloads.cjs https://echo.miningqwq.cn src/lib/client-downloads/catalog.json --full
```

它验证目录接口、同站重定向、错误类型、文件响应头、实际尾段 Range，以及完整公开下载的 SHA-256。常规发布在候选与正式环境自动运行轻量 HEAD/Range 验证，不反复下载全部文件。开发服务器不托管二进制文件；开发时可模拟目录响应，真实下载验收用正式域名。

## Windows 卸载说明

当前 Setup 按当前用户安装，卸载程序在 `%LOCALAPPDATA%\Programs\MiningQwQMusic\unins000.exe`，系统卸载注册位于 HKCU 的 Inno Setup AppId 键。手动删除安装目录会同时删除卸载程序，无法再从原路径运行它；账户登录、播放器本地数据位于另外的 `%LOCALAPPDATA%\MiningQwQMusic`，不要将清理这些数据与普通卸载绑定。Windows 设置列表显示异常的设备需单独排查，不能仅凭注册表存在就声称设置面板验收通过。

曾在用户设备用 SHA-256 与 GitHub 一致的 v1.0.0 Setup 实测：复装生成卸载 EXE 和系统卸载键，执行该 EXE 后程序与卸载键移除，原客户端设置保持不变。设置/控制面板列表搜索仍未列出它；另一个独立 AppId、纯英文名、单文本文件的最小标准 Inno Setup 对照包也未列出。因此尚未确认列表异常根因，**系统列表显示没有修复，Windows 安装包也没有重打或替换**。两个验证安装已卸载，不保留测试程序。前端可在帮助说明中给出安装目录内 `unins000.exe` 的备用操作路径；不要声称只能手动删文件或让用户清空应用数据。
