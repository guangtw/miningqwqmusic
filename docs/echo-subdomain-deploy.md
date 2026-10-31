# `echo.miningqwq.cn` 子域上线手册（阿里云 DNS + 宝塔/Nginx）

## 当前生产部署（2026-10-31 验收）

- 站点：`https://echo.miningqwq.cn`，前端为唱片行原版视觉。
- SSH：本机已配置 `ssh aliyun-ai`，账号 `aiops`。用户明确授权保留 sudo 用于以后部署；无需开启 root SSH 或密码登录。不要将私钥、生产 `.env` 或账户令牌放入仓库、发布包或日志。
- 当前版本：`/www/wwwroot/miningqwqmusic/releases/echo-20261031134252-587bbf62`；前端来源提交 `a42c395`（miningqwqmusic 仓库最新前端）；入口符号链接：`/www/wwwroot/miningqwqmusic/current`。
- PM2：`miningqwqmusic`（端口 3001）、`miningqwqlogin`（3002）、`ncm-api`（3000）。PM2 可执行文件位于 `/www/server/nvm/versions/node/v24.15.0/bin/pm2`，由 root 管理。`pm2-root.service` 已设为开机启动，进程列表已保存。
- 账户服务发布目录：`/www/wwwroot/miningqwqlogin-releases/echo-20261031134252-587bbf62`。数据库继续使用 `/www/wwwroot/miningqwqlogin/prisma/dev.db`（绝对路径），头像目录链接到 `/www/wwwroot/miningqwqlogin/public/uploads`，原签名密钥保留。不要删除原账户目录或复制空数据库。
- 生产配置：`/www/wwwroot/miningqwqmusic/shared/.env.production`；发布时复用该文件，保护文件权限为 600，不使用开发机 `.env.local`。
- 实际 Nginx 站点：`/www/server/panel/vhost/nginx/www.echo.miningqwq.cn.conf`；反代片段位于同级 `proxy/www.echo.miningqwq.cn/80de4b618cfe935c8dc495a21848582d_www.echo.miningqwq.cn.conf`，参考仓库 `ops/nginx/echo-panel-proxy.conf`。
- 共享代理缓存已禁用，保留后端 `Cache-Control` 和 `Set-Cookie`；不要恢复宝塔默认的 `proxy_ignore_headers` 和全站 `proxy_cache`，它们会缓存用户信息与签名播放地址。
- HTTPS 证书已续期至 **2027-01-28 23:15:22（北京时间）**。`echo-certificate-renew.timer` 每日检查，剩余不足 30 天时使用宝塔既有 ACME 账户续期，仅针对本站，并校验密钥匹配后重载 Nginx。
- 证书脚本：`/usr/local/sbin/renew-echo-certificate.py`；对应仓库 `ops/scripts/renew-echo-certificate.py` 和 `ops/systemd/echo-certificate-renew.*`。可用 `sudo systemctl start echo-certificate-renew.service` 检查，日志用 `sudo journalctl -u echo-certificate-renew.service` 查看。
- 本次备份：`/www/wwwroot/miningqwqmusic/shared/deploy-backups/echo-20261031134252-587bbf62`，含原版本路径和 PM2 快照，目录仅 root 可读。上一音乐版本：`/www/wwwroot/miningqwqmusic/releases/echo-20261031091734-0acddb72`。首次接入时的 Nginx、证书备份仍保留在 `shared/deploy-backups/20261031-opus`。

2026-10-31 更新通过阿里云命令助手完成。随后从 Nginx 的定向请求记录确认当前公网出口已变为 `221.213.61.115`；经用户确认，将 SSH 单 IP 白名单由 `221.213.61.113/32` 替换为 `221.213.61.115/32`。本机为服务器地址设置 WLAN 直连路由后，SSH 与 `sudo -n` 均已实测恢复。持久化 sudo 授权保留。遇到认证前连接关闭，先检查直连路由和公网出口，不要重复添加 sudo 或放开 SSH 全网访问。阿里云控制台的浏览器登录会话与服务器 sudo 授权彼此独立。

当前发布已通过仓库中的 `npm run deploy:echo -- --reuse-local-deps --push` 实跑。服务器校验发布包 SHA-256 为 `527d116205d12727b2eae2ec05246123154e9abbb48519bbca24811a189d9c91`，并校验 `release.json` 中 236 个源码文件。两项 Linux 构建及 3101/3102 候选验证通过后，切换账户与音乐服务，保留 ncm-api。正式站点上的版本回执为 `https://echo.miningqwq.cn/__deployment.json`，源码提交分别为音乐 `587bbf62f64c44d5b109f1548428781284d73f60` 与账户 `2984a6653399f7f6db8bbb085448ab3d839fa54d`。完整前后端源码包已归档到同名 GitHub Release。后续发布使用 [可重复发布流程](release-workflow.md)，不再使用浏览器分块传包。

后续发布先在新的 `releases/<版本>` 目录安装 Linux 依赖和构建，再用仅监听回环地址的临时端口检查首页、音乐搜索及账户接口。健康检查通过后原子切换 `current`，仅切换音乐和账户两项服务；如检查失败恢复原目录和两项运行配置。成功后执行 `pm2 save` 并停止临时测试进程。

本次同时发布账户服务和音乐网站，保留两者的运行配置。PM2 对既有应用 reload 时未切换账户启动目录，因此改为仅重新创建 `miningqwqlogin` 应用并在 3002 端口检查只读会话接口；其余 PM2 应用不变。回滚音乐网站不会修复已撤销的 Cookie；账户回滚配置包含受保护的生产环境，必须仅在服务器 root 权限下使用，不可上传 GitHub。

回滚音乐网站（通过 SSH 执行，先核对目标路径）：

```bash
sudo ln -s /www/wwwroot/miningqwqmusic/releases/echo-20261031091734-0acddb72 /www/wwwroot/miningqwqmusic/current.rollback
sudo mv -Tf /www/wwwroot/miningqwqmusic/current.rollback /www/wwwroot/miningqwqmusic/current
sudo /www/server/nvm/versions/node/v24.15.0/bin/pm2 restart miningqwqmusic
sudo /www/server/nvm/versions/node/v24.15.0/bin/pm2 save
```

生产验收已验证只读播放权限检查不消费刷新 Cookie、过期 Cookie 的 401 不擦除新 Cookie、真实注册、登录、Cookie 续期、收藏增加/删除、退出和再次登录，另外在候选和正式站点分别用双账号验证了一起听实时推送、定位、暂停防回退、房主转交、清空队列及退出关闭流；临时 QA 账号及关联数据已清理。真实浏览器已验证 HTTPS、首页、搜索、歌词和播放进度。游客访问账户刷新接口返回 401/code 5203 属正常无会话响应，不能当作服务故障。

以下是通用首次部署说明。

目标：

- 前端仅通过 `https://echo.miningqwq.cn` 访问
- 主域名 `https://miningqwq.cn` 不承载当前前端
- Next.js 继续监听 `127.0.0.1:3001`，由宝塔/Nginx 反向代理

## 1. 阿里云云解析配置

在阿里云控制台 > 云解析 DNS > `miningqwq.cn` 新增记录：

- 主机记录：`echo`
- 记录类型：`A`
- 记录值：`<你的服务器公网 IPv4>`
- TTL：`10 分钟`（或默认）

主域名策略（`@`）：

- 不新增指向当前前端的 `A/AAAA/CNAME`
- 如已存在旧记录指向当前前端，先改到其他业务或删除

## 2. 服务器应用进程（Next.js）

在服务器项目目录准备生产环境变量（示例）：

```bash
cat > .env.production << 'EOF'
MUSIC_SOURCE_BASE_URL=http://127.0.0.1:3000
MUSIC_SOURCE_API_KEY=
MUSIC_SOURCE_TIMEOUT_MS=8000
MUSIC_SOURCE_RETRY_TIMES=1
MUSIC_SOURCE_PLAY_LEVEL=standard
MUSIC_SOURCE_MOCK_ENABLED=false
MUSIC_SOURCE_MOCK_FALLBACK=false
MUSIC_SOURCE_PATH_SEARCH=/search
MUSIC_SOURCE_PATH_TRACK_DETAIL=/song/detail
MUSIC_SOURCE_PATH_PLAY_URL=/song/url/v1
MUSIC_SOURCE_PATH_LYRIC=/lyric
MUSIC_SOURCE_PATH_PLAYLIST=/playlist/detail
EOF
```

构建并启动：

```bash
npm ci
npm run build
PORT=3001 npm run start
```

如用宝塔 Node 项目守护/PM2，启动命令保持：

```bash
PORT=3001 npm run start
```

## 3. 宝塔/Nginx 站点配置

在宝塔新建站点：`echo.miningqwq.cn`。

- 反代目标：`http://127.0.0.1:3001`
- 反代路径：`/`
- 保留 `Host` 请求头
- 开启 WebSocket 转发

Nginx 参考配置见：`ops/nginx/echo.miningqwq.cn.conf`。

> 注意：不要开放 `3001` 公网访问，仅开放 `80/443`。

## 4. HTTPS 证书

在宝塔站点 `echo.miningqwq.cn` 中：

1. 申请 Let’s Encrypt 证书
2. 开启强制 HTTPS

## 5. 验证与验收

### DNS 生效检查

```bash
nslookup echo.miningqwq.cn
```

预期：解析到你的服务器公网 IP。

### 连通性检查

```bash
curl -I http://echo.miningqwq.cn
curl -I https://echo.miningqwq.cn
```

预期：

- `http` 返回 `301/302`（跳 HTTPS）或 `200`
- `https` 返回有效证书和 `200/301/302`

### 业务接口检查

```bash
curl "https://echo.miningqwq.cn/api/music/search?q=晴天&page=1&pageSize=5"
```

预期：返回 `code:0` 且 `data.items` 非空（取决于你的上游数据）。

### 主域名隔离检查

```bash
curl -I https://miningqwq.cn
```

预期：不返回当前前端站点内容（可为空站、停放页或其他业务）。

## 6. 可选：一键验收脚本

服务器可直接运行：

```bash
bash ops/scripts/verify-echo-subdomain.sh
```

Windows PowerShell 可直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\ops\scripts\verify-echo-subdomain.ps1
```

脚本会按 DNS、HTTP/HTTPS、BFF 接口与主域名隔离进行检查，并给出通过/失败提示。
