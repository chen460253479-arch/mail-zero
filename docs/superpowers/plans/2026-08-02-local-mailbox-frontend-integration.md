# Local Mailbox Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Zero 已有的本地 Mailbox 模型完整接入前端，使文件夹保持单一主要归属、标签保持多选关系，并让所有渠道共用同一套本地邮箱交互。

**Architecture:** 先在 `@zero/mail-core` 和 Mail API 增加标签安全删除与语义化线程移动，再在 `apps/mail/modules/mail` 建立账户级 Mailbox 领域选择器和 mutation 边界。侧边栏、设置页、单条/详情/批量操作只消费该领域层，迁移结束后删除旧 Label/Folder 兼容链路。

**Tech Stack:** TypeScript、PostgreSQL、Drizzle ORM、tRPC、React Router、TanStack Query、Vitest、React、dnd-kit。

## Global Constraints

- 本地文件夹和标签不反向同步到 Gmail、Outlook、Zoho 或 IMAP。
- 邮件只处于一个主要文件夹；移动时保留所有 `kind=label` 关系。
- `Draft`、`Sent` 是受保护生命周期角色，不作为移动目标。
- 不新增数据库表，不改变现有 PostgreSQL 表结构。
- 所有查询键、选择状态、乐观事务和缓存操作必须包含 `accountId`。
- 页面组件不得直接拼装 tRPC 参数。
- 不保留渠道能力分支、名称路径推断或第二套 Mailbox 前端链路。

---

### Task 1: Safely delete labels that are attached to email

**Files:**
- Modify: `packages/mail-core/src/store/repositories.ts`
- Modify: `packages/mail-core/src/testing/memory-mail-store.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/email-repository.ts`
- Modify: `packages/mail-core/src/mailbox/destroy-mailbox.ts`
- Test: `packages/mail-core/tests/mailbox/mailbox-commands.test.ts`
- Test: `packages/mail-core/tests/mailbox/set-mailboxes.test.ts`

**Interfaces:**
- Consumes: `prepareEmailStateReplacementInTransaction()` and `applyPreparedEmailStateInTransaction()`.
- Produces: `EmailRepository.listByMailbox(accountId, mailboxId)` and atomic label deletion semantics.

- [x] **Step 1: Write failing Mail Core tests**

Add tests proving that deleting a leaf `kind=label` removes only that relation, retains the email and its primary mailbox, records updated states, while deleting a non-empty `kind=folder` still returns `MAILBOX_HAS_EMAIL`.

- [x] **Step 2: Verify the tests fail**

Run: `pnpm --filter @zero/mail-core test -- tests/mailbox/mailbox-commands.test.ts tests/mailbox/set-mailboxes.test.ts`

Expected: the label deletion case fails with `MAILBOX_HAS_EMAIL`.

- [x] **Step 3: Add the repository query**

Add this contract and implement it in memory and PostgreSQL stores:

```ts
listByMailbox(accountId: MailAccountId, mailboxId: MailboxId): Promise<EmailRecord[]>;
```

The PostgreSQL implementation must query `email_mailbox`, hydrate only emails in the same account, and exclude destroyed records.

- [x] **Step 4: Implement atomic label deletion**

In `destroyMailboxInTransaction`, keep system/child checks. For `kind=folder`, preserve the non-empty rejection. For `kind=label`, prepare replacement states for every associated email with the label ID removed, apply those mutations, then delete the label and record its destroyed change in the same account transaction.

- [x] **Step 5: Run Mail Core tests**

Run: `pnpm --filter @zero/mail-core test -- tests/mailbox/mailbox-commands.test.ts tests/mailbox/set-mailboxes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/mail-core/src/store/repositories.ts packages/mail-core/src/testing/memory-mail-store.ts apps/server/src/modules/mail/postgres/repositories/email-repository.ts packages/mail-core/src/mailbox/destroy-mailbox.ts packages/mail-core/tests/mailbox/mailbox-commands.test.ts packages/mail-core/tests/mailbox/set-mailboxes.test.ts
git commit -m "feat(mail-core): detach email relations when deleting labels"
```

### Task 2: Add provider-neutral thread move semantics

**Files:**
- Create: `packages/mail-core/src/thread/move-thread-emails.ts`
- Modify: `packages/mail-core/src/thread/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Test: `packages/mail-core/tests/thread/move-thread-emails.test.ts`
- Modify: `apps/server/src/modules/mail-api/contracts/action.ts`
- Modify: `apps/server/src/modules/mail-api/application/thread-action-service.ts`
- Modify: `apps/server/src/modules/mail-api/routers/action.ts`
- Modify: `apps/server/src/modules/mail-api/public-contracts.ts`
- Test: `apps/server/tests/unit/modules/mail-api/application/thread-action-service.test.ts`

**Interfaces:**
- Consumes: `MailboxRecord.kind`, `MailboxRecord.role`, `EmailRecord.lifecycle`, state preconditions, prepared email mutations.
- Produces:

```ts
type MoveThreadEmailsInput = {
  accountId: MailAccountId;
  threadIds: ThreadId[];
  destinationMailboxId: MailboxId;
  ifInState?: string;
};

type MoveThreadEmailsResult = {
  oldState: string;
  newState: string;
  movedThreadIds: ThreadId[];
  failed: Record<string, MailCoreSetError>;
};
```

- [ ] **Step 1: Write failing Mail Core move tests**

Cover custom folder destinations, Inbox/Archive/Junk/Trash destinations, label preservation, mixed received/sent/draft threads, cross-account references, invalid label destinations, duplicate thread IDs, state mismatch and partial thread failure.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @zero/mail-core test -- tests/thread/move-thread-emails.test.ts`

Expected: FAIL because `moveThreadEmails` does not exist.

- [ ] **Step 3: Implement the core command**

Accept only `kind=folder` or system roles `inbox|archive|junk|trash`. For each retained `lifecycle=received` email, replace the organizational mailbox set with the destination while preserving every label and protected lifecycle mailbox. Skip `draft` and `sent` emails. Prepare all mutations for one thread before applying any of them so per-thread failures are atomic.

- [ ] **Step 4: Export and bind the command**

Export from `thread/index.ts`; add `moveThreadEmails` to `MailCore` and `createMailCore`.

- [ ] **Step 5: Write failing Mail API contract/service tests**

Assert the public input is exactly `accountId`, `threadIds`, `destinationMailboxId`, optional `ifInState`, and `clientMutationId`, and that the result maps item failures without exposing internal errors.

- [ ] **Step 6: Implement `mail.action.moveThreads`**

Add Zod schemas, service mapping and router procedure. Keep `updateThreads` for keyword and label changes only.

- [ ] **Step 7: Run backend tests and type checks**

Run:

```bash
pnpm --filter @zero/mail-core test -- tests/thread/move-thread-emails.test.ts
pnpm --filter @zero/server test:mail-core
pnpm --filter @zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/mail-core/src/thread packages/mail-core/src/mail-core.ts packages/mail-core/tests/thread/move-thread-emails.test.ts apps/server/src/modules/mail-api/contracts/action.ts apps/server/src/modules/mail-api/application/thread-action-service.ts apps/server/src/modules/mail-api/routers/action.ts apps/server/src/modules/mail-api/public-contracts.ts apps/server/tests/unit/modules/mail-api/application/thread-action-service.test.ts
git commit -m "feat(mail): add semantic thread move action"
```

### Task 3: Build the frontend Mailbox domain selectors

**Files:**
- Modify: `apps/mail/modules/mail/model/mailbox.ts`
- Create: `apps/mail/modules/mail/selectors/mailbox-tree.ts`
- Create: `apps/mail/modules/mail/selectors/mailbox-groups.ts`
- Create: `apps/mail/modules/mail/selectors/mailbox-count.ts`
- Create: `apps/mail/modules/mail/selectors/mailbox-selection.ts`
- Test: `apps/mail/modules/mail/selectors/mailbox-tree.test.ts`
- Test: `apps/mail/modules/mail/selectors/mailbox-groups.test.ts`
- Test: `apps/mail/modules/mail/selectors/mailbox-count.test.ts`
- Test: `apps/mail/modules/mail/selectors/mailbox-selection.test.ts`

**Interfaces:**
- Consumes: account-scoped `Mailbox[]` returned by `useMailboxes`.
- Produces `MailboxTreeNode`, `groupMailboxes`, `mailboxBadgeCount`, `resolvePrimaryMailboxIds`, and tri-state label selection.

- [ ] **Step 1: Write selector tests**

Cover stable `sortOrder/name/id` ordering, true `parentId` hierarchy, orphan recovery to root, cycle protection, cross-kind parents, subscribed visibility, system grouping, count rules and all/partial/none batch label states.

- [ ] **Step 2: Verify selector tests fail**

Run: `pnpm --filter @zero/mail test -- modules/mail/selectors --reporter=dot`

Expected: FAIL because selector modules do not exist.

- [ ] **Step 3: Implement pure selectors**

Selectors must be framework-free, immutable, account-agnostic and must never parse `/` or `[]` from names.

- [ ] **Step 4: Run selector tests**

Run: `pnpm --filter @zero/mail test -- modules/mail/selectors --reporter=dot`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mail/modules/mail/model/mailbox.ts apps/mail/modules/mail/selectors
git commit -m "feat(mail): add mailbox domain selectors"
```

### Task 4: Generalize frontend Mailbox mutations and thread actions

**Files:**
- Modify: `apps/mail/modules/mail/mutations/mailbox-set-input.ts`
- Modify: `apps/mail/modules/mail/mutations/mailbox-set-input.test.ts`
- Modify: `apps/mail/modules/mail/mutations/use-mailbox-actions.ts`
- Modify: `apps/mail/modules/mail/mutations/thread-action-input.ts`
- Modify: `apps/mail/modules/mail/mutations/thread-action-input.test.ts`
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`
- Create: `apps/mail/modules/mail/mutations/mailbox-error-message.ts`
- Test: `apps/mail/modules/mail/mutations/mailbox-error-message.test.ts`

**Interfaces:**
- Consumes: `mail.mailbox.set`, `mail.action.moveThreads`, `mail.action.updateThreads`.
- Produces generic `createMailbox`, `updateMailbox`, `destroyMailbox`, `moveThreads`, and `setThreadLabels` functions.

- [ ] **Step 1: Write failing input and error mapping tests**

Assert explicit `kind`, `parentId`, `sortOrder`, `isSubscribed`, color, dedicated move input and Chinese mappings for `MAILBOX_HAS_CHILD`, `MAILBOX_HAS_EMAIL`, `MAILBOX_ROLE_CONFLICT`, name conflict and state mismatch.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @zero/mail test -- modules/mail/mutations --reporter=dot`

- [ ] **Step 3: Implement generic Mailbox actions**

Replace label-only hook names internally with generic operations. Preserve temporary compatibility wrappers only until Task 8 removes all old consumers.

- [ ] **Step 4: Switch all organizational moves to `moveThreads`**

`optimisticMoveThreadsTo` and trash/archive/inbox actions must submit only `destinationMailboxId`; label changes continue through `updateThreads` and submit only `kind=label` IDs.

- [ ] **Step 5: Run mutation tests**

Run: `pnpm --filter @zero/mail test -- modules/mail/mutations lib/thread-actions.test.ts lib/optimistic-actions-manager.test.ts --reporter=dot`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mail/modules/mail/mutations apps/mail/hooks/use-optimistic-actions.ts
git commit -m "feat(mail): expose generic mailbox mutations"
```

### Task 5: Replace sidebar navigation with local Mailbox trees

**Files:**
- Create: `apps/mail/components/mailbox/mailbox-sidebar.tsx`
- Create: `apps/mail/components/mailbox/folder-tree.tsx`
- Create: `apps/mail/components/mailbox/mailbox-tree-node.tsx`
- Modify: `apps/mail/components/ui/app-sidebar.tsx`
- Modify: `apps/mail/components/ui/nav-main.tsx`
- Modify: `apps/mail/config/navigation.ts`
- Modify: `apps/mail/hooks/use-stats.ts`
- Modify: `apps/mail/app/(routes)/mail/[folder]/page.tsx`
- Modify: `apps/mail/modules/mail/routing/mailbox-route.ts`
- Test: `apps/mail/components/mailbox/mailbox-sidebar.test.tsx`
- Test: `apps/mail/modules/mail/routing/mailbox-route.test.ts`

**Interfaces:**
- Consumes: mailbox groups/tree/count selectors and `useMailboxes`.
- Produces one sidebar showing Core, Management, Folders and Labels for every provider.

- [ ] **Step 1: Write navigation tests**

Verify folder and label sections appear together regardless of provider capabilities, hidden nodes are absent, each child has its own count, routes use opaque IDs, and active state compares resolved mailbox IDs.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @zero/mail test -- components/mailbox modules/mail/routing --reporter=dot`

- [ ] **Step 3: Implement sidebar components**

Use true `parentId` trees, persist expanded IDs per account in local storage, navigate both folder and label nodes to `/mail/{mailboxId}`, and expose separate create buttons for folders and labels.

- [ ] **Step 4: Replace fixed badge mutation**

System and custom nodes must use `mailboxBadgeCount`; zero values render no badge.

- [ ] **Step 5: Run navigation tests**

Run: `pnpm --filter @zero/mail test -- components/mailbox modules/mail/routing --reporter=dot`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mail/components/mailbox apps/mail/components/ui/app-sidebar.tsx apps/mail/components/ui/nav-main.tsx apps/mail/config/navigation.ts apps/mail/hooks/use-stats.ts apps/mail/app/(routes)/mail/[folder]/page.tsx apps/mail/modules/mail/routing
git commit -m "feat(mail): render local mailbox navigation"
```

### Task 6: Replace label settings with Mailbox management

**Files:**
- Create: `apps/mail/app/(routes)/settings/mailboxes/page.tsx`
- Create: `apps/mail/components/mailbox/mailbox-settings.tsx`
- Create: `apps/mail/components/mailbox/mailbox-editor-dialog.tsx`
- Create: `apps/mail/components/mailbox/mailbox-delete-dialog.tsx`
- Modify: `apps/mail/app/routes.ts`
- Modify: `apps/mail/config/navigation.ts`
- Test: `apps/mail/components/mailbox/mailbox-settings.test.tsx`

**Interfaces:**
- Consumes: generic Mailbox actions and selectors.
- Produces `/settings/mailboxes` with Folder and Label tabs.

- [ ] **Step 1: Write component tests**

Verify create/rename/reparent/reorder/show-hide actions, folder/label parent filtering, label color editing, protected system rows, statistics, delete constraints and Chinese typed errors.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @zero/mail test -- components/mailbox/mailbox-settings.test.tsx --reporter=verbose`

- [ ] **Step 3: Implement settings UI**

Use one editor dialog parameterized by `kind`; validate trimmed names, same-parent duplicates, self/descendant parents and maximum depth before mutation. Use dnd-kit only inside the same mailbox kind.

- [ ] **Step 4: Replace settings route and navigation**

Route and navigation must use `/settings/mailboxes`; do not keep a second `/settings/labels` page.

- [ ] **Step 5: Run settings tests**

Run: `pnpm --filter @zero/mail test -- components/mailbox/mailbox-settings.test.tsx --reporter=verbose`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mail/app/(routes)/settings/mailboxes apps/mail/components/mailbox apps/mail/app/routes.ts apps/mail/config/navigation.ts
git commit -m "feat(mail): add mailbox management settings"
```

### Task 7: Add move-folder and label-management menus

**Files:**
- Create: `apps/mail/components/mailbox/move-to-folder-menu.tsx`
- Create: `apps/mail/components/mailbox/label-picker.tsx`
- Modify: `apps/mail/components/mail/mail-list.tsx`
- Modify: `apps/mail/components/mail/thread-display.tsx`
- Modify: `apps/mail/components/mail/navbar.tsx`
- Test: `apps/mail/components/mailbox/mail-action-menus.test.tsx`

**Interfaces:**
- Consumes: `moveThreads`, `setThreadLabels`, Mailbox tree selectors and selected thread summaries/details.
- Produces single-thread, detail-toolbar and batch menu entry points.

- [ ] **Step 1: Write interaction tests**

Verify move targets exclude Draft/Sent/labels/current location, destination search, label tree search, single selection, batch tri-state, one-shot add/remove submission and send blocking while a mutation is pending.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @zero/mail test -- components/mailbox/mail-action-menus.test.tsx --reporter=verbose`

- [ ] **Step 3: Implement the menus**

Move menus use one destination and close after success. Label picker computes additions/removals from the initial selection and submits once on Apply. Important, flagged and seen remain keyword actions.

- [ ] **Step 4: Integrate all three entry points**

Use the same components in list row menus, thread detail toolbar and bulk toolbar; no entry point may assemble raw tRPC input.

- [ ] **Step 5: Run interaction tests**

Run: `pnpm --filter @zero/mail test -- components/mailbox/mail-action-menus.test.tsx --reporter=verbose`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mail/components/mailbox apps/mail/components/mail/mail-list.tsx apps/mail/components/mail/thread-display.tsx apps/mail/components/mail/navbar.tsx
git commit -m "feat(mail): add folder move and label management menus"
```

### Task 8: Remove the legacy Label/Folder frontend chain

**Files:**
- Delete: `apps/mail/components/ui/sidebar-labels.tsx`
- Delete: `apps/mail/components/ui/recursive-folder.tsx`
- Delete: `apps/mail/components/labels/label-dialog.tsx`
- Delete: `apps/mail/app/(routes)/settings/labels/page.tsx`
- Delete: `apps/mail/hooks/use-labels.ts`
- Delete: `apps/mail/hooks/use-labels-search.ts`
- Modify: all remaining imports found by `git grep`.

**Interfaces:**
- Consumes: completed Mailbox components and hooks from Tasks 3-7.
- Produces: exactly one Mailbox frontend chain.

- [ ] **Step 1: Enumerate legacy references**

Run:

```bash
git grep -n -E "SidebarLabels|RecursiveFolder|LabelDialog|useLabels|useSearchLabels|capabilities.*labels|/settings/labels|/mail/label/"
```

- [ ] **Step 2: Replace remaining consumers and delete files**

Command palette and category filters may keep keyword filtering, but must not perform Mailbox navigation through query-string labels.

- [ ] **Step 3: Add an architecture guard test**

Create `apps/mail/modules/mail/mailbox-architecture.test.ts` that scans tracked source paths and rejects the deleted modules, capability branch and legacy routes.

- [ ] **Step 4: Run Mail tests**

Run: `pnpm --filter @zero/mail test -- --reporter=dot`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mail
git commit -m "refactor(mail): remove legacy label navigation"
```

### Task 9: Full verification and acceptance

**Files:**
- Modify: `docs/superpowers/plans/2026-08-02-local-mailbox-frontend-integration.md` to mark completed checkboxes.

- [ ] **Step 1: Run backend verification**

```bash
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail-core typecheck
pnpm --filter @zero/server test:mail-core
pnpm --filter @zero/server lint
```

- [ ] **Step 2: Run frontend verification**

```bash
pnpm --filter @zero/mail test -- --reporter=dot
pnpm --filter @zero/mail lint
pnpm --filter @zero/mail build
```

- [ ] **Step 3: Run source convergence checks**

```bash
git grep -n -E "SidebarLabels|RecursiveFolder|LabelDialog|capabilities.*labels|/settings/labels|/mail/label/"
git diff --check
git status --short
```

Expected: no legacy matches, no whitespace errors, and only the plan completion update remains.

- [ ] **Step 4: Perform manual Docker acceptance**

After the user rebuilds Mail and Server, verify folder/label creation, nesting, routing, counts, move semantics, batch labels, deletion constraints, account isolation and refresh persistence using the nine-step flow in the approved design.

- [ ] **Step 5: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-08-02-local-mailbox-frontend-integration.md
git commit -m "docs(mail): complete local mailbox frontend integration plan"
```
