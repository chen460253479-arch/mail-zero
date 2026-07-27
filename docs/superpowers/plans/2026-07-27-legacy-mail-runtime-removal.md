# Legacy Mail Runtime Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新账户、收件、发件、snooze 与 Mail API 链路全部接管后，删除旧 Driver、旧 mail-channel、订阅工厂、旧队列/KV/Workflow 运行时和代码内 Cloudflare 绑定。

**Architecture:** 保留唯一的 Mail Core、本地 PostgreSQL 数据源、插件式 `mail-channel`、通用同步/发件运行时。Cloudflare Queue 仅保留 `MAIL_INGRESS_QUEUE` 与 `MAIL_OUTBOUND_QUEUE`；R2 `THREADS_BUCKET` 继续作为 Mail Core blob store。

**Tech Stack:** TypeScript、Cloudflare Workers/Wrangler、PostgreSQL、Vitest、ESLint

## Global Constraints

- 本计划是硬切换，不保留旧 API、兼容适配器或双写。
- 不修改历史 Cloudflare migration；通过新的 deleted_classes migration 退役已部署 DO 类。
- 外部 Cloudflare Dashboard/API 中的资源删除只形成明确部署清单，不在未授权情况下执行。

---

## Task 1: 删除旧邮件源码与调用分支

**Files:**
- Delete: `apps/server/src/lib/driver/**`
- Delete: `apps/server/src/lib/mail-channel/**`
- Delete: `apps/server/src/lib/factories/**`
- Delete: `apps/server/src/lib/bulk-delete.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/lib/server-utils.ts`
- Modify: `apps/server/src/lib/utils.ts`
- Modify: `apps/server/src/trpc/trpc.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`

- [ ] 先扩展架构测试，禁止旧目录、旧 provider registry、旧订阅工厂和 shard 辅助函数。
- [ ] 删除 `subscribe-queue`、`send-email-queue`、`thread-queue` 分支及旧定时发送/续订。
- [ ] 清理 `server-utils` 中旧 Agent/driver/mail 方法，只保留仍被 Notes/Templates/Settings/Auth 使用的通用函数。
- [ ] 所有前后端邮件调用继续通过 `modules/mail-api` facade。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts src/runtime/mail
```

## Task 2: 从 ZeroDB 移走已接管的邮件职责

**Files:**
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/routes/integrations.ts`
- Modify: `apps/server/src/lib/auth.ts`
- Create: `apps/server/src/no-legacy-mail-rpc.test.ts`

- [ ] 写失败测试，禁止 `DbRpcDO/ZeroDB` 暴露连接授权、邮件同步、发件或 shard 方法。
- [ ] 删除已由 `modules/mail-accounts/postgres` 接管的连接 CRUD/RPC。
- [ ] 保留暂未迁移的用户、设置、快捷键、备注、模板方法，避免扩大本阶段范围。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/no-legacy-mail-rpc.test.ts
```

## Task 3: 清理代码内 Cloudflare 绑定

**Files:**
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/wrangler.jsonc`
- Modify: `apps/server/worker-configuration.d.ts`
- Modify: `docker-compose.yml`

- [ ] 删除旧 KV：pending/scheduled/snoozed Gmail history/processing/subscribed/labels/prompts。
- [ ] 删除旧 Queue：subscribe/send-email/thread；保留新 ingress/outbound Queue。
- [ ] 删除 Agent/Driver/MCP/Workflow DO 绑定与 Workflow 定义。
- [ ] 在各环境 migrations 末尾追加新的 tag 与 `deleted_classes`；不得改写已有 tag。
- [ ] 保留 `ZERO_DB`（仍承载非邮件业务）、`THREADS_BUCKET`、Hyperdrive 和新邮件队列。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec wrangler deploy --dry-run --env local
pnpm --filter @zero/server exec wrangler deploy --dry-run --env staging
pnpm --filter @zero/server exec wrangler deploy --dry-run --env production
```

## Task 4: 最终源码与依赖收敛

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/mail/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/server/src/mail-architecture.test.ts`

- [ ] 删除仅由旧邮件运行时使用的 Microsoft Graph、dormroom、partyserver、hono-agents 等依赖；每项必须先确认无引用。
- [ ] 架构测试增加“唯一邮件链路”断言，禁止旧目录和旧 Cloudflare 绑定名称重新出现。
- [ ] 运行：

```powershell
pnpm --filter @zero/server lint
pnpm --filter @zero/mail lint
pnpm --filter @zero/server exec tsc --noEmit
pnpm --filter @zero/mail exec tsc --noEmit
```

## Task 5: 全计划自动化验收

- [ ] 数据层：

```powershell
pnpm test:mail-core
pnpm --filter @zero/server exec vitest run tests/mail-sync src/modules/mail-outbound src/modules/mail-snooze src/modules/mail-accounts
```

- [ ] 构建层：

```powershell
pnpm --filter @zero/server exec wrangler deploy --dry-run --env local
pnpm --filter @zero/mail build
```

- [ ] 静态疏漏扫描：

```powershell
git grep -n -E "lib/driver|lib/mail-channel|lib/factories|subscribe_queue|send_email_queue|thread_queue|gmail_history_id|gmail_processing_threads|gmail_sub_age|subscribed_accounts|connection_labels|prompts_storage"
```

预期：只允许历史设计/计划文档出现。

- [ ] 提交：

```powershell
git add apps/server apps/mail package.json pnpm-lock.yaml docker-compose.yml
git commit -m "refactor(mail): remove legacy mail runtime"
```

## Task 6: 生产部署清单

- [ ] 记录每个环境需删除的外部 Queue、KV、Workflow、DO binding/namespace。
- [ ] 记录共享 Gmail Topic/Subscription 的 IAM、OIDC audience、Push service account 与回调 URL。
- [ ] 说明部署顺序：先发布新代码与 deleted_classes migration，观察新链路，再删除外部旧资源。
- [ ] 真实 Gmail Push、周期 reconcile、发送与断开/重连验收由用户启动现有环境后执行，不安装 Playwright 或浏览器。
