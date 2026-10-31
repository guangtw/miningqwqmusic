# 可重复的生产发布

在 `C:\MiningQwQMusic` 执行：

```powershell
npm run deploy:echo -- --push
```

先提交本次准备发布的源码。脚本发布两个仓库的 **HEAD 提交**，不打包工作目录里的未提交文件。账户仓库默认在相邻目录 `C:\MiningQwQLogin`，可用 `ECHO_LOGIN_REPO` 指定。账户服务源码也会随完整发布包上传到 `miningqwqmusic` 的 GitHub Release，版本清单同时记录两个仓库的提交。

脚本按顺序执行：

1. 首先验证 SSH 与 `sudo -n`，连接问题在构建前暴露；拉取 GitHub 引用，如果本地落后或分叉就停止，不覆盖新前端。
2. 从 Git 导出两个确定的提交到临时目录，排除 `.env`、SQLite 数据、头像上传和密钥。默认在隔离目录 `npm ci`，运行两个仓库的单元/集成测试及桌面、手机浏览器测试。浏览器使用独占的 3047 端口，不能误用另一个开发服务器。
3. 生成完整源代码包、逐文件 SHA-256 清单以及传输包 SHA-256，通过 SCP 上传。
4. 服务端取得发布锁，后台独立执行。SSH 中断不会停止已经启动的发布/回滚任务。复用线上配置、数据库和头像；依赖锁文件一致才复用 Linux 依赖，否则重新安装。两个服务按顺序构建，限制构建内存。
5. 使用仅监听回环地址的 3101/3102 候选服务，验证真实注册、登录、Cookie 续期、只读播放权限检查、旧 Cookie 不覆盖新 Cookie、收藏增删及退出。测试账号按随机邮箱和 ID 精确清理。
6. 保存旧配置，仅切换账户与音乐服务。正式 HTTPS 上重复验证；任何切换后失败都会尝试恢复原音乐链接和原账户进程配置。保留发布日志及旧版本，不修改数据库结构。
7. 检查公开的 `/__deployment.json` 是否与本次两个提交完全一致。只有出现 `PRODUCTION_VERIFIED` 才表示上线通过；随后推送确切提交（不强推），校验 GitHub 分支，并上传包含前后端源码的完整 GitHub Release 包。

`--prepare-only` 仅导出和校验发布包，不测试、不上传、不部署、不推送。`--reuse-local-deps` 用于已验证的本机依赖：仅当当前锁文件与提交中的锁文件一致时，链接现有依赖到隔离测试目录；默认仍为 `npm ci`。视觉对比需要独立的上游参考服务，本脚本不把缺失的参考对比当作已通过。

## 网络检查

服务器保持现有密钥认证、严格主机密钥校验、单 IP 白名单和已授权的 sudo。校园网公网出口会变化，持久化 sudo 不会使旧 IP 白名单自动匹配新出口。

Windows 的 VPN 劫持路由时，可执行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops/scripts/repair-echo-route.ps1
ssh aliyun-ai 'sudo -n true && echo READY'
```

路由脚本仅为服务器 `47.122.113.9/32` 设置 WLAN 网关的持久化直连。切换到不同网络网关时先核对并更新这条路由；不要关闭整个 VPN 或放开 SSH 全网访问。路由正确但连接仍超时，需要核对当前公网出口与云防火墙单 IP 规则。

## 失败后检查

本机临时目录内的 `receipt.json` 记录发布 ID、源码提交与包校验值。服务器任务位于 `/home/aiops/releases/<发布ID>/`，其中 `job.log` 为发布输出，`result.json` 为最终状态。不要在发布结果未知时重复启动第二次发布。

受保护的构建日志、原运行配置与完成标记位于 `/www/wwwroot/miningqwqmusic/shared/deploy-backups/<发布ID>/`，只通过 sudo 读取，不上传到 GitHub。数据库 schema 变化会直接停止发布，必须另外提供迁移和回滚方案。

GitHub 推送或 Release 上传失败不会撤销已经通过验收的生产版本。此时根据明确的 `PRODUCTION_VERIFIED` 记录补推相同提交或发布包，不重复部署。
