# 项目与生产发布

- 前端视觉由用户提供；保留现有组件样式、布局、字体和动效。最新前端更新以本仓库 `origin/main` 为准，不能用早期 chang-pian-hang 快照覆盖它。
- 部署前先读 `docs/release-workflow.md`。提交确定的源码后，使用 `npm run deploy:echo -- --push` 完成测试、传包、候选验证、正式发布、GitHub 推送和完整前后端 Release 包上传；不要临时发明浏览器分块传包流程。
- 账户服务源码位于相邻 `C:\MiningQwQLogin`（可用 `ECHO_LOGIN_REPO` 指定），仓库为 `guangtw/miningqwqlogin`。保留该目录里用户未提交的数据库、环境文件及其他修改；仅提交本任务拥有的文件。
- 生产站点为 `https://echo.miningqwq.cn`，SSH 别名为 `aliyun-ai`，账号 `aiops`。用户已明确授权部署并保留免密 sudo，后续不要重复索要已有权限或撤销它。私钥、环境文件、Cookie 和数据库不得上传 GitHub。
- SSH 出问题先做 8 秒连接预检，核对服务器的 `/32` 直连路由及云防火墙当前单 IP 白名单。不要把出口变化误判为 sudo 丢失，不要关闭主机密钥校验或放开 SSH 全网访问。Windows 路由修复入口为 `ops/scripts/repair-echo-route.ps1`。
- 原账户数据库 `/www/wwwroot/miningqwqlogin/prisma/dev.db` 和头像目录必须继续复用；任何 schema 变化需另外制定迁移与回滚方案，不能发布空库或清空会话。
- 只有脚本输出 `PRODUCTION_VERIFIED`，且 `/__deployment.json` 对应本次两个源码提交，才可报告上线成功。GitHub 推送与生产上线分别核验，失败要明确报告具体阶段。

<!-- CODEGRAPH_START -->
## CodeGraph

如果仓库根目录存在 `.codegraph/`，理解或定位代码时先用 `codegraph_explore` 或 `codegraph explore`；没有则跳过，不自行索引。
<!-- CODEGRAPH_END -->
