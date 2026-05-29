# `echo.miningqwq.cn` 子域上线手册（阿里云 DNS + 宝塔/Nginx）

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

脚本会按 DNS、HTTP/HTTPS、BFF 接口与主域名隔离进行检查，并给出通过/失败提示。
