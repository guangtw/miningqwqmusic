# 唱片行前端接入

来源：[guangtw/chang-pian-hang](https://github.com/guangtw/chang-pian-hang)，提交 `5d9b95ae2b12cd4b75e60eed34572964df662b49`（2026-10-31 同步）。

`src/frontend/components/`、`views/` 和 `styles/` 与该提交内容一致（仅允许换行格式差异）。字体沿用原版的 Space Grotesk Variable 与 IBM Plex Mono。本项目不再加载或保留旧版 studio、immersive 或 player-app 界面。新版细栏刊头、每日歌词卷首语、Mining 双行站标、唱臂/换片动画、歌词定位和返回时的滚动恢复均沿用上游实现。

## 运行与部署

沿用本项目的 `.env.local`、`npm run dev`、`npm run build` 和 `npm start`。Next.js 保留全部 `app/api/` 路由，主页面挂载原前端 SPA；hash 路由（例如 `/#/playlist/123`）支持刷新和直接访问。前端固定请求同源 `/api`，私有音源地址和密钥留在服务端。

可选公开配置：`NEXT_PUBLIC_SITE_NAME`、`NEXT_PUBLIC_BRAND_BIG`、`NEXT_PUBLIC_BRAND_SMALL`、`NEXT_PUBLIC_DEFAULT_QUALITY`、`NEXT_PUBLIC_REPLACE_TOPLIST_COVERS`、`NEXT_PUBLIC_IMAGE_RESIZE`。默认值与原前端一致，不需要额外配置。

账户服务仍由 `ACCOUNT_SERVICE_BASE_URL` 指定；它是单独的外部服务，不包含在本仓库。未配置时后端返回 5401，原前端隐藏登录入口；配置的服务不可达时，本地音乐功能继续工作。真实登录和跨设备同步需要该服务在线。

2026-10-31 已部署至 `https://echo.miningqwq.cn`，服务器上的账户服务正常，真实登录和收藏同步已完成验收。具体运行路径、证书续期和回滚步骤见 `docs/echo-subdomain-deploy.md`。

## 兼容与数据

- 共享 `src/types/music.ts` 和 `src/types/account.ts`，避免两套接口类型漂移。
- 播放及音质请求携带账户 token，401 时合并刷新并重试。账户/播放授权变化后废弃旧播放地址。
- 浏览器首次加载时把 `qwq-music-store-v1` 中的收藏、最近播放、队列、音量、音质复制到原版 `cph.*` 存储。已有新站数据不会被覆盖，旧键也不会被删除。
- 旧导入歌单数据保留在本地；原版唱片行只展示收藏和最近播放，没有新增导入歌单或一起听界面。
- 云端收藏写入失败时保留待同步变更，后续同步重试删除与新增。access token 只存在内存。
- 保留 PWA 和离线页，Service Worker 缓存版本更新为 v6，音乐接口与 Next.js 构建资源不由 Service Worker 缓存。

## 验证

```powershell
npm run test:run
npx tsc --noEmit
npm run build
npm start -- --hostname 127.0.0.1 --port 3010
# 另一个终端
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3010'
npm run test:e2e
```

浏览器测试覆盖桌面与 Pixel 7：搜索分类和分页、歌单/榜单/专辑/艺人详情、真实 HTMLAudio 播放、歌词、桌面队列、收藏持久化、登录/退出、云端收藏协议、账户关闭、推荐失败重试、深色设置和旧数据迁移。测试里的账户和音乐响应为确定性接口夹具，不代表真实外部服务健康状态。

2026-10-31 更新验证：89 项单元/集成测试通过，12 项桌面/手机浏览器测试通过（含每日歌词时间点起播和首页逐像素比较），TypeScript 和生产构建通过。测试 WAV 支持 HTTP Range，确保真实音频定位行为可以验证。

可选设置 `REFERENCE_BASE_URL` 指向未经修改的来源仓库 Vite 实例，执行桌面/手机首页逐像素比较；测试中仅冻结动画以固定截图时刻，产品动效不变。截图默认保存在系统临时目录 `qwq-opus-qa`。
