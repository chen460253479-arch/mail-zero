# Zero 数据完整性与插件边界修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Gmail 入栈前完成受保护的开发数据库初始化、必要约束与索引、多账户
应用投影隔离和服务商无关连接模型。

**Architecture:** TypeScript Schema 仍是开发期结构来源，项目级 `db:push` 包装器
负责空库检测和显式清空确认，正式增量由 `generate/migrate` 承担。`mail` 保持
服务商无关，Provider 映射与连接保留在 `integration`，旧前端投影通过连接作用域
避免多账户冲突。

**Tech Stack:** TypeScript、Vitest、Drizzle ORM/Kit、PostgreSQL 17、pnpm。

## Global Constraints

- 直接在 `D:\WorkSpace\Zero` 当前 `codex/local-mail-core` 分支开发。
- 不创建 Git worktree。
- 不修改或提交根目录未跟踪的 `AGENTS.md`。
- 当前开发数据库允许清空重建，不保留已有业务数据。
- 不接入 Gmail，不切换前端，不实现反向同步。
- 生产代码修改前必须先运行并观察对应失败测试。
- 生成基线只能使用 Drizzle 工具，不手写 snapshot JSON。

---

### Task 1: 受保护的 db:push 决策内核

**Files:**

- Create: `apps/server/src/db/development-push.ts`
- Test: `apps/server/src/db/development-push.test.ts`

**Interfaces:**

- Produces:

```ts
export type PushOptions = {
  reset: boolean;
  yes: boolean;
  production: boolean;
  interactive: boolean;
};

export type ExistingSchema = {
  schemaName: 'auth' | 'app' | 'integration' | 'mail';
  tableCount: number;
};

export type PushDecision =
  | { action: 'initialize' }
  | { action: 'prompt'; existing: ExistingSchema[] }
  | { action: 'reset'; existing: ExistingSchema[] }
  | { action: 'cancel' };

export function decideDevelopmentPush(
  existing: ExistingSchema[],
  options: PushOptions,
): PushDecision;

export function sanitizedDatabaseTarget(databaseUrl: string): string;
```

- [ ] **Step 1: Write failing policy tests**

Use literal cases for empty initialization, interactive prompt, non-interactive rejection,
explicit reset, production reset rejection, and sanitized target output.

- [ ] **Step 2: Run the red test**

```powershell
pnpm --dir apps/server exec vitest run src/db/development-push.test.ts
```

Expected: fail because `development-push.ts` does not exist.

- [ ] **Step 3: Implement the pure decision functions**

Production reset throws `DevelopmentPushError`; non-interactive existing databases without
`--reset --yes` also throw. URL output contains only protocol, host, port, and database name.

- [ ] **Step 4: Run green tests and typecheck**

```powershell
pnpm --dir apps/server exec vitest run src/db/development-push.test.ts
pnpm --filter=@zero/server exec tsc --noEmit --pretty false
```

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/db/development-push.ts apps/server/src/db/development-push.test.ts
git commit -m "feat(db): add guarded push policy"
```

### Task 2: db:push 数据库检查、交互和清空重建

**Files:**

- Create: `apps/server/src/db/push-development-database.ts`
- Modify: `apps/server/package.json`
- Create: `apps/server/tests/mail-core/development-push.integration.test.ts`
- Modify: `apps/server/tests/mail-core/helpers/database.ts`

**Interfaces:**

- Consumes: Task 1 `decideDevelopmentPush()` and `sanitizedDatabaseTarget()`.
- Produces:

```ts
export async function inspectZeroSchemas(sql: Sql): Promise<ExistingSchema[]>;
export async function resetZeroSchemas(sql: Sql): Promise<void>;
export async function runDevelopmentPush(argv: string[]): Promise<void>;
```

- [ ] **Step 1: Write failing PostgreSQL behavior tests**

Use a real isolated database to prove: empty inspection, existing table detection, cancel leaves a
sentinel row unchanged, explicit reset removes the sentinel, and unrelated `public` objects remain.

- [ ] **Step 2: Run the red integration test**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/development-push.integration.test.ts
```

- [ ] **Step 3: Implement inspection and scoped reset**

Use parameterized catalog queries. Reset only `auth`, `app`, `integration`, `mail`, and the
development `drizzle` migration metadata. Do not execute `DROP DATABASE`.

- [ ] **Step 4: Implement the CLI**

Parse `--reset` and `--yes`; use `readline/promises` only for TTY input. Default answer is cancel.
Spawn the local `drizzle-kit push` process, forward output, and return nonzero on child or detected
PostgreSQL/Drizzle errors.

- [ ] **Step 5: Route package db:push through the wrapper**

```json
"db:push:drizzle": "drizzle-kit push",
"db:push": "tsx src/db/push-development-database.ts"
```

- [ ] **Step 6: Verify empty, cancel, reset, noninteractive, and production paths**

```powershell
pnpm --dir apps/server exec vitest run src/db/development-push.test.ts tests/mail-core/development-push.integration.test.ts
```

- [ ] **Step 7: Commit**

```powershell
git add apps/server/package.json apps/server/src/db apps/server/tests/mail-core
git commit -m "feat(db): guard development schema reset"
```

### Task 3: 稳定约束名称

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/tests/mail-core/schema-definition.test.ts`
- Modify: `apps/server/tests/mail-core/schema-topology.test.ts`

**Interfaces:**

- All PostgreSQL constraint names are explicit, unique, and at most 63 bytes.
- Existing `email_part` account/email-scoped parent foreign key remains unchanged.

- [ ] **Step 1: Add a failing constraint-name contract**

Enumerate all exported Drizzle tables and fail for unnamed primary/unique constraints, duplicate
names, or UTF-8 names over 63 bytes.

- [ ] **Step 2: Run the red schema tests**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts tests/mail-core/schema-topology.test.ts
```

- [ ] **Step 3: Add short explicit names**

Name the `connection`, `authorization_binding`, `channel_mapping`, and
`writing_style_matrix` constraints without changing their current column sets.

- [ ] **Step 4: Run green schema tests**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts tests/mail-core/schema-topology.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/db/schema.ts apps/server/tests/mail-core
git commit -m "fix(db): stabilize postgres constraint names"
```

### Task 4: 外键和仓储查询索引

**Files:**

- Modify: `apps/server/src/modules/mail/postgres/schema/accounts.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/blobs.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/emails.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/mailboxes.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/submissions.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/identity-repository.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/mailbox-repository.ts`
- Modify: `apps/server/tests/mail-core/schema-definition.test.ts`
- Create: `apps/server/tests/mail-core/supporting-indexes.integration.test.ts`

**Interfaces:**

- Adds the exact FK and list indexes named in the approved design.
- Active Identity and Mailbox list methods exclude `deleted_at IS NOT NULL` in SQL.

- [ ] **Step 1: Add failing schema and repository behavior tests**

Assert literal index column order and that soft-deleted rows are absent from repository results.

- [ ] **Step 2: Run red tests**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts tests/mail-core/supporting-indexes.integration.test.ts
```

- [ ] **Step 3: Add minimal indexes and SQL predicates**

Do not add an index when an existing primary/unique index has the required left prefix.

- [ ] **Step 4: Verify query plans on analyzed fixtures**

Assert the plan uses the target index for Blob references, active Identity/Mailbox pages, Blob
pages, Submission pages, and RemoteEmail reverse lookup.

- [ ] **Step 5: Run green tests and mail-core regression**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts tests/mail-core/supporting-indexes.integration.test.ts
pnpm --dir apps/server test:mail-core
```

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/modules/mail/postgres apps/server/tests/mail-core
git commit -m "perf(mail): add supporting postgres indexes"
```

### Task 5: 删除确认的重复索引

**Files:**

- Modify: `apps/server/src/modules/mail/postgres/schema/changes.ts`
- Modify: `apps/server/src/modules/mail/postgres/schema/thread-references.ts`
- Modify: `apps/server/tests/mail-core/schema-definition.test.ts`

- [ ] **Step 1: Add a failing duplicate-index test**

Compare indexed column order and predicates, treating primary-key left-prefix coverage as duplicate
only for the two reviewed indexes.

- [ ] **Step 2: Run red**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts
```

- [ ] **Step 3: Remove only the two confirmed redundant indexes**

- [ ] **Step 4: Run schema and Thread/Changes regressions**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts tests/mail-core/changes.integration.test.ts tests/mail-core/thread-reference.integration.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/modules/mail/postgres/schema apps/server/tests/mail-core/schema-definition.test.ts
git commit -m "perf(mail): remove redundant postgres indexes"
```

### Task 6: Summary 和 Note 连接作用域

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/lib/notes-manager.ts`
- Modify: `apps/server/src/trpc/routes/notes.ts`
- Modify: `apps/server/src/main.ts`
- Create: `apps/server/src/lib/notes-manager.test.ts`
- Create: `apps/server/tests/mail-core/app-projection-scope.integration.test.ts`

**Interfaces:**

- `app.summary` primary key becomes `(connection_id, message_id)`.
- `app.note` gains required `connection_id`.
- Note list/create operations consume authenticated `connectionId`.

- [ ] **Step 1: Write failing two-connection tests**

Insert identical Message/Thread IDs for two connections and prove both projections coexist and
queries return only the selected connection.

- [ ] **Step 2: Run red tests**

```powershell
pnpm --dir apps/server exec vitest run src/lib/notes-manager.test.ts tests/mail-core/app-projection-scope.integration.test.ts
```

- [ ] **Step 3: Change schema and Server access paths**

Derive connection ID from `ctx.activeConnection.id`; do not accept an arbitrary client connection
ID. Update Durable Object database methods to include the connection predicate.

- [ ] **Step 4: Run green tests and route type checks**

```powershell
pnpm --dir apps/server exec vitest run src/lib/notes-manager.test.ts tests/mail-core/app-projection-scope.integration.test.ts
pnpm --filter=@zero/server exec tsc --noEmit --pretty false
```

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/db/schema.ts apps/server/src/lib/notes-manager* apps/server/src/trpc/routes/notes.ts apps/server/src/main.ts apps/server/tests/mail-core
git commit -m "fix(app): scope mail projections by connection"
```

### Task 7: 服务商无关 Connection

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/lib/mail-channel/types.ts`
- Modify: `apps/server/src/lib/mail-channel/registry.ts`
- Modify: `apps/server/src/lib/integrations/gmail-oauth-service.ts`
- Modify: `apps/server/src/lib/nango/bind.ts`
- Modify: `apps/server/src/lib/auth.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: affected tests beside these modules
- Create: `apps/server/tests/mail-core/plugin-connection-schema.integration.test.ts`

**Interfaces:**

- Connection stores `providerKey` and plugin `channelId`, not credentials.
- OAuth/Basic/custom credentials live in `authorization_binding`.
- Connection uniqueness is `(user_id, channel_id, normalized_email)`.
- Stable status/auth fields have PostgreSQL checks.

- [ ] **Step 1: Write failing OAuth/Basic schema tests**

Prove an OAuth Gmail connection and a Basic IMAP/SMTP connection can both be stored without fake
scope/expiry values, while invalid lifecycle values are rejected.

- [ ] **Step 2: Run red**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/plugin-connection-schema.integration.test.ts
```

- [ ] **Step 3: Update the declarative model**

Remove credentials from Connection, add `provider_key`, make Authorization Binding the credential
owner, and add checks/short named uniqueness constraints.

- [ ] **Step 4: Update Gmail/Nango compatibility paths**

Keep current externally visible `providerId` where required by the existing frontend, deriving it
from the registered channel/plugin rather than credential columns.

- [ ] **Step 5: Run focused integration and module tests**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/plugin-connection-schema.integration.test.ts src/lib/integrations src/lib/nango src/lib/credentials
pnpm --filter=@zero/server exec tsc --noEmit --pretty false
```

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src apps/server/tests/mail-core/plugin-connection-schema.integration.test.ts
git commit -m "refactor(integration): make connections plugin neutral"
```

### Task 8: 重建唯一开发基线并完整验收

**Files:**

- Replace: `apps/server/src/db/migrations/0000_*.sql`
- Replace: `apps/server/src/db/migrations/meta/0000_snapshot.json`
- Modify: `apps/server/src/db/migrations/meta/_journal.json`
- Modify: `docs/superpowers/specs/2026-07-26-database-integrity-and-plugin-boundaries-design.md`
- Modify: `docs/superpowers/plans/2026-07-26-database-integrity-and-plugin-boundaries.md`

- [ ] **Step 1: Generate one new schema-only baseline**

Use the repository Drizzle generation command after removing only the currently committed
development baseline artifacts. Do not touch user data or `AGENTS.md`.

- [ ] **Step 2: Verify baseline shape**

```powershell
pnpm --dir apps/server exec vitest run tests/mail-core/baseline-migration.test.ts tests/mail-core/schema-structure-parity.test.ts tests/mail-core/schema-topology.test.ts
```

- [ ] **Step 3: Verify push and migrate in separate temporary databases**

Exercise empty push, existing cancel, existing reset, production refusal, and migrate. Compare all
catalog entries for columns, defaults, constraints, indexes, and foreign keys.

- [ ] **Step 4: Run full regressions**

```powershell
pnpm test:mail-core
pnpm --filter=@zero/mail-core typecheck
pnpm --dir apps/server exec vitest run src/db/development-push.test.ts src/lib/notes-manager.test.ts
pnpm build
git diff --check
```

- [ ] **Step 5: Run the explicit scale test**

```powershell
$env:MAIL_CORE_SCALE_TEST='1'
pnpm --dir apps/server exec vitest run tests/mail-core/mail-core-scale.integration.test.ts
Remove-Item Env:MAIL_CORE_SCALE_TEST
```

- [ ] **Step 6: Final omission review**

Confirm every approved design requirement has code and test evidence and that no Critical or
Important issue remains.

- [ ] **Step 7: Commit**

```powershell
git add apps/server/src/db/migrations docs/superpowers
git commit -m "chore(db): rebuild development schema baseline"
```
