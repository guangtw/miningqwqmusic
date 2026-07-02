# MiningQwQ Music Player

基于 `Next.js + TypeScript + BFF` 的音乐播放器网站，面向“网易云风格”的私有音乐源 API。

## 功能概览

- 搜索歌曲、播放控制、播放队列（立即播放/下一首/队尾）
- 歌词时间轴同步与滚动高亮
- 收藏与最近播放（本地持久化）
- 可选账号登录（不强制），登录后自动启用云端音乐库同步
- 播放模式：顺序 / 单曲循环 / 随机
- 播放链接短时效续签（播放器中自动刷新播放 URL）
- 基础 PWA：可安装、离线壳页面、静态资源缓存
- BFF 代理与上游解耦（前端不直连私有音乐源）

## 技术架构

- 前端：Next.js App Router + React + Zustand
- BFF：Next.js Route Handlers
- 适配层：`MusicSourceAdapter` + `NeteaseLikeAdapter`
- 稳定性：超时、重试、熔断、标准错误响应、traceId

## 目录重点

- `app/api/music/*`: 对前端暴露的统一音乐接口
- `src/lib/music/adapter.ts`: 上游适配器抽象
- `src/lib/music/providers/netease-like.ts`: 网易云风格 provider
- `src/lib/music/service.ts`: 熔断包装后的音乐服务
- `src/store/player-store.ts`: 播放状态机与本地持久化
- `src/hooks/use-player-controller.ts`: 音频控制与 URL 续签

## 环境变量

复制 `.env.example` 为 `.env.local`，可先用 mock 再切真实源：

```bash
MUSIC_SOURCE_BASE_URL=https://your-private-music-api.example.com
ACCOUNT_SERVICE_BASE_URL=http://127.0.0.1:3002
MUSIC_SOURCE_API_KEY=
MUSIC_SOURCE_TIMEOUT_MS=6000
MUSIC_SOURCE_RETRY_TIMES=2
MUSIC_SOURCE_PLAY_LEVEL=standard
MUSIC_SOURCE_VIP_PREVIEW_MAX_MS=60000
MUSIC_SOURCE_PATH_PLAY_URL_UNBLOCK=/song/url/match
MUSIC_SOURCE_UNBLOCK_SOURCE=
MUSIC_SOURCE_UNBLOCK_SOURCES=unm,msls,qijieya
MUSIC_SOURCE_MOCK_ENABLED=false
MUSIC_SOURCE_MOCK_FALLBACK=false
MUSIC_SOURCE_PATH_SEARCH=/search
MUSIC_SOURCE_PATH_TRACK_DETAIL=/song/detail
MUSIC_SOURCE_PATH_PLAY_URL=/song/url/v1
MUSIC_SOURCE_PATH_LYRIC=/lyric
MUSIC_SOURCE_PATH_PLAYLIST=/playlist/detail
```

- 仅本地演示（不接私有 API）：可把 `MUSIC_SOURCE_MOCK_ENABLED=true`
- 真实联调建议关闭 mock 兜底：`MUSIC_SOURCE_MOCK_FALLBACK=false`
- 你的上游如果暂时无 API Key，可保持 `MUSIC_SOURCE_API_KEY=` 为空
- `MUSIC_SOURCE_PLAY_LEVEL` 用于透传到 `/song/url/v1` 的 `level` 参数（例如 `standard`、`exhigh`）
- `MUSIC_SOURCE_VIP_PREVIEW_MAX_MS`：判定试听直链阈值（默认 `60000`）
- `MUSIC_SOURCE_PATH_PLAY_URL_UNBLOCK`：备用播放地址接口路径（默认 `/song/url/match`）；当默认播放地址被判定为试听链接时自动尝试该接口
- `MUSIC_SOURCE_UNBLOCK_SOURCES`：可选，多个解灰 `source`（逗号分隔，默认 `unm,msls,qijieya`）；这是当前用于止血的优先级，优先避开会回落到 30 秒试听链的旧 source 组合
- `MUSIC_SOURCE_UNBLOCK_SOURCE`：兼容旧配置的单 `source` 参数；若同时配置，优先使用 `MUSIC_SOURCE_UNBLOCK_SOURCES`
- `ACCOUNT_SERVICE_BASE_URL`：可选，独立登录服务地址。配置后站内 `/api/account/*` 会代理到该服务，前端显示“登录同步”入口；未配置则保持纯游客模式。

## 接口约定（站内 BFF）

- `GET /api/music/search?q=&page=&pageSize=`
- `GET /api/music/track/:id`
- `GET /api/music/track/:id/play-url`
- `GET /api/music/track/:id/lyric`
- `GET /api/music/playlist/:id`
- `ALL /api/account/*`（可选代理，转发到独立登录服务）

统一返回：

- 成功：`{ code: 0, data, message, traceId }`
- 失败：`{ code, message, traceId, retryable }`

## 本地运行

```bash
npm install
npm run dev
```

## 未备案阶段联调部署（宝塔 + IP）

适用场景：域名尚未备案，先用服务器公网 IP 临时联调前后端。

### 1. 推荐网络形态

- Next.js（前端+BFF）监听：`127.0.0.1:3001`
- 私有 API 监听：`127.0.0.1:3000`
- 安全组建议仅开放：`22`、`80`（临时联调），关闭 `3000/3001` 公网访问

### 2. 服务器环境变量（前端项目）

在项目根目录创建 `.env.production`：

```bash
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
```

> 联调阶段建议 `MUSIC_SOURCE_MOCK_FALLBACK=false`，避免真实上游报错被 mock 掩盖。

### 3. 构建与启动（Node 18.18+）

```bash
npm ci
npm run build
PORT=3001 npm run start
```

如果使用宝塔 Node 项目守护/PM2，请把启动命令设置为：

```bash
PORT=3001 npm run start
```

### 4. 宝塔反向代理


- 反代目标：`http://127.0.0.1:3001`
- 反代路径：`/`

这样浏览器只访问你站点的 `/api/music/*`，不会直连私有 API，避免 CORS 与密钥暴露。

### 5. 联调验证命令

服务器本机验证上游：

```bash
curl "http://127.0.0.1:3000/search?keywords=晴天&limit=2&offset=0"
curl "http://127.0.0.1:3000/song/url/v1?id=347230&level=standard"
```

验证 BFF：

```bash
curl "http://127.0.0.1:3001/api/music/search?q=晴天&page=1&pageSize=5"
curl "http://127.0.0.1:3001/api/music/track/347230/play-url"
```

预期：

- `search` 返回 `code:0` 且有 `data.items`
- `play-url` 返回 `code:0`，`data.url` 存在
- 你的上游若返回 `data[0].expi`，BFF 会映射为 `ttlSeconds`

### 6. 常见排障

- 前端 502：先看 Next 进程是否在 `3001` 存活，再看宝塔反代目标是否正确
- BFF 返回错误码 `2004/2005`：上游超时或网络失败，优先检查 `127.0.0.1:3000` 是否可达
- 能搜到但无法播放：检查 `/song/url/v1` 返回是否有 `url`，以及 `level` 是否可播（改 `MUSIC_SOURCE_PLAY_LEVEL`）

## 备案完成后子域上线（`echo.miningqwq.cn`）

适用场景：域名已备案，主域名不承载当前前端，仅用子域名访问本站前端。

- 上线手册：`docs/echo-subdomain-deploy.md`
- Nginx 参考配置：`ops/nginx/echo.miningqwq.cn.conf`
- 验收脚本（Linux）：`ops/scripts/verify-echo-subdomain.sh`
- 验收脚本（PowerShell）：`ops/scripts/verify-echo-subdomain.ps1`

## 测试

```bash
npm run test:run
npm run test:e2e
```

## 编码要求

- 所有代码与文档文件请使用 `UTF-8` 编码。
