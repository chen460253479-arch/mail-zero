# Task 12 Report — BlobStore boundaries, runtime composition, and phase-one acceptance

## Result

Implemented Task 12 from base `11d6e3e7720fea0d6477a44eae4bde4bcb69d526` on
`codex/local-mail-core`. The server can now compose the provider-independent facade from a
PostgreSQL database, a supplied BlobStore, clock, ID factory, and HTML sanitizer. No frontend,
tRPC mail route, provider driver, or provider network behavior was changed.

## TDD evidence

Initial RED:

- `pnpm --dir apps/server exec vitest run tests/mail-core/r2-blob-store.test.ts
tests/mail-core/runtime-boundary.test.ts`
  - failed during collection because `src/modules/mail/index.ts`, the R2 adapter, and runtime did
    not exist.
- `pnpm --filter=@zero/mail-core test -- tests/message/import-email.test.ts`
  - 20 passed, 1 failed because persisted Blob keys still used
    `mail/<account>/blobs/<blobId>`.

Focused GREEN:

- R2/runtime boundary: 2 files, 20 tests passed.
- content-addressed Import/Draft/GC and Blob fake: 4 files, 51 tests passed.
- schema inventory plus direct PostgreSQL catalog prefix assertion: 2 files, 18 tests passed.

Two content-addressing integration risks were found with focused RED regressions before their
fixes:

1. GC deleted shared object bytes while a second Blob metadata record still owned the same
   content-addressed key. The regression failed at the byte-presence assertion, then passed after
   GC began deleting the object only when the final metadata owner is collected.
2. A failed duplicate Draft promotion could compensate by deleting bytes owned by an earlier
   immutable revision. The regression failed with one old object missing, then passed after Draft
   compensation began tracking only newly owned object keys.

The first independent staged-diff review found three blocking BlobStore boundary defects. A new
R2 regression set first ran RED with 8 failures across 20 tests:

1. legal-shaped keys belonging to another account could be used by get/delete/deleteTemporary;
2. retrying promotion after temporary deletion succeeded but its acknowledgement was lost returned
   `BLOB_NOT_FOUND`;
3. a bucket-thrown `MailCoreError` could retain private details.

The fixes made account context mandatory in the pure-core BlobStore contract and every production,
fake, command, helper, and test call site. Server adapters now bind validated keys to that trusted
account. R2 promotion now recognizes a missing temporary object plus an already committed,
digest-matching target as an idempotent retry. The retry regression verifies the final bytes and
that `bucket.put` remains at two calls (temporary plus the original promotion), proving the retry
does not overwrite the committed object. Every bucket exception is reconstructed as a safe
`BLOB_STORE_FAILURE` with empty details. The focused R2 suite then passed all 20 tests, and the
pure-core compile check proves calls without `accountId` no longer satisfy the contract.

## Delivered

- `MemoryBlobStore` is a server-owned production adapter, independent of the pure-core test fake.
- `R2BlobStore`:
  - uses exactly `mail/<mailAccountId>/sha256/<first-two-hex>/<lowercase-sha256>`;
  - generates account-scoped UUID temporary keys;
  - rejects traversal, separators, invalid accounts, uppercase/malformed digests, wrong shards,
    malformed prefixes, cross-account promotion, and content/digest mismatch;
  - promotes with `onlyIf: { etagDoesNotMatch: '*' }`;
  - verifies a pre-existing object byte-for-byte on duplicate promotion;
  - requires trusted account context and validates get/delete/deleteTemporary/promotion keys
    against it;
  - retries safely after a lost temporary-delete acknowledgement without rewriting the committed
    object;
  - maps bucket failures to stable `BLOB_STORE_FAILURE` errors with empty details;
  - is structurally type-compatible with the generated Cloudflare `R2Bucket` contract.
- `createMailCoreRuntime(...)` constructs `PostgresMailUnitOfWork` and `PostgresSearchStore` from
  the supplied DB and returns the public pure-core facade without accessing the DB at construction.
- Pure-core Blob metadata and GC now use the same account-scoped SHA-256 object-key format required
  by R2.
- Added root/server `test:mail-core` scripts and phase-one README documentation.
- Added a recursive pure-core dependency boundary test and a no-route-cutover assertion.
- Added the deferred direct PostgreSQL catalog assertion; its inventory is derived from all exports
  of the local-mail schema, so a newly exported local-mail table cannot bypass the prefix check.

## Final verification evidence

- `pnpm --filter=@zero/mail-core test`
  - 23 files, 225 tests passed.
- `pnpm test:mail-core`
  - the documented root aggregate command passed the same 225 pure-core and 60 server tests.
- `pnpm --filter=@zero/mail-core typecheck`
  - passed.
- `pnpm --dir apps/server test:mail-core`
  - 14 files, 60 tests passed, including all real PostgreSQL integration tests.
- `pnpm --dir apps/server exec tsc --noEmit`
  - honestly remains nonzero on the established unrelated baseline.
  - a fresh disposable `git archive` of Task 12 base produced 79 diagnostics;
  - current Task 12 also produced 79 diagnostics;
  - after normalizing only archive-vs-workspace dependency path prefixes, the
    `(file, line, column, TS code)` signature delta was 0;
  - Task 12 files produced 0 diagnostics.
- `pnpm exec prettier --check packages/mail-core apps/server/src/modules/mail
apps/server/tests/mail-core`
  - remains nonzero only for three pre-existing, untouched files:
    `src/store/unit-of-work.ts`, `src/types/keyword.ts`, and
    `tests/store/unit-of-work.test.ts`.
  - an explicit check of every Task 12 touched source, test, docs, and package path passed.
- `pnpm --dir apps/server exec eslint src/modules/mail tests/mail-core`
  - exited 0 with no lint errors (only the repository React-version configuration warning).
- `git diff --check`
  - passed.
- Both committed-range and working-tree no-cutover checks returned 0 lines for:
  `apps/mail`, the mail/drafts/label tRPC routes, and `apps/server/src/lib/driver`.
- The boundary suite recursively scanned only `packages/mail-core/src/**/*.ts`; it found no Gmail,
  Microsoft, Cloudflare, R2Bucket, DurableObject, tRPC, or server-module dependency.
- No Provider request or external network request was made.

## Scope and integration decision

The narrow pure-core content-addressing changes are required for runtime usability: before this
task, the core supplied `mail/<account>/blobs/<blobId>` to `BlobStore.commitTemporary`, while the
approved R2 adapter is required to accept only the SHA-256 key format. Leaving that mismatch would
allow construction tests to pass while every real Import or Draft promotion failed. The changes
were limited to object-key allocation, compensation ownership, GC ownership, the pure-core memory
test fake, and their direct regressions.

## Review

First independent staged-diff review: CHANGES REQUIRED.

- Critical: legal-shaped cross-account BlobStore get/delete/deleteTemporary access.
- Important: promotion was not retryable after temporary deletion succeeded but its
  acknowledgement was lost.
- Important: bucket-thrown `MailCoreError` details could escape the adapter.
- Minor: the table-prefix test used a fixed 17-table list.
- Minor: this report still marked review pending.

All Critical and Important findings have dedicated RED-to-GREEN regressions and fixes described
above. The fixed table inventory is now schema-derived. This report records the review accurately.

Scoped independent re-review of the refreshed staged diff: PASS / APPROVED.

- C1 cross-account access: ADDRESSED.
- I1 acknowledgement-loss retry: ADDRESSED.
- I2 bucket error-detail leakage: ADDRESSED.
- M1 fixed table inventory: ADDRESSED.
- M2 pending review report: ADDRESSED.
- No new Critical or Important findings.
- Reviewer verification: pure-core typecheck passed; R2/runtime focused suite passed 23 tests;
  cached diff check passed; the review package matched the cached diff; `AGENTS.md` remained the
  only untracked path.
- Final verdicts: `SPEC COMPLIANCE = PASS`; `TASK QUALITY = APPROVED`.

## Staged paths

- `.superpowers/sdd/2026-07-25-local-mail-core/task-12-report.md`
- `README.md`
- `apps/server/package.json`
- `apps/server/src/modules/mail/blob/blob-key.ts`
- `apps/server/src/modules/mail/blob/memory-blob-store.ts`
- `apps/server/src/modules/mail/blob/r2-blob-store.ts`
- `apps/server/src/modules/mail/index.ts`
- `apps/server/src/modules/mail/runtime/create-mail-core.ts`
- `apps/server/tests/mail-core/drafts.integration.test.ts`
- `apps/server/tests/mail-core/r2-blob-store.test.ts`
- `apps/server/tests/mail-core/runtime-boundary.test.ts`
- `apps/server/tests/mail-core/table-prefix.integration.test.ts`
- `package.json`
- `packages/mail-core/src/message/blob-lifecycle.ts`
- `packages/mail-core/src/message/create-draft.ts`
- `packages/mail-core/src/message/garbage-collect-blobs.ts`
- `packages/mail-core/src/message/import-email.ts`
- `packages/mail-core/src/message/update-draft.ts`
- `packages/mail-core/src/store/blob-store.ts`
- `packages/mail-core/src/testing/fakes.ts`
- `packages/mail-core/src/testing/memory-blob-store.ts`
- `packages/mail-core/src/types/errors.ts`
- `packages/mail-core/tests/helpers/draft-harness.ts`
- `packages/mail-core/tests/helpers/email-harness.ts`
- `packages/mail-core/tests/helpers/query-harness.ts`
- `packages/mail-core/tests/message/draft.test.ts`
- `packages/mail-core/tests/message/garbage-collect-blobs.test.ts`
- `packages/mail-core/tests/message/import-email.test.ts`
- `packages/mail-core/tests/message/query-emails.test.ts`
- `packages/mail-core/tests/store/memory-blob-store.test.ts`

The required Task 12 report is force-staged because the SDD workspace is ignored by default. Other
brief/progress/review artifacts remain ignored and unstaged. The user's untracked `AGENTS.md` is
untouched and not staged. No lockfile, credential, `.dev.vars`, generated archive, frontend, route,
or provider file is staged.
