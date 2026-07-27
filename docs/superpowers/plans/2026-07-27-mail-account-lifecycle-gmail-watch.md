# Mail Account Lifecycle and Gmail Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Gmail Zero OAuth 与 Nango 两种授权统一进入本地邮箱账户生命周期，并由新邮件链路直接创建本地账户、默认身份和 Inbox 增量 Watch，不再经过 Brain、旧订阅工厂或旧 KV。

**Architecture:** `modules/mail-accounts` 负责连接与本地账户生命周期，`mail-channel/gmail/inbound` 只封装 Gmail Watch/Stop 与 Push 身份校验，`runtime/mail` 负责把应用服务接到 PostgreSQL、Cloudflare Queue 和 Gmail 插件。Pub/Sub Topic/Subscription 是部署级共享资源，邮箱级只保存 Gmail Watch 到期时间和增量检查点。

**Tech Stack:** TypeScript、Drizzle ORM、PostgreSQL、Cloudflare Workers/Queues、Gmail API、Google OIDC、Vitest

## Global Constraints

- 不创建 worktree，不安装依赖，不启动或重建 Docker。
- 只同步 Gmail Inbox 增量邮件，不做历史导入，不反向同步本地标签/文件夹。
- 同一个 Gmail 地址全局只允许一个活动绑定；断开后允许保留本地数据并重新授权。
- Gmail Push 在持久化同步请求后才能返回成功；Push 与定时任务只产生同步请求。
- 每个任务遵循测试先行；仅运行本任务相关测试，阶段末再运行组合验证。

---

## Task 1: 固化全局邮箱身份约束

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/tests/mail-core/schema.integration.test.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.test.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/connect-gmail-oauth.test.ts`

- [ ] 增加失败测试：两个用户不能同时绑定相同 `channel_id + normalized_email` 的活动连接。
- [ ] 在 `integration.connection` 增加仅覆盖 `connected/reconnect_required` 的部分唯一索引。
- [ ] 保留现有表列、主外键和用户内历史连接约束，不修改既有邮件表结构。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-accounts tests/mail-core/schema.integration.test.ts
```

预期：新增测试由失败转为通过。

## Task 2: 建立独立 PostgreSQL 连接仓储

**Files:**
- Create: `apps/server/src/modules/mail-accounts/postgres/connection-repository.ts`
- Create: `apps/server/src/modules/mail-accounts/postgres/connection-repository.integration.test.ts`
- Modify: `apps/server/src/modules/mail-accounts/index.ts`
- Modify: `apps/server/src/db/schema.ts`

- [ ] 先写仓储集成测试，覆盖全局邮箱查重、创建连接与授权、断开连接、删除授权、列出用户连接。
- [ ] 实现 `createPostgresConnectionRepository(db)`，将连接事务从 `ZeroDB` 邮件职责中移出。
- [ ] `saveBinding` 在一个事务中锁定/复用断开连接并写入授权；唯一约束冲突映射成稳定领域错误。
- [ ] 所有读写必须带 `userId` 或返回明确的全局占用结果，禁止仅凭 `connectionId` 越权。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-accounts/postgres/connection-repository.integration.test.ts
```

## Task 3: 统一绑定后的本地邮箱启动

**Files:**
- Create: `apps/server/src/modules/mail-accounts/application/provision-mailbox.ts`
- Create: `apps/server/src/modules/mail-accounts/application/provision-mailbox.test.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/connect-gmail-oauth.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.ts`
- Modify: `apps/server/src/runtime/mail/gmail-oauth.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/routes/integrations.ts`

- [ ] 写失败测试：保存连接后必须幂等创建 `mail.account`、八个系统邮箱和默认 `mail.identity`。
- [ ] 定义 `provisionMailbox({userId, connectionId, identity})`，依次调用 Mail Core `createAccount` 与 `createIdentity`，并对并发重试保持幂等。
- [ ] Gmail OAuth 与 Nango 都通过同一应用服务保存绑定并启动本地账户，禁止各自实现一套启动逻辑。
- [ ] 失败补偿：授权已保存但本地启动失败时连接进入 `reconnect_required`，下次授权/恢复可继续，不删除已创建的本地数据。
- [ ] 将 routes/tRPC 从 `getZeroDB().createMailboxWithAuthorization` 切到新仓储运行时。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-accounts
```

## Task 4: 部署级 Gmail Pub/Sub 配置与 Watch/Stop

**Files:**
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-client.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-client.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-transport.ts`
- Modify: `apps/server/src/mail-channel/gmail/inbound/adapter.ts`
- Modify: `apps/server/src/mail-channel/gmail/inbound/adapter.test.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Create: `apps/server/src/runtime/mail/gmail-inbound-config.ts`
- Create: `apps/server/src/runtime/mail/gmail-inbound-config.test.ts`

- [ ] 先写测试，要求所有邮箱使用同一 `GMAIL_PUBSUB_TOPIC_NAME`，不再拼接 `connectionId`。
- [ ] 增加显式部署配置：Topic 名、Subscription 名、OIDC audience、允许的 Push 服务账号。
- [ ] Gmail API 客户端增加 `stopWatch()`，适配器暴露幂等取消订阅能力。
- [ ] `activateGmailInboundForConnection` 直接由统一绑定启动服务调用，并创建 Inbox 增量检查点/Watch。
- [ ] 删除新运行时对 `GOOGLE_S_ACCOUNT.project_id + notifications__connectionId` 的依赖。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/mail-channel/gmail/inbound src/mail-channel/gmail/shared/api-client.test.ts src/runtime/mail/gmail-inbound-config.test.ts
```

## Task 5: 安全且持久的 Gmail Push 入口

**Files:**
- Create: `apps/server/src/mail-channel/gmail/inbound/push-auth.ts`
- Create: `apps/server/src/mail-channel/gmail/inbound/push-auth.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/inbound/handle-push.ts`
- Modify: `apps/server/src/mail-channel/gmail/inbound/handle-push.test.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/src/main.ts`

- [ ] 写失败测试：拒绝错误 issuer、audience、service-account email 和 subscription header。
- [ ] 使用 `google-auth-library` 校验 OIDC ID token；不再使用只查 tokeninfo 的 `verifyToken`。
- [ ] Push 路由先调用 PostgreSQL `recordSignal` 持久化请求，再尝试入队发现命令；持久化失败返回非 2xx，持久化成功后即使瞬时入队失败也可由调度补偿。
- [ ] 正确解析 Gmail Pub/Sub 包装消息与直接测试载荷，日志不得包含 token 或邮件正文。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/mail-channel/gmail/inbound src/modules/mail-sync/application/receive-signal.test.ts
```

## Task 6: 新生命周期接管断开、重连和删除

**Files:**
- Modify: `apps/server/src/modules/mail-accounts/application/disconnect-mailbox.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/disconnect-mailbox.test.ts`
- Create: `apps/server/src/modules/mail-accounts/runtime/lifecycle.ts`
- Create: `apps/server/src/modules/mail-accounts/runtime/lifecycle.test.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/lib/auth.ts`

- [ ] 写测试覆盖顺序：停止 Gmail Watch/暂停同步 → 撤销 Zero OAuth（Nango 仅解除本地绑定）→ 删除授权 → 标记断开或删除。
- [ ] 删除本地数据时先列出 `mail.blob.object_key` 并删除对应 R2 对象，再删除 connection，让 PostgreSQL 外键级联清理 Mail Core、同步、发件和 snooze 数据。
- [ ] 用户删除复用同一个生命周期服务，不再调用 Brain 或旧 shard/KV 清理。
- [ ] 重连复用原 `connection` 与 `mail.account`，恢复默认身份和 Inbox Watch，不创建重复账户。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-accounts
```

## Task 7: 第一阶段边界验收

**Files:**
- Modify: `apps/server/src/mail-architecture.test.ts`
- Modify: `apps/server/src/runtime/mail/outbound.test.ts`

- [ ] 增加架构测试：新账户生命周期不得导入 `lib/brain`、`lib/factories`、`lib/server-utils` 或旧 mail-channel。
- [ ] 确认 routes/tRPC 不再向 `subscribe_queue` 投递。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-accounts src/modules/mail-sync src/mail-channel/gmail src/runtime/mail src/mail-architecture.test.ts
pnpm --filter @zero/server lint
```

- [ ] 提交：

```powershell
git add apps/server packages/mail-core
git commit -m "feat(mail): unify account lifecycle and gmail watch"
```
