# Provider-neutral 邮件入站与 Gmail 增量同步实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 按任务逐项实施；每项功能必须先写失败测试，再写最小实现，并在任务完成后运行对应验证。

**目标：** 在不切换现有前端的前提下，为 Zero 建立基于 PostgreSQL 的通用邮件入站同步模块，并完成首个 Gmail 适配器。首期只导入 Gmail 绑定完成后新进入 Inbox 的邮件，不导入历史邮件。

**架构：** 渠道适配器负责提供不透明检查点、标准化新增邮件事件、原始 MIME 获取、错误分类和订阅能力；通用 `modules/mail-sync` 负责在 PostgreSQL 中持久化同步状态、待导入项目、租约和尝试记录，再统一调用 `MailCore.importEmail`。Gmail Pub/Sub 只作为唤醒信号，周期性 reconcile 负责弥补通知丢失。

**技术栈：** TypeScript、PostgreSQL、Drizzle ORM、Vitest、Cloudflare Queues/Scheduled Handler、`@googleapis/gmail`、现有 `@zero/mail-core`、现有 `R2BlobStore`。

## 一、不可变边界

- 直接在 `D:\WorkSpace\Zero` 当前分支 `codex/local-mail-core` 开发，不创建 worktree。
- `modules/mail-sync` 不允许出现 Gmail、Outlook、Zoho、IMAP 等渠道判断。
- 首期范围固定为 `Inbox + 仅增量`：绑定时建立基线，不读取基线之前的历史邮件。
- Gmail 的标签、已读、星标、移动、归档、删除等变化全部忽略。
- 导入后，以 Zero 本地邮箱数据为唯一业务事实，不把本地状态反向写回 Gmail。
- 原始 MIME 必须进入现有的 `MailCore.importEmail`；Gmail threadId 不决定本地线程。
- PostgreSQL 是新同步链路唯一的状态来源，不再依赖 KV 中的 `gmail_history_id`。
- 现有 Durable Object、Workflow、旧同步代码和前端入口暂时保留，避免本阶段切换前端。
- 新表放入 `integration` Schema，不改变既有邮件内核表结构。
- 开发阶段继续只维护一份 `0000` 基线 SQL，不新增时间线式 `0001`。
- 不增加运行时依赖，优先复用仓库已有组件。
- 保留用户未跟踪的 `AGENTS.md`，不暂存、不提交。

## 二、目标目录

```text
apps/server/src/
├─ lib/mail-channel/
│  ├─ types.ts
│  ├─ registry.ts
│  └─ gmail/
│     ├─ channel.ts
│     ├─ errors.ts
│     ├─ gmail-api-client.ts
│     ├─ history-mapper.ts
│     ├─ ingress-adapter.ts
│     └─ *.test.ts
├─ modules/mail-sync/
│  ├─ index.ts
│  ├─ domain/
│  │  ├─ errors.ts
│  │  ├─ ingress-adapter.ts
│  │  ├─ ingress-event.ts
│  │  └─ sync-state.ts
│  ├─ application/
│  │  ├─ activate.ts
│  │  ├─ bootstrap-account.ts
│  │  ├─ discover-incremental.ts
│  │  ├─ import-pending.ts
│  │  ├─ receive-signal.ts
│  │  ├─ reconcile.ts
│  │  └─ renew-subscription.ts
│  ├─ postgres/
│  │  ├─ schema.ts
│  │  ├─ sync-repository.ts
│  │  └─ types.ts
│  └─ runtime/
│     ├─ create-gmail-ingress.ts
│     ├─ create-mail-sync.ts
│     └─ handle-gmail-push.ts
├─ db/schema.ts
├─ env.ts
└─ main.ts

apps/server/tests/mail-sync/
├─ helpers/database.ts
├─ schema.integration.test.ts
├─ repository.integration.test.ts
├─ activation.integration.test.ts
├─ discovery.integration.test.ts
└─ import.integration.test.ts
```

现有 `lib/mail-channel/gmail.ts`、`gmail-sync.ts` 及其测试作为旧链路兼容面保留。

---

## 任务 1：定义与渠道无关的入站契约

**文件**

- 新建 `apps/server/src/modules/mail-sync/domain/ingress-event.ts`
- 新建 `apps/server/src/modules/mail-sync/domain/ingress-adapter.ts`
- 新建 `apps/server/src/modules/mail-sync/domain/sync-state.ts`
- 新建 `apps/server/src/modules/mail-sync/domain/errors.ts`
- 新建 `apps/server/src/modules/mail-sync/domain/ingress-adapter.test.ts`
- 新建 `apps/server/src/modules/mail-sync/index.ts`
- 修改 `apps/server/src/lib/mail-channel/types.ts`
- 修改 `apps/server/src/lib/mail-channel/gmail.ts`

### 1.1 先写失败测试

测试应证明：

- 检查点和订阅目标都带显式 `version`，并保持渠道不透明。
- 标准事件只表达新增邮件，不泄漏 Gmail History 结构。
- 适配器工厂按连接创建实例，不能保存跨账号的认证状态。
- 邮件渠道可以选择性提供 `inbound` 工厂，旧渠道不受影响。
- `mail-sync` 目录不存在 Gmail 字符串或 Gmail 类型依赖。

运行：

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync/domain/ingress-adapter.test.ts
```

预期：测试先因模块不存在失败。

### 1.2 实现最小领域契约

核心类型：

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type VersionedProviderState = {
  version: number;
  [key: string]: JsonValue;
};

export type IngressScope = {
  version: 1;
  mailboxRoles: ['inbox'];
  initialSync: 'none';
};

export type IngressMessageAdded = {
  type: 'message_added';
  remoteMessageId: string;
  remoteThreadId: string | null;
};

export type DiscoverPage = {
  events: IngressMessageAdded[];
  nextPageToken: string | null;
  checkpoint: VersionedProviderState;
};

export type RawIngressMessage = {
  remoteMessageId: string;
  raw: Uint8Array;
  receivedAt: Date | null;
};
```

适配器职责：

```ts
export interface InboundMailAdapter {
  readonly provider: string;
  establishCheckpoint(scope: IngressScope): Promise<VersionedProviderState>;
  discover(input: {
    scope: IngressScope;
    checkpoint: VersionedProviderState;
    pageToken: string | null;
  }): Promise<DiscoverPage>;
  fetchRawMessage(input: {
    scope: IngressScope;
    remoteMessageId: string;
  }): Promise<RawIngressMessage>;
  subscribe?(input: {
    scope: IngressScope;
    checkpoint: VersionedProviderState;
    target: VersionedProviderState;
  }): Promise<{ expiresAt: Date | null }>;
  classifyError(error: unknown): 'retryable' | 'authentication' | 'permanent';
}

export interface InboundMailAdapterFactory {
  create(connectionId: string): Promise<InboundMailAdapter>;
}
```

在 `MailboxChannel` 上增加可选的 `inbound` 工厂，不删除旧 `sync` 能力。

### 1.3 验证

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync/domain/ingress-adapter.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

仓库若有既有 TypeScript 诊断，记录基线；本任务不得增加新诊断。

---

## 任务 2：增加同步表并重新生成唯一开发基线

**文件**

- 新建 `apps/server/src/modules/mail-sync/postgres/schema.ts`
- 修改 `apps/server/src/db/schema.ts`
- 修改 `apps/server/tests/mail-core/helpers/database.ts`
- 新建 `apps/server/tests/mail-sync/helpers/database.ts`
- 新建 `apps/server/tests/mail-sync/schema.integration.test.ts`
- 重新生成 `apps/server/src/db/migrations/0000_*.sql`
- 重新生成 `apps/server/src/db/migrations/meta/0000_snapshot.json`
- 重新生成 `apps/server/src/db/migrations/meta/_journal.json`

### 2.1 先写 Schema 集成测试

测试在临时数据库应用 `0000` 基线后断言：

- `integration.inbound_sync`、`inbound_sync_item`、`inbound_sync_attempt` 存在。
- 不存在新的 `0001` 迁移。
- 外键能阻止悬空账号和悬空同步项目。
- 唯一约束能阻止同一账号、同一 provider、同一 scope 的重复同步。
- 唯一约束能阻止同一同步流中重复的 `remote_message_id`。
- 索引覆盖到期租约、待处理项目、订阅续期和 reconcile 查询。

运行：

```powershell
pnpm --dir apps/server exec vitest run tests/mail-sync/schema.integration.test.ts
```

预期：先因表不存在失败。

### 2.2 增加三张表

`integration.inbound_sync`：

- `id`
- `account_id`，外键到本地邮件账号
- `provider`
- `scope_key`
- `scope` JSONB
- `checkpoint` JSONB
- `status`：`activating | active | paused | auth_error`
- `subscription_expires_at`
- `last_signal_at`
- `last_discovered_at`
- `last_reconciled_at`
- `lease_owner`
- `lease_expires_at`
- `created_at`
- `updated_at`

约束：

- 唯一 `(account_id, provider, scope_key)`
- 检查 `checkpoint.version` 和 `scope.version` 存在
- 检查租约 owner/expiry 同时为空或同时非空

`integration.inbound_sync_item`：

- `id`
- `sync_id`
- `remote_message_id`
- `remote_thread_id`
- `status`：`pending | processing | imported | failed`
- `attempt_count`
- `next_attempt_at`
- `lease_owner`
- `lease_expires_at`
- `local_email_id`
- `last_error_code`
- `last_error_message`
- `discovered_at`
- `imported_at`
- `created_at`
- `updated_at`

约束：

- 唯一 `(sync_id, remote_message_id)`
- `imported` 状态必须有 `local_email_id` 和 `imported_at`
- 租约字段成对出现

`integration.inbound_sync_attempt`：

- `id`
- `item_id`
- `attempt_number`
- `outcome`：`retry | imported | failed`
- `error_code`
- `error_message`
- `started_at`
- `finished_at`

约束：

- 唯一 `(item_id, attempt_number)`
- `finished_at >= started_at`

不在同步表重复存 `channel_id`；通过 `mail.account` 与现有连接关系解析渠道。

### 2.3 重新生成单一基线

先确认当前迁移只包含一个 `0000`，再仅删除当前基线产物：

```powershell
git rm apps/server/src/db/migrations/0000_organic_captain_britain.sql
git rm apps/server/src/db/migrations/meta/0000_snapshot.json
git rm apps/server/src/db/migrations/meta/_journal.json
pnpm db:generate
```

生成后必须确认：

- SQL 文件仍只有一个 `0000_*.sql`
- `_journal.json` 只有 `idx: 0`
- 新基线可从空库一次性建立全部 Schema

这里不运行会清空本机开发数据的 `db:push --reset --yes`；使用测试临时库验证基线。

### 2.4 验证

```powershell
pnpm --dir apps/server exec vitest run tests/mail-sync/schema.integration.test.ts
pnpm test:mail-core
```

---

## 任务 3：实现 PostgreSQL 仓储、租约和幂等状态机

**文件**

- 新建 `apps/server/src/modules/mail-sync/postgres/types.ts`
- 新建 `apps/server/src/modules/mail-sync/postgres/sync-repository.ts`
- 新建 `apps/server/tests/mail-sync/repository.integration.test.ts`

### 3.1 先写失败测试

覆盖：

- `createActivatingSync` 对同一账号/provider/scope 幂等。
- 激活检查点只能从 `activating` 正确转为 `active`。
- 同一同步流插入重复远端 ID 只保留一条。
- discovery 在一个事务中插入项目并推进检查点。
- 同一时刻只有一个 worker 能获得同步流租约。
- 项目用 `FOR UPDATE SKIP LOCKED` 分配，不会被两个 worker 同时导入。
- 租约过期后可重新领取。
- `markImported`、`scheduleRetry`、`markFailed` 均验证 owner。
- 每次处理结果写入不可覆盖的 attempt 记录。
- 达到最大尝试次数后进入终态 `failed`。

### 3.2 实现仓储接口

接口至少包含：

```ts
interface MailSyncRepository {
  createActivatingSync(input: CreateSyncInput): Promise<InboundSync>;
  activate(input: ActivateSyncInput): Promise<void>;
  acquireSyncLease(input: AcquireSyncLeaseInput): Promise<InboundSync | null>;
  releaseSyncLease(input: ReleaseSyncLeaseInput): Promise<void>;
  persistDiscoveryPage(input: PersistDiscoveryPageInput): Promise<void>;
  claimPendingItems(input: ClaimItemsInput): Promise<InboundSyncItem[]>;
  markImported(input: MarkImportedInput): Promise<void>;
  scheduleRetry(input: ScheduleRetryInput): Promise<void>;
  markFailed(input: MarkFailedInput): Promise<void>;
  recordSignal(input: RecordSignalInput): Promise<void>;
  findDueReconciliations(input: DueQueryInput): Promise<InboundSync[]>;
  findDueRenewals(input: DueQueryInput): Promise<InboundSync[]>;
}
```

状态转换必须由 SQL 条件保护，不能只依靠进程内判断。租约使用数据库时间，避免 worker 时钟漂移。

### 3.3 验证

```powershell
pnpm --dir apps/server exec vitest run tests/mail-sync/repository.integration.test.ts
```

---

## 任务 4：实现 Gmail 入站适配器

**参考机制**

- EmailEngine：Gmail History 分页、Watch 到期续订、404 历史失效分类。
- sync-engine：持久化 checkpoint、账号级串行化、拉取与提交边界。
- Stalwart：以原始 MIME 为入口，本地模型不采用 provider thread。

**文件**

- 新建 `apps/server/src/lib/mail-channel/gmail/errors.ts`
- 新建 `apps/server/src/lib/mail-channel/gmail/gmail-api-client.ts`
- 新建 `apps/server/src/lib/mail-channel/gmail/history-mapper.ts`
- 新建 `apps/server/src/lib/mail-channel/gmail/ingress-adapter.ts`
- 新建 `apps/server/src/lib/mail-channel/gmail/channel.ts`
- 新建对应 `*.test.ts`
- 修改 `apps/server/src/lib/mail-channel/gmail.ts`

### 4.1 先写失败测试

测试：

- `profile.get` 返回的 historyId 建立绑定基线。
- `history.list` 每页都限制 `labelId: INBOX`，并完整处理 `nextPageToken`。
- 仅 `messagesAdded` 且含 `INBOX` 的记录转换为 `message_added`。
- 同一页/跨页重复 ID 去重。
- `labelsAdded`、`labelsRemoved`、`messagesDeleted` 全部忽略。
- 原始 MIME 使用 base64url 解码为 `Uint8Array`，不先转 UTF-8 字符串。
- `watch` 固定 `labelIds: ['INBOX']`、`labelFilterBehavior: 'include'`。
- 404/historyId 过期分类为需要重建基线的永久间隙错误。
- 401/403 分类为认证错误；429、5xx 和网络错误分类为可重试。

### 4.2 实现 API 包装和映射

`gmail-api-client.ts` 只封装：

- `users.getProfile`
- `users.history.list`
- `users.messages.get(format: 'raw')`
- `users.watch`

`history-mapper.ts` 是纯函数，不访问网络和数据库。

Gmail 检查点：

```ts
type GmailCheckpoint = {
  version: 1;
  historyId: string;
};
```

订阅目标：

```ts
type GmailSubscriptionTarget = {
  version: 1;
  topicName: string;
};
```

`channel.ts` 向通用 registry 注册 Gmail 入站工厂；旧 `gmail.ts` 对外导出保持兼容。

### 4.3 验证

```powershell
pnpm --dir apps/server exec vitest run src/lib/mail-channel/gmail
```

---

## 任务 5：建立本地账号并原子激活“仅增量”同步

**文件**

- 新建 `apps/server/src/modules/mail-sync/application/bootstrap-account.ts`
- 新建 `apps/server/src/modules/mail-sync/application/activate.ts`
- 新建 `apps/server/src/modules/mail-sync/application/activate.test.ts`
- 新建 `apps/server/tests/mail-sync/activation.integration.test.ts`
- 修改 `apps/server/src/lib/subscription/google-subscription-factory.ts`
- 新建/修改对应测试

### 5.1 先写失败测试

覆盖：

- 同一连接重复激活只得到一个本地账号和一个同步流。
- 建立本地账号时保证 Inbox 系统邮箱存在。
- 顺序固定为：创建 `activating` 记录 → 获取 Gmail profile 基线 → 持久化基线 → 建立 Watch → 标记 `active`。
- profile 基线必须在 Watch 之前持久化，避免绑定/Watch 间隙漏信。
- Watch 失败时保留可恢复的 `activating` 状态，不回退检查点。
- Gmail OAuth 回调仍只进入现有 `subscribe_queue`。
- `GoogleSubscriptionFactory.subscribe` 是唯一激活所有者，不额外从新队列重复建立 Watch。

### 5.2 实现激活流程

激活输入：

```ts
type ActivateInboundSyncInput = {
  accountId: string;
  connectionId: string;
  provider: string;
  scope: IngressScope;
  subscriptionTarget: VersionedProviderState;
};
```

激活步骤：

1. 幂等创建/读取本地账号与 Inbox。
2. 幂等创建 `activating` 同步流。
3. 若尚无 checkpoint，调用 `establishCheckpoint` 并立即持久化。
4. 由现有 Google subscription factory 完成 Pub/Sub 基础设施准备。
5. 调用适配器 `subscribe`。
6. 持久化 `active` 与订阅到期时间。

不修改前端 OAuth 流程，不新增第二个激活入口。

### 5.3 验证

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync/application/activate.test.ts tests/mail-sync/activation.integration.test.ts
```

---

## 任务 6：实现可恢复的增量发现

**文件**

- 新建 `apps/server/src/modules/mail-sync/application/discover-incremental.ts`
- 新建 `apps/server/src/modules/mail-sync/application/discover-incremental.test.ts`
- 新建 `apps/server/tests/mail-sync/discovery.integration.test.ts`

### 6.1 先写失败测试

覆盖：

- 只有持有同步流租约的 worker 能执行 discovery。
- 从数据库 checkpoint 开始逐页拉取。
- 每页的标准事件与该页 checkpoint 在同一个事务提交。
- 中途崩溃后从最后已提交页继续，不重复、不丢失。
- 重复通知和重复 History 记录不会产生重复项目。
- 空页仍可推进 checkpoint。
- 单个坏项目不阻塞后续 checkpoint。
- historyId 失效时暂停流并记录显式错误，绝不偷偷做历史全量同步。
- 认证错误转为 `auth_error`。
- 可重试错误释放租约，由队列/周期任务重试。

### 6.2 实现发现服务

伪代码：

```ts
const sync = await repository.acquireSyncLease(...);
if (!sync) return;

try {
  let pageToken: string | null = null;
  do {
    const page = await adapter.discover({
      scope: sync.scope,
      checkpoint: sync.checkpoint,
      pageToken,
    });
    await repository.persistDiscoveryPage({
      syncId: sync.id,
      owner,
      events: page.events,
      checkpoint: page.checkpoint,
    });
    pageToken = page.nextPageToken;
  } while (pageToken);
} finally {
  await repository.releaseSyncLease(...);
}
```

分页期间必须维持同一旧 checkpoint 语义；只有已提交页的 checkpoint 能成为下次恢复点。

### 6.3 验证

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync/application/discover-incremental.test.ts tests/mail-sync/discovery.integration.test.ts
```

---

## 任务 7：通过本地邮件内核导入待处理 MIME

**文件**

- 新建 `apps/server/src/modules/mail-sync/application/import-pending.ts`
- 新建 `apps/server/src/modules/mail-sync/application/import-pending.test.ts`
- 新建 `apps/server/tests/mail-sync/import.integration.test.ts`
- 新建 `apps/server/src/modules/mail-sync/runtime/create-mail-sync.ts`
- 复用 `apps/server/src/modules/mail/runtime.ts`
- 复用 `apps/server/src/lib/email-processor.ts`

### 7.1 先写失败测试

覆盖：

- worker 领取项目后按 `remoteMessageId` 获取原始 MIME。
- MIME 字节原样交给 `MailCore.importEmail`。
- 导入目标是该本地账号的 Inbox mailboxId。
- HTML 清理由现有 `preprocessEmailHtml` 注入，不复制另一套 sanitizer。
- 导入成功后记录 `local_email_id` 和成功 attempt。
- worker 在导入成功、写状态前崩溃时，重试不会创建重复本地邮件。
- 幂等键必须由账号、provider、remoteMessageId 构成。
- retryable 错误采用有上限的指数退避。
- 认证错误暂停账号同步。
- 永久错误或超过最大次数后进入 `failed`，不会永久毒化队列。
- 一个项目失败不影响同批其他项目。

### 7.2 实现导入服务

`create-mail-sync.ts` 负责组装：

- `MailSyncRepository`
- provider registry/factory
- 现有 `createMailCoreRuntime`
- 现有 `R2BlobStore` 和 `THREADS_BUCKET`
- 现有 `preprocessEmailHtml`

对象键继续由 `R2BlobStore` 使用 `mail/<account>/...` 命名空间；本阶段不创建新的 bucket。

导入状态顺序：

1. `SKIP LOCKED` 领取项目并创建 attempt。
2. 获取 raw MIME。
3. 调用带幂等来源键的 `MailCore.importEmail`。
4. 在数据库事务内标记 `imported` 并完成 attempt。
5. 错误按适配器分类后重试、暂停或终止。

若现有 `MailCore.importEmail` 尚不能接受稳定的外部幂等键，则先用失败测试扩展邮件内核入口和唯一约束，不能只在同步表中“假装幂等”。

### 7.3 验证

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync/application/import-pending.test.ts tests/mail-sync/import.integration.test.ts
pnpm test:mail-core
```

---

## 任务 8：接入 Push、队列、reconcile 和 Watch 续订

**文件**

- 新建 `apps/server/src/modules/mail-sync/application/receive-signal.ts`
- 新建 `apps/server/src/modules/mail-sync/application/reconcile.ts`
- 新建 `apps/server/src/modules/mail-sync/application/renew-subscription.ts`
- 新建对应单元测试
- 新建 `apps/server/src/modules/mail-sync/runtime/create-gmail-ingress.ts`
- 新建 `apps/server/src/modules/mail-sync/runtime/handle-gmail-push.ts`
- 新建 `apps/server/src/modules/mail-sync/runtime/handle-gmail-push.test.ts`
- 修改 `apps/server/src/main.ts`
- 修改 `apps/server/src/env.ts`
- 修改 `apps/server/wrangler.jsonc` 或当前实际 Wrangler 配置
- 修改 Google subscription factory 相关测试

### 8.1 先写失败测试

覆盖：

- Push payload 仅解析 `emailAddress` 和 `historyId`，不把 payload 当作事实数据。
- 无效 token、错误 provider、无效 base64/JSON 被拒绝。
- 合法 Push 只记录 signal 并投递通用 discovery 命令。
- 重复 Push 可安全重复处理。
- reconcile 能发现长时间无 signal 或到期未检查的 active 流。
- renew 只处理临近过期订阅，不重置 checkpoint。
- 队列命令使用 provider-neutral 联合类型。
- 成功命令显式 `ack`。
- 可重试失败使用带延迟的 `retry`。
- 永久无效命令记录后 `ack`，避免无限毒化队列。

队列命令：

```ts
type MailIngressCommand =
  | { type: 'signal'; provider: string; externalAccount: string; cursorHint?: string }
  | { type: 'discover'; syncId: string }
  | { type: 'import'; syncId: string }
  | { type: 'reconcile'; syncId: string }
  | { type: 'renew'; syncId: string };
```

### 8.2 实现运行时接线

- 保留 `/a8n/notify/:providerId` 路由形状。
- Gmail 路由校验 token 后调用独立、可测试的 `handleGmailPush`。
- Push 只唤醒同步；真实 History 始终由 discovery 读取。
- 新 `MAIL_INGRESS_QUEUE` 只处理 signal/discover/import/reconcile/renew。
- OAuth callback → 现有 `subscribe_queue` → `GoogleSubscriptionFactory.subscribe` 仍是唯一激活链路。
- Scheduled handler 分页查询 due reconcile 和 due renewal，并按小批量投递，避免一次扫描全表。
- discovery 完成后只在存在 pending 项目时投递 import。
- import 若仍有可领取项目则继续自投递，形成有界批处理。

### 8.3 验证

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync/application src/modules/mail-sync/runtime/handle-gmail-push.test.ts
pnpm --dir apps/server exec vitest run src/lib/subscription
```

---

## 任务 9：端到端验收和兼容性收口

**文件**

- 新建 `apps/server/tests/mail-sync/gmail-incremental.e2e.test.ts`
- 修改必要的测试夹具和文档
- 不修改前端数据读取路径

### 9.1 端到端场景

使用伪 Gmail API、真实 PostgreSQL 临时库和测试对象存储，验证：

1. 绑定账号时 profile 返回 `historyId=100`。
2. 数据库先持久化 checkpoint 100，再建立 Inbox Watch。
3. History 101 中的 Inbox 新邮件被持久化为待处理项目。
4. 同页的标签变化、删除和非 Inbox 新增被忽略。
5. import 获取 raw MIME 并进入本地 MailCore。
6. 本地生成邮件、线程、mailbox membership、blob 和 change log。
7. checkpoint 推进到 101。
8. 重放同一 Push/History 不创建重复同步项目或重复本地邮件。
9. 本地已读/星标/移动操作不调用 Gmail API。
10. Push 丢失后 reconcile 仍能发现 102。
11. Gmail 429 会重试；坏 MIME 达到上限后失败但 103 仍可继续。
12. historyId 失效时明确暂停，不进行历史回填。

### 9.2 数据库初始化验证

临时数据库验证唯一基线后，再确认开发库命令参数仍可用：

```powershell
pnpm --dir apps/server exec vitest run tests/mail-sync
```

只有用户明确允许清空当前开发数据库时才执行：

```powershell
pnpm db:push --reset --yes
```

该脚本的含义是：检测现有 Zero Schema；在显式 `--reset --yes` 下清理 `auth/app/integration/mail` 与开发迁移元数据，然后运行 Drizzle push。它不是生产增量迁移命令。

### 9.3 全量回归

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-sync src/lib/mail-channel/gmail tests/mail-sync
pnpm test:mail-core
pnpm --dir apps/server exec tsc --noEmit
pnpm lint
pnpm build
```

验收标准：

- 所有新增测试通过。
- 邮件内核既有测试通过。
- TypeScript 不增加新诊断。
- lint/build 若受既有问题影响，需分别记录“既有基线”和“本次新增”，不能隐瞒。
- Git diff 不包含前端切换、历史全量同步、Gmail 状态反向同步或 `AGENTS.md`。

## 三、完成定义

本阶段只有同时满足以下条件才可宣布完成：

- Gmail 绑定完成后能从基线之后增量发现 Inbox 新邮件。
- 新邮件先可靠落入 PostgreSQL 同步项目，再通过原始 MIME 导入本地邮件内核。
- 通知重复、分页中断、worker 崩溃、队列重试都不会造成重复邮件或检查点倒退。
- 单封异常邮件不会阻断账号后续邮件。
- Push 丢失可由 reconcile 补偿，Watch 可续订且不重置基线。
- 所有本地邮箱操作与 Gmail 解耦，不产生反向调用。
- 通用层不包含 Gmail 分支，后续渠道只需新增适配器并注册。
- 现有前端和旧链路仍可运行。
- 数据库仍是一份可从空库完整初始化的开发基线。
