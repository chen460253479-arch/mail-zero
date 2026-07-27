# Mail Sync Trigger Coalescing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Gmail Pub/Sub、定时对账和手工恢复统一成一个持久化同步请求状态机，保证触发合并、忙碌补跑、原子调度、租约续期与最终页检查点语义。

**Architecture:** 每个 `inbound_sync` 保存 requested/completed generation、最大 cursor hint、下一次对账时间和调度认领租约。任意触发只增加 requested generation；Worker 持有同步租约循环追赶，释放租约前确认是否又有请求。周期调度用 `FOR UPDATE SKIP LOCKED` 原子认领，Queue 只是唤醒机制。

**Tech Stack:** TypeScript、Drizzle ORM、PostgreSQL、Cloudflare Queues、Vitest

## Global Constraints

- 本计划不引入 Gmail 特有字段到通用同步应用层。
- 邮件导入仍以 `(sync_id, remote_message_id)` 唯一约束保证幂等。
- 分页时可以持久化事件，但 provider checkpoint 只在最终页前进。

---

## Task 1: 扩展通用同步状态模型

**Files:**
- Modify: `apps/server/src/modules/mail-sync/postgres/schema.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/types.ts`
- Modify: `apps/server/tests/mail-sync/schema.integration.test.ts`

- [ ] 先写 schema 测试覆盖非负 generation、completed 不得超过 requested、调度租约成对、下一次对账索引。
- [ ] 增加 `requestedGeneration`、`completedGeneration`、`pendingCursorHint`、`nextReconcileAt`、`dispatchLeaseOwner`、`dispatchLeaseExpiresAt`。
- [ ] 保留既有同步/条目/尝试表，不改变远端消息唯一约束。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run tests/mail-sync/schema.integration.test.ts
```

## Task 2: 持久化触发合并

**Files:**
- Modify: `apps/server/src/modules/mail-sync/postgres/sync-repository.ts`
- Modify: `apps/server/src/modules/mail-sync/application/receive-signal.ts`
- Modify: `apps/server/src/modules/mail-sync/application/receive-signal.test.ts`
- Modify: `apps/server/tests/mail-sync/repository.integration.test.ts`

- [ ] 写失败测试：连续 Pub/Sub hint 只递增请求代数并保留最大 provider hint；空 hint 也必须请求一次同步。
- [ ] `recordSignal` 在事务中更新 `lastSignalAt/requestedGeneration/pendingCursorHint` 并返回需要唤醒的 sync。
- [ ] 已有未完成请求时允许重复入队，但正确性不得依赖 Queue 去重。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-sync/application/receive-signal.test.ts tests/mail-sync/repository.integration.test.ts
```

## Task 3: 发现循环、最终页检查点与租约续期

**Files:**
- Modify: `apps/server/src/modules/mail-sync/application/discover-incremental.ts`
- Modify: `apps/server/src/modules/mail-sync/application/discover-incremental.test.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/sync-repository.ts`
- Modify: `apps/server/tests/mail-sync/discovery.integration.test.ts`

- [ ] 写失败测试：同步期间到达新 generation 时同一 Worker 继续下一轮；租约忙时请求保留；分页中间不推进 provider checkpoint。
- [ ] 增加 `renewSyncLease`，在每页 API 调用前后按剩余时间续租；续租失败立即停止写入。
- [ ] `persistDiscoveryPage` 只插入事件；`completeDiscoveryRun` 在最终页原子推进 checkpoint、completed generation、next reconcile time 并清空已消费 hint。
- [ ] 只有完整对账完成才更新 `lastReconciledAt`。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-sync/application/discover-incremental.test.ts tests/mail-sync/discovery.integration.test.ts
```

## Task 4: 原子调度与入队补偿

**Files:**
- Modify: `apps/server/src/modules/mail-sync/postgres/sync-repository.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/src/modules/mail-sync/runtime/create-mail-sync.ts`
- Modify: `apps/server/src/modules/mail-sync/runtime/create-mail-sync.test.ts`
- Create: `apps/server/tests/mail-sync/scheduler.integration.test.ts`

- [ ] 写并发集成测试：两个 scheduler 不得认领同一 sync；dispatch lease 到期后可重领。
- [ ] 用事务、`FOR UPDATE SKIP LOCKED` 和 dispatch lease 替换 `findDueReconciliations/findDueRenewals` 只读扫描。
- [ ] 定时任务同时认领：未完成 generation、到期对账、Watch 续期和待导入条目。
- [ ] 成功入队后确认 dispatch；入队失败保留/缩短 dispatch lease，供下一轮恢复。
- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-sync/runtime/create-mail-sync.test.ts tests/mail-sync/scheduler.integration.test.ts
```

## Task 5: 第三阶段一致性验收

- [ ] 运行：

```powershell
pnpm --filter @zero/server exec vitest run src/modules/mail-sync tests/mail-sync src/mail-channel/gmail/inbound
pnpm --filter @zero/server lint
```

- [ ] 确认 `cursorHint` 不再被丢弃，且不存在只读 due scan 后直接入队的代码。
- [ ] 提交：

```powershell
git add apps/server/src/modules/mail-sync apps/server/src/runtime/mail/gmail-inbound.ts apps/server/tests/mail-sync
git commit -m "feat(mail-sync): coalesce durable sync triggers"
```
