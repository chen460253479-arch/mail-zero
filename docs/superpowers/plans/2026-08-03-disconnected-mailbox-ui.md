# 断开邮箱后的界面状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 断开邮箱后立即清除活动邮箱状态，禁止 disconnected 记录继续驱动邮件界面。

**Architecture:** 服务端通过纯选择器统一定义默认连接资格；客户端通过纯过滤器防御持久缓存中的旧状态；断开流程复用邮箱连接查询刷新器，并在重新获取前先清空默认连接缓存。

**Tech Stack:** TypeScript、React、TanStack Query、tRPC、Vitest。

## Global Constraints

- 本地保留数据继续保留，不删除 Mail Core 邮件数据。
- 不修改外部邮箱渠道逻辑。
- 不执行构建、打包、Docker 或完整测试套件。
- 测试使用单文件、单 fork。
- 不修改工作区原有 `.env.example` 变更。

---

### Task 1: 服务端默认连接只选择 connected

**Files:**
- Create: `apps/server/src/modules/mail-accounts/application/select-default-connection.ts`
- Create: `apps/server/tests/unit/modules/mail-accounts/application/select-default-connection.test.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`

- [x] 写入默认连接选择器失败测试。
- [x] 单文件运行并确认因实现缺失失败。
- [x] 实现 connected 过滤、默认 ID 优先和稳定回退顺序。
- [x] 将 `getDefault` 与 `setDefault` 接入选择规则。
- [x] 单文件运行并确认通过。

### Task 2: 客户端过滤非 connected 缓存

**Files:**
- Create: `apps/mail/modules/mail-connections/connected-connections.ts`
- Create: `apps/mail/modules/mail-connections/connected-connections.test.ts`
- Modify: `apps/mail/hooks/use-connections.ts`
- Modify: `apps/mail/components/ui/nav-user.tsx`

- [x] 写入活动连接和连接列表过滤失败测试。
- [x] 单文件运行并确认因实现缺失失败。
- [x] 实现过滤器并接入活动连接查询和侧边栏。
- [x] 移除无活动邮箱时的登录用户身份回退。
- [x] 单文件运行并确认通过。

### Task 3: 断开后立即清空查询缓存

**Files:**
- Modify: `apps/mail/modules/mail-connections/refresh-mailbox-queries.ts`
- Modify: `apps/mail/modules/mail-connections/refresh-mailbox-queries.test.ts`
- Modify: `apps/mail/components/connection/disconnect-dialog.tsx`

- [x] 写入清空默认连接缓存失败测试。
- [x] 单文件运行并确认失败。
- [x] 为刷新器增加 `clearDefaultConnection` 选项。
- [x] 断开和删除保留数据流程接入统一刷新器。
- [x] 运行三份客户端测试与服务端选择器测试，确认全部通过。
