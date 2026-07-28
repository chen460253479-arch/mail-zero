# 外部遥测完整移除设计

日期：2026-07-28

## 目标

从 Zero 的浏览器端和服务端完整移除 Dub Analytics、Sentry 与 PostHog。应用不再通过这些 SDK 加载外部分析能力、上传页面访问和操作事件、识别用户、转发错误或上传源码映射。

## 删除边界

- 删除 Dub Analytics 前端组件、Better Auth 插件、Dub SDK 及依赖。
- 删除 Sentry 前端初始化、错误处理、服务端转发路由、上传脚本、配置和依赖。
- 删除 PostHog Provider、页面访问采集、用户识别、邮件操作埋点、环境变量和依赖。
- 清除工作区配置与锁文件中的上述依赖记录。
- 通过架构测试禁止这些运行时、配置和依赖重新进入项目。

## 保留边界

- 不调整 Nango、BIMI 或其他邮件渠道集成。
- 不改变登录、收件同步、发件、草稿、标签、文件夹、线程和本地邮箱数据模型。
- 不以其他分析平台替代 PostHog。
- 保留本地日志与浏览器开发控制台错误，便于自托管环境排查问题。

## PostHog 清理方式

`PostHogProvider` 当前负责初始化客户端、自动采集页面访问，并用用户 ID、邮箱和姓名识别登录用户。邮件发送、回复和部分本地操作还会直接调用 `posthog.capture()`。这些调用全部删除，但它们包裹的邮件业务操作保持原样执行。

删除 `posthog-js` 直接依赖后，同步清除 `pnpm-lock.yaml` 的应用导入项、包快照与包实例。该操作不安装依赖、不下载包，也不执行生命周期脚本。

## 验收

- 架构测试拒绝 `posthog-js`、`PostHogProvider`、`posthog.capture`、`posthog.identify`、`VITE_PUBLIC_POSTHOG_*` 和 PostHog 锁文件记录。
- 当前文件系统不存在 `apps/mail/lib/posthog-provider.tsx`。
- 前端 TypeScript、定向 ESLint/Oxlint 和遥测架构测试通过。
- 运行时代码、环境配置、应用清单和锁文件不再包含 Dub、Sentry 或 PostHog。
