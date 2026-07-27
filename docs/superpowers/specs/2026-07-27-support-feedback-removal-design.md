# Support and Feedback Removal Design

## Goal

从 Zero 邮箱界面和运行时完整移除 Live Support 与 Feedback 产品入口，使应用只保留标准邮箱及已明确保留的本地业务能力。

## Scope

- 删除侧边栏 Live Support 与 Feedback 入口。
- 删除前端 Intercom 初始化与令牌查询。
- 删除后端 `user.getIntercomToken` tRPC 接口。
- 删除 `@intercom/messenger-js-sdk` 与仅供该接口使用的
  `@tsndr/cloudflare-worker-jwt`。
- 删除仅由这两个入口使用的 `OldPhone`、`MessageSquare` 图标。
- 删除所有语言文件中的 `navigation.sidebar.livesupport` 与
  `navigation.sidebar.feedback` 文案。

## Boundaries

- 保留 `user.delete` 和 `userRouter`，不扩大到其他用户管理功能。
- 保留通用 `JWT_SECRET`，因为它仍属于认证配置；只删除 Intercom 专用签名逻辑。
- 邮件内文、演示数据和 E2E 邮件主题中的普通英文单词 “feedback” 不属于产品反馈入口，
  不删除。
- 不修改 Mail Core、邮件同步、发件、数据库 Schema 或 Docker 配置。

## Verification

- 架构测试禁止重新引入 Intercom SDK、令牌接口、客服/反馈导航和专用依赖。
- 服务端与前端 TypeScript 检查通过。
- 相关 ESLint 检查通过。
- 前端生产构建通过并重新生成 Paraglide 消息模块。

