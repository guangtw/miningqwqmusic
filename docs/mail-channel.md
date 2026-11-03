# 服务器邮件通道

本次只接通事务邮件发送，不开放会员申请、不自动发码、不改变会员名额规则，也不修改前端视觉或数据库结构。

账户服务使用 Nodemailer（需要 Node 20+；生产使用 Node 24）通过 SMTP 发送品牌 HTML 通知，同时附带可独立阅读的纯文本版本。163 邮箱使用 `smtp.163.com:465`、直接 TLS、客户端授权码；证书必须验证通过。587 等非直接 TLS 连接强制 STARTTLS，配置不得用 `SMTP_SECURE=false` 连接 465。

## 私有配置

实际配置保存在 `/www/wwwroot/miningqwqmusic/shared/mail.env`，root 所有、权限 600。账户服务的私有 `.env` 中只引用 `ACCOUNT_MAIL_ENV_FILE=/www/wwwroot/miningqwqmusic/shared/mail.env`。发布继续复用这份配置，凭证不进入源代码、归档、GitHub、命令参数或日志。文件缺失、权限过宽或字段不完整时，邮件操作安全失败；其他账户功能继续运行。

配置字段为 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`、`MAIL_FROM_NAME`、`MAIL_FROM_ADDRESS`。授权码应在邮箱后台生成，不使用网页登录密码。切换服务商或轮换凭证时更新私有文件即可，后续调用读取最新配置。

## 服务端接口

- `GET /api/account/admin/mail`：管理员查看是否配置及公开的发件地址/服务器信息，不返回授权码、认证用户名或配置文件路径。
- `POST /api/account/admin/mail/verify`：管理员验证 SMTP 认证，不发邮件；并发调用共享一次验证，成功缓存 30 秒。普通用户返回 403，未登录返回 401，响应禁止缓存。
- 内部 `sendTransactionalMail({to, subject, text})`：调用方仍只提供单个收件人、标题与纯文本；服务端自动套用品牌 HTML 模板并生成纯文本兼容版。所有动态内容转义，头部换行、调用方附件/HTML、文件/URL 读取仍被拒绝。没有公开的任意收件人发送 API。

## 唱片行品牌邮件

模板沿用网站的纸白 `#f3f2ee`、墨黑 `#111111` 与唱片封套陶土色 `#a8553a`，复用网站 `public/icons/icon-192.png` 的 M 字唱片图标；账号服务包内固定副本为 `src/lib/mail/assets/mining-mark.png`。该图标以 Buffer + CID 内嵌，邮件不访问外部图片、字体或追踪像素。客户端禁用图片时，文字品牌名、正文与站点链接依然可读。

布局采用展示用表格和内联 CSS，含 640px 桌面版、手机排版与支持客户端的深色配色。CTA 仅指向固定的 `https://echo.miningqwq.cn`，不会生成不存在的申请链接。实际邮件显示仍取决于收件客户端的 HTML/CSS 支持。

`node scripts/preview-mail.mjs <绝对输出目录>` 离线生成自包含 `brand-mail.html` 和标准 MIME `brand-mail.eml`，使用虚构的 `preview@example.test` 地址，无需 SMTP 配置，不联网发信。`--send-test` 会发送这一品牌预览样式到已配置的发件地址，每次实际发信仍须用户明确授权。

未来自动申请功能可调用内部发送函数；申请资格、名额预留、发码幂等和候补规则须另外实现，当前配置不代表这些功能已上线。

## 运维与验收

在账户服务的发布目录执行 `node scripts/mail-channel.mjs --verify`，只验证连接、证书和认证。执行 `--send-test` 时，仅向配置中的发件地址发送一封固定内容测试邮件，不接受命令行收件人，不生成会员码。不得把发送测试加入自动部署；只有得到用户明确指示才实际发信。

生产发布在候选和正式阶段分别运行认证验证；应用验收失败按原流程回滚。SMTP 错误仅返回固定错误码，不输出服务商原始响应或凭证。SMTP 接收成功仅表示邮件服务商接受投递，不保证已经进入收件箱。
