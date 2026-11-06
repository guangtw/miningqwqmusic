# 项目文档

从[项目首页](../README.md)开始了解唱片行；开发、接口接入和维护说明按用途列在下面。

## 使用与开发

| 文档 | 内容 |
| --- | --- |
| [开发指南](development.md) | 本地运行、Mock、环境变量与验证命令 |
| [贡献指南](../CONTRIBUTING.md) | 问题反馈与 Pull Request |
| [安全报告](../SECURITY.md) | 私密漏洞报告与敏感信息处理 |
| [Windows 客户端](../desktop/windows/README.md) | 系统能力、构建与打包 |
| [Android 客户端](../desktop/android/README.md) | WebView 壳层、构建与验证 |

## 功能与接口

| 文档 | 内容 |
| --- | --- |
| [前端接入](frontend-integration.md) | 前端来源、目录与集成约定 |
| [音乐上游协议](upstream-contract.md) | BFF 与网易云 API 风格服务的约定 |
| [音源偏好](playback-source-preference.md) | 音质、分类与音源切换 |
| [音乐请求保护](music-upstream-protection.md) | 调度、合并、限流与指标 |
| [会话可靠性](session-reliability.md) | Cookie 轮换与跨标签页行为 |
| [一起听](listen-together.md) | 房间、进度与实时同步 |
| [私信与评论](social-and-messages.md) | 好友、消息、事件与评论读取 |
| [音乐卡片与邀请](message-cards.md) | 结构化分享与一起听邀请 |
| [客户端下载](client-downloads.md) | 版本清单、下载协议与文件校验 |
| [邮箱验证码改密](email-password-claude-handoff.md) | 发码、确认、限流与退出契约 |
| [会员申请](membership-application.md) | 邮箱确认、申请和状态 |
| [会员授权](membership-invitations.md) | 一人一码、期限与数据迁移 |
| [熟人验证](familiar-verification.md) | 题面展示与交互流程 |
| [熟人验证后端](familiar-backend-contract.md) | 题库、挑战与判定规则 |

## 维护与发布

下面包含本项目维护环境的路径、配置和历史操作记录；自托管时应结合自己的环境使用。

- [可重复发布流程](release-workflow.md)：确定提交、测试、候选验收、切换和回滚。
- [域名与服务器部署](echo-subdomain-deploy.md)：HTTPS、进程、备份和服务器准备。
- [邮件通道](mail-channel.md)：SMTP、私有配置和品牌邮件。
- [会员调度设计](membership-admission-design.md)：队列、持久任务和保留策略。
- [后端联合修复记录](backend-request-and-login-repair-plan.md)：请求保护与登录来源信任。

历史界面设计保存在 [设计记录](superpowers/specs/)，其中的方案不一定代表当前运行实现。
