# Task 11 Report — PostgreSQL Adapters and Transactional Integration

## Result

Implemented the phase-one PostgreSQL mail persistence boundary on
`codex/local-mail-core` from base `789dbd5111e24d542f9af777ecd1e798d746cf22`.
The implementation stays inside the approved PostgreSQL/core-port scope: no route,
frontend, provider, R2, or runtime cutover was made.

## Delivered

- Completed Drizzle schema and migration `0041_local_mail_core.sql` with:
  - account-scoped Email Identity, Blob, Thread, self-reply, Mailbox, content, part,
    Submission, and Attempt relationships;
  - retained-state floor, frozen Submission draft revision, ordered relation positions,
    lifecycle/status/nonnegative checks, and active Mailbox uniqueness;
  - an account-scoped `tsvector` search projection with a GIN index.
- Implemented every current mail-core repository contract plus
  `PostgresMailUnitOfWork`:
  - one real transaction and one callback invocation;
  - account row locking and atomic, rollback-safe state allocation;
  - account predicates on scoped reads/writes/deletes;
  - safe known-constraint mappings and non-leaking unknown storage failures;
  - deterministic Change ordering and cutoff-state soft-limit expansion.
- Added a narrow private search-document port. Import and Draft create/update publish
  normalized subject, address, and full parsed body text transactionally without
  adding body text to public `EmailRecord`.
- Implemented PostgreSQL search filters, case-folded address/subject behavior,
  `websearch_to_tsquery`, destroyed-Email exclusion, typed keysets, deterministic ID
  ties, and nullable `sentAt` ordering.
- Added a real PostgreSQL harness which applies the complete migration journal in a
  cryptographically random, regex-validated isolated schema and drops only that
  generated schema in `finally`.

## Concurrency and outcome characterization

- Controlled barriers prove same-account locks serialize while another account
  progresses independently.
- Concurrent identical imports return one Email identity.
- Concurrent Draft updates from one expected revision yield one success and one
  `DRAFT_REVISION_CONFLICT`.
- Concurrent root/sibling/role conflicts yield exactly one success at the applicable
  database boundary.
- Rolled-back state allocations, Email aggregates, relations, and Changes do not
  publish and do not leave state-version gaps.
- The unit-of-work callback is invoked exactly once and is never automatically
  replayed. A driver failure after callback completion can have an unknown commit
  outcome; callers must reconcile by durable idempotency identity and must not blindly
  replay side effects.

## Database safety

- PostgreSQL was reachable through the configured local Docker environment.
- Each integration invocation used a name matching
  `^mail_core_test_[a-f0-9]{32}$`.
- The helper validates the generated name before create and drop, replaces only the
  exact historical `"public".` migration token, uses exact journal order and statement
  breakpoints, closes both clients, and never writes application rows in `public`.
- No connection URL, credential, raw MIME, SQL text, row body, driver message, or
  constraint name is exposed through adapter errors or this report.

## Verification evidence

- PostgreSQL integration: **8 files, 15 tests passed**.
- Schema definition/parity: **1 file, 17 tests passed**.
- Server Task 11 aggregate: **11 files, 36 tests passed**.
- `@zero/mail-core`: **23 files, 223 tests passed**.
- `@zero/mail-core` typecheck: **passed**.
- Task 11 server ESLint paths: **0 errors**. The server ESLint base ignores files
  outside `apps/server`; core paths are covered by their clean typecheck and test suite.
- Full server typecheck: exits nonzero on the established unrelated baseline.
  A disposable `git archive` of the base commit, supplied the same ignored generated
  worker declaration and dependency installation, produced **79 diagnostics**.
  The working branch also produced **79 diagnostics**, with **0 differences** in
  `(file, line, column, TypeScript code)` signatures and **0 diagnostics** in Task 11
  files.
- Prettier: all source, test, package, and report paths passed. The generated
  `pnpm-lock.yaml` is in pnpm's canonical format but the repository's existing lockfile
  is not Prettier-clean; formatting it would mechanically rewrite thousands of
  unrelated lines. `git diff --check` passed.

The required wildcard Vitest spelling is not expanded by this Windows invocation and
reports no matching test file. The equivalent explicit eight-file invocation above is
the authoritative integration run.

## Review ledger

The first independent staged-diff review returned **FAIL** with no Critical findings,
five Important findings, and one Minor finding:

1. UoW-owned lock/state driver failures could bypass safe translation.
2. Cross-account FK mapping was incomplete/misclassified and the mandatory
   all-relationship database evidence was missing.
3. test-database cleanup steps were not failure-independent.
4. Blob/Thread/Identity repository round trips and immutable old Draft body Blobs were
   not explicitly proven.
5. Search did not explicitly prove a foreign account row was excluded or consume typed
   `sentAt`, `size`, and `subject` cursors.

All Important findings were fixed with regressions:

- owned UoW driver failures now become `STORAGE_FAILURE` with empty details;
- real PostgreSQL rejects every relevant foreign aggregate relationship with
  `CROSS_ACCOUNT_REFERENCE`;
- isolated close, validated drop, and admin close are all attempted independently
  while preserving the primary test failure;
- Blob/Thread/Identity contracts round-trip and old Draft revision body objects remain
  byte-for-byte retrievable;
- search excludes an actual matching foreign-account Email and traverses all typed
  keysets, including nullable `sentAt`.

The Minor finding is ledgered for later: a relation-only update against a missing Email
can reach a constraint-derived error before returning `EMAIL_NOT_FOUND`. Current public
core commands establish Email existence before relation replacement, so this does not
create cross-account access or leakage and was not included in the mandatory fix loop.

The first post-fix re-review verified those five findings, then found one remaining
Important semantic issue: physical Identity deletion was incompatible with the core
contract that permits deletion after referencing Submissions become terminal. The
PostgreSQL adapter now uses an internal `deleted_at` marker and filters deleted
Identities from repository reads/updates while retaining the row for Email and terminal
Submission foreign-key history. A public-core real-PostgreSQL regression proves:

- deletion still rejects while the Submission is nonterminal;
- deletion succeeds after the Submission is sent;
- the deleted Identity is no longer returned;
- the frozen Submission continues to retain its original `identityId`.

The first re-review also ledgered two additional Minor findings:

- the report still said seven explicit integration files after the constraint suite
  increased the total to eight (corrected above);
- all mail tables use `createMailTable`, but there is no separate all-table prefix
  assertion beyond applying and exercising the correctly prefixed migration.

Final post-fix re-review: **PASS** — zero Critical and zero Important findings. The
reviewer verified the Identity soft-delete behavior, cross-account mappings, migration
parity, UoW sanitation, cleanup independence, constraint coverage, immutable Draft
Blobs, repository round trips, search isolation/keysets, and safe error handling in the
current staged diff. The two Minor findings above remain ledgered.

## Deferred Task 12 requirements

Task 12 must:

- add server-owned memory and R2 BlobStore adapters;
- validate account-scoped content-addressed R2 keys and prevent traversal/arbitrary
  deletion;
- compose `createMailCoreRuntime` from DB, BlobStore, clock, ID factory, and sanitizer;
- add runtime/R2 boundary tests and focused mail-core scripts;
- document the backend-local verification command;
- prove pure core has no Gmail, Microsoft, Cloudflare, R2, Durable Object, tRPC, or
  server imports;
- prove existing frontend, provider, and tRPC routes remain unchanged;
- run complete phase-one verification before its separate runtime-composition commit.
