# Local Mail Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a provider-independent, JMAP-compatible local mail core for Zero with PostgreSQL metadata, immutable RFC 5322/MIME blobs, local mailbox state, drafts, submissions, changes, search, and automated tests.

**Architecture:** `packages/mail-core` contains pure TypeScript domain behavior and storage ports. `apps/server/src/modules/mail` implements those ports with Drizzle/PostgreSQL and R2 without exposing Gmail, Cloudflare, tRPC, or provider IDs to the core. Existing frontend and provider-driven mail paths remain unchanged in this phase.

**Tech Stack:** TypeScript 5.8, Node.js 22+, pnpm 10.15, Vitest 3.2, Zod 3, ULID 3, postal-mime 2.7.5, mimetext 3.0.27, Drizzle ORM 0.43, PostgreSQL, Cloudflare R2.

## Global Constraints

- Work directly on branch `codex/local-mail-core` in `D:\WorkSpace\Zero`; do not create a Git worktree.
- Preserve the existing untracked `AGENTS.md` and all unrelated user changes.
- Follow `docs/superpowers/specs/2026-07-25-local-mail-core-design.md`.
- Use JMAP RFC 8620/8621 as the normative behavior source and Stalwart only as an external behavior and module-boundary reference.
- Do not copy or line-by-line translate Stalwart AGPL-3.0/SELv2 source or tests.
- Use 2-space indentation, single quotes, semicolons, and a 100-character line width.
- Do not run project-wide lint or format commands.
- Do not modify existing frontend behavior or existing Gmail/Outlook driver behavior.
- Do not make Provider network requests from `packages/mail-core`.
- Do not store Provider IDs as local primary keys.
- Do not store OAuth credentials, Raw MIME, email bodies, or signed object URLs in errors or logs.
- All new SQL tables use the existing `mail0_` prefix.
- Ordinary received/sent Email content is immutable; only `$draft` Email content may be revised.
- Every visible Email belongs to at least one Mailbox and exactly one Thread.
- Every state-changing transaction increments one account state version and records Changes atomically.
- Write the failing focused test before implementation, then run only focused tests and checks.
- Commit only the files named by the current task.

---

## File Structure

### Pure core package

```text
packages/mail-core/
├── package.json
├── tsconfig.json
├── src/
│   ├── types/
│   │   ├── ids.ts
│   │   ├── address.ts
│   │   ├── keyword.ts
│   │   ├── special-use.ts
│   │   ├── errors.ts
│   │   └── index.ts
│   ├── account/
│   ├── mailbox/
│   ├── message/
│   ├── thread/
│   ├── submission/
│   ├── changes/
│   ├── search/
│   ├── store/
│   └── index.ts
└── tests/
    ├── account/
    ├── mailbox/
    ├── message/
    ├── thread/
    ├── submission/
    └── changes/
```

### Server adapters

```text
apps/server/src/modules/mail/
├── postgres/
│   ├── schema/
│   ├── repositories/
│   └── postgres-unit-of-work.ts
├── blob/
│   ├── memory-blob-store.ts
│   └── r2-blob-store.ts
├── search/
│   └── postgres-search-store.ts
├── runtime/
│   └── create-mail-core.ts
└── index.ts

apps/server/tests/mail-core/
├── helpers/
├── schema.integration.test.ts
├── repositories.integration.test.ts
├── import-email.integration.test.ts
├── mailbox-operations.integration.test.ts
├── drafts.integration.test.ts
├── submissions.integration.test.ts
└── changes.integration.test.ts
```

---

### Task 1: Scaffold the pure mail-core package and vocabulary

**Files:**

- Create: `packages/mail-core/package.json`
- Create: `packages/mail-core/tsconfig.json`
- Create: `packages/mail-core/src/types/ids.ts`
- Create: `packages/mail-core/src/types/address.ts`
- Create: `packages/mail-core/src/types/keyword.ts`
- Create: `packages/mail-core/src/types/special-use.ts`
- Create: `packages/mail-core/src/types/errors.ts`
- Create: `packages/mail-core/src/types/index.ts`
- Create: `packages/mail-core/src/index.ts`
- Create: `packages/mail-core/tests/types/keyword.test.ts`
- Create: `packages/mail-core/tests/types/errors.test.ts`

**Interfaces:**

- Produces: branded `MailAccountId`, `MailboxId`, `EmailId`, `ThreadId`, `BlobId`, `IdentityId`, `EmailSubmissionId`.
- Produces: `MailAddress`, `Keyword`, `StandardKeyword`, `MailboxKind`, `MailboxRole`.
- Produces: `MailCoreError` and stable `MailCoreErrorCode`.

- [ ] **Step 1: Add the package manifest and TypeScript config**

```json
{
  "name": "@zero/mail-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "mimetext": "3.0.27",
    "postal-mime": "2.7.5",
    "ulid": "3.0.1",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@zero/tsconfig": "workspace:*",
    "typescript": "catalog:",
    "vitest": "3.2.4"
  }
}
```

```json
{
  "extends": "@zero/tsconfig/base",
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 2: Write failing keyword and error tests**

```ts
import { describe, expect, it } from 'vitest';

import { MailCoreError, normalizeKeyword } from '../../src';

describe('mail-core vocabulary', () => {
  it('normalizes standard JMAP keywords', () => {
    expect(normalizeKeyword('$SEEN')).toBe('$seen');
    expect(normalizeKeyword('$Draft')).toBe('$draft');
  });

  it('rejects whitespace and control characters in keywords', () => {
    expect(() => normalizeKeyword('team label')).toThrow('INVALID_KEYWORD');
    expect(() => normalizeKeyword('team\nlabel')).toThrow('INVALID_KEYWORD');
  });

  it('exposes a safe stable error shape', () => {
    const error = new MailCoreError('EMAIL_NOT_FOUND', { entityId: 'email-1' });
    expect(error.code).toBe('EMAIL_NOT_FOUND');
    expect(error.details).toEqual({ entityId: 'email-1' });
    expect(JSON.stringify(error)).not.toContain('rawMime');
  });
});
```

- [ ] **Step 3: Run the tests and verify the missing-export failure**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/types
```

Expected: FAIL because `../../src` does not yet export the vocabulary.

- [ ] **Step 4: Implement IDs, keywords, roles, addresses, and errors**

Use this ID shape:

```ts
export type Id<Kind extends string> = string & { readonly __kind: Kind };
export type MailAccountId = Id<'MailAccount'>;
export type MailboxId = Id<'Mailbox'>;
export type EmailId = Id<'Email'>;
export type ThreadId = Id<'Thread'>;
export type BlobId = Id<'Blob'>;
export type IdentityId = Id<'Identity'>;
export type EmailSubmissionId = Id<'EmailSubmission'>;
```

Use these exact standard values:

```ts
export const standardKeywords = [
  '$seen',
  '$flagged',
  '$draft',
  '$answered',
  '$forwarded',
  '$important',
  '$junk',
] as const;

export const mailboxKinds = ['system', 'folder', 'label'] as const;
export const mailboxRoles = [
  'inbox',
  'sent',
  'drafts',
  'trash',
  'junk',
  'archive',
  'outbox',
  'scheduled',
] as const;
```

`normalizeKeyword()` lowercases standard `$` keywords, preserves valid custom keyword spelling,
and throws `MailCoreError('INVALID_KEYWORD')` for an empty value, whitespace, control characters,
or a value longer than 255 code units.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/types
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the vocabulary**

```bash
git add packages/mail-core pnpm-lock.yaml
git commit -m "feat(mail-core): add JMAP vocabulary"
```

---

### Task 2: Add the normalized Drizzle schema and migration

**Files:**

- Create: `apps/server/src/modules/mail/postgres/schema/accounts.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/mailboxes.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/blobs.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/threads.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/emails.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/submissions.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/changes.ts`
- Create: `apps/server/src/modules/mail/postgres/schema/index.ts`
- Create: `apps/server/src/modules/mail/postgres/table.ts`
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/tests/mail-core/schema-definition.test.ts`
- Create: generated `apps/server/src/db/migrations/0041_local_mail_core.sql`
- Modify: generated `apps/server/src/db/migrations/meta/_journal.json`
- Create: generated `apps/server/src/db/migrations/meta/0041_snapshot.json`

**Interfaces:**

- Consumes: existing `connection` and `user` tables from `apps/server/src/db/schema.ts`.
- Produces: Drizzle exports `mailAccount`, `mailbox`, `blob`, `thread`, `email`, `emailAddress`,
  `emailMailbox`, `emailTrashRestore`, `emailKeyword`, `emailContent`, `emailPart`, `mailIdentity`,
  `emailSubmission`, `submissionAttempt`, `remoteEmail`, `mailChange`.

- [ ] **Step 1: Write the failing schema inventory test**

```ts
import { describe, expect, it } from 'vitest';

import * as schema from '../../src/db/schema';

describe('local mail schema', () => {
  it('exports every local mail collection', () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        'mailAccount',
        'mailbox',
        'blob',
        'thread',
        'email',
        'emailAddress',
        'emailMailbox',
        'emailTrashRestore',
        'emailKeyword',
        'emailContent',
        'emailPart',
        'mailIdentity',
        'emailSubmission',
        'submissionAttempt',
        'remoteEmail',
        'mailChange',
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify missing exports**

Run:

```bash
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts
```

Expected: FAIL because `mailAccount` and the other collections are not exported.

- [ ] **Step 3: Add focused schema files**

Create `table.ts`:

```ts
import { pgTableCreator } from 'drizzle-orm/pg-core';

export const createMailTable = pgTableCreator((name) => `mail0_${name}`);
```

Implement the following exact table ownership:

```text
accounts.ts:
  mail_account, mail_identity

mailboxes.ts:
  mailbox

blobs.ts:
  blob

threads.ts:
  thread

emails.ts:
  email, email_address, email_mailbox, email_trash_restore, email_keyword,
  email_content, email_part, remote_email

submissions.ts:
  email_submission, submission_attempt

changes.ts:
  mail_change
```

Use `text` local IDs, `bigint({ mode: 'bigint' })` for state versions and byte sizes, timezone-aware
timestamps, and explicit enum-like text unions. Every relationship table includes
`mailAccountId`. Add composite uniqueness `(id, mail_account_id)` to parent tables and composite
foreign keys on relationships so cross-account links fail in PostgreSQL.

Required indexes:

```text
mail_account(connection_id) UNIQUE
mail_account(user_id)
mailbox(mail_account_id, role) WHERE role IS NOT NULL AND deleted_at IS NULL UNIQUE
mailbox(mail_account_id, parent_id, normalized_name) WHERE deleted_at IS NULL UNIQUE
email(mail_account_id, received_at DESC, id DESC)
email(mail_account_id, thread_id, received_at, id)
email_mailbox(mail_account_id, mailbox_id, email_id)
email_trash_restore(mail_account_id, email_id, mailbox_id)
email_keyword(mail_account_id, keyword, email_id)
remote_email(mail_account_id, provider, remote_email_id) UNIQUE
email_submission(mail_account_id, status, send_at)
email_submission(mail_account_id, idempotency_key) UNIQUE
mail_change(mail_account_id, state_version, collection, entity_id)
blob(mail_account_id, sha256, size_bytes) UNIQUE
```

- [ ] **Step 4: Export the schema through the existing aggregator**

Append:

```ts
export * from '../modules/mail/postgres/schema';
```

Keep all existing schema exports unchanged.

- [ ] **Step 5: Generate the named migration**

Run:

```bash
pnpm --dir apps/server exec drizzle-kit generate --name local_mail_core
```

Expected: `0041_local_mail_core.sql`, journal entry 41, and snapshot 41.

Inspect the generated SQL and add partial unique indexes that Drizzle did not emit:

```sql
CREATE UNIQUE INDEX "mailbox_account_role_active_uidx"
ON "mail0_mailbox" ("mail_account_id", "role")
WHERE "role" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "mailbox_active_sibling_name_uidx"
ON "mail0_mailbox" ("mail_account_id", "parent_id", "normalized_name")
WHERE "deleted_at" IS NULL;
```

- [ ] **Step 6: Run schema test, migration consistency check, and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run tests/mail-core/schema-definition.test.ts
pnpm --dir apps/server exec drizzle-kit check
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit the schema**

```bash
git add apps/server/src/modules/mail/postgres/schema apps/server/src/db/schema.ts apps/server/src/db/migrations apps/server/tests/mail-core/schema-definition.test.ts
git commit -m "feat(mail-core): add normalized mail schema"
```

---

### Task 3: Define storage ports and deterministic in-memory adapters

**Files:**

- Create: `packages/mail-core/src/store/repositories.ts`
- Create: `packages/mail-core/src/store/unit-of-work.ts`
- Create: `packages/mail-core/src/store/blob-store.ts`
- Create: `packages/mail-core/src/store/search-store.ts`
- Create: `packages/mail-core/src/store/index.ts`
- Create: `packages/mail-core/src/testing/memory-mail-store.ts`
- Create: `packages/mail-core/src/testing/memory-blob-store.ts`
- Create: `packages/mail-core/src/testing/fakes.ts`
- Create: `packages/mail-core/tests/store/unit-of-work.test.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Consumes: IDs and `MailCoreError` from Task 1.
- Produces: `MailUnitOfWork`, `MailTransaction`, focused repositories, `BlobStore`, `SearchStore`.
- Produces: `createMemoryMailCoreDependencies()` for Tasks 4–10.

- [ ] **Step 1: Write the failing rollback and state-version tests**

```ts
import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

describe('memory mail unit of work', () => {
  it('rolls back writes when the operation throws', async () => {
    const deps = createMemoryMailCoreDependencies();
    await expect(
      deps.unitOfWork.run(async (tx) => {
        await tx.accounts.insert({
          id: 'account-1',
          userId: 'user-1',
          connectionId: 'connection-1',
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await expect(deps.inspect.accounts()).resolves.toEqual([]);
  });

  it('allocates one state version per transaction', async () => {
    const deps = createMemoryMailCoreDependencies();
    const version = await deps.unitOfWork.run(async (tx) => {
      await tx.accounts.insert({
        id: 'account-1',
        userId: 'user-1',
        connectionId: 'connection-1',
      });
      return tx.nextStateVersion('account-1');
    });
    expect(version).toBe(1n);
  });
});
```

- [ ] **Step 2: Run and verify missing testing adapters**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/store/unit-of-work.test.ts
```

Expected: FAIL because `createMemoryMailCoreDependencies` does not exist.

- [ ] **Step 3: Define exact transaction and port contracts**

```ts
export interface MailTransaction {
  accounts: AccountRepository;
  mailboxes: MailboxRepository;
  blobs: BlobRepository;
  threads: ThreadRepository;
  emails: EmailRepository;
  identities: IdentityRepository;
  submissions: SubmissionRepository;
  changes: ChangeRepository;
  nextStateVersion(accountId: MailAccountId): Promise<bigint>;
}

export interface MailUnitOfWork {
  run<T>(operation: (tx: MailTransaction) => Promise<T>): Promise<T>;
}

export interface BlobStore {
  putTemporary(input: {
    accountId: MailAccountId;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ temporaryKey: string; sha256: string; size: bigint }>;
  commitTemporary(input: { temporaryKey: string; objectKey: string }): Promise<void>;
  get(objectKey: string): Promise<Uint8Array>;
  delete(objectKey: string): Promise<void>;
}

export interface SearchStore {
  query(input: SearchEmailInput): Promise<SearchEmailResult>;
}

export type MailCoreDependencies = {
  unitOfWork: MailUnitOfWork;
  blobStore: BlobStore;
  searchStore: SearchStore;
  clock: { now(): Date };
  idFactory: { next<Kind extends string>(): Id<Kind> };
  sanitizeHtml(html: string): string;
};
```

Define focused repository methods used by the design: `findById`, `insert`, `update`,
`findByRemoteId`, `listByThread`, `replaceMailboxes`, `replaceKeywords`, `recordChange`, and
`queryChanges`. Do not expose SQL query builders through these interfaces.

- [ ] **Step 4: Implement snapshot-based memory transactions**

`MemoryMailUnitOfWork.run()` clones all maps before invoking the operation, publishes the cloned
state only after success, and discards it on failure. `MemoryBlobStore` stores copied
`Uint8Array` values and verifies SHA-256 using Web Crypto.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/store
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the ports and memory adapters**

```bash
git add packages/mail-core/src/store packages/mail-core/src/testing packages/mail-core/tests/store packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add storage ports"
```

---

### Task 4: Implement account and Mailbox behavior

**Files:**

- Create: `packages/mail-core/src/account/create-account.ts`
- Create: `packages/mail-core/src/account/manage-identity.ts`
- Create: `packages/mail-core/src/account/types.ts`
- Create: `packages/mail-core/src/account/index.ts`
- Create: `packages/mail-core/src/mailbox/types.ts`
- Create: `packages/mail-core/src/mailbox/create-mailbox.ts`
- Create: `packages/mail-core/src/mailbox/update-mailbox.ts`
- Create: `packages/mail-core/src/mailbox/destroy-mailbox.ts`
- Create: `packages/mail-core/src/mailbox/index.ts`
- Create: `packages/mail-core/tests/account/create-account.test.ts`
- Create: `packages/mail-core/tests/mailbox/mailbox-commands.test.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Consumes: `MailUnitOfWork`, ID factory, and clock.
- Produces: `createMailAccount`, `createIdentity`, `updateIdentity`, `destroyIdentity`,
  `createMailbox`, `updateMailbox`, `destroyMailbox`.

- [ ] **Step 1: Write failing system Mailbox and invariant tests**

```ts
import { describe, expect, it } from 'vitest';

import {
  createIdentity,
  createMailAccount,
  createMailbox,
  destroyMailbox,
  updateMailbox,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

describe('MailAccount and Mailbox commands', () => {
  it('creates all required system Mailboxes atomically', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'Asia/Shanghai',
      storageQuotaBytes: null,
    });

    const roles = (await deps.inspect.mailboxes(account.id)).map(({ role }) => role).sort();
    expect(roles).toEqual(
      ['archive', 'drafts', 'inbox', 'junk', 'outbox', 'scheduled', 'sent', 'trash'].sort(),
    );
    expect(await deps.inspect.changes(account.id)).toHaveLength(8);

    const identity = await createIdentity(deps, {
      accountId: account.id,
      name: 'Zero User',
      email: 'user@example.test',
      replyTo: null,
      makeDefault: true,
    });
    expect(identity).toMatchObject({
      email: 'user@example.test',
      isDefault: true,
    });
  });

  it('enforces role, name, parent, child, content, and system invariants', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;

    await expect(
      createMailbox(deps, {
        accountId: account.id,
        name: 'Second inbox',
        kind: 'system',
        role: 'inbox',
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    await expect(
      updateMailbox(deps, {
        accountId: account.id,
        mailboxId: inbox.id,
        name: 'Renamed inbox',
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });

    const parent = await createMailbox(deps, {
      accountId: account.id,
      name: 'Projects',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    await createMailbox(deps, {
      accountId: account.id,
      name: 'Zero',
      kind: 'folder',
      role: null,
      parentId: parent.id,
    });
    await expect(
      createMailbox(deps, {
        accountId: account.id,
        name: ' projects ',
        kind: 'folder',
        role: null,
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_NAME_CONFLICT' });

    const other = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-2',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    await expect(
      createMailbox(deps, {
        accountId: other.id,
        name: 'Cross account',
        kind: 'folder',
        role: null,
        parentId: parent.id,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });

    await expect(
      destroyMailbox(deps, { accountId: account.id, mailboxId: parent.id }),
    ).rejects.toMatchObject({ code: 'MAILBOX_HAS_CHILD' });
    await deps.inspect.seedMailboxEmail(inbox.id);
    await expect(
      destroyMailbox(deps, { accountId: account.id, mailboxId: inbox.id }),
    ).rejects.toMatchObject({ code: 'MAILBOX_HAS_EMAIL' });
  });

  it('keeps exactly one default Identity per account', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const first = await createIdentity(deps, {
      accountId: account.id,
      name: 'First',
      email: 'first@example.test',
      replyTo: null,
      makeDefault: true,
    });
    const second = await createIdentity(deps, {
      accountId: account.id,
      name: 'Second',
      email: 'second@example.test',
      replyTo: null,
      makeDefault: true,
    });
    expect(await deps.inspect.identity(first.id)).toMatchObject({ isDefault: false });
    expect(await deps.inspect.identity(second.id)).toMatchObject({ isDefault: true });
  });
});
```

The first test must assert these roles exactly:

```ts
['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'outbox', 'scheduled'];
```

- [ ] **Step 2: Run and verify missing commands**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/account tests/mailbox
```

Expected: FAIL because the account and Mailbox commands do not exist.

- [ ] **Step 3: Implement account creation**

```ts
export type CreateMailAccountInput = {
  userId: string;
  connectionId: string;
  timezone: string;
  storageQuotaBytes: bigint | null;
};
```

Generate one MailAccount ULID, create all eight system Mailboxes in the same transaction, allocate
state version `1n`, and record eight Mailbox Created Changes. `mail_change` has no Account
collection; the MailAccount itself is the state-version owner.

- [ ] **Step 4: Implement Mailbox commands**

Normalize names with `trim().normalize('NFC').toLocaleLowerCase('und')`. Custom `folder` and
`label` Mailboxes may be renamed and reparented within the same account. System Mailboxes reject
role/name/parent changes with `MAILBOX_ROLE_CONFLICT`.

Identity commands validate normalized email addresses. Setting one Identity as default clears the
previous default in the same transaction. An Identity cannot be destroyed while a `scheduled`,
`queued`, `sending`, or `retry_wait` Submission references it; reject with `IDENTITY_IN_USE`.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/account tests/mailbox
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit account and Mailbox behavior**

```bash
git add packages/mail-core/src/account packages/mail-core/src/mailbox packages/mail-core/tests/account packages/mail-core/tests/mailbox packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add account and mailbox behavior"
```

---

### Task 5: Implement local Thread calculation and merging

**Files:**

- Create: `packages/mail-core/src/thread/normalize-subject.ts`
- Create: `packages/mail-core/src/thread/thread-keys.ts`
- Create: `packages/mail-core/src/thread/calculate-thread.ts`
- Create: `packages/mail-core/src/thread/index.ts`
- Create: `packages/mail-core/tests/thread/normalize-subject.test.ts`
- Create: `packages/mail-core/tests/thread/calculate-thread.test.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Produces: `normalizeSubject(subject)`, `normalizeMessageId(value)`,
  `calculateThreadDecision(input)`.
- Produces: `ThreadDecision = { type: 'create' } | { type: 'use'; threadId } |
{ type: 'merge'; winnerThreadId; loserThreadIds }`.

- [ ] **Step 1: Write failing RFC/JMAP threading tests**

```ts
it.each([
  ['Re: Hello', 'hello'],
  ['Fwd: Re:  Hello ', 'hello'],
  ['[List] Re: Hello', 'hello'],
])('normalizes %s to %s', (input, expected) => {
  expect(normalizeSubject(input)).toBe(expected);
});

it('uses an existing Thread only when reference and subject match', () => {
  expect(
    calculateThreadDecision({
      normalizedSubject: 'release',
      referenceIds: ['root@example.com'],
      candidates: [
        {
          threadId: 'thread-1' as ThreadId,
          normalizedSubject: 'release',
          matchedReference: 'root@example.com',
        },
      ],
    }),
  ).toEqual({ type: 'use', threadId: 'thread-1' });

  expect(
    calculateThreadDecision({
      normalizedSubject: 'different',
      referenceIds: ['root@example.com'],
      candidates: [
        {
          threadId: 'thread-1' as ThreadId,
          normalizedSubject: 'release',
          matchedReference: 'root@example.com',
        },
      ],
    }),
  ).toEqual({ type: 'create' });
});

it('merges bridged Threads with the smallest ID as winner', () => {
  expect(
    calculateThreadDecision({
      normalizedSubject: 'release',
      referenceIds: ['a@example.com', 'b@example.com'],
      candidates: [
        {
          threadId: 'thread-b' as ThreadId,
          normalizedSubject: 'release',
          matchedReference: 'b@example.com',
        },
        {
          threadId: 'thread-a' as ThreadId,
          normalizedSubject: 'release',
          matchedReference: 'a@example.com',
        },
      ],
    }),
  ).toEqual({
    type: 'merge',
    winnerThreadId: 'thread-a',
    loserThreadIds: ['thread-b'],
  });
});
```

- [ ] **Step 2: Run and verify missing modules**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/thread
```

Expected: FAIL because Thread calculation is not implemented.

- [ ] **Step 3: Implement pure normalization and decision logic**

Strip repeated reply/forward prefixes and one or more leading list tags, collapse whitespace,
normalize Unicode NFC, and lowercase for comparison. Normalize Message IDs by trimming whitespace,
removing one surrounding `<...>` pair, and lowercasing the domain portion.

`calculateThreadDecision()` receives candidate rows already found by the repository:

```ts
export type ThreadCandidate = {
  threadId: ThreadId;
  normalizedSubject: string;
  matchedReference: string;
};
```

It does not query storage itself.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/thread
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Thread calculation**

```bash
git add packages/mail-core/src/thread packages/mail-core/tests/thread packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add local threading"
```

---

### Task 6: Parse MIME, persist immutable blobs, and import Email idempotently

**Files:**

- Create: `packages/mail-core/src/message/types.ts`
- Create: `packages/mail-core/src/message/mime.ts`
- Create: `packages/mail-core/src/message/blob-lifecycle.ts`
- Create: `packages/mail-core/src/message/import-email.ts`
- Create: `packages/mail-core/src/message/index.ts`
- Create: `packages/mail-core/tests/fixtures/simple.eml`
- Create: `packages/mail-core/tests/fixtures/multipart.eml`
- Create: `packages/mail-core/tests/helpers/import-harness.ts`
- Create: `packages/mail-core/tests/message/mime.test.ts`
- Create: `packages/mail-core/tests/message/import-email.test.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Consumes: `postal-mime`, `BlobStore`, `MailUnitOfWork`, Thread decision functions.
- Produces: `parseRawEmail(raw)`, `importEmail(input)`, `ImportEmailResult`.

- [ ] **Step 1: Add minimal hand-written RFC 5322 fixtures**

`simple.eml` contains From, To, Message-ID, Date, Subject, and a plain-text body.
`multipart.eml` contains one HTML body, one inline CID image, and one attachment. Use invented
addresses and short original text; do not copy fixture content from reference projects.

- [ ] **Step 2: Write failing parser and import tests**

```ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import { createMailAccount, importEmail, parseRawEmail } from '../../src';

const raw = new Uint8Array(readFileSync(new URL('../fixtures/multipart.eml', import.meta.url)));

describe('MIME import', () => {
  it('extracts normalized content and preserves exact Raw bytes', async () => {
    const parsed = await parseRawEmail(raw, { sanitizeHtml: (html) => html });
    expect(parsed.subject).toBe('Multipart fixture');
    expect(parsed.from[0]?.email).toBe('sender@example.test');
    expect(parsed.htmlBody).toContain('<p>Hello</p>');
    expect(parsed.attachments.map(({ disposition }) => disposition)).toEqual([
      'inline',
      'attachment',
    ]);

    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;
    const result = await importEmail(deps, {
      accountId: account.id,
      provider: 'fixture',
      remoteEmailId: 'remote-1',
      remoteThreadId: null,
      raw,
      mailboxIds: [inbox.id],
      keywords: ['$seen'],
      receivedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.created).toBe(true);
    const stored = await deps.inspect.email(result.emailId);
    expect(stored?.threadId).toBeTruthy();
    expect(await deps.inspect.rawBytes(result.emailId)).toEqual(raw);
    expect(await deps.inspect.changes(account.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ collection: 'email', changeType: 'created' }),
        expect.objectContaining({ collection: 'thread', changeType: 'created' }),
      ]),
    );
  });

  it('is idempotent and rejects conflicting content for one remote ID', async () => {
    const deps = await createSeededImportDependencies();
    const first = await importEmail(deps.core, deps.input);
    const repeated = await importEmail(deps.core, deps.input);
    expect(repeated).toEqual({ created: false, emailId: first.emailId });

    await expect(
      importEmail(deps.core, {
        ...deps.input,
        raw: new TextEncoder().encode('Subject: changed\r\n\r\nchanged'),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('does not expose Email after Blob commit or account validation failure', async () => {
    const deps = await createSeededImportDependencies({ failBlobCommit: true });
    await expect(importEmail(deps.core, deps.input)).rejects.toThrow('blob commit failed');
    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);

    await expect(
      importEmail(deps.core, {
        ...deps.input,
        mailboxIds: ['mailbox-from-another-account' as MailboxId],
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
  });

  it('rejects import that exceeds the account storage quota', async () => {
    const deps = await createSeededImportDependencies({ storageQuotaBytes: 10n });
    await expect(importEmail(deps.core, deps.input)).rejects.toMatchObject({
      code: 'OVER_QUOTA',
    });
    expect(await deps.core.inspect.emails(deps.input.accountId)).toEqual([]);
  });
});
```

Implement this helper in `tests/helpers/import-harness.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raw = new Uint8Array(readFileSync(resolve(import.meta.dirname, '../fixtures/multipart.eml')));
const fixtureAccountInput = {
  userId: 'user-1',
  connectionId: 'connection-1',
  timezone: 'UTC',
} as const;

export const createSeededImportDependencies = async (
  options: { failBlobCommit?: boolean; storageQuotaBytes?: bigint | null } = {},
): Promise<{
  core: ReturnType<typeof createMemoryMailCoreDependencies>;
  input: ImportEmailInput;
}> => {
  const core = createMemoryMailCoreDependencies({
    failBlobCommit: options.failBlobCommit ?? false,
  });
  const account = await createMailAccount(core, {
    ...fixtureAccountInput,
    storageQuotaBytes: options.storageQuotaBytes ?? null,
  });
  const inbox = (await core.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;
  return {
    core,
    input: {
      accountId: account.id,
      provider: 'fixture',
      remoteEmailId: 'remote-1',
      remoteThreadId: null,
      raw,
      mailboxIds: [inbox.id],
      keywords: [],
      receivedAt: new Date('2026-01-01T00:00:00Z'),
    },
  };
};
```

- [ ] **Step 3: Run and verify missing import implementation**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message/mime.test.ts tests/message/import-email.test.ts
```

Expected: FAIL because `parseRawEmail` and `importEmail` do not exist.

- [ ] **Step 4: Implement MIME normalization**

Use `PostalMime` with `attachmentEncoding: 'arraybuffer'`. Convert all binary values to copied
`Uint8Array` instances. Produce:

```ts
export type ParsedEmail = {
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  subject: string;
  sentAt: Date | null;
  from: MailAddress[];
  sender: MailAddress[];
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  textBody: string;
  htmlBody: string;
  attachments: ParsedPart[];
  hasAttachment: boolean;
};
```

Sanitize HTML with an injected `sanitizeHtml(html: string): string` dependency; the pure core does
not import the existing server HTML processor.

- [ ] **Step 5: Implement Blob-first import**

```ts
export type ImportEmailInput = {
  accountId: MailAccountId;
  provider: string;
  remoteEmailId: string;
  remoteThreadId: string | null;
  raw: Uint8Array;
  mailboxIds: MailboxId[];
  keywords: Keyword[];
  receivedAt: Date;
};
```

Write Raw and attachment temporary objects, verify SHA-256 and size, insert pending Blob rows,
create Email data and Changes in one database transaction, then commit temporary objects. Do not
expose the Email until every referenced Blob is `ready`. A retry first checks `remote_email`; the
same fingerprint returns `{ created: false, emailId }`, while a different fingerprint throws
`IDEMPOTENCY_CONFLICT`. Before creating Blob metadata, sum the account's ready/pending referenced
Blob bytes plus the unique new content sizes and throw `OVER_QUOTA` when the configured quota would
be exceeded.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit MIME import**

```bash
git add packages/mail-core/src/message packages/mail-core/tests/message packages/mail-core/tests/fixtures packages/mail-core/src/index.ts
git commit -m "feat(mail-core): import MIME email"
```

---

### Task 7: Implement local Keyword, Mailbox, Trash, and Change operations

**Files:**

- Create: `packages/mail-core/src/message/update-email.ts`
- Create: `packages/mail-core/src/message/destroy-email.ts`
- Create: `packages/mail-core/src/message/garbage-collect-blobs.ts`
- Create: `packages/mail-core/src/changes/types.ts`
- Create: `packages/mail-core/src/changes/record-change.ts`
- Create: `packages/mail-core/src/changes/index.ts`
- Create: `packages/mail-core/tests/message/update-email.test.ts`
- Create: `packages/mail-core/tests/message/destroy-email.test.ts`
- Create: `packages/mail-core/tests/message/garbage-collect-blobs.test.ts`
- Create: `packages/mail-core/tests/changes/change-log.test.ts`
- Create: `packages/mail-core/tests/helpers/email-harness.ts`
- Modify: `packages/mail-core/src/message/index.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Produces: `updateEmail`, `moveEmailToTrash`, `restoreEmail`, `destroyEmail`.
- Produces: `garbageCollectBlobs`.
- Produces: `MailChange`, `ChangeType`, and state-version response values.

- [ ] **Step 1: Write failing state and Change tests**

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  destroyEmail,
  garbageCollectBlobs,
  moveEmailToTrash,
  restoreEmail,
  updateEmail,
  type UpdateEmailInput,
} from '../../src';

describe('local Email state', () => {
  it('patches Mailboxes and Keywords with one state version', async () => {
    const h = await createSeededEmailHarness({ keywords: [] });
    const before = await h.inspect.stateVersion();
    const updated = await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [h.archiveId],
      removeMailboxIds: [h.inboxId],
      addKeywords: ['$seen', '$flagged'],
    });

    expect(updated.mailboxIds).toEqual([h.archiveId]);
    expect(updated.keywords).toEqual(['$flagged', '$seen']);
    expect(await h.inspect.stateVersion()).toBe(before + 1n);
    expect(await h.inspect.mailbox(h.inboxId)).toMatchObject({ unreadEmails: 0 });
    expect(await h.inspect.thread(h.threadId)).toMatchObject({ unreadCount: 0 });
  });

  it('moves to Trash, restores, then permanently destroys', async () => {
    const h = await createSeededEmailHarness({ keywords: [] });
    await moveEmailToTrash(h.deps, { accountId: h.accountId, emailId: h.emailId });
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toEqual([h.trashId]);

    await restoreEmail(h.deps, { accountId: h.accountId, emailId: h.emailId });
    expect((await h.inspect.email(h.emailId))?.mailboxIds).toEqual([h.inboxId]);

    await destroyEmail(h.deps, { accountId: h.accountId, emailId: h.emailId });
    expect(await h.inspect.visibleEmail(h.emailId)).toBeNull();
    expect(await h.inspect.changes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'email',
          entityId: h.emailId,
          changeType: 'destroyed',
        }),
      ]),
    );
  });

  it('rejects an empty Mailbox set and excludes content from the patch type', async () => {
    const h = await createSeededEmailHarness({ keywords: [] });
    await expect(
      updateEmail(h.deps, {
        accountId: h.accountId,
        emailId: h.emailId,
        removeMailboxIds: [h.inboxId],
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_MUST_HAVE_MAILBOX' });
    expectTypeOf<UpdateEmailInput>().not.toHaveProperty('subject');
  });

  it('collects only old unreferenced Blobs and retries object deletion failure', async () => {
    const h = await createSeededEmailHarness({ keywords: [] });
    const referenced = await h.inspect.rawBlob(h.emailId);
    const orphan = await h.inspect.seedOrphanBlob({ ageMs: 25 * 60 * 60 * 1000 });
    const recent = await h.inspect.seedOrphanBlob({ ageMs: 60 * 1000 });
    h.inspect.failNextBlobDelete(orphan.id);

    await expect(
      garbageCollectBlobs(h.deps, {
        accountId: h.accountId,
        olderThan: new Date(h.clock.now().getTime() - 24 * 60 * 60 * 1000),
        limit: 100,
      }),
    ).rejects.toThrow('blob delete failed');
    expect(await h.inspect.blob(orphan.id)).toMatchObject({ status: 'ready' });

    await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - 24 * 60 * 60 * 1000),
      limit: 100,
    });
    expect(await h.inspect.blob(orphan.id)).toBeNull();
    expect(await h.inspect.blob(recent.id)).not.toBeNull();
    expect(await h.inspect.blob(referenced.id)).not.toBeNull();
  });
});
```

`createSeededEmailHarness()` creates one account and imports one unread fixture Email into Inbox.
It returns `deps`, `accountId`, `emailId`, `threadId`, `inboxId`, `archiveId`, `trashId`, and
`inspect`. Its optional `keywords` value is passed to `importEmail()` unchanged. The helper may
seed Mailbox-content relationships only through public mail-core commands.

- [ ] **Step 2: Run and verify missing commands**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message/update-email.test.ts tests/message/destroy-email.test.ts tests/changes/change-log.test.ts
```

Expected: FAIL because the commands do not exist.

- [ ] **Step 3: Implement JMAP-style patch input**

```ts
export type UpdateEmailInput = {
  accountId: MailAccountId;
  emailId: EmailId;
  addMailboxIds?: MailboxId[];
  removeMailboxIds?: MailboxId[];
  addKeywords?: Keyword[];
  removeKeywords?: Keyword[];
};
```

Normalize and de-duplicate every input set. Reject the same Mailbox/Keyword appearing in both add
and remove. Record only properties that actually changed.

- [ ] **Step 4: Implement Trash and permanent deletion**

When moving to Trash, save prior visible Mailbox IDs in an internal restore projection, remove
Inbox/Archive/Junk membership, and add Trash. Restore removes Trash and reapplies the saved IDs,
falling back to Inbox if none remain. Permanent deletion sets `destroyedAt`, removes visible
relationships, records Email Destroyed and affected Thread/Mailbox Updated Changes, and leaves Blob
cleanup to GC.

`garbageCollectBlobs()` selects unreferenced Blob rows older than the caller-provided safety cutoff,
marks one bounded batch `deleting`, deletes object bytes, then deletes metadata. If object deletion
fails, restore the metadata status to `ready` so a later run retries. It never follows arbitrary
object keys supplied by a caller.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message tests/changes
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit local state operations**

```bash
git add packages/mail-core/src/message packages/mail-core/src/changes packages/mail-core/tests/message packages/mail-core/tests/changes packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add local email state"
```

---

### Task 8: Implement Draft Email revisions

**Files:**

- Create: `packages/mail-core/src/message/draft-types.ts`
- Create: `packages/mail-core/src/message/render-draft.ts`
- Create: `packages/mail-core/src/message/create-draft.ts`
- Create: `packages/mail-core/src/message/update-draft.ts`
- Create: `packages/mail-core/src/message/destroy-draft.ts`
- Create: `packages/mail-core/tests/message/draft.test.ts`
- Create: `packages/mail-core/tests/helpers/draft-harness.ts`
- Modify: `packages/mail-core/src/message/index.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Consumes: `mimetext`, Blob lifecycle, MailUnitOfWork.
- Produces: `createDraft`, `updateDraft`, `destroyDraft`, `DraftContent`.

- [ ] **Step 1: Write failing Draft tests**

```ts
import { describe, expect, it } from 'vitest';

import { createDraft, destroyDraft, updateDraft } from '../../src';

describe('Draft Email', () => {
  it('creates and revises a deterministic Draft Email', async () => {
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    expect(draft).toMatchObject({
      lifecycle: 'draft',
      draftRevision: 1,
      keywords: ['$draft'],
      mailboxIds: [h.draftsMailboxId],
    });

    const raw1 = await h.inspect.rawBytes(draft.id);
    const updated = await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: { ...h.content, subject: 'Revised subject' },
    });
    const raw2 = await h.inspect.rawBytes(updated.id);
    expect(updated.draftRevision).toBe(2);
    expect(new TextDecoder().decode(raw2)).toContain('Subject: Revised subject');
    expect(raw2).not.toEqual(raw1);
    expect(updated.messageId).toBe(draft.messageId);
  });

  it('rejects stale or non-Draft mutation and records destruction', async () => {
    const h = await createDraftHarness();
    const draft = await createDraft(h.deps, h.content);
    await updateDraft(h.deps, {
      accountId: h.accountId,
      emailId: draft.id,
      expectedRevision: 1,
      content: h.content,
    });
    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 1,
        content: h.content,
      }),
    ).rejects.toMatchObject({ code: 'DRAFT_REVISION_CONFLICT' });

    await h.inspect.setLifecycle(draft.id, 'sent');
    await expect(
      updateDraft(h.deps, {
        accountId: h.accountId,
        emailId: draft.id,
        expectedRevision: 2,
        content: h.content,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_CONTENT_IMMUTABLE' });

    const second = await createDraft(h.deps, h.content);
    await destroyDraft(h.deps, { accountId: h.accountId, emailId: second.id });
    expect(await h.inspect.visibleEmail(second.id)).toBeNull();
  });
});
```

`createDraftHarness()` creates one account, its default Identity, and returns a `DraftContent`
whose recipient is `recipient@example.test`. Its `inspect.setLifecycle()` test-only method updates
the in-memory fixture directly and is never exported from `@zero/mail-core`.

- [ ] **Step 2: Run and verify missing Draft commands**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts
```

Expected: FAIL because Draft commands do not exist.

- [ ] **Step 3: Define structured Draft input**

```ts
export type DraftContent = {
  identityId: IdentityId;
  replyToEmailId: EmailId | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachmentBlobIds: BlobId[];
};
```

`createDraft()` sets revision `1`, creates `$draft`, and places the Email in the Drafts Mailbox.
`updateDraft()` requires `expectedRevision` and creates a new immutable Raw Blob; it never overwrites
the previous object.

- [ ] **Step 4: Render deterministic MIME**

Use `mimetext` with CRLF line endings. Generate the local Message-ID once on Draft creation and
reuse it across Draft revisions. Order recipients and attachments by input order. Do not add a
Provider-specific header.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Draft behavior**

```bash
git add packages/mail-core/src/message packages/mail-core/tests/message/draft.test.ts packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add draft revisions"
```

---

### Task 9: Implement EmailSubmission and attempt history

**Files:**

- Create: `packages/mail-core/src/submission/types.ts`
- Create: `packages/mail-core/src/submission/create-submission.ts`
- Create: `packages/mail-core/src/submission/transition-submission.ts`
- Create: `packages/mail-core/src/submission/retry-policy.ts`
- Create: `packages/mail-core/src/submission/index.ts`
- Create: `packages/mail-core/tests/submission/submission.test.ts`
- Create: `packages/mail-core/tests/submission/retry-policy.test.ts`
- Create: `packages/mail-core/tests/helpers/submission-harness.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Produces: `createSubmission`, `transitionSubmission`, `cancelSubmission`.
- Produces: `SubmissionStatus`, `SubmissionAttemptOutcome`, `calculateRetryAt`.

- [ ] **Step 1: Write failing state-machine tests**

```ts
import { describe, expect, it } from 'vitest';

import { createSubmission, destroyIdentity, transitionSubmission } from '../../src';

describe('EmailSubmission', () => {
  it('creates idempotent Submission only for the same frozen Draft', async () => {
    const h = await createSubmissionHarness();
    const input = {
      accountId: h.accountId,
      emailId: h.draftId,
      identityId: h.identityId,
      idempotencyKey: 'send-1',
      sendAt: null,
    };
    const first = await createSubmission(h.deps, input);
    const repeated = await createSubmission(h.deps, input);
    expect(first.status).toBe('queued');
    expect(repeated.id).toBe(first.id);

    await expect(
      createSubmission(h.deps, { ...input, emailId: h.otherDraftId }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it.each([
    ['scheduled', 'queued'],
    ['queued', 'sending'],
    ['sending', 'sent'],
    ['sending', 'retry_wait'],
    ['sending', 'failed'],
    ['retry_wait', 'queued'],
    ['scheduled', 'canceled'],
    ['queued', 'canceled'],
    ['retry_wait', 'canceled'],
  ])('allows %s -> %s', async (from, to) => {
    const h = await createSubmissionHarness({ initialStatus: from });
    const result = await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId: h.submissionId,
      to,
      outcome:
        from === 'sending'
          ? { type: to === 'sent' ? 'sent' : 'failure', retryable: to === 'retry_wait' }
          : null,
    });
    expect(result.status).toBe(to);
  });

  it.each(['sent', 'failed', 'canceled'] as const)(
    'rejects transition from terminal state %s',
    async (status) => {
      const h = await createSubmissionHarness({ initialStatus: status });
      await expect(
        transitionSubmission(h.deps, {
          accountId: h.accountId,
          submissionId: h.submissionId,
          to: 'queued',
          outcome: null,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_SUBMISSION_TRANSITION' });
    },
  );

  it('records immutable Attempt history', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'sending' });
    await transitionSubmission(h.deps, {
      accountId: h.accountId,
      submissionId: h.submissionId,
      to: 'retry_wait',
      outcome: { type: 'failure', retryable: true, safeResponse: 'rate limited' },
    });
    expect(await h.inspect.attempts(h.submissionId)).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        outcome: 'transient_failure',
        safeResponse: 'rate limited',
      }),
    ]);
  });

  it('keeps an Identity referenced by a nonterminal Submission', async () => {
    const h = await createSubmissionHarness({ initialStatus: 'queued' });
    await expect(
      destroyIdentity(h.deps, {
        accountId: h.accountId,
        identityId: h.identityId,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_IN_USE' });
  });
});
```

`createSubmissionHarness()` creates one account, one Identity, and two valid Draft Emails. With no
option it returns those IDs and no Submission. With `initialStatus`, it additionally creates one
Submission, advances it through the public transition API to the requested reachable status, and
returns `submissionId`; terminal fixture states must not be written directly.

- [ ] **Step 2: Run and verify missing submission implementation**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/submission
```

Expected: FAIL because submission modules do not exist.

- [ ] **Step 3: Implement exact transition map**

```ts
export const allowedSubmissionTransitions = {
  scheduled: ['queued', 'canceled'],
  queued: ['sending', 'canceled'],
  sending: ['sent', 'retry_wait', 'failed'],
  retry_wait: ['queued', 'canceled'],
  sent: [],
  failed: [],
  canceled: [],
} as const;
```

Freeze the Draft revision used by the Submission. Submission creation fails if the Email is not a
Draft, has no Raw Blob, or has no recipient.

- [ ] **Step 4: Implement bounded retry policy**

Use delays of 30 seconds, 2 minutes, 10 minutes, 30 minutes, and 2 hours for attempts 1–5.
Attempt 6 becomes permanent failure. Accept an injected Clock and never use `Date.now()` directly
inside the core.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/submission
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Submission behavior**

```bash
git add packages/mail-core/src/submission packages/mail-core/tests/submission packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add email submissions"
```

---

### Task 10: Implement Email/Thread queries, PostgreSQL search semantics, and Changes

**Files:**

- Create: `packages/mail-core/src/message/query-emails.ts`
- Create: `packages/mail-core/src/thread/query-threads.ts`
- Create: `packages/mail-core/src/search/types.ts`
- Create: `packages/mail-core/src/search/cursor.ts`
- Create: `packages/mail-core/src/search/index.ts`
- Create: `packages/mail-core/src/changes/get-changes.ts`
- Create: `packages/mail-core/src/mail-core.ts`
- Create: `packages/mail-core/tests/message/query-emails.test.ts`
- Create: `packages/mail-core/tests/thread/query-threads.test.ts`
- Create: `packages/mail-core/tests/search/cursor.test.ts`
- Create: `packages/mail-core/tests/changes/get-changes.test.ts`
- Create: `packages/mail-core/tests/helpers/query-harness.ts`
- Modify: `packages/mail-core/src/index.ts`

**Interfaces:**

- Produces: `queryEmails`, `queryThreads`, `encodeCursor`, `decodeCursor`, `getChanges`.
- Produces: `createMailCore(dependencies): MailCore`.

- [ ] **Step 1: Write failing query and cursor tests**

```ts
import { describe, expect, it } from 'vitest';

import { decodeCursor, getChanges, queryEmails, queryThreads } from '../../src';

describe('local queries', () => {
  it('filters and keyset-pages Email without duplicates', async () => {
    const h = await createQueryHarness();
    const first = await queryEmails(h.deps, {
      accountId: h.accountId,
      filter: {
        mailboxId: h.inboxId,
        hasKeyword: '$seen',
        after: new Date('2026-01-01T00:00:00Z'),
        address: 'sender@example.test',
        hasAttachment: true,
        text: 'release',
      },
      sort: { property: 'receivedAt', direction: 'desc' },
      limit: 2,
      cursor: null,
    });
    expect(first.emailIds).toEqual([h.email3, h.email2]);

    await h.insertBetweenPages();
    const second = await queryEmails(h.deps, {
      accountId: h.accountId,
      filter: first.appliedFilter,
      sort: first.appliedSort,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.emailIds).toEqual([h.email1]);
    expect(new Set([...first.emailIds, ...second.emailIds]).size).toBe(3);
  });

  it('returns stable Thread order and collapses Changes', async () => {
    const h = await createQueryHarness();
    const threads = await queryThreads(h.deps, {
      accountId: h.accountId,
      mailboxId: h.inboxId,
      limit: 10,
      cursor: null,
    });
    expect(threads.threads[0]?.emailIds).toEqual([h.email1, h.email2, h.email3]);

    const changes = await getChanges(h.deps, {
      accountId: h.accountId,
      collection: 'email',
      sinceState: '0',
      maxChanges: 2,
    });
    expect(changes).toMatchObject({
      oldState: '0',
      hasMoreChanges: true,
      created: expect.any(Array),
      updated: expect.any(Array),
      destroyed: expect.any(Array),
    });
    expect(BigInt(changes.newState)).toBeGreaterThan(0n);
  });

  it('rejects malformed and cross-account cursors', () => {
    expect(() => decodeCursor('not-base64url', 'account-1' as MailAccountId)).toThrow(
      'INVALID_CURSOR',
    );
    expect(() => decodeCursor(validAccountTwoCursor, 'account-1' as MailAccountId)).toThrow(
      'CROSS_ACCOUNT_REFERENCE',
    );
  });
});
```

`createQueryHarness()` imports three fixture Emails in one Thread with increasing `receivedAt`
values, applies Inbox, `$seen`, sender, attachment, and searchable `release` content, and exposes
their IDs oldest-to-newest as `email1`, `email2`, `email3`. `insertBetweenPages()` inserts a newer
matching Email after page one. `validAccountTwoCursor` is produced by `encodeCursor()` for a
different account rather than being a hand-written string.

- [ ] **Step 2: Run and verify missing query modules**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message/query-emails.test.ts tests/thread/query-threads.test.ts tests/search tests/changes/get-changes.test.ts
```

Expected: FAIL because query and cursor modules do not exist.

- [ ] **Step 3: Define stable cursor payloads**

```ts
export type EmailCursorPayload = {
  accountId: MailAccountId;
  sort: 'receivedAt' | 'sentAt' | 'size' | 'subject';
  direction: 'asc' | 'desc';
  value: string;
  emailId: EmailId;
};
```

Encode canonical JSON with base64url. Validate every decoded field with Zod and verify account,
sort, and direction match the active query.

- [ ] **Step 4: Implement Changes response**

```ts
export type ChangesResult = {
  oldState: string;
  newState: string;
  hasMoreChanges: boolean;
  created: string[];
  updated: string[];
  destroyed: string[];
};
```

Collapse multiple changes for one entity between states: created then updated remains created;
created then destroyed disappears; updated then destroyed becomes destroyed.

- [ ] **Step 5: Create the public MailCore facade**

Create the public facade:

```ts
export const createMailCore = (dependencies: MailCoreDependencies): MailCore => ({
  createAccount: (input) => createMailAccount(dependencies, input),
  createIdentity: (input) => createIdentity(dependencies, input),
  updateIdentity: (input) => updateIdentity(dependencies, input),
  destroyIdentity: (input) => destroyIdentity(dependencies, input),
  createMailbox: (input) => createMailbox(dependencies, input),
  updateMailbox: (input) => updateMailbox(dependencies, input),
  destroyMailbox: (input) => destroyMailbox(dependencies, input),
  importEmail: (input) => importEmail(dependencies, input),
  getEmail: (input) => getEmail(dependencies, input),
  queryEmails: (input) => queryEmails(dependencies, input),
  updateEmail: (input) => updateEmail(dependencies, input),
  destroyEmail: (input) => destroyEmail(dependencies, input),
  createDraft: (input) => createDraft(dependencies, input),
  updateDraft: (input) => updateDraft(dependencies, input),
  destroyDraft: (input) => destroyDraft(dependencies, input),
  createSubmission: (input) => createSubmission(dependencies, input),
  cancelSubmission: (input) => cancelSubmission(dependencies, input),
  getThread: (input) => getThread(dependencies, input),
  queryThreads: (input) => queryThreads(dependencies, input),
  getChanges: (input) => getChanges(dependencies, input),
});
```

Export the facade constructor, public command functions (including the maintenance-only
`garbageCollectBlobs` command), domain types, errors, and adapter ports from `src/index.ts`; do not
export memory test adapters from the package root.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter=@zero/mail-core test -- tests/message/query-emails.test.ts tests/thread/query-threads.test.ts tests/search tests/changes
pnpm --filter=@zero/mail-core typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit query and Changes behavior**

```bash
git add packages/mail-core/src/message/query-emails.ts packages/mail-core/src/thread/query-threads.ts packages/mail-core/src/search packages/mail-core/src/changes packages/mail-core/tests packages/mail-core/src/index.ts
git commit -m "feat(mail-core): add queries and changes"
```

---

### Task 11: Implement PostgreSQL repositories and transactional integration tests

**Files:**

- Create: `apps/server/src/modules/mail/postgres/repositories/account-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/mailbox-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/blob-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/thread-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/email-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/identity-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/submission-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/change-repository.ts`
- Create: `apps/server/src/modules/mail/postgres/repositories/index.ts`
- Create: `apps/server/src/modules/mail/postgres/postgres-unit-of-work.ts`
- Create: `apps/server/src/modules/mail/search/postgres-search-store.ts`
- Modify: `apps/server/src/db/index.ts`
- Create: `apps/server/tests/mail-core/helpers/database.ts`
- Create: `apps/server/tests/mail-core/helpers/harness.ts`
- Create: `apps/server/tests/mail-core/repositories.integration.test.ts`
- Create: `apps/server/tests/mail-core/import-email.integration.test.ts`
- Create: `apps/server/tests/mail-core/mailbox-operations.integration.test.ts`
- Create: `apps/server/tests/mail-core/drafts.integration.test.ts`
- Create: `apps/server/tests/mail-core/submissions.integration.test.ts`
- Create: `apps/server/tests/mail-core/changes.integration.test.ts`

**Interfaces:**

- Consumes: `DB`, Drizzle schema, all `@zero/mail-core` repository interfaces.
- Produces: `PostgresMailUnitOfWork`, repositories, `PostgresSearchStore`.

- [ ] **Step 1: Add an isolated PostgreSQL test-schema helper**

```ts
export const withMailTestDatabase = async (
  test: (input: {
    db: DB;
    unitOfWork: PostgresMailUnitOfWork;
    harness: PostgresMailTestHarness;
  }) => Promise<void>,
) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for mail-core integration tests');

  const schemaName = `mail_core_test_${crypto.randomUUID().replaceAll('-', '')}`;
  if (!/^mail_core_test_[a-f0-9]{32}$/.test(schemaName)) {
    throw new Error('Unsafe mail-core test schema name');
  }

  const admin = postgres(databaseUrl, { max: 1 });
  await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
  const isolated = new URL(databaseUrl);
  isolated.searchParams.set('options', `-csearch_path=${schemaName}`);
  const conn = postgres(isolated.toString(), { max: 1 });
  const db = createDrizzle(conn);

  try {
    await migrate(db, {
      migrationsFolder: resolve(process.cwd(), 'src/db/migrations'),
    });
    const unitOfWork = new PostgresMailUnitOfWork(db);
    await test({
      db,
      unitOfWork,
      harness: await createPostgresMailTestHarness({ db, unitOfWork }),
    });
  } finally {
    await conn.end();
    if (!/^mail_core_test_[a-f0-9]{32}$/.test(schemaName)) {
      throw new Error('Refusing to drop unsafe test schema');
    }
    await admin.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await admin.end();
  }
};
```

Resolve `DATABASE_URL` from the existing test environment. Validate the generated schema name
against `/^mail_core_test_[a-f0-9]{32}$/` before `CREATE SCHEMA` and again before
`DROP SCHEMA ... CASCADE`. Never drop `public`, a database, or a user-provided schema.

- [ ] **Step 2: Write failing repository integration tests**

```ts
import { describe, expect, it } from 'vitest';

import { withMailTestDatabase } from './helpers/database';

describe('PostgreSQL mail adapters', () => {
  it('rolls back relationships, counters, state, and Changes together', () =>
    withMailTestDatabase(async ({ harness }) => {
      const before = await harness.snapshot();
      await expect(harness.runFailingEmailTransaction()).rejects.toThrow('forced rollback');
      expect(await harness.snapshot()).toEqual(before);
    }));

  it('enforces account and concurrency invariants', () =>
    withMailTestDatabase(async ({ harness }) => {
      await expect(harness.insertCrossAccountEmailMailbox()).rejects.toThrow();

      const roleResults = await Promise.allSettled([
        harness.createSystemMailbox('inbox'),
        harness.createSystemMailbox('inbox'),
      ]);
      expect(roleResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(roleResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);

      const importResults = await Promise.all([
        harness.importFixture('remote-1'),
        harness.importFixture('remote-1'),
      ]);
      expect(new Set(importResults.map(({ emailId }) => emailId)).size).toBe(1);
    }));

  it('serializes Draft revisions and account state allocation', () =>
    withMailTestDatabase(async ({ harness }) => {
      const draft = await harness.createDraft();
      const revisionResults = await Promise.allSettled([
        harness.updateDraft(draft.id, 1),
        harness.updateDraft(draft.id, 1),
      ]);
      expect(revisionResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(revisionResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);

      const states = await Promise.all([
        harness.allocateState(),
        harness.allocateState(),
        harness.allocateState(),
      ]);
      expect(states.map(String).sort()).toEqual(['1', '2', '3']);
      await expect(harness.assertStablePagination()).resolves.toBeUndefined();
    }));
});
```

- [ ] **Step 3: Run and verify missing repositories**

Run:

```bash
pnpm --dir apps/server exec vitest run tests/mail-core/*.integration.test.ts
```

Expected: FAIL because `PostgresMailUnitOfWork` and repositories do not exist.

- [ ] **Step 4: Implement repositories with account-scoped predicates**

Every read/update/delete includes `mailAccountId` in its predicate. Use PostgreSQL row locking on
`mail_account` when allocating a state version and on Draft Email when checking a revision.
Translate unique violations to `MAILBOX_ROLE_CONFLICT`, `IDEMPOTENCY_CONFLICT`, or
`DRAFT_REVISION_CONFLICT`; do not expose raw SQL errors from the adapter.

Export the existing `createDrizzle(conn)` function from `apps/server/src/db/index.ts` so the
isolated-schema test helper and production `createDb()` use the same schema registration.

- [ ] **Step 5: Implement PostgreSQL full-text search**

Maintain a `tsvector` projection from normalized subject, addresses, and plain-text body in the same
transaction as Email content. Query with `websearch_to_tsquery`, always scope by MailAccount, and
apply keyset sorting from the decoded cursor.

- [ ] **Step 6: Run integration tests and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run tests/mail-core/*.integration.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit PostgreSQL adapters**

```bash
git add apps/server/src/modules/mail/postgres apps/server/src/modules/mail/search apps/server/src/db/index.ts apps/server/tests/mail-core
git commit -m "feat(mail-core): add PostgreSQL adapters"
```

---

### Task 12: Compose the Server runtime, add R2 boundary, and verify phase-one isolation

**Files:**

- Create: `apps/server/src/modules/mail/blob/memory-blob-store.ts`
- Create: `apps/server/src/modules/mail/blob/r2-blob-store.ts`
- Create: `apps/server/src/modules/mail/runtime/create-mail-core.ts`
- Create: `apps/server/src/modules/mail/index.ts`
- Create: `apps/server/tests/mail-core/r2-blob-store.test.ts`
- Create: `apps/server/tests/mail-core/runtime-boundary.test.ts`
- Modify: `apps/server/package.json`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: DB, `R2Bucket`, `PostgresMailUnitOfWork`, HTML sanitizer adapter.
- Produces: `createMailCoreRuntime({ db, blobStore, clock, idFactory, sanitizeHtml })`.

- [ ] **Step 1: Write failing runtime boundary tests**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { R2BlobStore } from '../../src/modules/mail/blob/r2-blob-store';
import { createMailCoreRuntime } from '../../src/modules/mail';

describe('mail runtime boundary', () => {
  it('constructs with memory adapters without Cloudflare globals', () => {
    expect(() => createMemoryMailRuntime()).not.toThrow();
  });

  it('uses validated account-scoped content-addressed R2 keys', async () => {
    const bucket = createFakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const bytes = new TextEncoder().encode('blob');
    const pending = await store.putTemporary({
      accountId: '01MAILACCOUNT' as MailAccountId,
      bytes,
      contentType: 'text/plain',
    });
    await store.commitTemporary({
      temporaryKey: pending.temporaryKey,
      objectKey:
        'mail/01MAILACCOUNT/sha256/fa/' +
        'fa2c8cc4f28176bbeed4b736df569a34c79bda9ca11442153e001778d90253cb',
    });
    expect(bucket.put).toHaveBeenCalledTimes(2);
    await expect(store.get('../escape')).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
  });

  it('keeps runtime dependencies outside the pure core and preserves old routes', () => {
    const root = resolve(process.cwd(), '../..');
    const coreFiles = listTypeScriptFiles(resolve(root, 'packages/mail-core/src'));
    const forbidden = /@googleapis\/gmail|@microsoft|cloudflare:|R2Bucket|DurableObject|@trpc/;
    for (const file of coreFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(forbidden);
    }

    for (const route of [
      'apps/server/src/trpc/routes/mail.ts',
      'apps/server/src/trpc/routes/drafts.ts',
      'apps/server/src/trpc/routes/label.ts',
    ]) {
      expect(readFileSync(resolve(root, route), 'utf8')).not.toContain('createMailCoreRuntime');
    }
  });
});
```

Define `createFakeR2Bucket()` in the test file with `vi.fn()` implementations for `put`, `get`, and
`delete`; its `get` result implements `arrayBuffer()`. Define `listTypeScriptFiles(root)` using
`readdirSync(root, { withFileTypes: true })`, recurse only into directories under the supplied
`packages/mail-core/src` root, and return only `.ts` files. `createMemoryMailRuntime()` injects the
Task 3 memory unit of work/blob store, fixed clock, deterministic ID factory, and identity HTML
sanitizer.

The static boundary test searches `packages/mail-core/src` for:

```ts
['@googleapis/gmail', '@microsoft', 'cloudflare:', 'R2Bucket', 'DurableObject', '@trpc'];
```

and expects no matches.

- [ ] **Step 2: Run and verify missing runtime**

Run:

```bash
pnpm --dir apps/server exec vitest run tests/mail-core/r2-blob-store.test.ts tests/mail-core/runtime-boundary.test.ts
```

Expected: FAIL because the runtime and R2 adapter do not exist.

- [ ] **Step 3: Implement account-scoped R2 storage**

Keys use:

```text
mail/<mailAccountId>/sha256/<first-two-hex>/<sha256>
```

Validate `mailAccountId` and lowercase 64-character SHA-256 before constructing a key. Use
conditional put to avoid replacing an existing content-addressed object. `delete()` accepts a
validated object key returned by the adapter, not arbitrary user input.

- [ ] **Step 4: Add focused scripts**

Add to `apps/server/package.json`:

```json
"test:mail-core": "vitest run src/modules/mail tests/mail-core"
```

Add to root `package.json`:

```json
"test:mail-core": "pnpm --filter=@zero/mail-core test && pnpm --dir apps/server test:mail-core"
```

Document only the backend-local core test command and the fact that existing frontend/provider
paths are not switched in phase one.

- [ ] **Step 5: Run complete phase-one verification**

Run:

```bash
pnpm --filter=@zero/mail-core test
pnpm --filter=@zero/mail-core typecheck
pnpm --dir apps/server test:mail-core
pnpm --dir apps/server exec tsc --noEmit
pnpm exec prettier --check packages/mail-core apps/server/src/modules/mail apps/server/tests/mail-core
pnpm --dir apps/server exec eslint src/modules/mail tests/mail-core
git diff --check
```

Expected: every command exits 0. Do not run root `pnpm check`, `pnpm lint`, or `pnpm format`.

- [ ] **Step 6: Verify no frontend or Provider cutover occurred**

Run:

```bash
git diff main...HEAD -- apps/mail apps/server/src/trpc/routes/mail.ts apps/server/src/trpc/routes/drafts.ts apps/server/src/trpc/routes/label.ts apps/server/src/lib/driver
```

Expected: no diff.

- [ ] **Step 7: Commit runtime composition and documentation**

```bash
git add apps/server/src/modules/mail/blob apps/server/src/modules/mail/runtime apps/server/src/modules/mail/index.ts apps/server/tests/mail-core apps/server/package.json package.json README.md pnpm-lock.yaml
git commit -m "feat(mail-core): compose local mail runtime"
```

---

## Final Acceptance Checklist

- [ ] `packages/mail-core` has no Gmail, Cloudflare, tRPC, Drizzle, or Server imports.
- [ ] Empty PostgreSQL schema accepts migration `0041_local_mail_core`.
- [ ] Every local mail table uses the `mail0_` prefix.
- [ ] Email, Mailbox, Thread, Keyword, Blob, Identity, EmailSubmission, Attempt, RemoteEmail, and
      Change models exist.
- [ ] Raw MIME bytes are immutable and byte-for-byte retrievable.
- [ ] Received and sent Email content is immutable.
- [ ] Draft Email uses `$draft`, Drafts Mailbox, and optimistic revision.
- [ ] Visible Email always has at least one Mailbox and exactly one Thread.
- [ ] Provider ID and local ID are separate.
- [ ] Mailbox, Keyword, Draft, Trash, Destroy, Thread merge, and Submission behavior records atomic
      Changes.
- [ ] Account state version is monotonic under concurrency.
- [ ] Trash, permanent deletion, and Blob GC are distinct.
- [ ] Submission state transitions and Attempt history pass tests.
- [ ] Email/Thread queries use stable keyset cursors.
- [ ] PostgreSQL text search is account scoped.
- [ ] All focused unit, integration, type, format, and lint checks pass.
- [ ] Existing frontend and Provider mail paths have no diff.
- [ ] No real Provider network request occurs in phase one.

## Reference Map

| Zero area                              | Normative/reference source                         |
| -------------------------------------- | -------------------------------------------------- |
| Email, Mailbox, Thread, Keyword        | RFC 8621; Stalwart `crates/types`, `crates/email`  |
| State and Changes                      | RFC 8620/8621; Stalwart `crates/jmap/src/changes`  |
| MIME and Blob metadata                 | RFC 5322, RFC 2045–2049; Stalwart message metadata |
| Relational entities and remote mapping | Nylas Sync Engine `inbox/models`                   |
| Submission retry and attempt history   | Stalwart EmailSubmission; Postal queue/deliveries  |
| Future Provider plugin boundary        | EmailEngine `lib/email-client`, `workers`          |
