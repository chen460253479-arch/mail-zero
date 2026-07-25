# Task 8 Report: Draft Email Revisions

## Outcome

Implemented account-scoped Draft Email creation, optimistic revision updates, and
permanent Draft destruction:

- structured `DraftContent` and public create/update/destroy command types;
- revision 1, `$draft`, and Drafts Mailbox projection on creation;
- stable local Message-ID and immutable Raw/text/HTML Blob objects per revision;
- persisted reply-target identity with immutable/self-reference validation;
- deterministic `mimetext` rendering with CRLF, deterministic boundaries, and caller
  recipient/attachment order;
- account-scoped Identity, reply Email, and ready attachment Blob validation;
- quota, Blob integrity, commit verification, temporary cleanup, and committed-object
  compensation;
- exact Draft/Thread/Mailbox projections and atomic Changes at one state version;
- optimistic stale-revision rejection and received/sent content immutability;
- Draft destruction through the existing tombstone and GC-candidate lifecycle.

No Provider, frontend, server, Drizzle, or live application adapter code was added.

## TDD Evidence

### Initial RED

Command:

```text
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts
```

Result: exit 1; 1 file failed and all 10 Draft tests failed with
`createDraft is not a function`. This proved the Draft command surface was absent
before implementation.

The test cases name and exercise the production breaks they catch: missing revision-1
projection, Blob overwrite or Message-ID regeneration, stale-write acceptance,
non-Draft mutation, cross-account references, missing reply Threading, random/LF MIME,
Blob failure publication, pending/over-quota publication, and incomplete destruction.
All tests use the real memory UoW and memory BlobStore.

### GREEN and Debugging Evidence

The first implementation run passed 8 tests and failed 2 update tests with
`Do not know how to serialize a BigInt`. The stack traced the fault to change-property
comparison attempting to JSON-serialize `sizeBytes`. Replacing that comparison with
Node's deep strict equality was the single root-cause fix.

Pre-review focused Draft verification:

```text
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts
```

Result: exit 0; 1 file passed, 10 tests passed.

Typecheck:

```text
pnpm --filter=@zero/mail-core typecheck
```

Result: exit 0.

Full mail-core suite:

```text
pnpm --filter=@zero/mail-core test
```

Result after the review fix round: exit 0; 16 files passed, 103 tests passed.

## Blob and Revision Semantics

- Creation generates the Email ID and `<emailId@local.zero>` Message-ID once, renders
  revision 1, and persists new Raw/text/HTML Blobs.
- Every accepted update requires the exact current `expectedRevision`, increments the
  revision once, reuses the stored Message-ID and original Date, and allocates new
  immutable Raw/body object keys. It never overwrites or deletes the prior revision.
- Attachment Blobs are referenced in input order; they must belong to the account,
  remain `ready`, and pass byte-level SHA-256 and size verification. Attachment bytes
  are not copied into new standalone Blob records.
- Quota is calculated from the post-mutation reference set. The replaced revision is
  excluded, while other Email references, attachment references, and all new revision
  objects are counted once.
- Blob metadata begins `pending`; each object commit is receipt-checked, byte-verified,
  and marked `ready` inside the locked mutation. Failure rolls back metadata/content,
  removes newly committed objects, and discards all remaining temporary objects.
- Replaced and destroyed revision Blob metadata/objects remain unreferenced and eligible
  for the existing age-bounded garbage collector.

## Files

Created:

- `packages/mail-core/src/message/draft-types.ts`
- `packages/mail-core/src/message/render-draft.ts`
- `packages/mail-core/src/message/create-draft.ts`
- `packages/mail-core/src/message/update-draft.ts`
- `packages/mail-core/src/message/destroy-draft.ts`
- `packages/mail-core/tests/helpers/draft-harness.ts`
- `packages/mail-core/tests/message/draft.test.ts`

Modified:

- `packages/mail-core/src/message/index.ts`
- `packages/mail-core/src/message/destroy-email.ts`
- `packages/mail-core/src/message/import-email.ts`
- `packages/mail-core/src/store/repositories.ts`
- `packages/mail-core/src/testing/memory-mail-store.ts`
- `packages/mail-core/src/testing/memory-blob-store.ts`
- `packages/mail-core/src/types/errors.ts`

Report:

- `.superpowers/sdd/2026-07-25-local-mail-core/task-8-report.md`

## Self-Review

- Verified every caller-supplied Identity, reply Email, and attachment Blob lookup is
  account-scoped and revalidated after the mutation acquires the account lock.
- Verified actual create/update/destroy mutations take one account lock and allocate one
  state version through `recordChanges`; rejected operations publish neither state nor
  Changes.
- Verified create/update Blob commits occur within the same transaction as Email,
  Thread, Mailbox, and Changes publication, with the established unknown-commit-outcome
  compensation guard.
- Verified stable Message-ID, deterministic Date/boundaries, CRLF-only output, readable
  ASCII Subject headers, ordered To/Cc/Bcc and attachments, and absence of Provider
  headers.
- Verified updates never mutate received/sent Email content and `destroyDraft` rejects
  those lifecycles.
- Verified Thread and Mailbox aggregates are recomputed through the existing shared
  projection helpers, with all affected Changes sharing the command state.
- Verified old revision objects remain present and ready after update/destruction.
- Verified only Task 8 files and the two required core error/export extensions are in
  scope, plus one test-fault injection on the existing memory BlobStore. `AGENTS.md`
  remains untracked and will not be staged.

## Concerns / Follow-up

- `DraftContent` carries attachment Blob IDs but no user filename metadata. MIME parts
  therefore use the stable Blob ID as the filename until a later public attachment
  metadata contract is introduced.
- The memory UoW serializes every transaction, which is stronger than the account lock
  port. Production same-account optimistic races still need the planned adapter
  integration coverage.
- `replyToEmailId` is a new nullable mail-core Email port field. The existing server
  Drizzle Email schema does not yet carry that self-reference; Task 11 must add and map
  it (or an equivalent persisted column) without changing the Task 8 core contract.
- Provider-specific send-time header removal and Bcc delivery handling belong to the
  later submission/provider boundary; Draft MIME intentionally contains no Provider
  header.
- The review noted that attachment verification currently performs a second BlobStore
  read and maps failure on that second read to `BLOB_INTEGRITY`; consolidating fetch and
  verification while preserving transient `BLOB_STORE_FAILURE` is deferred minor
  hardening.
- `renderDraft` and `RenderDraftInput` are publicly barrel-exported even though the
  brief requires only the Draft commands and `DraftContent`. Narrowing that API surface
  is deferred to avoid changing the already verified public surface during this task.

## Review Fix Round

An independent read-only review found three Important integrity gaps. Regression tests
were added before each production correction.

Focused RED:

```text
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts
```

Result: exit 1; 3 tests failed and 10 passed:

- changing `replyToEmailId` resolved instead of rejecting, allowing MIME reply headers
  to disagree with the stored Thread and allowing self-reference;
- a standalone subject revision retained `Thread.normalizedSubject: "original subject"`;
- simulated promotion success followed by acknowledgement loss left one extra
  untracked object in the memory BlobStore.

Corrections:

- Draft reply targets are immutable after creation. Cross-thread changes and
  self-reference reject with `INVALID_PATCH` before Blob preparation.
- `normalizedSubject` follows the revised subject only when the Draft has no reply and
  is the sole visible Email in its Thread; that Thread change is recorded atomically
  with aggregate changes.
- Canonical destination keys are registered for best-effort idempotent compensation
  before promotion is attempted. The memory BlobStore can now inject one
  post-promotion acknowledgement failure to prove cleanup.

Focused GREEN:

```text
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts
```

Result: exit 0; 1 file passed, 13 tests passed.

The two Minor review observations—second-read Blob error classification and the broad
`renderDraft` export—are ledgered above as directed and were not changed.

### Reply-identity re-review

The first re-review found that comparing MIME header tuples did not prove target
identity when a referenced Email had a null or duplicate Message-ID.

Targeted RED:

```text
pnpm --filter=@zero/mail-core test -- tests/message/draft.test.ts -t "keeps the reply target immutable"
```

Result: exit 1; changing a standalone Draft to a different visible Email whose
test-only Message-ID was null resolved successfully instead of rejecting.

The Email core port now persists `replyToEmailId`. Imports set it to null, Draft
creation sets the exact structured target, updates compare the exact target ID in both
preflight and the locked transaction, and permanent destruction clears it with the
other content relationships. Standalone Thread ownership now uses the persisted target
rather than inferred header emptiness.

Targeted GREEN: exit 0; the selected regression passed and 12 unrelated Draft tests
were skipped.

Final staged re-review: PASS. The reviewer confirmed exact reply identity is persisted
and compared before rendering and again under the account lock, standalone ownership
uses that identity, imports/destruction handle the field, and no new Critical or
Important issue was introduced.
