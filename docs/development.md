# 开发指南

本仓库包含 Web 前端、音乐 BFF、PWA 和两个平台客户端；账户服务单独维护。日常界面开发可以先使用 Mock 音源。

## 环境与启动

以下命令以 Node.js 24、npm 和仓库根目录为基准。Windows PowerShell 和 macOS/Linux 终端均可使用；PowerShell 中的 `cp` 等同于 `Copy-Item`。

```bash
npm ci
cp .env.example .env.local
```

在 `.env.local` 中将 `MUSIC_SOURCE_MOCK_ENABLED` 改为 `true`，将 `ACCOUNT_SERVICE_BASE_URL` 留空，然后运行：

```bash
npm run dev -- --hostname 127.0.0.1 --port 3010
```

浏览器访问 `http://localhost:3010`。Mock 提供固定的音乐接口数据，部分发现、社交和账户功能需要真实服务。播放示例音频仍可能需要联网。

## 真实音源与账户

将 `MUSIC_SOURCE_MOCK_ENABLED=false`，设置 `MUSIC_SOURCE_BASE_URL`，按上游要求设置 `MUSIC_SOURCE_API_KEY`。真实联调保持 `MUSIC_SOURCE_MOCK_FALLBACK=false`，避免服务错误被示例数据掩盖。[上游协议](upstream-contract.md)说明支持的请求与响应结构；完整变量在根目录 `.env.example` 中。

账户服务位于 [guangtw/miningqwqlogin](https://github.com/guangtw/miningqwqlogin)。在另一个进程启动后，使用 `ACCOUNT_SERVICE_BASE_URL` 指向其本地地址。浏览器仍只请求本项目同源 `/api/account/*`，不直接接触数据库、SMTP 配置或服务端密钥。

不要将私有密钥放入 `NEXT_PUBLIC_*` 环境变量。不要提交环境文件、数据库、Cookie、真实账号或验证码。测试身份使用 `@example.test`。

## 常用验证

| 命令 | 检查内容 |
| --- | --- |
| `npx tsc --noEmit` | 类型检查 |
| `npm run test:run` | Vitest 单元与路由集成测试 |
| `npm run build` | Next.js 生产构建及类型检查 |
| `npm run test:e2e` | Playwright 桌面与手机浏览器测试 |

首次运行浏览器测试需安装 Chromium：

```bash
npx playwright install chromium
npm run test:e2e
```

测试配置默认使用 3010 端口。测试使用本地接口夹具，不代表生产音源或 SMTP 已验证。没有配置 `REFERENCE_BASE_URL` 时，上游页面视觉对比用例会跳过。需要 WebKit/iPhone 验证时另行安装相应浏览器，并按 [项目约定](../AGENTS.md)设置环境。

GitHub Web CI 在 Ubuntu 上运行类型检查、单元/集成测试和生产构建，不连接生产服务器、不发送邮件、不发布网站。Windows 与 Android 客户端的依赖、构建与验证分别见其目录说明。

## 生产构建与部署

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3010
```

自托管需自行准备真实服务和环境配置，将应用放在 HTTPS 反向代理后，并仅在可信代理环境启用转发 IP 信任。部署时继续使用原有账户数据库与头像目录，不随代码包覆盖用户数据。

本项目维护者使用的 `npm run deploy:echo -- --push` 依赖既有 Windows 路径、SSH 配置和生产目录，不是通用的一键部署器。其检查、备份、候选验证与回滚流程见 [发布手册](release-workflow.md)。

## 改动范围

界面、播放、账户和上游适配各有独立协议，先从[文档导航](README.md)找到相关说明。尽量提交能独立验证的改动；维护现有视觉与动效时，不要用早期来源仓库快照覆盖当前 `main`。
