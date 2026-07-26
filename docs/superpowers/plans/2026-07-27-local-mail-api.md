# Local Mail API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested backend-only local mailbox API facade defined in `docs/superpowers/specs/2026-07-27-local-mail-api-design.md`, without switching the current frontend or retaining a second permanent mail API.

**Architecture:** Add one `apps/server/src/modules/mail-api` public facade whose thin tRPC and HTTP adapters call application services. Application services use the `@zero/mail-core` public facade, a dedicated read-projection port, and the existing mail-outbound facade; they never call Gmail, Nango, a provider SDK, or a Drizzle table directly. JMAP-style resources provide canonical operations, while `view` and `action` remain explicit Zero extensions.

**Tech Stack:** TypeScript, tRPC, Zod, Vitest, Drizzle ORM, PostgreSQL, Cloudflare R2/Queues, `@zero/mail-core`.

## Global Constraints

- Work directly on `codex/local-mail-core` in `D:\WorkSpace\Zero`; do not create a Git worktree.
- Do not switch the existing frontend in this plan.
- Do not mount a temporary `mailV2`, `localMail`, or compatibility Router.
- The only public backend module entry is `apps/server/src/modules/mail-api/index.ts`.
- Every mailbox resource request uses the local `accountId` explicitly.
- Local mailbox operations never call a provider API and never reverse-sync to Gmail.
- Provider message IDs, thread IDs, labels, credentials, and raw errors never appear in public DTOs.
- tRPC is the JSON control plane; Blob and raw-message bytes use authenticated HTTP handlers.
- Each behavior starts with a failing test, then the smallest implementation, then verification.
- Preserve existing user changes and keep unrelated files untouched.
- The frontend cutover and deletion of the legacy `mail/drafts/labels` Routers require a separate approved plan.

## Follow-up Plan Boundaries

This plan implements the unified local mailbox API itself. The following adjacent systems remain separate because they have independent data models and acceptance criteria:

1. `mailSync.triggerIncremental/getStatus`, local recipient suggestions, ID-based HTML rendering, and mail-security verification.
2. Frontend migration, permanent App Router mounting, legacy Router deletion, Driver DTO deletion, and unused KV binding cleanup.

Neither follow-up may reintroduce provider fields into the Mail API.

---

## File Structure

The completed backend work is organized as follows:

```text
packages/mail-core/src/
├── account/
│   ├── get-account.ts
│   └── list-identities.ts
├── blob/
│   └── upload-blob.ts
├── changes/
│   ├── get-state.ts
│   └── state.ts
├── mailbox/
│   └── set-mailboxes.ts
├── message/
│   └── set-emails.ts
├── submission/
│   └── query-submissions.ts
└── thread/
    └── update-thread-emails.ts

apps/server/src/modules/mail-api/
├── index.ts
├── router.ts
├── contracts/
├── procedures/
├── application/
├── projections/
│   └── postgres/
├── routers/
├── runtime/
├── http/
└── errors/

apps/server/src/modules/mail-snooze/
├── application/
├── domain/
├── postgres/
└── runtime/
```

`packages/mail-core` owns reusable domain operations. `modules/mail-api` owns transport adaptation and API orchestration. `modules/mail-snooze` owns the persisted timer workflow while using Mail Core to change mailbox membership.

---

### Task 1: Mail Core Read Facade and Collection State

**Files:**

- Create: `packages/mail-core/src/account/get-account.ts`
- Create: `packages/mail-core/src/account/list-identities.ts`
- Create: `packages/mail-core/src/changes/get-state.ts`
- Create: `packages/mail-core/src/submission/query-submissions.ts`
- Modify: `packages/mail-core/src/account/index.ts`
- Modify: `packages/mail-core/src/changes/index.ts`
- Modify: `packages/mail-core/src/submission/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Modify: `packages/mail-core/src/store/repositories.ts`
- Modify: `packages/mail-core/src/testing/memory-mail-store.ts`
- Modify: `apps/server/src/modules/mail/postgres/repositories/account-repository.ts`
- Test: `packages/mail-core/tests/account/read-account.test.ts`
- Test: `packages/mail-core/tests/submission/query-submissions.test.ts`
- Test: `packages/mail-core/tests/changes/get-state.test.ts`

**Interfaces:**

- Consumes: `MailCoreDependencies.unitOfWork`, existing scoped repositories.
- Produces:

```ts
type MailCoreReadApi = {
  listAccounts(input: { userId: string }): Promise<MailAccountRecord[]>;
  getAccount(input: { accountId: MailAccountId }): Promise<MailAccountRecord>;
  listIdentities(input: { accountId: MailAccountId }): Promise<IdentityRecord[]>;
  getSubmission(input: {
    accountId: MailAccountId;
    submissionId: EmailSubmissionId;
  }): Promise<SubmissionRecord>;
  querySubmissions(input: {
    accountId: MailAccountId;
    status?: SubmissionStatus;
    limit: number;
    cursor: string | null;
  }): Promise<{ submissions: SubmissionRecord[]; nextCursor: string | null }>;
  getState(input: { accountId: MailAccountId; collection: ChangeCollection }): Promise<string>;
};
```

- [ ] **Step 1: Write failing scoped-read tests**

```ts
it('rejects an identity query for a missing account', async () => {
  await expect(core.listIdentities({ accountId: missingAccountId })).rejects.toMatchObject({
    code: 'ACCOUNT_NOT_FOUND',
  });
});

it('lists only accounts owned by the requested user', async () => {
  const accounts = await core.listAccounts({ userId });
  expect(accounts.map(({ id }) => id)).toEqual([accountId]);
});

it('returns only submissions from the requested account and status', async () => {
  const result = await core.querySubmissions({
    accountId,
    status: 'queued',
    limit: 20,
    cursor: null,
  });
  expect(result.submissions.map(({ id }) => id)).toEqual([queuedSubmissionId]);
});
```

- [ ] **Step 2: Run the tests and verify missing methods fail**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/account/read-account.test.ts tests/submission/query-submissions.test.ts tests/changes/get-state.test.ts
```

Expected: FAIL because the read methods are not exported by `MailCore`.

- [ ] **Step 3: Implement account, identity, submission, and state reads**

```ts
export async function getMailAccount(
  dependencies: Pick<MailCoreDependencies, 'unitOfWork'>,
  input: { accountId: MailAccountId },
): Promise<MailAccountRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    const account = await tx.accounts.findById(input.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return account;
  });
}
```

Use deterministic `(createdAt, id)` submission cursors bound to `accountId` and the optional status filter. Validate `limit` in the range `1..200`.
Add `AccountRepository.listByUser(userId)` to the memory and PostgreSQL adapters so the API account directory does not query Drizzle directly.

- [ ] **Step 4: Run focused and package tests**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/account/read-account.test.ts tests/submission/query-submissions.test.ts tests/changes/get-state.test.ts
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the read facade**

```bash
git add packages/mail-core/src packages/mail-core/tests
git commit -m "feat(mail-core): expose account and submission reads"
```

---

### Task 2: Mail Core Blob Upload

**Files:**

- Create: `packages/mail-core/src/blob/upload-blob.ts`
- Modify: `packages/mail-core/src/blob/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Test: `packages/mail-core/tests/blob/upload-blob.test.ts`
- Test: `apps/server/tests/mail-core/r2-blob-store.test.ts`

**Interfaces:**

- Consumes: `BlobStore.put/get/delete`, `BlobRepository`, account quota, SHA-256 helpers.
- Produces:

```ts
type UploadBlobInput = {
  accountId: MailAccountId;
  contentType: string;
  bytes: Uint8Array;
};

type UploadBlobResult = {
  blob: BlobRecord;
  deduplicated: boolean;
};
```

- [ ] **Step 1: Write failing upload, deduplication, rollback, and quota tests**

```ts
it('deduplicates equal account-scoped uploads', async () => {
  const first = await core.uploadBlob({ accountId, contentType: 'text/plain', bytes });
  const second = await core.uploadBlob({ accountId, contentType: 'text/plain', bytes });
  expect(second.blob.id).toBe(first.blob.id);
  expect(second.deduplicated).toBe(true);
});

it('removes a temporary object when metadata commit fails', async () => {
  store.failNextCommit();
  await expect(core.uploadBlob({ accountId, contentType: 'text/plain', bytes })).rejects.toThrow();
  expect(blobStore.listTemporary(accountId)).toEqual([]);
});
```

- [ ] **Step 2: Run the upload tests and verify failure**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/blob/upload-blob.test.ts
```

Expected: FAIL because `uploadBlob` does not exist.

- [ ] **Step 3: Implement the two-phase Blob lifecycle**

```ts
export async function uploadBlob(
  dependencies: MailCoreDependencies,
  input: UploadBlobInput,
): Promise<UploadBlobResult> {
  const prepared = await prepareBlob(
    dependencies.blobStore,
    input.accountId,
    input.bytes,
    input.contentType,
  );
  return commitPreparedUpload(dependencies, prepared);
}
```

`commitPreparedUpload` must lock the account, revalidate account status/quota, reuse an existing ready digest, insert pending metadata, promote the object, mark it ready, and compensate temporary/object writes on failure. Storage failures abort the operation rather than becoming per-item API failures.

- [ ] **Step 4: Run Blob and full Mail Core verification**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/blob
pnpm --dir apps/server exec vitest run tests/mail-core/r2-blob-store.test.ts
pnpm --filter @zero/mail-core test
```

Expected: PASS.

- [ ] **Step 5: Commit Blob upload**

```bash
git add packages/mail-core/src/blob packages/mail-core/src/mail-core.ts packages/mail-core/tests/blob apps/server/tests/mail-core/r2-blob-store.test.ts
git commit -m "feat(mail-core): add durable blob uploads"
```

---

### Task 3: Conditional and Batch Mailbox Set

**Files:**

- Create: `packages/mail-core/src/changes/assert-state.ts`
- Create: `packages/mail-core/src/mailbox/set-mailboxes.ts`
- Modify: `packages/mail-core/src/mailbox/create-mailbox.ts`
- Modify: `packages/mail-core/src/mailbox/update-mailbox.ts`
- Modify: `packages/mail-core/src/mailbox/destroy-mailbox.ts`
- Modify: `packages/mail-core/src/mailbox/types.ts`
- Modify: `packages/mail-core/src/mailbox/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Test: `packages/mail-core/tests/mailbox/set-mailboxes.test.ts`
- Test: `apps/server/tests/mail-core/mailbox-operations.integration.test.ts`

**Interfaces:**

- Consumes: existing mailbox validation and account-scoped transaction lock.
- Produces:

```ts
type SetMailboxesInput = {
  accountId: MailAccountId;
  ifInState?: string;
  create: Record<string, CreateMailboxData>;
  update: Record<MailboxId, UpdateMailboxPatch>;
  destroy: MailboxId[];
};

type SetMailboxesResult = {
  oldState: string;
  newState: string;
  created: Record<string, MailboxRecord>;
  updated: Record<string, MailboxRecord>;
  destroyed: string[];
  notCreated: Record<string, MailCoreSetError>;
  notUpdated: Record<string, MailCoreSetError>;
  notDestroyed: Record<string, MailCoreSetError>;
};
```

- [ ] **Step 1: Write failing state, field, and partial-success tests**

```ts
it('aborts the full set when ifInState is stale', async () => {
  await expect(core.setMailboxes({ ...input, ifInState: '0' })).rejects.toMatchObject({
    code: 'STATE_MISMATCH',
  });
});

it('returns a role conflict without discarding another valid update', async () => {
  const result = await core.setMailboxes({ ...input, update: mixedUpdates });
  expect(result.updated).toHaveProperty(validMailboxId);
  expect(result.notUpdated[systemMailboxId]?.code).toBe('MAILBOX_ROLE_CONFLICT');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/mailbox/set-mailboxes.test.ts
```

Expected: FAIL because transactional mailbox set and the extended fields do not exist.

- [ ] **Step 3: Extract transaction-scoped commands and implement batch set**

```ts
export async function setMailboxes(
  dependencies: MailCoreDependencies,
  input: SetMailboxesInput,
): Promise<SetMailboxesResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    const result = await applyMailboxSet(dependencies, tx, input);
    const account = await requireAccount(tx, input.accountId);
    return { ...result, oldState, newState: account.stateVersion.toString() };
  });
}
```

Extend `UpdateMailboxInput` with `color`, `sortOrder`, and `isSubscribed`. Domain validation errors become item results; storage, integrity, and transaction errors abort the whole request.

- [ ] **Step 4: Run mailbox unit and PostgreSQL tests**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/mailbox
pnpm --dir apps/server exec vitest run tests/mail-core/mailbox-operations.integration.test.ts
pnpm --filter @zero/mail-core test
```

Expected: PASS.

- [ ] **Step 5: Commit mailbox set**

```bash
git add packages/mail-core/src packages/mail-core/tests/mailbox apps/server/tests/mail-core/mailbox-operations.integration.test.ts
git commit -m "feat(mail-core): add conditional mailbox set"
```

---

### Task 4: Conditional and Batch Email Set

**Files:**

- Create: `packages/mail-core/src/message/set-emails.ts`
- Modify: `packages/mail-core/src/message/create-draft.ts`
- Modify: `packages/mail-core/src/message/update-draft.ts`
- Modify: `packages/mail-core/src/message/update-email.ts`
- Modify: `packages/mail-core/src/message/destroy-email.ts`
- Modify: `packages/mail-core/src/message/destroy-draft.ts`
- Modify: `packages/mail-core/src/message/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Test: `packages/mail-core/tests/message/set-emails.test.ts`
- Test: `apps/server/tests/mail-core/drafts.integration.test.ts`

**Interfaces:**

- Consumes: Task 2 Blob IDs, Task 3 state precondition conventions.
- Produces:

```ts
type SetEmailsInput = {
  accountId: MailAccountId;
  ifInState?: string;
  create: Record<string, DraftContent>;
  update: Record<EmailId, EmailSetPatch>;
  destroy: EmailId[];
};
```

`EmailSetPatch` has `mailboxIds`, `keywords`, and draft-only content properties with `ifDraftRevision`.

- [ ] **Step 1: Write failing draft, metadata, destroy, and partial-success tests**

```ts
it('moves an email to trash without destroying it', async () => {
  const result = await core.setEmails({ ...input, update: { [emailId]: trashPatch } });
  expect(result.updated[emailId]?.mailboxIds).toEqual([trashMailboxId]);
  expect(await core.getEmail({ accountId, emailId })).toBeDefined();
});

it('reports a stale draft revision as one failed item', async () => {
  const result = await core.setEmails({ ...input, update: staleAndValidPatches });
  expect(result.notUpdated[draftId]?.code).toBe('DRAFT_REVISION_CONFLICT');
  expect(result.updated).toHaveProperty(receivedEmailId);
});
```

- [ ] **Step 2: Run the set test and verify failure**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/message/set-emails.test.ts
```

Expected: FAIL because `setEmails` is not available.

- [ ] **Step 3: Extract transaction-scoped email commands and implement set**

```ts
export async function setEmails(
  dependencies: MailCoreDependencies,
  input: SetEmailsInput,
): Promise<SetEmailsResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    return applyEmailSetInTransaction(dependencies, tx, input, oldState);
  });
}
```

Validate all draft references before committing each item. Treat moving to Trash as mailbox membership mutation; reserve `destroy` for permanent deletion. Keep immutable content rules for received/sent emails.

- [ ] **Step 4: Run draft, message, and integration tests**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/message
pnpm --dir apps/server exec vitest run tests/mail-core/drafts.integration.test.ts tests/mail-core/changes.integration.test.ts
pnpm --filter @zero/mail-core test
```

Expected: PASS.

- [ ] **Step 5: Commit email set**

```bash
git add packages/mail-core/src packages/mail-core/tests/message apps/server/tests/mail-core
git commit -m "feat(mail-core): add conditional email set"
```

---

### Task 5: Mail API Contracts, Errors, and Runtime

**Files:**

- Create: `apps/server/src/modules/mail-api/contracts/common.ts`
- Create: `apps/server/src/modules/mail-api/contracts/account.ts`
- Create: `apps/server/src/modules/mail-api/contracts/mailbox.ts`
- Create: `apps/server/src/modules/mail-api/contracts/email.ts`
- Create: `apps/server/src/modules/mail-api/contracts/thread.ts`
- Create: `apps/server/src/modules/mail-api/contracts/identity.ts`
- Create: `apps/server/src/modules/mail-api/contracts/submission.ts`
- Create: `apps/server/src/modules/mail-api/errors/mail-api-error.ts`
- Create: `apps/server/src/modules/mail-api/errors/map-mail-core-error.ts`
- Create: `apps/server/src/modules/mail-api/runtime/create-mail-api.ts`
- Create: `apps/server/src/modules/mail-api/procedures/mail-account-procedure.ts`
- Test: `apps/server/src/modules/mail-api/contracts/contracts.test.ts`
- Test: `apps/server/src/modules/mail-api/errors/map-mail-core-error.test.ts`
- Test: `apps/server/src/modules/mail-api/procedures/mail-account-procedure.test.ts`

**Interfaces:**

- Consumes: Tasks 1–4 Mail Core facade, `createDb`, `R2BlobStore`, `privateProcedure`.
- Produces:

```ts
type MailApiContext = {
  account: MailAccountRecord;
  core: MailCore;
  db: DB;
  close(): Promise<void>;
};

function createMailApiRuntime(db: DB, runtimeEnv: ZeroEnv): MailApiRuntime;
```

`mailSessionProcedure` authenticates the user without requiring an account and serves `account.list`. `mailAccountProcedure` extends it with explicit account ownership and active-status validation.

- [ ] **Step 1: Write failing contract and account-isolation tests**

```ts
it('does not expose provider or storage fields in an Email DTO', () => {
  expect(Object.keys(emailSchema.parse(sample))).not.toContain('remoteEmailId');
  expect(Object.keys(emailSchema.parse(sample))).not.toContain('objectKey');
});

it('maps a cross-account reference to public NOT_FOUND', () => {
  expect(mapMailCoreError(new MailCoreError('CROSS_ACCOUNT_REFERENCE'))).toMatchObject({
    code: 'NOT_FOUND',
    retryable: false,
  });
});
```

- [ ] **Step 2: Run tests and verify missing modules fail**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/contracts/contracts.test.ts src/modules/mail-api/errors/map-mail-core-error.test.ts src/modules/mail-api/procedures/mail-account-procedure.test.ts
```

Expected: FAIL because `modules/mail-api` does not exist.

- [ ] **Step 3: Implement schemas, runtime, and account procedure**

```ts
export const mailSessionProcedure = privateProcedure;

export const mailAccountProcedure = mailSessionProcedure
  .input(z.object({ accountId: mailAccountIdSchema }).passthrough())
  .use(async ({ ctx, input, next }) => {
    const runtime = await openOwnedMailApiRuntime(ctx.sessionUser.id, input.accountId, ctx.c.env);
    try {
      return await next({ ctx: { ...ctx, mailApi: runtime } });
    } finally {
      await runtime.close();
    }
  });
```

Use stable public error data `{ code, retryable, requestId }`. Dates serialize as ISO strings and bigint values as decimal strings.

- [ ] **Step 4: Run focused tests, lint, and typecheck for changed scope**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api
pnpm exec prettier --check apps/server/src/modules/mail-api
pnpm --dir apps/server exec eslint src/modules/mail-api
```

Expected: PASS.

- [ ] **Step 5: Commit the API foundation**

```bash
git add apps/server/src/modules/mail-api
git commit -m "feat(mail-api): add contracts and account runtime"
```

---

### Task 6: Account, Mailbox, Thread, and Identity Routers

**Files:**

- Create: `apps/server/src/modules/mail-api/application/account-service.ts`
- Create: `apps/server/src/modules/mail-api/application/mailbox-service.ts`
- Create: `apps/server/src/modules/mail-api/application/thread-service.ts`
- Create: `apps/server/src/modules/mail-api/application/identity-service.ts`
- Create: `apps/server/src/modules/mail-api/routers/account.ts`
- Create: `apps/server/src/modules/mail-api/routers/mailbox.ts`
- Create: `apps/server/src/modules/mail-api/routers/thread.ts`
- Create: `apps/server/src/modules/mail-api/routers/identity.ts`
- Create: `packages/mail-core/src/account/set-identities.ts`
- Modify: `packages/mail-core/src/account/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Test: `packages/mail-core/tests/account/set-identities.test.ts`
- Test: `apps/server/src/modules/mail-api/routers/resource-routers.test.ts`

**Interfaces:**

- Consumes: Task 5 `mailAccountProcedure`, Mail Core reads/sets/changes.
- Produces:

```text
mail.account.list/get
mail.mailbox.get/set/changes
mail.thread.get/changes
mail.identity.get/set/changes
```

- [ ] **Step 1: Write failing Router caller tests**

```ts
it('returns account-scoped mailbox state and records', async () => {
  const caller = createTestCaller({ userId, runtime });
  const result = await caller.mailbox.get({ accountId });
  expect(result).toMatchObject({ accountId, state: expect.any(String) });
  expect(result.list[0]).not.toHaveProperty('normalizedName');
});

it('returns partial Identity set failures without changing the default twice', async () => {
  const result = await core.setIdentities(identitySetInput);
  expect(result.updated).toHaveProperty(validIdentityId);
  expect(result.notUpdated[conflictingIdentityId]?.code).toBe('IDENTITY_DEFAULT_CONFLICT');
});
```

- [ ] **Step 2: Run the Router test and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/routers/resource-routers.test.ts
```

Expected: FAIL because the resource Routers are not assembled.

- [ ] **Step 3: Implement thin Routers and DTO services**

```ts
export const mailboxRouter = router({
  get: mailAccountProcedure.query(({ input, ctx }) => ctx.mailApi.mailbox.get(input)),
  set: mailAccountProcedure.mutation(({ input, ctx }) => ctx.mailApi.mailbox.set(input)),
  changes: mailAccountProcedure.query(({ input, ctx }) => ctx.mailApi.mailbox.changes(input)),
});
```

Resource services map Core records to public DTOs and never query `db` directly. Implement `setIdentities` with the same account lock, `ifInState`, per-item error, and old/new state conventions as Mailbox Set.

- [ ] **Step 4: Run resource Router and Mail Core tests**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/routers/resource-routers.test.ts
pnpm --filter @zero/mail-core exec vitest run tests/account/set-identities.test.ts
pnpm --filter @zero/mail-core test
```

Expected: PASS.

- [ ] **Step 5: Commit resource Routers**

```bash
git add apps/server/src/modules/mail-api
git commit -m "feat(mail-api): expose mailbox resources"
```

---

### Task 7: Email Body Projection and Email Router

**Files:**

- Create: `apps/server/src/modules/mail-api/application/email-service.ts`
- Create: `apps/server/src/modules/mail-api/application/email-dto.ts`
- Create: `apps/server/src/modules/mail-api/application/body-values.ts`
- Create: `apps/server/src/modules/mail-api/routers/email.ts`
- Modify: `packages/mail-core/src/search/types.ts`
- Modify: `packages/mail-core/src/message/query-emails.ts`
- Modify: `apps/server/src/modules/mail/search/postgres-search-store.ts`
- Test: `packages/mail-core/tests/message/query-emails.test.ts`
- Test: `apps/server/tests/mail-core/search.integration.test.ts`
- Test: `apps/server/src/modules/mail-api/application/email-dto.test.ts`
- Test: `apps/server/src/modules/mail-api/routers/email-router.test.ts`

**Interfaces:**

- Consumes: `MailCore.getEmail/queryEmails/setEmails/getChanges/readBlob`.
- Produces:

```text
mail.email.get
mail.email.query
mail.email.set
mail.email.changes
```

- [ ] **Step 1: Write failing selective-body and patch tests**

```ts
it('does not read body blobs when body values are not requested', async () => {
  await service.get({ accountId, ids: [emailId] });
  expect(core.readBlob).not.toHaveBeenCalled();
});

it('maps JMAP keyword null to a remove-keyword patch', async () => {
  await service.set({
    accountId,
    update: { [emailId]: { keywords: { $seen: null } } },
  });
  expect(core.setEmails).toHaveBeenCalledWith(
    expect.objectContaining({ update: expect.objectContaining({ [emailId]: expect.anything() }) }),
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/application/email-dto.test.ts src/modules/mail-api/routers/email-router.test.ts
```

Expected: FAIL because Email DTO and Router are absent.

- [ ] **Step 3: Implement property selection and bounded body reads**

```ts
const bodyValue = async (
  core: Pick<MailCore, 'readBlob'>,
  accountId: MailAccountId,
  blobId: BlobId,
  maxBytes: number,
): Promise<BodyValueDto> => {
  const bytes = await core.readBlob({ accountId, blobId });
  const truncated = bytes.byteLength > maxBytes;
  return {
    value: decoder.decode(bytes.subarray(0, maxBytes)),
    isTruncated: truncated,
  };
};
```

Map mailbox and keyword arrays to `Record<string, true>`. Keep raw/provider/storage fields out of the response.
Extend the Core query filter and PostgreSQL Search Store with `notKeyword` and `lifecycle`; preserve account-scoped keyset pagination and bind both fields into the cursor signature.

- [ ] **Step 4: Run Email API and Core tests**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/application src/modules/mail-api/routers/email-router.test.ts
pnpm --filter @zero/mail-core exec vitest run tests/message tests/blob
pnpm --dir apps/server exec vitest run tests/mail-core/search.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Email API**

```bash
git add apps/server/src/modules/mail-api
git commit -m "feat(mail-api): expose email resources"
```

---

### Task 8: Submission Router and Outbound Boundary

**Files:**

- Create: `apps/server/src/modules/mail-api/application/submission-service.ts`
- Create: `apps/server/src/modules/mail-api/routers/submission.ts`
- Modify: `apps/server/src/runtime/mail/outbound.ts`
- Test: `apps/server/src/modules/mail-api/application/submission-service.test.ts`
- Test: `apps/server/src/modules/mail-api/routers/submission-router.test.ts`

**Interfaces:**

- Consumes: Task 1 submission reads and existing `MailOutboundRuntime.submit/cancel`.
- Produces:

```text
mail.submission.get/query/set/changes
createMailOutboundRuntimeForEnvironment(db, env)
```

- [ ] **Step 1: Write failing idempotency and cancellation tests**

```ts
it('accepts a submission by enqueueing through Mail Outbound', async () => {
  const result = await service.set(createInput);
  expect(outbound.submit).toHaveBeenCalledWith(
    expect.objectContaining({ accountId, emailId, identityId, idempotencyKey }),
  );
  expect(result.created.clientRequest.status).toBe('queued');
});

it('does not report provider acceptance before worker finalization', async () => {
  const result = await service.get({ accountId, ids: [submissionId] });
  expect(result.list[0]?.status).toBe('queued');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/application/submission-service.test.ts src/modules/mail-api/routers/submission-router.test.ts
```

Expected: FAIL because the submission API service is missing.

- [ ] **Step 3: Implement the service through the public outbound runtime**

```ts
export const createSubmissionService = (
  core: MailCore,
  outbound: Pick<MailOutboundRuntime, 'submit' | 'cancel'>,
): SubmissionService => ({
  create: (input) => outbound.submit(toCoreSubmissionInput(input)),
  cancel: (input) => outbound.cancel(toCoreCancelInput(input)),
  get: (input) => getSubmissionDtos(core, input),
  query: (input) => querySubmissionDtos(core, input),
  changes: (input) => core.getChanges({ ...input, collection: 'email_submission' }),
});
```

Rename the worker-specific runtime constructor to the environment-neutral name and reuse it from both Worker and API composition.

- [ ] **Step 4: Run submission, outbound, and API tests**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/submission
pnpm --dir apps/server exec vitest run src/modules/mail-api src/modules/mail-outbound src/runtime/mail/outbound.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Submission API**

```bash
git add apps/server/src/modules/mail-api apps/server/src/runtime/mail/outbound.ts
git commit -m "feat(mail-api): expose email submissions"
```

---

### Task 9: PostgreSQL Thread Read Projections

**Files:**

- Create: `apps/server/src/modules/mail-api/contracts/view.ts`
- Create: `apps/server/src/modules/mail-api/projections/port.ts`
- Create: `apps/server/src/modules/mail-api/projections/postgres/thread-page.ts`
- Create: `apps/server/src/modules/mail-api/projections/postgres/thread-detail.ts`
- Create: `apps/server/src/modules/mail-api/application/thread-view-service.ts`
- Create: `apps/server/src/modules/mail-api/routers/view.ts`
- Test: `apps/server/src/modules/mail-api/application/thread-view-service.test.ts`
- Test: `apps/server/tests/mail-core/mail-api-thread-projection.integration.test.ts`

**Interfaces:**

- Consumes: `mail.thread`, `mail.email`, `mail.mailbox_thread`, existing search semantics.
- Produces:

```ts
interface MailViewProjection {
  threadPage(input: ThreadPageInput): Promise<ThreadPageResult>;
  threadDetail(input: ThreadDetailInput): Promise<ThreadDetailResult>;
}
```

- [ ] **Step 1: Write failing page, search, cursor, and detail tests**

```ts
it('returns one summary row per thread without loading body blobs', async () => {
  const page = await projection.threadPage({ accountId, mailboxId: inboxId, limit: 50 });
  expect(page.items).toHaveLength(2);
  expect(page.items[0]).toMatchObject({
    id: threadId,
    latestEmail: { id: latestEmailId },
  });
});

it('rejects a cursor reused with a different mailbox', async () => {
  await expect(
    projection.threadPage({ accountId, mailboxId: archiveId, cursor: inboxCursor, limit: 50 }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});
```

- [ ] **Step 2: Run projection tests and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/application/thread-view-service.test.ts tests/mail-core/mail-api-thread-projection.integration.test.ts
```

Expected: FAIL because the projection port and PostgreSQL adapter are absent.

- [ ] **Step 3: Implement deterministic SQL projections**

```ts
export const createPostgresMailViewProjection = (db: DB): MailViewProjection => ({
  threadPage: (input) => queryThreadPage(db, input),
  threadDetail: (input) => queryThreadDetail(db, input),
});
```

Use `(latestReceivedAt DESC, threadId DESC)` keyset pagination. Bind the signed Cursor to `accountId`, mailbox/filter/lifecycle, and sort. Query only local schemas and return projection records to the application DTO mapper.

- [ ] **Step 4: Run projection and scale tests**

Run:

```bash
pnpm --dir apps/server exec vitest run tests/mail-core/mail-api-thread-projection.integration.test.ts tests/mail-core/thread-query.integration.test.ts tests/mail-core/mail-core-scale.integration.test.ts
pnpm --dir apps/server exec vitest run src/modules/mail-api
```

Expected: PASS with a bounded query count independent of page length.

- [ ] **Step 5: Commit read projections**

```bash
git add apps/server/src/modules/mail-api apps/server/tests/mail-core/mail-api-thread-projection.integration.test.ts
git commit -m "feat(mail-api): add thread read projections"
```

---

### Task 10: Transactional Thread Actions

**Files:**

- Create: `packages/mail-core/src/thread/update-thread-emails.ts`
- Modify: `packages/mail-core/src/thread/index.ts`
- Modify: `packages/mail-core/src/mail-core.ts`
- Create: `apps/server/src/modules/mail-api/contracts/action.ts`
- Create: `apps/server/src/modules/mail-api/application/thread-action-service.ts`
- Create: `apps/server/src/modules/mail-api/routers/action.ts`
- Test: `packages/mail-core/tests/thread/update-thread-emails.test.ts`
- Test: `apps/server/src/modules/mail-api/routers/action-router.test.ts`

**Interfaces:**

- Consumes: transaction-scoped Email patching from Task 4.
- Produces:

```ts
updateThreadEmails(input: {
  accountId: MailAccountId;
  threadIds: ThreadId[];
  ifInState?: string;
  addMailboxIds: MailboxId[];
  removeMailboxIds: MailboxId[];
  addKeywords: Keyword[];
  removeKeywords: Keyword[];
}): Promise<ThreadActionResult>;
```

- [ ] **Step 1: Write failing atomic expansion and cross-account tests**

```ts
it('updates every retained email in each requested thread', async () => {
  const result = await core.updateThreadEmails(markReadInput);
  expect(result.updatedThreadIds).toEqual([threadId]);
  expect(await keywordsForThread(threadId)).not.toContain('$seen');
});

it('does not reveal a thread owned by another account', async () => {
  const result = await service.updateThreads(crossAccountInput);
  expect(result.failed[foreignThreadId]?.code).toBe('NOT_FOUND');
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/thread/update-thread-emails.test.ts
pnpm --dir apps/server exec vitest run src/modules/mail-api/routers/action-router.test.ts
```

Expected: FAIL because the thread action is absent.

- [ ] **Step 3: Implement one account-scoped transaction**

```ts
export async function updateThreadEmails(
  dependencies: MailCoreDependencies,
  input: UpdateThreadEmailsInput,
): Promise<UpdateThreadEmailsResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    return applyThreadPatches(dependencies, tx, input, oldState);
  });
}
```

Deduplicate Thread IDs and Email IDs. Apply aggregate counters and Changes exactly once per changed entity.

- [ ] **Step 4: Run Thread, aggregate, and API tests**

Run:

```bash
pnpm --filter @zero/mail-core exec vitest run tests/thread tests/mailbox/email-aggregate-delta.test.ts
pnpm --dir apps/server exec vitest run src/modules/mail-api/routers/action-router.test.ts tests/mail-core/incremental-aggregates.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit thread actions**

```bash
git add packages/mail-core apps/server/src/modules/mail-api
git commit -m "feat(mail-api): add transactional thread actions"
```

---

### Task 11: Authenticated Blob and Raw-Message HTTP Handlers

**Files:**

- Create: `apps/server/src/modules/mail-api/http/index.ts`
- Create: `apps/server/src/modules/mail-api/http/upload-blob.ts`
- Create: `apps/server/src/modules/mail-api/http/download-blob.ts`
- Create: `apps/server/src/modules/mail-api/http/download-raw-email.ts`
- Create: `apps/server/src/modules/mail-api/http/authorize-mail-account.ts`
- Test: `apps/server/src/modules/mail-api/http/blob-routes.test.ts`

**Interfaces:**

- Consumes: Task 2 `uploadBlob`, `readBlob`, Mail API account authorization.
- Produces:

```ts
function registerMailBlobRoutes(app: Hono<HonoContext>): void;
```

Routes:

```text
POST /api/mail/accounts/:accountId/blobs
GET  /api/mail/accounts/:accountId/blobs/:blobId/:filename
GET  /api/mail/accounts/:accountId/emails/:emailId/raw
```

- [ ] **Step 1: Write failing authorization and header tests**

```ts
it('returns 404 for a cross-account Blob', async () => {
  const response = await app.request(foreignBlobUrl, authenticatedRequest);
  expect(response.status).toBe(404);
});

it('sets safe download headers', async () => {
  const response = await app.request(blobUrl, authenticatedRequest);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-disposition')).toContain('attachment');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/http/blob-routes.test.ts
```

Expected: FAIL because HTTP handlers are absent.

- [ ] **Step 3: Implement streaming-safe authenticated handlers**

```ts
const safeDownloadHeaders = (type: string, size: bigint, filename: string) => ({
  'Content-Type': type,
  'Content-Length': size.toString(),
  'Content-Disposition': contentDisposition(filename),
  'X-Content-Type-Options': 'nosniff',
});
```

Enforce upload size before buffering, normalize content type, authorize every request, and obtain raw message bytes through the Email `blobId` plus `readBlob`.

- [ ] **Step 4: Run HTTP, Blob, and security checks**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/http packages/mail-core/tests/blob
pnpm --dir apps/server exec eslint src/modules/mail-api/http
```

Expected: PASS.

- [ ] **Step 5: Commit Blob HTTP handlers**

```bash
git add apps/server/src/modules/mail-api/http
git commit -m "feat(mail-api): add authenticated blob routes"
```

---

### Task 12: Persisted Local Snooze and Due Worker

**Files:**

- Create: `apps/server/src/modules/mail-snooze/domain/snooze.ts`
- Create: `apps/server/src/modules/mail-snooze/application/snooze-threads.ts`
- Create: `apps/server/src/modules/mail-snooze/application/unsnooze-threads.ts`
- Create: `apps/server/src/modules/mail-snooze/application/wake-due-snoozes.ts`
- Create: `apps/server/src/modules/mail-snooze/postgres/schema.ts`
- Create: `apps/server/src/modules/mail-snooze/postgres/repository.ts`
- Create: `apps/server/src/modules/mail-snooze/runtime/create-mail-snooze.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/modules/mail-api/contracts/action.ts`
- Modify: `apps/server/src/modules/mail-api/application/thread-action-service.ts`
- Modify: `apps/server/src/modules/mail-api/routers/action.ts`
- Modify: `apps/server/src/main.ts:1437`
- Test: `apps/server/src/modules/mail-snooze/application/snooze-threads.test.ts`
- Test: `apps/server/src/modules/mail-snooze/application/wake-due-snoozes.test.ts`
- Test: `apps/server/tests/mail-core/snooze-schema.integration.test.ts`

**Interfaces:**

- Consumes: Task 10 Thread actions and the server scheduled runtime.
- Produces:

```ts
type SnoozeRecord = {
  accountId: MailAccountId;
  threadId: ThreadId;
  wakeAt: Date;
  restoreMailboxIds: MailboxId[];
  status: 'scheduled' | 'waking' | 'completed' | 'canceled';
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Routes:

```text
mail.action.snoozeThreads
mail.action.unsnoozeThreads
```

- [ ] **Step 1: Write failing persistence and due-wakeup tests**

Write:

```ts
it('stores restore mailboxes and removes Inbox locally', async () => {
  await runtime.snooze({ accountId, threadIds: [threadId], wakeAt });
  expect(await repository.find(accountId, threadId)).toMatchObject({
    restoreMailboxIds: [inboxId],
    status: 'scheduled',
  });
});

it('wakes a due snooze once after lease recovery', async () => {
  await runtime.wakeDue({ now: wakeAt, limit: 100 });
  await runtime.wakeDue({ now: wakeAt, limit: 100 });
  expect(await membership(threadId)).toContain(inboxId);
});
```

- [ ] **Step 2: Run tests and verify schema/runtime failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-snooze tests/mail-core/snooze-schema.integration.test.ts
```

Expected: FAIL because the Snooze table and runtime do not exist.

- [ ] **Step 3: Implement the leased local Snooze workflow**

```ts
export const createMailSnoozeRuntime = (dependencies: MailSnoozeDependencies) => ({
  snooze: (input: SnoozeThreadsInput) => snoozeThreads(input, dependencies),
  unsnooze: (input: UnsnoozeThreadsInput) => unsnoozeThreads(input, dependencies),
  wakeDue: (input: WakeDueInput) => wakeDueSnoozes(input, dependencies),
});
```

Create the table through the current Drizzle template schema, not a development timeline migration. Claim due rows with a lease, restore membership through Mail Core, and mark completion idempotently. Remove no existing KV configuration in this backend-only phase; the later frontend/legacy-removal phase removes unused legacy KV bindings.

- [ ] **Step 4: Run Snooze, schema, and aggregate tests**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-snooze tests/mail-core/snooze-schema.integration.test.ts tests/mail-core/incremental-aggregates.integration.test.ts
pnpm --dir apps/server test:mail-core
```

Expected: PASS.

- [ ] **Step 5: Commit Snooze**

```bash
git add apps/server/src/modules/mail-snooze apps/server/src/modules/mail-api apps/server/src/db/schema.ts apps/server/tests/mail-core
git commit -m "feat(mail-api): add local snooze workflow"
```

---

### Task 13: Unified Mail API Facade and Architecture Guard

**Files:**

- Create: `apps/server/src/modules/mail-api/router.ts`
- Create: `apps/server/src/modules/mail-api/index.ts`
- Create: `apps/server/src/modules/mail-api/mail-api.contract.test.ts`
- Modify: `apps/server/src/mail-architecture.test.ts`
- Do not modify: `apps/server/src/trpc/index.ts`

**Interfaces:**

- Consumes: Tasks 5–12 Routers and HTTP registration.
- Produces:

```ts
export const mailApiRouter = router({
  account: accountRouter,
  mailbox: mailboxRouter,
  email: emailRouter,
  thread: threadRouter,
  identity: identityRouter,
  submission: submissionRouter,
  view: viewRouter,
  action: actionRouter,
});

export { registerMailBlobRoutes } from './http';
```

- [ ] **Step 1: Write failing facade and import-boundary tests**

```ts
it('exports one nested Mail API Router', () => {
  expect(Object.keys(mailApiRouter._def.record)).toEqual([
    'account',
    'mailbox',
    'email',
    'thread',
    'identity',
    'submission',
    'view',
    'action',
  ]);
});

it('contains no provider dependency below modules/mail-api', () => {
  expect(forbiddenImports).toEqual([]);
});
```

- [ ] **Step 2: Run contract and architecture tests and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api/mail-api.contract.test.ts src/mail-architecture.test.ts
```

Expected: FAIL because the unified facade is not assembled.

- [ ] **Step 3: Assemble the sole public module**

```ts
export { mailApiRouter } from './router';
export { registerMailBlobRoutes } from './http';
```

The architecture test must reject imports from Mail API to `mail-channel`, Gmail, Nango, integrations credentials, or legacy Driver modules. It must also reject server imports of Mail API internal paths outside `modules/mail-api`.

- [ ] **Step 4: Run complete backend verification**

Run:

```bash
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail-core typecheck
pnpm --dir apps/server test:mail-core
pnpm --dir apps/server exec vitest run src/modules/mail-api src/modules/mail-snooze src/modules/mail-outbound src/mail-architecture.test.ts
pnpm exec prettier --check packages/mail-core apps/server/src/modules/mail-api apps/server/src/modules/mail-snooze
pnpm --dir apps/server exec eslint src/modules/mail-api src/modules/mail-snooze
```

Expected: all focused tests and checks PASS. If the repository-wide server typecheck still reports historical errors, record the unchanged baseline and require zero errors from changed files.

- [ ] **Step 5: Commit the unified facade**

```bash
git add apps/server/src/modules/mail-api apps/server/src/mail-architecture.test.ts
git commit -m "feat(mail-api): expose unified local mail facade"
```

---

### Task 14: Backend Acceptance and Handoff

**Files:**

- Create: `docs/superpowers/plans/2026-07-27-local-mail-api-acceptance.md`
- Modify only if verification finds a defect: files introduced by Tasks 1–13.

**Interfaces:**

- Consumes: all plan deliverables.
- Produces: an evidence-backed backend acceptance record and the exact prerequisites for the separate frontend-cutover plan.

- [ ] **Step 1: Write the acceptance checklist before final verification**

```markdown
- [ ] Mail API has one public module export.
- [ ] Canonical resources use explicit local accountId.
- [ ] Cross-account reads and Blob downloads do not leak existence.
- [ ] Batch Set supports state preconditions and partial item failures.
- [ ] Thread pages have bounded query count.
- [ ] Submission creation enters Mail Outbound and does not claim provider success.
- [ ] Snooze state is PostgreSQL-backed and wakeup is idempotent.
- [ ] No Mail API code imports a provider.
- [ ] Legacy Router remains unchanged and no temporary v2 Router exists.
```

- [ ] **Step 2: Run the canonical verification suite from a clean process**

Run:

```bash
pnpm test:mail-core
pnpm --dir apps/server exec vitest run src/modules/mail-api src/modules/mail-snooze src/modules/mail-outbound src/mail-architecture.test.ts
pnpm --filter @zero/mail-core typecheck
pnpm exec prettier --check .
git diff --check
git status --short
```

Expected: all relevant tests pass, formatting passes, and only the acceptance document is uncommitted.

- [ ] **Step 3: Inspect schema and API surface mechanically**

Run:

```powershell
Get-ChildItem -Path apps/server/src/modules/mail-api -Recurse -File | Select-String -Pattern 'gmail|nango|historyId|remoteMessageId|objectKey'
Select-String -Path apps/server/src/trpc/index.ts -Pattern 'mailApi|mailV2|localMail'
```

Expected: no provider/storage leak in Mail API; no temporary Router is mounted in the existing App Router.

- [ ] **Step 4: Record exact evidence and remaining frontend work**

```markdown
## Result

Backend local Mail API: accepted

## Deferred to frontend cutover

- Mount `mailApiRouter` as the permanent `mail` namespace.
- Replace frontend `mail/drafts/labels` calls.
- Remove legacy Routers, Driver DTOs, Durable Object mail state, and unused KV bindings.
```

- [ ] **Step 5: Commit acceptance evidence**

```bash
git add docs/superpowers/plans/2026-07-27-local-mail-api-acceptance.md
git commit -m "docs(mail-api): record backend acceptance"
```
