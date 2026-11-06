# 邮箱验证码修改密码：Claude 前端交接

2026-11-06。后端已实现，前端由 Claude 在本仓库最新 `origin/main` 上接入。入口为账户设置里的「修改密码」，保留现有旧密码方式，增加「邮箱验证码」方式。沿用现有组件、样式、布局、字体和动效。本次没有修改前端源码，也没有发布生产；不要把源码已推送理解为线上接口已可用。

账户服务仓库：`guangtw/miningqwqlogin`，后端提交 [`8eb24248f0dbb83ce10a58e6d69220cf30423ad2`](https://github.com/guangtw/miningqwqlogin/commit/8eb24248f0dbb83ce10a58e6d69220cf30423ad2)（`feat(auth): support email-verified password changes`）。音乐 BFF 已有通用代理和 `auth/email/**` 来源校验，无需新增代理路由。本仓库补充了两个新端点的代理回归测试。

## 接口契约

均请求**音乐站同源**接口，使用现有 `authed` 请求链携带 `Authorization: Bearer <accessToken>`，浏览器照常携带 Cookie。不能绕过 BFF 直连账户服务。两个接口都需要登录，不是未登录的找回密码功能。后端只向数据库里当前账号的邮箱发码，不接受客户端指定邮箱或用户 ID。

响应沿用 `{code: 0, message, data, traceId}`，失败沿用 `{code, message, traceId, retryable, retryAfterSeconds?}`，全部禁止缓存。

### 1. 发送验证码

`POST /api/account/auth/email/password/request`

必须发送 JSON `{}`，无额外字段。成功 HTTP 200 的 `data`：

```ts
{
  challengeId: string; // UUID，只供随后确认提交
  expiresAt: string;  // ISO UTC，10 分钟有效
  resendAfter: string; // ISO UTC，60 秒后可重发
  serverTime: string;
}
```

邮件进入已有持久队列；200 表示已排队，不表示已经进入收件箱。页面可显示当前登录账号邮箱（来自现有 `authStore.user.email`），不要放可编辑收件邮箱。验证码为六位数字，包括开头的 0。保持字符串，建议 `inputMode="numeric"`、`autoComplete="one-time-code"`，不要用数字类型或 Number 转换。

倒计时按 `resendAfter - serverTime` 校准，本地刷新、关闭再打开弹窗不能绕过服务端限流。共享现有邮件预算：每邮箱每分钟 1 封、每邮箱每日 10 封、每 IP 每日 50 封、全站每日 300 封（固定窗口）。登录和会员验证码也共用这些发送预算。重发成功必须替换 challengeId；旧的改密验证码立即失效。

### 2. 确认改密

`POST /api/account/auth/email/password/confirm`

```json
{
  "challengeId": "上一步返回的 UUID",
  "code": "012345",
  "newPassword": "用户的新密码"
}
```

只接受这三个字段，不传旧密码、邮箱、确认密码或用户 ID。前端的二次新密码输入只用于本地一致性检查。密码规则复用现有规则：默认 10–128 字符，包含大写、小写、数字及非字母数字字符；部署可配置长度。不要 trim 密码。

成功 HTTP 200，`data` 为 `{ok: true, requiresLogin: true}`，响应清除刷新 Cookie（包含兼容旧 Cookie）。后端在同一事务中更新密码、验证账号邮箱、撤销该用户所有刷新会话、消费验证码、作废未使用的登录及改密验证码，并清理相关邮件密文。任何一步失败全部回滚。不会删库、清歌单、撤销会员或改数据库 schema。

## Claude 需要完成的前端改动

- 在 `src/frontend/views/AccountView.tsx` 的 `PasswordField` 内加入验证方式选择，保留旧密码方式；邮箱方式显示发码、验证码、新密码及再次确认，不要求旧密码。
- 在 `src/frontend/config/site.ts` 增加两个路径，在 `src/frontend/lib/account.ts` 增加请求封装；可以复用 `OtpChallengeResponse`，新成功类型为 `{ok: true; requiresLogin: true}`。
- 确认接口成功后清掉内存 token/user/playbackAuthorization、停止恢复计时、递增 authGeneration，并广播退出，使其他标签页同步退出。复用现有 `sessionLock` 序列化确认操作与 Cookie 刷新，防止旧刷新响应覆盖清 Cookie。可抽取现有退出状态清理逻辑；不要把此接口接到旧 `changePassword(oldPassword, newPassword)`，它会自动重登，与新接口要求重新登录的契约不同。
- 成功提示「密码已修改，请用新密码重新登录」，进入现有登录流程。失败保留用户输入以便纠正；新密码不写本地存储、URL、日志或分析事件。
- 六位验证码校验、两次密码一致校验、提交中防重复、发送失败恢复按钮、429 使用服务器等待秒数、过期/五次错误提示重新发码；关闭弹窗清掉密码和验证码。
- 复用现有请求错误处理和登录恢复，不要将 5905 验证失败当作登录失效。

会话限制：项目现有 access token 是无状态 JWT，已签发的 token 在到期前仍可能使用（默认最长 15 分钟）。刷新会话立即撤销；不要承诺所有设备的 access token 立即失效。本次没有改变全站鉴权模型。

## 错误与降级

| HTTP / code | 含义与建议 |
| --- | --- |
| 400 / 5101 | 参数不合法，包括密码规则不满足、验证码格式或额外字段；在前端先检查 |
| 400 / 5905 | 验证码错误、过期、已使用、用途或账号不符；不泄露细分原因 |
| 401 / 5204（或现有 token 错误码） | 未登录或 token 无效，走现有登录恢复 |
| 403 / 5207 | 来源校验失败，提示刷新页面 |
| 429 / 5910 | 持久限流，按 `Retry-After` / `retryAfterSeconds` 等待 |
| 503 / 5900 | SMTP 配置不可用或邮件 Worker 心跳过期，提示稍后再试，旧密码方式仍可使用 |
| 503 / 5914 | 账户写入繁忙，遵循重试提示 |
| 502–504 / 540x | BFF/账户服务异常，沿用现有暂不可用提示 |

每个 challenge 最多 5 次错误，次数持久化；验证 IP 每 15 分钟 30 次，与现有邮箱验证码共用预算。登录/会员验证码不能用来改密，改密码也不能用来登录。改密不依赖会员申请或邮箱登录开关，依赖私有 SMTP 配置和现有 `miningqwq-membership-worker` 在线；不需要新环境变量或迁移。

## 验收与发布

后端账户全量回归 182 项通过，TypeScript 检查及生产构建通过；新增 8 项集成测试覆盖发码鉴权/限流、改密/旧密码登录失败/新密码登录成功、会话撤销、错误次数、用途与账号隔离、过期与来源、重发与并发、Worker 离线、事务回滚和桩邮件投递（部分场景组合在一个测试中）。音乐 BFF 与来源校验 25 项通过。测试只使用临时 SQLite、`@example.test` 和桩发送器，没有发送真实邮件。

Claude 接入后补桌面/手机前端测试：切换验证方式、发码倒计时、开头为 0 的验证码、参数/密码校验、429/503、重发后旧码失效、成功退出及跨标签页状态清理。后端接口未部署时用请求桩，不能反复向真实邮箱发码。

最终前后端一起按 `docs/release-workflow.md` 发布，继续复用原库、头像和私有邮件配置，不上传任何凭证。源码推送与生产发布分别核验；只有标准脚本输出 `PRODUCTION_VERIFIED` 且部署清单匹配两个提交时才能宣称上线。
