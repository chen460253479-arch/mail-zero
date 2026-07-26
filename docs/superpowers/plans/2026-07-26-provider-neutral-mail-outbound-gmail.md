# Zero 通用邮件出站与 Gmail 实施计划

> **执行要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项实施本计划；所有步骤使用复选框（`- [ ]`）追踪。

**目标：** 在不切换现有前端的前提下，实现由 PostgreSQL 持久化的 `EmailSubmission -> Delivery Spool -> MailChannel outbound -> Gmail API -> 本地 Draft 转 Sent` 完整链路。

**架构：** `@zero/mail-core` 负责服务商无关的 Submission 语义和本地 Email 终态变更；`apps/server/src/modules/mail-outbound` 负责持久化 Spool、租约、重试、投递尝试、路由和不确定结果恢复；`apps/server/src/mail-channel/gmail/outbound` 只负责 Gmail 请求、响应与错误映射。PostgreSQL 是唯一权威工作队列，Cloudflare Queue 仅负责唤醒。

**技术栈：** TypeScript、Vitest、PostgreSQL、Drizzle ORM、`@googleapis/gmail`、Cloudflare Workers Queue、基于 R2 的 BlobStore。

## 全局约束

- Work directly on `codex/local-mail-core` in `D:\WorkSpace\Zero`; do not create a Git worktree.
- Preserve unrelated user changes and do not remove the legacy frontend mail path in this phase.
- Gmail is the only concrete outbound provider in this phase; no Gmail branches are allowed in `mail-outbound`.
- Gmail send success means Provider acceptance; only then may the local Draft become Sent.
- Never hold a PostgreSQL transaction open during a Gmail network request.
- PostgreSQL is the only authoritative Delivery Spool; Cloudflare Queue messages are non-authoritative wake-ups.
- Every retry reuses the exact frozen raw MIME and stable RFC Message-ID.
- Gmail labels, folders, drafts, read state, and other Gmail mailbox operations are outside this phase.
- Use `mail` and `integration` PostgreSQL Schemas; do not add Gmail-prefixed tables or a Provider-specific Schema.
- Follow TDD for every production behavior: write one failing test, run it and observe the expected failure, add the minimum implementation, rerun, then refactor.
- Make focused commits after every task passes its targeted tests.

---

### 任务 1：增加事务作用域内的 Mail Core Submission 发送终态处理

**Files:**

- Create: `packages/mail-core/src/submission/finalize-submission-sent.ts`
- Create: `packages/mail-core/tests/submission/finalize-submission-sent.test.ts`
- Modify: `packages/mail-core/src/submission/create-submission.ts`
- Modify: `packages/mail-core/src/submission/types.ts`
- Modify: `packages/mail-core/src/submission/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Modify: `packages/mail-core/src/store/repositories.ts`
- Modify: `packages/mail-core/src/testing/memory-mail-store.ts`
- Modify: `packages/mail-core/tests/helpers/submission-harness.ts`

**Interfaces:**

- Consumes: existing `MailTransaction`, `MailCoreDependencies`, `applyEmailAggregateDelta()`, `recordChanges()`, `EmailRepository.linkRemote()`, system Mailbox roles, and frozen Submission Blob references.
- Produces:

```ts
export type FinalizeSubmissionSentInput = {
  accountId: MailAccountId;
  submissionId: EmailSubmissionId;
  provider: string;
  remoteMessageId: string;
  remoteThreadId: string | null;
  acceptedAt: Date;
};

export async function createSubmissionInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: CreateSubmissionInput,
): Promise<SubmissionRecord>;

export async function finalizeSubmissionSentInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: FinalizeSubmissionSentInput,
): Promise<{ submission: SubmissionRecord; email: EmailRecord; stateVersion: bigint }>;
```

- `createSubmission()` remains a public wrapper around `unitOfWork.run()`.
- `MailCore.finalizeSubmissionSent()` remains a public wrapper for tests and future non-composite callers; the server composite transaction uses `finalizeSubmissionSentInTransaction()`.

- [ ] **Step 1: Write the failing local-finalization tests**

Add tests proving that successful finalization:

```ts
const result = await finalizeSubmissionSent(h.deps, {
  accountId: h.accountId,
  submissionId: submission.id,
  provider: 'gmail',
  remoteMessageId: 'gmail-message-1',
  remoteThreadId: 'gmail-thread-1',
  acceptedAt,
});

expect(result.email).toMatchObject({
  id: h.draftId,
  lifecycle: 'sent',
  sentAt: acceptedAt,
  mailboxIds: [h.sentMailboxId],
  keywords: ['$seen'],
});
expect(await h.inspect.remoteEmail('gmail', 'gmail-message-1')).toMatchObject({
  emailId: h.draftId,
  remoteThreadId: 'gmail-thread-1',
});
```

Also prove:

- Drafts, Outbox, and Scheduled system memberships are removed;
- ordinary user label memberships are preserved;
- `$draft` is removed and `$seen` is present;
- mailbox/thread aggregates and Change Log update in the same state version;
- a mismatched Draft revision is rejected;
- finalization is idempotent for the same Provider result;
- a conflicting remote message ID is rejected;
- injected repository failure rolls back Email, Submission, remote mapping, aggregates, and changes.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
pnpm --filter @zero/mail-core exec vitest run tests/submission/finalize-submission-sent.test.ts
```

Expected: FAIL because `finalizeSubmissionSent` and the transaction-scoped operation do not exist.

- [ ] **Step 3: Extract transaction-scoped Submission creation**

Move the body currently inside `dependencies.unitOfWork.run()` into
`createSubmissionInTransaction(dependencies, tx, input)`. Keep account locking, recipient validation,
frozen Blob verification, idempotency, and Change creation unchanged.

Implement the wrapper as:

```ts
export const createSubmission = (
  dependencies: MailCoreDependencies,
  input: CreateSubmissionInput,
) =>
  dependencies.unitOfWork.run((tx) =>
    createSubmissionInTransaction(dependencies, tx, input),
  );
```

- [ ] **Step 4: Implement transaction-scoped Sent finalization**

Within the existing `MailTransaction`:

```ts
await tx.lockAccount(input.accountId);
const before = await tx.emails.findById(input.accountId, submission.emailId);
const sent = await tx.mailboxes.findByRole(input.accountId, 'sent');
const transientRoles = new Set(['drafts', 'outbox', 'scheduled']);
```

Validate Submission ownership, status, Draft lifecycle, frozen revision, and stable Message-ID. Build
the next mailbox and keyword sets deterministically, update the same Email row, insert the
`RemoteEmailRecord`, apply aggregate deltas, update Submission to `sent`, and record all changes
through one `recordChanges()` call.

Idempotent replay is allowed only when Submission, Email, Provider, remote ID, and remote thread ID
already agree.

- [ ] **Step 5: Run targeted and full Mail Core tests**

Run:

```powershell
pnpm --filter @zero/mail-core exec vitest run tests/submission/finalize-submission-sent.test.ts tests/submission/submission.test.ts tests/message/draft.test.ts
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail-core typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- packages/mail-core/src packages/mail-core/tests
git commit -m "feat(mail-core): finalize sent submissions atomically"
```

---

### 任务 2：建立服务商无关的出站领域模型与插件契约

**Files:**

- Create: `apps/server/src/modules/mail-outbound/domain/delivery.ts`
- Create: `apps/server/src/modules/mail-outbound/domain/errors.ts`
- Create: `apps/server/src/modules/mail-outbound/domain/retry-policy.ts`
- Create: `apps/server/src/modules/mail-outbound/domain/state-machine.ts`
- Create: `apps/server/src/modules/mail-outbound/domain/ports.ts`
- Create: `apps/server/src/modules/mail-outbound/domain/state-machine.test.ts`
- Create: `apps/server/src/modules/mail-outbound/domain/retry-policy.test.ts`
- Create: `apps/server/src/mail-channel/contracts/outbound.ts`
- Modify: `apps/server/src/mail-channel/contracts/channel.ts`
- Modify: `apps/server/src/mail-channel/contracts/index.ts`
- Modify: `apps/server/src/mail-channel/registry/registry.ts`
- Modify: `apps/server/src/mail-channel/registry/registry.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/plugin.ts`
- Modify: `apps/server/src/mail-channel/gmail/plugin.test.ts`

**Interfaces:**

- Consumes: existing `ResolvedCredential`, `MailChannelPlugin`, `MailChannelRegistry`, and channel capability metadata.
- Produces:

```ts
export type OutboundDeliveryStatus =
  | 'scheduled'
  | 'ready'
  | 'leased'
  | 'retry_wait'
  | 'uncertain'
  | 'completed'
  | 'failed'
  | 'canceled';

export type OutboundAttemptKind = 'send' | 'reconcile';
export type OutboundAttemptOutcome =
  | 'sent'
  | 'transient_failure'
  | 'permanent_failure'
  | 'uncertain'
  | 'not_found';

export type OutboundAcceptedResult = {
  remoteMessageId: string;
  remoteThreadId: string | null;
  acceptedAt: Date;
  providerCode: string | null;
  safeResponse: 'accepted';
};

export type OutboundReconciliationResult =
  | { status: 'found'; result: OutboundAcceptedResult }
  | { status: 'not_found' }
  | { status: 'inconclusive'; retryAfter: Date | null };

export interface OutboundMailAdapter {
  readonly provider: string;
  send(input: FrozenOutboundMessage): Promise<OutboundAcceptedResult>;
  classifyError(error: unknown): OutboundErrorClassification;
  reconcile?(input: OutboundReconciliationQuery): Promise<OutboundReconciliationResult>;
}
```

`MailChannelPlugin` gains:

```ts
readonly outbound?: {
  createAdapter(input: {
    connectionId: string;
    credential: ResolvedCredential;
  }): Promise<OutboundMailAdapter>;
};
```

`MailChannelRegistry` gains `getOutbound(channelId)`.

- [ ] **Step 1: Write failing state-machine, retry, and Registry tests**

Tests must prove:

- only the approved Delivery transitions are accepted;
- completed, failed, and canceled are terminal;
- an expired leased item becomes uncertain, never directly ready;
- Retry-After is bounded and exponential retry includes deterministic injected jitter;
- Gmail advertises `send_messages` and exposes one outbound capability;
- Registry rejects `getOutbound()` for a plugin without outbound support;
- no outbound interface contains Gmail-specific fields.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/domain src/mail-channel/registry/registry.test.ts src/mail-channel/gmail/plugin.test.ts
```

Expected: FAIL because the outbound domain, contract, and Registry method are absent.

- [ ] **Step 3: Implement the domain types and pure policies**

Implement transitions as a total function:

```ts
export const transitionDelivery = (
  delivery: OutboundDeliveryRecord,
  to: OutboundDeliveryStatus,
  now: Date,
): OutboundDeliveryRecord => {
  if (!allowedDeliveryTransitions[delivery.status].includes(to)) {
    throw new MailOutboundError('INVALID_DELIVERY_TRANSITION', 'permanent');
  }
  return { ...delivery, status: to, updatedAt: new Date(now) };
};
```

Implement retry delays from an explicit sequence:

```ts
export const SEND_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000] as const;
export const RECONCILIATION_DELAYS_MS = [30_000, 120_000, 600_000] as const;
```

Apply at most ±20% injected jitter and validate Provider Retry-After before use.

- [ ] **Step 4: Implement outbound contracts and Registry integration**

Add `getOutbound()` with the same failure behavior as `getInbound()`, using capability name
`'outbound'`. Update Gmail plugin metadata to advertise `send_messages`; the concrete Gmail adapter
factory is added in Task 5.

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/domain src/mail-channel/registry/registry.test.ts src/mail-channel/gmail/plugin.test.ts
```

Expected: all selected files pass.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- apps/server/src/modules/mail-outbound/domain apps/server/src/mail-channel
git commit -m "feat(mail-outbound): define delivery and plugin contracts"
```

---

### 任务 3：增加 PostgreSQL Delivery Spool 并迁移投递尝试的职责归属

**Files:**

- Create: `apps/server/src/modules/mail-outbound/postgres/schema.ts`
- Create: `apps/server/src/modules/mail-outbound/postgres/types.ts`
- Create: `apps/server/tests/mail-core/outbound-schema.integration.test.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/submissions.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/index.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `packages/mail-core/src/store/repositories.ts`
- Modify: `packages/mail-core/src/submission/types.ts`
- Modify: `packages/mail-core/src/submission/create-submission.ts`
- Modify: `packages/mail-core/src/submission/transition-submission.ts`
- Modify: `packages/mail-core/src/submission/retry-policy.ts`
- Modify: `packages/mail-core/src/testing/memory-mail-store.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/submission-repository.ts`
- Modify: `apps/server/tests/mail-core/schema-definition.test.ts`
- Modify: `apps/server/tests/mail-core/schema-structure-parity.test.ts`
- Modify: `apps/server/tests/mail-core/schema-topology.test.ts`
- Modify: `apps/server/tests/mail-core/constraints.integration.test.ts`
- Modify: `apps/server/tests/mail-core/submissions.integration.test.ts`
- Modify: `apps/server/tests/mail-core/__snapshots__/schema-structure-parity.test.ts.snap`
- Modify: `packages/mail-core/tests/submission/submission.test.ts`
- Modify: `packages/mail-core/tests/helpers/submission-harness.ts`

**Interfaces:**

- Consumes: `mail.submission`, `mail.account`, `integration.connection`, existing cross-account composite constraints, and development-template `db:push`.
- Produces:

```text
integration.outbound_delivery
integration.send_attempt
```

`mail.submission` no longer owns `attempt_count` or `next_attempt_at`. `integration.send_attempt`
no longer belongs to the Mail Core `SubmissionRepository`.

- [ ] **Step 1: Write failing Schema and integrity tests**

Assert exact columns, statuses, checks, foreign keys, and indexes for:

```text
outbound_delivery:
  id, mail_account_id, submission_id, connection_id, status, available_at,
  lease_owner, lease_token, lease_expires_at, attempt_count,
  reconciliation_count, uncertain_since, last_error_kind,
  last_error_code, last_error_message, created_at, updated_at, completed_at

send_attempt:
  id, mail_account_id, delivery_id, submission_id, attempt_number, kind,
  lease_token, started_at, finished_at, outcome, provider_code,
  safe_response, retry_at, remote_message_id, remote_thread_id
```

Test invalid cross-account references, invalid lease triples, negative counters, duplicate
Submission delivery, duplicate attempt numbers, and more than one open send attempt.

- [ ] **Step 2: Run Schema tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/mail-core/outbound-schema.integration.test.ts tests/mail-core/schema-definition.test.ts tests/mail-core/schema-topology.test.ts
```

Expected: FAIL because the outbound tables are absent.

- [ ] **Step 3: Define `integration.outbound_delivery`**

Use Drizzle checks so lease state is structurally valid:

```ts
check(
  'outbound_delivery_lease_lifecycle_chk',
  sql`(
    ${t.status} = 'leased'
    AND ${t.leaseOwner} IS NOT NULL
    AND ${t.leaseToken} IS NOT NULL
    AND ${t.leaseExpiresAt} IS NOT NULL
  ) OR (
    ${t.status} <> 'leased'
    AND ${t.leaseOwner} IS NULL
    AND ${t.leaseToken} IS NULL
    AND ${t.leaseExpiresAt} IS NULL
  )`,
);
```

Add a unique Submission association and partial indexes for due work and expired leases.

- [ ] **Step 4: Move `integration.send_attempt` into mail-outbound**

Move its Drizzle declaration from `modules/mail/postgres/schema/submissions.ts` to the new outbound
Schema. Add Delivery and Submission composite foreign keys and the partial unique index:

```ts
uniqueIndex('send_attempt_open_delivery_uidx')
  .on(t.mailAccountId, t.deliveryId)
  .where(sql`${t.finishedAt} IS NULL`);
```

- [ ] **Step 5: Remove delivery scheduling state from Mail Core**

Remove `attemptCount`, `nextAttemptAt`, `SubmissionAttemptRecord`, and attempt repository methods
from `@zero/mail-core`. Keep Submission status as a user-visible projection updated by outbound
application services. Move retry tests and behavior to `mail-outbound`.

- [ ] **Step 6: Refresh parity snapshots and run tests**

Run:

```powershell
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail-core typecheck
pnpm --filter @zero/server exec vitest run tests/mail-core/outbound-schema.integration.test.ts tests/mail-core/schema-definition.test.ts tests/mail-core/schema-structure-parity.test.ts tests/mail-core/schema-topology.test.ts tests/mail-core/constraints.integration.test.ts tests/mail-core/submissions.integration.test.ts
```

Expected: all commands exit 0; PostgreSQL tests may report their established environment skip only
when the repository test database URL is unavailable.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- packages/mail-core apps/server/src/modules/mail apps/server/src/modules/mail-outbound/postgres apps/server/src/db/schema.ts apps/server/tests/mail-core
git commit -m "feat(mail-outbound): add postgres delivery spool"
```

---

### 任务 4：实现 Spool 仓储、租约、投递尝试与复合事务

**Files:**

- Create: `apps/server/src/modules/mail-outbound/postgres/repository.ts`
- Create: `apps/server/src/modules/mail-outbound/postgres/unit-of-work.ts`
- Create: `apps/server/tests/mail-core/outbound-repository.integration.test.ts`
- Modify: `apps/server/src/modules/mail/postgres/postgres-unit-of-work.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/index.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/database.ts`

**Interfaces:**

- Consumes: Task 3 Schema, `MailTransaction`, `createPostgresRepositories()`, and a Drizzle
transaction.
- Produces:

```ts
export interface MailOutboundRepository {
  insert(input: InsertOutboundDelivery): Promise<OutboundDeliveryRecord>;
  findById(deliveryId: string): Promise<OutboundDeliveryRecord | null>;
  findBySubmission(accountId: string, submissionId: string): Promise<OutboundDeliveryRecord | null>;
  listDue(input: { now: Date; limit: number }): Promise<string[]>;
  claimById(input: ClaimDeliveryInput): Promise<ClaimedDelivery | null>;
  recoverExpiredLeases(input: { now: Date; limit: number }): Promise<string[]>;
  loadMessage(input: LeaseIdentity): Promise<OutboundMessageSnapshot>;
  finishAttempt(input: FinishAttemptInput): Promise<void>;
  scheduleRetry(input: ScheduleDeliveryRetryInput): Promise<void>;
  markUncertain(input: MarkDeliveryUncertainInput): Promise<void>;
  scheduleReconciliation(input: ScheduleReconciliationInput): Promise<void>;
  markFailed(input: FailDeliveryInput): Promise<void>;
  markCanceled(input: CancelDeliveryInput): Promise<void>;
  markCompleted(input: CompleteDeliveryInput): Promise<void>;
}

export interface MailOutboundTransaction {
  mail: MailTransaction;
  outbound: MailOutboundRepository;
}

export interface MailOutboundUnitOfWork {
  run<T>(operation: (tx: MailOutboundTransaction) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 1: Write failing repository integration tests**

Tests must prove:

- `listDue()` orders by `available_at, id`;
- duplicate wake-ups cannot acquire the same Delivery twice;
- two concurrent callers acquire at most one valid lease;
- `lease_token` is random per acquisition;
- stale token updates affect zero rows and throw `MAIL_OUTBOUND_LEASE_LOST`;
- expired lease recovery changes status to uncertain;
- retry clears lease and advances `available_at`;
- open attempt uniqueness is enforced;
- completed/failed/canceled rows cannot be claimed;
- message loading returns the exact frozen raw Blob reference, envelope, Message-ID, connection,
  channel, and optional remote reply thread.

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/mail-core/outbound-repository.integration.test.ts
```

Expected: FAIL because the repository and composite Unit of Work are missing.

- [ ] **Step 3: Export a reusable PostgreSQL MailTransaction factory**

Refactor `PostgresMailUnitOfWork` without changing its behavior:

```ts
export const createPostgresMailTransaction = (
  transaction: MailDatabase,
  allocated: Map<MailAccountId, bigint>,
): MailTransaction => ({
  ...createPostgresRepositories(transaction),
  lockAccount: ...,
  nextStateVersion: ...,
});
```

Both the existing Mail Core Unit of Work and the new composite outbound Unit of Work must use this
factory.

- [ ] **Step 4: Implement atomic lease operations**

Use one conditional `UPDATE ... WHERE` or a row-locked transaction for `claimById()`. Its condition
must include the allowed due statuses and `available_at <= now`. Create the open attempt in the same
transaction that establishes the lease.

Every mutation after claim includes:

```ts
and(
  eq(outboundDelivery.id, input.deliveryId),
  eq(outboundDelivery.status, 'leased'),
  eq(outboundDelivery.leaseToken, input.leaseToken),
);
```

- [ ] **Step 5: Implement the composite Unit of Work**

Create one Drizzle transaction and expose both the transaction-bound Mail repositories and outbound
repository. Preserve callback error identity with the same `CallbackFailure` behavior as
`PostgresMailUnitOfWork`.

- [ ] **Step 6: Run repository and existing UoW tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/mail-core/outbound-repository.integration.test.ts tests/mail-core/postgres-unit-of-work.test.ts tests/mail-core/repositories.integration.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- apps/server/src/modules/mail/postgres apps/server/src/modules/mail-outbound/postgres apps/server/tests/mail-core/outbound-repository.integration.test.ts
git commit -m "feat(mail-outbound): persist leases and delivery attempts"
```

---

### 任务 5：实现 Submission 原子入队与服务商无关的投递编排

**Files:**

- Create: `apps/server/src/modules/mail-outbound/application/enqueue-submission.ts`
- Create: `apps/server/src/modules/mail-outbound/application/enqueue-submission.test.ts`
- Create: `apps/server/src/modules/mail-outbound/application/deliver.ts`
- Create: `apps/server/src/modules/mail-outbound/application/deliver.test.ts`
- Create: `apps/server/src/modules/mail-outbound/application/commands.ts`
- Create: `apps/server/src/modules/mail-outbound/application/dispatch-due-deliveries.ts`
- Create: `apps/server/src/modules/mail-outbound/application/dispatch-due-deliveries.test.ts`
- Create: `apps/server/src/modules/mail-outbound/application/finalize-sent.ts`
- Create: `apps/server/src/modules/mail-outbound/index.ts`

**Interfaces:**

- Consumes: Task 1 transaction-scoped Mail Core operations, Task 2 adapter contract and retry
policy, Task 4 composite Unit of Work and repository.
- Produces:

```ts
export type SubmitDraftForDeliveryInput = CreateSubmissionInput;

export type SubmitDraftForDeliveryResult = {
  submission: SubmissionRecord;
  delivery: OutboundDeliveryRecord;
};

export const enqueueSubmission = (
  input: SubmitDraftForDeliveryInput,
  dependencies: EnqueueSubmissionDependencies,
) => Promise<SubmitDraftForDeliveryResult>;

export const deliverClaimed = (
  claimed: ClaimedDelivery,
  dependencies: DeliverDependencies,
) => Promise<'sent' | 'retry_wait' | 'uncertain' | 'failed'>;

export type MailOutboundCommand =
  | { type: 'dispatch' }
  | { type: 'reconcile'; deliveryId: string };
```

- [ ] **Step 1: Write failing atomic-enqueue tests**

Use a composite fake Unit of Work and PostgreSQL integration coverage to prove:

```ts
const first = await enqueueSubmission(input, dependencies);
const second = await enqueueSubmission(input, dependencies);

expect(second.submission.id).toBe(first.submission.id);
expect(second.delivery.id).toBe(first.delivery.id);
```

Also inject Delivery insert failure and prove the Submission and Change Log roll back.

- [ ] **Step 2: Run enqueue tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/application/enqueue-submission.test.ts
```

Expected: FAIL because the application service is absent.

- [ ] **Step 3: Implement atomic enqueue**

Inside one composite transaction:

```ts
const submission = await createSubmissionInTransaction(mailCoreDependencies, tx.mail, input);
const existing = await tx.outbound.findBySubmission(input.accountId, submission.id);
if (existing) return { submission, delivery: existing };
const account = await tx.mail.accounts.findById(input.accountId);
const delivery = await tx.outbound.insert({
  id: dependencies.newId(),
  mailAccountId: input.accountId,
  submissionId: submission.id,
  connectionId: account!.connectionId,
  status: submission.status === 'scheduled' ? 'scheduled' : 'ready',
  availableAt: submission.sendAt,
  now: dependencies.clock.now(),
});
return { submission, delivery };
```

Send the Queue wake-up only after transaction success.

- [ ] **Step 4: Write failing delivery-orchestrator tests**

Tests must cover:

- exact frozen bytes reach the adapter;
- channel selection comes from Connection and Registry, not Provider conditionals;
- credentials are resolved before adapter construction;
- Gmail accepted result invokes one composite finalization;
- transient error schedules retry with the lease token;
- authentication error marks reconnect-required and schedules retry without leaking the token;
- permanent error leaves the Email as Draft and marks Delivery/Submission failed;
- a transport timeout after request dispatch becomes uncertain;
- no database transaction is active while `adapter.send()` is pending.

- [ ] **Step 5: Run delivery tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/application/deliver.test.ts src/modules/mail-outbound/application/dispatch-due-deliveries.test.ts
```

Expected: FAIL because delivery orchestration is absent.

- [ ] **Step 6: Implement dispatch, delivery, and finalization**

`dispatchDueDeliveries()` lists IDs, emits bounded wake-ups, and relies on `claimById()` for
ownership. `deliverClaimed()` loads one immutable snapshot, resolves one adapter, calls it outside
the transaction, and maps the result to exactly one repository transition.

On accepted result, open one composite transaction:

```ts
await finalizeSubmissionSentInTransaction(mailCoreDependencies, tx.mail, {
  accountId: claimed.delivery.mailAccountId,
  submissionId: claimed.delivery.submissionId,
  provider: adapter.provider,
  remoteMessageId: accepted.remoteMessageId,
  remoteThreadId: accepted.remoteThreadId,
  acceptedAt: accepted.acceptedAt,
});
await tx.outbound.markCompleted({
  deliveryId: claimed.delivery.id,
  leaseToken: claimed.delivery.leaseToken,
  accepted,
});
```

This is the local atomic boundary after Provider success.

- [ ] **Step 7: Run application tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/application
```

Expected: all application tests pass.

- [ ] **Step 8: Commit Task 5**

```powershell
git add -- apps/server/src/modules/mail-outbound/application apps/server/src/modules/mail-outbound/index.ts
git commit -m "feat(mail-outbound): enqueue and deliver submissions"
```

---

### 任务 6：实现 Gmail 发送与已发送邮件对账

**Files:**

- Create: `apps/server/src/mail-channel/gmail/outbound/adapter.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/adapter.test.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/mime-request.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/mime-request.test.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/result-mapper.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/reconciliation.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/reconciliation.test.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/errors.ts`
- Create: `apps/server/src/mail-channel/gmail/outbound/index.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-client.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-client.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-transport.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/api-transport.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/shared/errors.ts`
- Modify: `apps/server/src/mail-channel/gmail/plugin.ts`
- Modify: `apps/server/src/mail-channel/gmail/plugin.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/index.ts`

**Interfaces:**

- Consumes: Task 2 `OutboundMailAdapter`, existing Gmail executor/transport/auth retry path, and
EmailEngine-informed payload thresholds.
- Produces:

```ts
export const GMAIL_JSON_SEND_RAW_LIMIT = 3_500_000;

export interface GmailApiClient {
  sendRawMessage(input: {
    raw: Uint8Array;
    remoteThreadId: string | null;
  }): Promise<{ id: string | null; threadId: string | null }>;
  findSentByMessageId(messageId: string): Promise<
    Array<{ id: string; threadId: string | null; internalDate: string | null }>
  >;
}

export const createGmailOutboundAdapter = (
  client: GmailApiClient,
  clock: { now(): Date },
): OutboundMailAdapter;
```

- [ ] **Step 1: Write failing Gmail request tests**

Test:

- raw size at and below `3_500_000` uses JSON base64url;
- raw size above it uses media upload;
- JSON raw contains no `+`, `/`, or padding `=`;
- reply thread ID is included in both request modes;
- missing Gmail response ID is a permanent invalid response;
- returned `id/threadId` maps to the common accepted result;
- raw MIME bytes are not changed.

- [ ] **Step 2: Run Gmail send tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-channel/gmail/outbound/mime-request.test.ts src/mail-channel/gmail/outbound/adapter.test.ts
```

Expected: FAIL because Gmail outbound files and transport methods are absent.

- [ ] **Step 3: Extend the shared Gmail transport**

Add typed methods for:

```ts
sendMessage(request)
uploadMessage(request)
listMessages({ userId: 'me', labelIds: ['SENT'], q, pageToken })
getMessageMetadata({ userId: 'me', id, metadataHeaders: ['Message-ID'] })
```

The Google transport implementation continues to execute through `GmailApiExecutor`, preserving
the existing Zero OAuth/Nango refresh behavior.

- [ ] **Step 4: Implement Gmail send adapter**

For JSON:

```ts
requestBody: {
  raw: Buffer.from(input.raw).toString('base64url'),
  ...(input.remoteThreadId ? { threadId: input.remoteThreadId } : {}),
}
```

For upload, pass the unchanged RFC 5322 bytes as `message/rfc822` media and include thread metadata
when present. Do not call Gmail label, draft, modify, trash, or delete APIs.

- [ ] **Step 5: Write failing reconciliation and error tests**

Test:

- query is limited to Gmail Sent and exact stable Message-ID;
- pagination is exhausted;
- one match returns found;
- zero matches returns not_found;
- multiple matches select the earliest trustworthy Gmail item and do not request another send;
- 401 maps to authentication_required;
- 429 maps to rate_limited with bounded Retry-After;
- 5xx and connection reset map to uncertain when request dispatch cannot be disproved;
- preflight validation failures map to permanent failure.

- [ ] **Step 6: Run reconciliation tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-channel/gmail/outbound/reconciliation.test.ts src/mail-channel/gmail/outbound/adapter.test.ts
```

Expected: the new cases fail until reconciliation and error mapping exist.

- [ ] **Step 7: Implement reconciliation and plugin wiring**

Use a Provider-local query builder for:

```text
in:sent rfc822msgid:<stable-message-id>
```

Verify candidates through Gmail metadata before returning `found`. Wire `plugin.outbound` through
the same executor factory used by inbound. Ensure `plugin.ts` remains the only Gmail capability
assembly point.

- [ ] **Step 8: Run all canonical Gmail and Registry tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-channel/gmail src/mail-channel/registry
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit Task 6**

```powershell
git add -- apps/server/src/mail-channel
git commit -m "feat(gmail): send and reconcile outbound messages"
```

---

### 任务 7：实现不确定投递结果恢复

**Files:**

- Create: `apps/server/src/modules/mail-outbound/application/reconcile-uncertain.ts`
- Create: `apps/server/src/modules/mail-outbound/application/reconcile-uncertain.test.ts`
- Create: `apps/server/src/modules/mail-outbound/application/recover-expired-leases.ts`
- Create: `apps/server/src/modules/mail-outbound/application/recover-expired-leases.test.ts`
- Modify: `apps/server/src/modules/mail-outbound/application/commands.ts`
- Modify: `apps/server/src/modules/mail-outbound/application/deliver.ts`
- Modify: `apps/server/src/modules/mail-outbound/postgres/repository.ts`
- Modify: `apps/server/tests/mail-core/outbound-repository.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 reconciliation policy, Task 4 lease repository, Task 5 local finalization, and
Task 6 Gmail reconciliation capability.
- Produces:

```ts
export const reconcileUncertainDelivery = (
  input: { deliveryId: string; owner: string; leaseForMs: number },
  dependencies: ReconcileUncertainDependencies,
) => Promise<'sent' | 'not_found' | 'retry_wait' | 'unsupported'>;

export const recoverExpiredOutboundLeases = (
  input: { now: Date; limit: number },
  dependencies: RecoverExpiredLeaseDependencies,
) => Promise<string[]>;
```

- [ ] **Step 1: Write failing recovery tests**

Prove:

- an expired send lease becomes uncertain and closes its open attempt as uncertain;
- the recovery scanner emits reconciliation commands, not send commands;
- found result performs the same atomic local finalization as direct send success;
- first and second not_found results use 30-second and 2-minute reconciliation delays;
- third not_found result returns the Delivery to ready using the same frozen MIME;
- inconclusive result remains uncertain;
- multiple matches never cause another send;
- unsupported reconciliation is explicitly marked as at-least-once before resend;
- a stale reconciliation lease cannot finalize.

- [ ] **Step 2: Run recovery tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/application/reconcile-uncertain.test.ts src/modules/mail-outbound/application/recover-expired-leases.test.ts
```

Expected: FAIL because recovery services are absent.

- [ ] **Step 3: Implement expired-lease recovery**

Recover only rows satisfying:

```text
status = leased AND lease_expires_at <= now
```

Close the current attempt with outcome `uncertain`, clear the old lease, set `uncertain_since` once,
set status `uncertain`, and schedule the first reconciliation.

- [ ] **Step 4: Implement reconciliation**

Acquire a fresh lease with attempt kind `reconcile`, load only Message-ID and route context, invoke
the optional adapter reconciliation method outside a transaction, and handle:

```ts
switch (result.status) {
  case 'found':
    return finalizeAcceptedResult(...);
  case 'not_found':
    return scheduleNextReconciliationOrResend(...);
  case 'inconclusive':
    return keepUncertainWithRetry(...);
}
```

- [ ] **Step 5: Run recovery and repository tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/application/reconcile-uncertain.test.ts src/modules/mail-outbound/application/recover-expired-leases.test.ts tests/mail-core/outbound-repository.integration.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 7**

```powershell
git add -- apps/server/src/modules/mail-outbound apps/server/tests/mail-core/outbound-repository.integration.test.ts
git commit -m "feat(mail-outbound): recover uncertain provider outcomes"
```

---

### 任务 8：组装运行时队列与定时唤醒

**Files:**

- Create: `apps/server/src/modules/mail-outbound/runtime/create-mail-outbound.ts`
- Create: `apps/server/src/modules/mail-outbound/runtime/create-mail-outbound.test.ts`
- Create: `apps/server/src/runtime/mail/outbound.ts`
- Create: `apps/server/src/runtime/mail/outbound.test.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/wrangler.jsonc`
- Modify: `apps/server/src/mail-architecture.test.ts`
- Modify: `apps/server/src/modules/mail-outbound/index.ts`

**Interfaces:**

- Consumes: all earlier tasks, existing connection/authorization credential resolution,
`createCredentialAwareGmailExecutor()`, `R2BlobStore`, and Cloudflare Worker handlers.
- Produces:

```ts
export interface MailOutboundRuntime {
  submit(input: CreateSubmissionInput): Promise<SubmitDraftForDeliveryResult>;
  process(command: MailOutboundCommand): Promise<void>;
  enqueueDue(): Promise<{ due: number; expired: number; uncertain: number }>;
}

export const runMailOutboundCommand = (
  env: ZeroEnv,
  command: MailOutboundCommand,
) => Promise<void>;

export const enqueueDueMailOutboundWork = (
  env: ZeroEnv,
) => Promise<{ due: number; expired: number; uncertain: number }>;
```

- [ ] **Step 1: Write failing runtime and architecture tests**

Prove:

- Zero OAuth and Nango both resolve through one credential path;
- channel Registry selects the plugin;
- one Gmail adapter implementation is shared by both authorization sources;
- queue command parsing rejects unknown shapes;
- queue wake-up loss is repaired by scheduled PostgreSQL scan;
- queue duplicates are absorbed by the lease;
- canonical outbound files do not import `lib/driver`, `pipelines`, KV bindings, or old
  `send_email_queue`;
- old frontend queue remains untouched in this phase.

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound/runtime src/runtime/mail/outbound.test.ts src/mail-architecture.test.ts
```

Expected: FAIL because runtime assembly and bindings are absent.

- [ ] **Step 3: Implement runtime assembly**

Move reusable credential-loading logic out of Gmail inbound runtime only when necessary to avoid
copying it. The new runtime:

1. opens one DB connection per Worker command;
2. loads Connection and AuthorizationBinding;
3. resolves Zero OAuth or Nango credentials;
4. creates the credential-aware Gmail executor;
5. asks Registry for outbound capability;
6. injects R2 BlobStore, composite UoW, repository, clock, ID/lease factories, and queue sender;
7. closes the database connection in `finally`.

- [ ] **Step 4: Add a dedicated non-authoritative Queue binding**

Add `MAIL_OUTBOUND_QUEUE` to `ZeroEnv` and add `mail-outbound-queue`,
`mail-outbound-queue-staging`, and `mail-outbound-queue-prod` producer/consumer entries to their
matching Wrangler environments.

Do not rename or remove `send_email_queue` in this phase.

- [ ] **Step 5: Wire Worker queue and scheduled handlers**

Add a `mail-outbound-queue` case before the legacy send queue case:

```ts
const command = parseMailOutboundCommand(message.body);
await runMailOutboundCommand(this.env, command);
message.ack();
```

Permanent validated command errors are acknowledged; retryable infrastructure errors use bounded
Queue retry. Add `await enqueueDueMailOutboundWork(this.env)` to `scheduled()`.

- [ ] **Step 6: Run targeted runtime and architecture tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound src/runtime/mail/outbound.test.ts src/mail-channel src/mail-architecture.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 8**

```powershell
git add -- apps/server/src/modules/mail-outbound apps/server/src/runtime/mail/outbound.ts apps/server/src/runtime/mail/outbound.test.ts apps/server/src/env.ts apps/server/src/main.ts apps/server/src/mail-architecture.test.ts apps/server/wrangler.jsonc
git commit -m "feat(mail-outbound): wire worker runtime and wakeups"
```

---

### 任务 9：执行完整性、回归与构建验证

**Files:**

- Modify only files required by failures reproduced in this task.

**Interfaces:**

- Consumes: the complete implementation.
- Produces: fresh verification evidence and a clean working tree.

- [ ] **Step 1: Run the complete Mail Core suite**

```powershell
pnpm test:mail-core
```

Expected: all Mail Core package and server Mail Core tests pass; the established database-dependent
skip is acceptable only when its environment variable is absent.

- [ ] **Step 2: Run canonical outbound, channel, credential, and architecture suites**

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-outbound src/mail-channel src/modules/mail-accounts/credentials src/runtime/mail src/mail-architecture.test.ts
```

Expected: zero failed files and zero failed tests.

- [ ] **Step 3: Run TypeScript checks**

```powershell
pnpm --filter @zero/mail-core typecheck
pnpm --filter @zero/server exec tsc --noEmit
```

Expected: Mail Core exits 0. If server-wide historical errors remain, capture the complete baseline,
prove no changed outbound file appears in the error list, and run a changed-file-scoped TypeScript
verification through the server Vitest/Vite transform.

- [ ] **Step 4: Run format and lint checks on changed files**

```powershell
pnpm exec prettier --check packages/mail-core/src packages/mail-core/tests apps/server/src/modules/mail-outbound apps/server/src/mail-channel apps/server/src/runtime/mail/outbound.ts apps/server/src/env.ts apps/server/src/main.ts apps/server/wrangler.jsonc apps/server/tests/mail-core
pnpm --filter @zero/server exec eslint src/modules/mail-outbound src/mail-channel src/runtime/mail/outbound.ts
```

Expected: both commands exit 0.

- [ ] **Step 5: Run a production Worker dry build**

```powershell
pnpm --filter @zero/server exec wrangler deploy --dry-run --env local --outdir .wrangler/tmp/mail-outbound-build
```

Expected: exit 0 and a generated Worker bundle.

- [ ] **Step 6: Review the approved design line by line**

Check `docs/superpowers/specs/2026-07-26-provider-neutral-mail-outbound-gmail-design.md` against:

- Submission/Spool separation;
- Provider-neutral routing;
- local Draft-to-Sent atomic finalization;
- exact frozen MIME reuse;
- Gmail message/thread mapping;
- lease recovery and uncertain reconciliation;
- no Gmail mailbox-state operations;
- no frontend cutover;
- no new dependency on legacy mail code.

Any gap must first receive a failing test, then the minimum fix, then rerun Steps 1–5.

- [ ] **Step 7: Inspect Git state and commit verification fixes**

```powershell
git diff --check
git status --short
```

如果本任务发现并修复了问题，应返回负责该文件的前置任务，重新执行该任务的定向测试，并使用该任务已经列明的精确 `git add` 和 `git commit` 命令提交；纯验证本身不创建空提交。

Expected final state: no uncommitted implementation changes.
