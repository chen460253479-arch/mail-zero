# 本地邮箱内核规模化改进实施计划

> **供智能执行器使用：** 必须按任务逐项执行。建议使用
> `superpowers:subagent-driven-development`；当前会话按用户要求使用
> `superpowers:executing-plans` 在根工作区直接执行。所有步骤使用复选框跟踪。

**目标：** 消除本地邮箱内核在 Thread 查询、邮件导入和计数维护中的账户级
全量扫描，使正常查询和单封邮件写入的工作量只与请求页或受影响实体相关。

**架构：** 在 `packages/mail-core` 增加数据库无关的线程查询、线程引用和聚合
端口，在 PostgreSQL 适配器中用索引查询实现这些端口。参考 Stalwart 的
主题/Message-ID 索引和派生状态思想，参考 Sync Engine 的关系型建模，但继续
以 PostgreSQL 和现有 Zero 领域对象为事实来源。

**技术栈：** TypeScript、Vitest、Drizzle ORM、PostgreSQL 17、pnpm。

## 全局约束

- 直接在 `D:\WorkSpace\Zero` 当前 `codex/local-mail-core` 分支开发。
- 不创建 Git worktree。
- 不修改或提交用户未跟踪的根目录 `AGENTS.md`。
- 不切换现有前端，不接入 Gmail，不增加反向同步。
- 生产代码之前必须先存在失败测试，并确认因缺少目标行为而失败。
- 每个任务完成定向测试、相关测试、类型检查后再提交。
- 生成迁移只能通过仓库 Drizzle 工具，不手写 snapshot JSON。

---

### 任务 1：线程引用规范化与哈希

**文件：**

- 新建：`packages/mail-core/src/thread/thread-reference.ts`
- 修改：`packages/mail-core/src/thread/index.ts`
- 修改：`packages/mail-core/src/index.ts`
- 测试：`packages/mail-core/tests/thread/thread-reference.test.ts`

**接口：**

- 产出：

```ts
export type ThreadReferenceKey = {
  normalizedSubjectHash: string;
  messageIdHash: string;
};

export function hashThreadKey(value: string): Promise<string>;

export function createThreadReferenceKeys(input: {
  subject: string;
  messageIds: string[];
}): Promise<ThreadReferenceKey[]>;
```

- `normalizedSubjectHash` 基于现有 `normalizeSubject()`。
- `messageIdHash` 基于现有 `normalizeMessageId()`。
- 输出按照 Message-ID 哈希排序并去重。
- 缺失或规范化后为空的 Message-ID 不产生键。

- [ ] **步骤 1：编写失败测试**

测试必须使用手工计算的 SHA-256 字面量验证：

- `Re: Status` 与 `status` 产生相同主题哈希。
- 大小写和尖括号差异的 Message-ID 产生相同哈希。
- 重复引用只返回一项。
- 空引用不返回键。

- [ ] **步骤 2：运行测试并确认红灯**

运行：

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/thread/thread-reference.test.ts
```

预期：失败原因是 `thread-reference` 导出不存在。

- [ ] **步骤 3：实现最小规范化和哈希逻辑**

使用 Web Crypto `crypto.subtle.digest('SHA-256', ...)`，返回 64 位小写十六进制，
不引入 Node 专有 `createHash`，保持 Cloudflare Worker 兼容。

- [ ] **步骤 4：运行定向测试和类型检查**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/thread/thread-reference.test.ts
pnpm --filter=@zero/mail-core typecheck
```

- [ ] **步骤 5：提交**

```powershell
git add packages/mail-core/src/thread packages/mail-core/src/index.ts packages/mail-core/tests/thread/thread-reference.test.ts
git commit -m "feat(mail-core): add indexed thread reference keys"
```

### 任务 2：数据库无关的 Thread 查询端口

**文件：**

- 新建：`packages/mail-core/src/store/thread-query-store.ts`
- 修改：`packages/mail-core/src/store/index.ts`
- 修改：`packages/mail-core/src/store/unit-of-work.ts`
- 修改：`packages/mail-core/src/thread/query-threads.ts`
- 修改：`packages/mail-core/src/testing/memory-mail-store.ts`
- 测试：`packages/mail-core/tests/thread/query-threads.test.ts`
- 测试辅助：`packages/mail-core/tests/helpers/query-harness.ts`

**接口：**

```ts
export type ThreadQueryPosition = {
  latestReceivedAt: Date;
  threadId: ThreadId;
};

export type ThreadQueryProjection = {
  id: ThreadId;
  emailIds: EmailId[];
  mailboxIds: MailboxId[];
  emailCount: number;
  unreadCount: number;
  hasAttachment: boolean;
  participantSummary: string | null;
  preview: string | null;
  latestReceivedAt: Date;
};

export interface ThreadQueryRepository {
  query(input: {
    accountId: MailAccountId;
    mailboxId: MailboxId | null;
    after: ThreadQueryPosition | null;
    limit: number;
  }): Promise<{
    threads: ThreadQueryProjection[];
    hasMore: boolean;
  }>;

  findById(
    accountId: MailAccountId,
    threadId: ThreadId,
  ): Promise<ThreadQueryProjection | null>;
}
```

`MailTransaction` 新增 `threadQueries: ThreadQueryRepository`。查询仍通过
UnitOfWork，以保持账户存在性和事务快照一致。

- [ ] **步骤 1：扩展 Thread 查询测试形成红灯**

在真实 Memory 适配器中记录 `EmailRepository.listByAccount` 与
`ThreadRepository.listByAccount` 调用次数。新增测试断言 `queryThreads` 和
`getThread` 均不调用这两个全量方法。

- [ ] **步骤 2：运行并确认现实现红灯**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/thread/query-threads.test.ts
```

预期：断言显示两个全量列表方法被调用。

- [ ] **步骤 3：实现 Memory ThreadQueryRepository**

Memory 实现可以遍历内存 Map，但必须作为专用投影仓储提供结果；领域命令不得
再组合 EmailRepository 和 ThreadRepository 的全量列表。

- [ ] **步骤 4：改造 queryThreads/getThread 消费查询端口**

保持现有公共输入、输出、排序和游标格式不变。传给仓储的 `limit` 为
`input.limit + 1` 或由仓储明确返回 `hasMore`，只能选择一种并在 Memory 与
PostgreSQL 中一致实现。本计划采用仓储内部读取 `limit + 1` 并返回
`hasMore`，返回数组最多 `limit` 项。

- [ ] **步骤 5：运行测试和类型检查**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/thread/query-threads.test.ts
pnpm --filter=@zero/mail-core typecheck
```

- [ ] **步骤 6：提交**

```powershell
git add packages/mail-core/src/store packages/mail-core/src/thread packages/mail-core/src/testing packages/mail-core/tests/thread packages/mail-core/tests/helpers/query-harness.ts
git commit -m "refactor(mail-core): query threads through projections"
```

### 任务 3：PostgreSQL Thread 查询实现

**文件：**

- 新建：
  `apps/server/src/modules/mail/postgres/repositories/thread-query-repository.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/repositories/index.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/schema/threads.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/schema/index.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/postgres-unit-of-work.ts`
- 测试：
  `apps/server/tests/mail-core/thread-query.integration.test.ts`
- 测试：
  `apps/server/tests/mail-core/schema-definition.test.ts`

**实现约束：**

- Thread 页查询必须由 Thread 表开始。
- Mailbox 过滤使用 `EXISTS` 关联 `email_mailbox` 和可见 Email。
- 分页条件为：

```sql
(latest_received_at < cursor_time)
OR (latest_received_at = cursor_time AND id > cursor_id)
```

- 排序为 `latest_received_at DESC, id ASC`。
- 取得 Thread 页后，用固定批次查询这些 Thread 的可见 Email ID、Mailbox ID。
- 禁止调用 `hydrateEmail()`。

- [ ] **步骤 1：编写 PostgreSQL 红灯集成测试**

覆盖：

- 顺序与 Memory 结果相同。
- Mailbox 过滤正确。
- Keyset 第二页不重复。
- 返回的 Email ID 按 `receivedAt ASC, id ASC`。
- 跨账户数据不可见。

- [ ] **步骤 2：运行并确认缺少仓储实现**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/thread-query.integration.test.ts
```

- [ ] **步骤 3：添加 Thread 排序索引声明**

索引名称：

```text
thread_account_latest_received_id_idx
```

列：

```text
mail_account_id, latest_received_at DESC, id
```

- [ ] **步骤 4：实现 PostgreSQL 查询仓储并接入 UnitOfWork**

批量查询结果必须在 TypeScript 中只对本页结果组装，不得对账户全部 Thread
排序。

- [ ] **步骤 5：生成迁移**

```powershell
pnpm db:generate
```

确认只产生本任务预期的 Thread 索引迁移和对应 snapshot/journal 更新。

- [ ] **步骤 6：运行集成测试、Schema 测试和类型检查**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/thread-query.integration.test.ts tests/mail-core/schema-definition.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

- [ ] **步骤 7：提交**

```powershell
git add apps/server/src/modules/mail/postgres apps/server/src/db/migrations apps/server/tests/mail-core/thread-query.integration.test.ts apps/server/tests/mail-core/schema-definition.test.ts
git commit -m "feat(mail-core): add bounded postgres thread queries"
```

### 任务 4：Thread Reference 表与仓储

**文件：**

- 新建：
  `apps/server/src/modules/mail/postgres/schema/thread-references.ts`
- 新建：
  `apps/server/src/modules/mail/postgres/repositories/thread-reference-repository.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/schema/index.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/repositories/index.ts`
- 修改：
  `packages/mail-core/src/store/repositories.ts`
- 修改：
  `packages/mail-core/src/store/unit-of-work.ts`
- 修改：
  `packages/mail-core/src/testing/memory-mail-store.ts`
- 测试：
  `packages/mail-core/tests/store/thread-reference-repository.test.ts`
- 测试：
  `apps/server/tests/mail-core/thread-reference.integration.test.ts`

**接口：**

```ts
export type ThreadReferenceRecord = {
  accountId: MailAccountId;
  normalizedSubjectHash: string;
  messageIdHash: string;
  emailId: EmailId;
  threadId: ThreadId;
  createdAt: Date;
};

export interface ThreadReferenceRepository {
  findCandidates(input: {
    accountId: MailAccountId;
    normalizedSubjectHash: string;
    messageIdHashes: string[];
  }): Promise<ThreadReferenceRecord[]>;
  insert(record: ThreadReferenceRecord): Promise<void>;
  moveThread(
    accountId: MailAccountId,
    fromThreadId: ThreadId,
    toThreadId: ThreadId,
  ): Promise<void>;
  deleteByEmail(accountId: MailAccountId, emailId: EmailId): Promise<void>;
}
```

- [ ] **步骤 1：编写 Memory 仓储契约红灯测试**

验证账户隔离、主题隔离、批量 Message-ID 匹配、去重、线程迁移和按 Email 删除。

- [ ] **步骤 2：运行并确认接口不存在**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/store/thread-reference-repository.test.ts
```

- [ ] **步骤 3：实现端口与 Memory 仓储**

Memory State 增加 `threadReferences` Map，并纳入事务 structuredClone。

- [ ] **步骤 4：编写 PostgreSQL 集成红灯测试**

同一套可观察行为在真实 PostgreSQL 中验证，并额外验证外键和唯一约束。

- [ ] **步骤 5：实现 Schema 和 PostgreSQL 仓储**

表、主键、外键、索引必须与设计规格一致。

- [ ] **步骤 6：生成迁移并验证**

```powershell
pnpm db:generate
pnpm --dir apps/server exec vitest run tests/mail-core/thread-reference.integration.test.ts
```

- [ ] **步骤 7：运行相关测试和类型检查**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/store/thread-reference-repository.test.ts
pnpm --filter=@zero/mail-core typecheck
pnpm --dir apps/server exec tsc --noEmit
```

- [ ] **步骤 8：提交**

```powershell
git add packages/mail-core/src/store packages/mail-core/src/testing packages/mail-core/tests/store apps/server/src/modules/mail/postgres apps/server/src/db/migrations apps/server/tests/mail-core/thread-reference.integration.test.ts
git commit -m "feat(mail-core): persist indexed thread references"
```

### 任务 5：邮件导入切换到索引线程匹配

**文件：**

- 修改：`packages/mail-core/src/message/import-email.ts`
- 修改：`packages/mail-core/src/thread/calculate-thread.ts`
- 修改：`packages/mail-core/src/thread/thread-reference.ts`
- 修改：`packages/mail-core/src/testing/memory-mail-store.ts`
- 测试：`packages/mail-core/tests/message/import-email.test.ts`
- 测试：`apps/server/tests/mail-core/import-email.integration.test.ts`

**行为：**

- `decideThread` 不再调用 `emails.listByAccount()` 或
  `threads.listByAccount()`。
- 候选通过 `threadReferences.findCandidates()` 获得。
- 线程合并调用：

```ts
emails.moveThread(accountId, fromThreadId, toThreadId)
threadReferences.moveThread(accountId, fromThreadId, toThreadId)
```

- Email 创建后插入自身 Message-ID 索引。
- 无 Message-ID 的邮件正常导入。

- [ ] **步骤 1：编写红灯测试**

新增可观察调用计数，断言导入引用邮件和合并线程时不调用账户级 Email/Thread
列表；同时验证 create/use/merge 结果保持不变。

- [ ] **步骤 2：运行并确认当前实现红灯**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/message/import-email.test.ts
```

- [ ] **步骤 3：为 EmailRepository 增加有界线程操作**

```ts
moveThread(
  accountId: MailAccountId,
  fromThreadId: ThreadId,
  toThreadId: ThreadId,
): Promise<EmailId[]>;

hasRetainedEmailInThread(
  accountId: MailAccountId,
  threadId: ThreadId,
): Promise<boolean>;
```

PostgreSQL 实现必须使用单条有界 `UPDATE ... RETURNING` 和 `EXISTS` 查询。

- [ ] **步骤 4：改造线程决策和引用写入**

Blob 配额扫描暂不在本任务处理；本任务验收只要求线程路径不依赖账户级扫描。

- [ ] **步骤 5：运行单元、集成和类型检查**

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/message/import-email.test.ts tests/thread/calculate-thread.test.ts
pnpm --dir apps/server exec vitest run tests/mail-core/import-email.integration.test.ts tests/mail-core/thread-reference.integration.test.ts
pnpm --filter=@zero/mail-core typecheck
pnpm --dir apps/server exec tsc --noEmit
```

- [ ] **步骤 6：提交**

```powershell
git add packages/mail-core/src/message packages/mail-core/src/thread packages/mail-core/src/store packages/mail-core/src/testing packages/mail-core/tests/message apps/server/src/modules/mail/postgres apps/server/tests/mail-core
git commit -m "refactor(mail-core): match imported threads by index"
```

### 任务 6：增量 Thread 与 Mailbox 聚合

**文件：**

- 新建：`packages/mail-core/src/mailbox/email-aggregate-delta.ts`
- 新建：
  `apps/server/src/modules/mail/postgres/schema/mailbox-threads.ts`
- 新建：
  `apps/server/src/modules/mail/postgres/repositories/mail-aggregate-repository.ts`
- 修改：`packages/mail-core/src/store/repositories.ts`
- 修改：`packages/mail-core/src/store/unit-of-work.ts`
- 修改：`packages/mail-core/src/testing/memory-mail-store.ts`
- 修改：`packages/mail-core/src/message/import-email.ts`
- 修改：`packages/mail-core/src/message/update-email.ts`
- 修改：`packages/mail-core/src/message/create-draft.ts`
- 修改：`packages/mail-core/src/message/update-draft.ts`
- 修改：`packages/mail-core/src/message/destroy-draft.ts`
- 修改：`packages/mail-core/src/message/destroy-email.ts`
- 测试：
  `packages/mail-core/tests/mailbox/email-aggregate-delta.test.ts`
- 测试：
  `apps/server/tests/mail-core/incremental-aggregates.integration.test.ts`

**接口：**

```ts
export type EmailAggregateProjection = {
  emailId: EmailId;
  threadId: ThreadId;
  mailboxIds: MailboxId[];
  visible: boolean;
  unread: boolean;
  hasAttachment: boolean;
  receivedAt: Date;
};

export interface MailAggregateRepository {
  applyEmailDelta(input: {
    accountId: MailAccountId;
    before: EmailAggregateProjection | null;
    after: EmailAggregateProjection | null;
    now: Date;
  }): Promise<{
    threadChanges: { threadId: ThreadId; changedProperties: string[] }[];
    mailboxChanges: { mailboxId: MailboxId; changedProperties: string[] }[];
  }>;
}
```

`mail0_mailbox_thread` 与约束按设计规格创建。

- [ ] **步骤 1：编写纯 Delta 红灯测试**

用手工字面量覆盖创建、跨 Mailbox 移动、已读切换、Thread 变更、隐藏和恢复。

- [ ] **步骤 2：实现纯 Delta 计算**

纯函数只产出受影响的 Mailbox/Thread 键和 Email/Unread 增量，不访问仓储。

- [ ] **步骤 3：编写 PostgreSQL 聚合红灯集成测试**

验证多个 Email 共用一个 Thread 时 `totalThreads/unreadThreads` 的 0/正数边界。

- [ ] **步骤 4：实现 Mailbox-Thread Schema 与原子 SQL 更新**

所有计数必须由数据库约束防止负数。若更新产生不可能状态，映射为
`STORAGE_FAILURE`。

- [ ] **步骤 5：生成迁移**

```powershell
pnpm db:generate
```

- [ ] **步骤 6：逐条切换 Email 写路径**

每切换一个命令，先运行对应测试文件，确认行为和 Changes 记录不变：

```powershell
pnpm --filter=@zero/mail-core exec vitest run tests/message/import-email.test.ts
pnpm --filter=@zero/mail-core exec vitest run tests/message/update-email.test.ts
pnpm --filter=@zero/mail-core exec vitest run tests/message/draft.test.ts
pnpm --filter=@zero/mail-core exec vitest run tests/message/destroy-email.test.ts
```

- [ ] **步骤 7：加入禁止全量计数回归测试**

用调用计数证明上述命令不再为了聚合调用 `emails.listByAccount()` 或
`mailboxes.listByAccount()`。

- [ ] **步骤 8：运行完整 MailCore 测试和类型检查**

```powershell
pnpm test:mail-core
pnpm --filter=@zero/mail-core typecheck
pnpm --dir apps/server exec tsc --noEmit
```

- [ ] **步骤 9：提交**

```powershell
git add packages/mail-core apps/server/src/modules/mail/postgres apps/server/src/db/migrations apps/server/tests/mail-core/incremental-aggregates.integration.test.ts
git commit -m "refactor(mail-core): maintain aggregates incrementally"
```

### 任务 7：规范化查询字段与配套索引

**文件：**

- 修改：`apps/server/src/modules/mail/postgres/schema/emails.ts`
- 修改：
  `apps/server/src/modules/mail/postgres/repositories/email-repository.ts`
- 修改：
  `apps/server/src/modules/mail/search/postgres-search-store.ts`
- 测试：`apps/server/tests/mail-core/search.integration.test.ts`
- 测试：`apps/server/tests/mail-core/schema-definition.test.ts`

**字段：**

```text
mail0_email.normalized_subject text not null
mail0_email_address.normalized_email text not null
```

**索引：**

```text
email_account_sent_id_idx
email_account_size_id_idx
email_account_normalized_subject_id_idx
email_address_account_normalized_kind_email_idx
```

- [ ] **步骤 1：扩展搜索集成测试形成红灯**

覆盖大小写、Unicode NFC、前后空格地址匹配和主题排序。

- [ ] **步骤 2：添加 Schema 字段并在仓储写入规范化值**

复用 MailCore 的规范化规则；若为避免 server 反向依赖内部实现，应将公开纯函数
从 `@zero/mail-core` 导出。

- [ ] **步骤 3：修改查询使用物理规范化列**

删除常规查询中的 `lower(normalize(btrim(...)))` 表达式。

- [ ] **步骤 4：生成迁移并检查回填**

迁移必须为现有行填充规范化值后再设为非空，不允许直接添加无默认值的非空列。

```powershell
pnpm db:generate
```

- [ ] **步骤 5：运行搜索、Schema、迁移和类型测试**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/search.integration.test.ts tests/mail-core/schema-definition.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

- [ ] **步骤 6：提交**

```powershell
git add apps/server/src/modules/mail apps/server/src/db/migrations apps/server/tests/mail-core packages/mail-core/src
git commit -m "perf(mail-core): index normalized email queries"
```

### 任务 8：聚合校验、回填与规模回归

**文件：**

- 新建：`packages/mail-core/src/mailbox/reconcile-mail-aggregates.ts`
- 修改：`packages/mail-core/src/mail-core-maintenance.ts`
- 新建：
  `apps/server/src/modules/mail/postgres/repositories/mail-maintenance-repository.ts`
- 新建：
  `apps/server/tests/mail-core/mail-aggregate-maintenance.integration.test.ts`
- 新建：
  `apps/server/tests/mail-core/mail-core-scale.integration.test.ts`
- 修改：
  `docs/superpowers/specs/2026-07-25-local-mail-core-design.md`
- 修改：
  `docs/superpowers/plans/2026-07-25-local-mail-core-omission-audit-report.md`

**接口：**

```ts
export type ReconcileMailAggregatesInput = {
  accountId: MailAccountId;
  repair: boolean;
};

export type AggregateMismatch = {
  entityType: 'thread' | 'mailbox' | 'mailbox_thread';
  entityId: string;
  expected: Record<string, number | boolean | string | null>;
  actual: Record<string, number | boolean | string | null> | null;
};
```

- [ ] **步骤 1：编写维护红灯测试**

人为制造计数漂移：

- `repair: false` 只报告，不写入。
- `repair: true` 修复 Thread、Mailbox、Mailbox-Thread。
- 重复修复返回零差异。

- [ ] **步骤 2：实现 SQL 事实聚合和修复**

正常命令不得调用该能力。修复在账户锁内执行，SQL 查询按单账户进行。

- [ ] **步骤 3：添加确定性规模数据测试**

在 PostgreSQL 中批量生成至少 100,000 Email、20,000 Thread、30 Mailbox 的
数据集。该测试标记为显式规模测试，通过环境变量
`MAIL_CORE_SCALE_TEST=1` 启用，避免普通单元测试每次承担完整数据成本。

规模测试必须断言：

- Thread 页只返回请求页。
- 查询仓储不调用 Email 水合。
- 单封 Email Delta 只改变受影响的聚合行。
- `EXPLAIN` 使用账户前缀 Thread 索引，不出现账户级显式 Sort。

- [ ] **步骤 4：运行维护测试和显式规模测试**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/mail-aggregate-maintenance.integration.test.ts
$env:MAIL_CORE_SCALE_TEST='1'
pnpm --dir apps/server exec vitest run tests/mail-core/mail-core-scale.integration.test.ts
Remove-Item Env:MAIL_CORE_SCALE_TEST
```

- [ ] **步骤 5：运行全量验证**

```powershell
pnpm test:mail-core
pnpm --filter=@zero/mail-core typecheck
pnpm --dir apps/server exec tsc --noEmit
pnpm exec prettier --check packages/mail-core apps/server/src/modules/mail apps/server/tests/mail-core docs/superpowers/specs/2026-07-26-local-mail-core-scalability-design.md docs/superpowers/plans/2026-07-26-local-mail-core-scalability.md
git diff --check
```

- [ ] **步骤 6：逐项复核设计规格**

确认六项交付物全部具有对应代码、迁移和测试；搜索生产命令中用于 Thread 查询
或计数维护的 `emails.listByAccount()`，对剩余调用逐个分类。Blob 配额和 Blob
GC 的全量扫描属于后续 Blob/Quota 项目，不在本项目误删。

- [ ] **步骤 7：更新设计和疏漏审计文档**

记录：

- 参照了 Stalwart/Sync Engine 的哪些机制。
- Zero 如何转换为 PostgreSQL/TypeScript。
- 完整验证命令和结果。
- 明确延后的 Submission、Blob、Changes、Sync、Gmail 项目。

- [ ] **步骤 8：提交**

```powershell
git add packages/mail-core apps/server/src/modules/mail apps/server/tests/mail-core docs/superpowers
git commit -m "feat(mail-core): complete scalability hardening"
```

## 完成门槛

只有同时满足以下条件，才允许声明本子项目完成：

- 八个任务的定向测试均经历红灯和绿灯。
- `pnpm test:mail-core` 零失败。
- MailCore 与 Server TypeScript 检查零错误。
- 迁移可在隔离 Schema 中从头应用。
- 显式 100,000 Email 规模测试通过。
- Thread 查询不再水合账户全部 Email。
- 线程匹配不再扫描账户全部 Email/Thread。
- 正常 Email 写入不再为了计数扫描账户全部 Email/Mailbox。
- 聚合校验能够报告并修复漂移。
- 用户未跟踪文件保持未修改、未提交。

完成后进入下一个独立子项目：
“数据约束、Changes 保留策略和 Blob 外部 I/O 事务边界”。
