# Mail Account Cache Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a newly bound mailbox is immediately available to draft and send flows without reloading the page.

**Architecture:** Add one shared React Query invalidation helper whose input requires connection-list, default-connection, and local-account query keys. Use it from both dynamic mailbox binding dialogs so all related cached resources refresh as one contract.

**Tech Stack:** TypeScript, React, TanStack Query, Vitest.

## Global Constraints

- Do not modify backend, database, Gmail delivery, or persisted mailbox data.
- Do not clear the complete query cache.
- Cover both Nango and manual IMAP/SMTP binding paths.
- Follow test-driven development and verify the regression test fails before implementation.

---

### Task 1: Refresh all mailbox resources after binding

**Files:**

- Create: `apps/mail/modules/mail-connections/refresh-mailbox-queries.test.ts`
- Create: `apps/mail/modules/mail-connections/refresh-mailbox-queries.ts`
- Modify: `apps/mail/components/connection/nango-connect-dialog.tsx`
- Modify: `apps/mail/components/connection/imap-smtp-connect-dialog.tsx`

**Interfaces:**

- Consumes: `QueryClient` and three required TanStack `QueryKey` values.
- Produces: `refreshMailboxConnectionQueries(queryClient, queryKeys): Promise<void>`.

- [ ] **Step 1: Write the failing regression test**

Create three cached queries in a real `QueryClient`, call
`refreshMailboxConnectionQueries`, and assert that each query state has
`isInvalidated === true`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @zero/mail test --run modules/mail-connections/refresh-mailbox-queries.test.ts
```

Expected: failure because `refresh-mailbox-queries` does not exist.

- [ ] **Step 3: Implement the minimal shared refresh function**

Implement a function that awaits `queryClient.invalidateQueries` for the required
connection-list, default-connection, and mail-account-list query keys.

- [ ] **Step 4: Use the helper in both binding dialogs**

Replace each two-query `Promise.all` block with the shared function and pass:

```ts
{
  connectionList: trpc.connections.list.queryKey(),
  defaultConnection: trpc.connections.getDefault.queryKey(),
  mailAccountList: trpc.mail.account.list.queryKey(),
}
```

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```powershell
pnpm --filter @zero/mail test --run modules/mail-connections/refresh-mailbox-queries.test.ts
pnpm --filter @zero/mail test --run
pnpm --filter @zero/mail exec tsc --noEmit
```

Expected: all commands exit successfully with zero failed tests and zero type errors.
