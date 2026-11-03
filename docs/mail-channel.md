# 服务器邮件通道

本次只接通事务邮件发送，不开放会员申请、不自动发码、不改变会员名额规则，也不修改前端视觉或数据库结构。

账户服务使用 Nodemailer（需要 Node 20+；生产使用 Node 24）通过 SMTP 发送纯文本通知。163 邮箱使用 `smtp.163.com:465`、直接 TLS、客户端授权码；证书必须验证通过。587 等非直接 TLS 连接强制 STARTTLS，配置不得用 `SMTP_SECURE=false` 连接 465。

## 私有配置

实际配置保存在 `/www/wwwroot/miningqwqmusic/shared/mail.env`，root 所有、权限 600。账户服务的私有 `.env` 中只引用 `ACCOUNT_MAIL_ENV_FILE=/www/wwwroot/miningqwqmusic/shared/mail.env`。发布继续复用这份配置，凭证不进入源代码、归档、GitHub、命令参数或日志。文件缺失、权限过宽或字段不完整时，邮件操作安全失败；其他账户功能继续运行。

配置字段为 `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`、`MAIL_FROM_NAME`、`MAIL_FROM_ADDRESS`。授权码应在邮箱后台生成，不使用网页登录密码。切换服务商或轮换凭证时更新私有文件即可，后续调用读取最新配置。

## 服务端接口

- `GET /api/account/admin/mail`：管理员查看是否配置及公开的发件地址/服务器信息，不返回授权码、认证用户名或配置文件路径。
- `POST /api/account/admin/mail/verify`：管理员验证 SMTP 认证，不发邮件；并发调用共享一次验证，成功缓存 30 秒。普通用户返回 403，未登录返回 401，响应禁止缓存。
- 内部 `sendTransactionalMail({to, subject, text})`：只接受单个收件人和纯文本。头部换行、附件、文件/URL 读取均被拒绝。没有公开的任意收件人发送 API。

未来自动申请功能可调用内部发送函数；申请资格、名额预留、发码幂等和候补规则须另外实现，当前配置不代表这些功能已上线。

## 运维与验收

在账户服务的发布目录执行 `node scripts/mail-channel.mjs --verify`，只验证连接、证书和认证。执行 `--send-test` 时，仅向配置中的发件地址发送一封固定内容测试邮件，不接受命令行收件人，不生成会员码。不得把发送测试加入自动部署；只有得到用户明确指示才实际发信。

生产发布在候选和正式阶段分别运行认证验证；应用验收失败按原流程回滚。SMTP 错误仅返回固定错误码，不输出服务商原始响应或凭证。SMTP 接收成功仅表示邮件服务商接受投递，不保证已经进入收件箱。
