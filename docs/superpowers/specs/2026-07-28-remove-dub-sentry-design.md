# Dub Analytics 与 Sentry 完整移除设计

## 目标

从 Zero 的浏览器端和服务端完整移除 Dub Analytics 与 Sentry，停止向这两个第三方服务加载脚本、上报分析数据、错误数据、性能数据和会话回放数据。

## 边界

- 删除前端 Dub Analytics 全局组件和 `@dub/analytics`。
- 删除 Better Auth 的 Dub 插件、Dub SDK，以及 `@dub/better-auth`、`dub`。
- 删除前端 Sentry 初始化、React 错误处理、异常上报和 `@sentry/react`。
- 删除服务端 `/monitoring/sentry` 转发路由及其固定 Host、Project ID。
- 删除工作区构建白名单和锁文件中的 Dub、Sentry 孤立记录。
- 增加架构回归测试，防止上述运行时、路由和依赖重新进入项目。

## 明确不包含

- 不调整 Nango `baseUrl` 或凭据处理。
- 不调整 BIMI。
- 不调整 PostHog 或其他外部服务。
- 不改变邮件同步、发送、登录、邮箱 API 和本地邮箱数据模型。

## 实现策略

使用一个独立的架构测试表达“Dub 与 Sentry 不得存在于应用运行时”的约束。先运行该测试并确认它因现有 Dub/Sentry 代码失败，再删除前后端入口、服务端转发路由和依赖，最后离线更新锁文件并运行定向测试、类型检查或构建检查。
