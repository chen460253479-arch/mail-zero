# Important and Star Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make important and star toggles persist reliably and render consistently during the undo window.

**Architecture:** Keep Server and Mail Core contracts unchanged. Make the Mail UI's keyword command builder unconditional for idempotent keyword operations, and project pending important/star state into immutable display-message copies before rendering `MailDisplay`.

**Tech Stack:** TypeScript, React 19, TanStack Query, Jotai, tRPC, Vitest.

## Global Constraints

- Do not change PostgreSQL schemas or existing email data.
- Keep `ifInState` optional in Server API and Mail Core.
- Do not change folder, label, or move concurrency behavior.
- Do not change the undo-window duration.
- Preserve failure rollback and success refresh behavior.

---

### Task 1: Make UI keyword commands unconditional

**Files:**

- Modify: `apps/mail/modules/mail/mutations/thread-action-input.test.ts`
- Modify: `apps/mail/modules/mail/mutations/thread-action-input.ts`
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`

**Interfaces:**

- Consumes: `buildKeywordThreadAction({ accountId, threadIds, keyword, enabled, clientMutationId })`
- Produces: an `updateThreads` input that never contains `ifInState` for read, important, or star commands.

- [x] **Step 1: Write the failing regression test**

Create an input variable containing a stale `ifInState`, pass it to `buildKeywordThreadAction`, and assert that the result omits `ifInState` while preserving the requested keyword mutation.

- [x] **Step 2: Run the test and verify red**

Run:

```powershell
pnpm --dir apps/mail exec vitest run modules/mail/mutations/thread-action-input.test.ts
```

Expected: the keyword test fails because the current result contains `ifInState: 'stale-state'`.

- [x] **Step 3: Implement the minimal behavior**

Split the action input types so `buildKeywordThreadAction` consumes the base command without `ifInState`, while move and label builders retain the optional state type. Remove `mailboxState` from the `updateKeyword` call in `useOptimisticActions`.

- [x] **Step 4: Run the focused test and verify green**

Run the Step 2 command. Expected: all thread action input tests pass.

### Task 2: Project important and star optimistic state into detail tags

**Files:**

- Create: `apps/mail/components/mail/optimistic-keyword-tags.ts`
- Create: `apps/mail/components/mail/optimistic-keyword-tags.test.ts`
- Modify: `apps/mail/components/mail/thread-display.tsx`

**Interfaces:**

- Produces: `applyOptimisticKeywordTags(tags, { important, starred }): Label[]`
- `important` and `starred` are `boolean | null`; `null` preserves API data, `true` ensures the keyword tag exists, and `false` removes it.

- [x] **Step 1: Write failing projection tests**

Cover these behaviors with real label arrays:

```ts
applyOptimisticKeywordTags(tags, { important: false, starred: false });
applyOptimisticKeywordTags(tags, { important: true, starred: true });
applyOptimisticKeywordTags(tags, { important: null, starred: null });
```

Assert removal, deduplicated addition, preservation of unrelated labels, and no mutation of the source array.

- [x] **Step 2: Run the test and verify red**

Run:

```powershell
pnpm --dir apps/mail exec vitest run components/mail/optimistic-keyword-tags.test.ts
```

Expected: failure because `applyOptimisticKeywordTags` is not implemented.

- [x] **Step 3: Implement the pure projection**

Implement a non-mutating tag transformation for `$important`/`IMPORTANT` and `$flagged`/`STARRED`, preserving every unrelated label.

- [x] **Step 4: Connect the projection to thread detail**

In `thread-display.tsx`, derive display-message copies from `emailData.messages` and the current `useOptimisticThreadState` values. Render those copies through `MailDisplay`; leave the query cache and DTOs unchanged.

- [x] **Step 5: Run the projection tests and verify green**

Run the Step 2 command. Expected: all projection tests pass.

### Task 3: Verify the complete change

**Files:**

- Verify all files modified in Tasks 1 and 2.

- [x] **Step 1: Run focused Mail tests**

```powershell
pnpm --dir apps/mail exec vitest run modules/mail/mutations/thread-action-input.test.ts components/mail/optimistic-keyword-tags.test.ts lib/thread-actions.test.ts
```

- [x] **Step 2: Run the Mail test suite**

```powershell
pnpm --dir apps/mail test
```

- [x] **Step 3: Run related Server tests**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-api
```

- [x] **Step 4: Run production builds**

```powershell
pnpm --dir apps/mail build
pnpm --dir apps/server build
```

- [x] **Step 5: Inspect the final diff**

Run `git diff --check` and `git status --short`. Confirm no generated artifacts or unrelated files were introduced.
