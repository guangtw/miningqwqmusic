# 项目与生产发布

- 前端视觉由用户提供；保留现有组件样式、布局、字体和动效。最新前端更新以本仓库 `origin/main` 为准，不能用早期 chang-pian-hang 快照覆盖它。
- 部署前先读 `docs/release-workflow.md`。提交确定的源码后，使用 `npm run deploy:echo -- --push` 完成测试、传包、候选验证、正式发布、GitHub 推送和完整前后端 Release 包上传；不要临时发明浏览器分块传包流程。
- 账户服务源码位于相邻 `C:\MiningQwQLogin`（可用 `ECHO_LOGIN_REPO` 指定），仓库为 `guangtw/miningqwqlogin`。保留该目录里用户未提交的数据库、环境文件及其他修改；仅提交本任务拥有的文件。
- 生产站点为 `https://echo.miningqwq.cn`，SSH 别名为 `aliyun-ai`，账号 `aiops`。用户已明确授权部署并保留免密 sudo，后续不要重复索要已有权限或撤销它。私钥、环境文件、Cookie 和数据库不得上传 GitHub。
- SSH 出问题先做 8 秒连接预检，核对服务器的 `/32` 直连路由及云防火墙当前单 IP 白名单。不要把出口变化误判为 sudo 丢失，不要关闭主机密钥校验或放开 SSH 全网访问。Windows 路由修复入口为 `ops/scripts/repair-echo-route.ps1`。
- 原账户数据库 `/www/wwwroot/miningqwqlogin/prisma/dev.db` 和头像目录必须继续复用；任何 schema 变化需另外制定迁移与回滚方案，不能发布空库或清空会话。
- 只有脚本输出 `PRODUCTION_VERIFIED`，且 `/__deployment.json` 对应本次两个源码提交，才可报告上线成功。GitHub 推送与生产上线分别核验，失败要明确报告具体阶段。

## Linux 云沙箱（instabox）上开发

- 这台机器只做开发和推送 GitHub，不跑 `deploy:echo`（发布脚本依赖 Windows 路径和 `aliyun-ai` SSH），上线由用户在自己的 Windows 环境发布。
- 本地端口：`3010` 本仓库开发服务器；`3011` 本地 miningqwqlogin 测试实例（全新临时库，不用仓库里的 `dev.db`）。`.env.local` 用 `ACCOUNT_SERVICE_BASE_URL=http://127.0.0.1:3011` 指向它；测试账号只用 `@example.test` 邮箱。
- 这台机器取不到真实播放地址（`play-url` 返回 3002），播放相关改动用请求拦截桩音频验证。
- Playwright 没装自带浏览器时，用临时配置指向 `/usr/bin/chromium` 跑，`INSTABOX_HEADLESS=1` 保持无头；跑完删掉临时配置和 `test-results/`。
- 不主动开公网预览。用户明确要预览时才用 `instabox-port publish 3010 --private`（只给带 `_token` 的私有链接），看完即 `instabox-port unpublish 3010`。
- iPhone 有单独的渲染路径：`<html data-device="iphone">`（`app/layout.tsx` 内联脚本写入，JS 侧用 `src/frontend/lib/device.ts`）。换页不走视图过渡、封面用 FLIP 飞，长歌单分批渲染。测 iPhone 性能用 Playwright 自带 WebKit + `devices['iPhone 13']`，对生产构建测（开发模式的 React 会把渲染耗时放大几倍）；跑之前去掉 `HTTP(S)_PROXY`（否则 WebKit 连不上本机），上下文加 `serviceWorkers: 'block'`（生产版注册了 sw.js，请求会绕过 `page.route` 桩）。
- 账户服务单个请求默认最多 400 个 JSON 字段（`AUTH_JSON_BODY_MAX_FIELDS`），自建歌单在前端按字段预算分卷存储（见 `src/frontend/lib/playlists.ts`），改歌单存储格式时保持兼容。

<!-- CODEGRAPH_START -->
## CodeGraph

如果仓库根目录存在 `.codegraph/`，理解或定位代码时先用 `codegraph_explore` 或 `codegraph explore`；没有则跳过，不自行索引。
<!-- CODEGRAPH_END -->
