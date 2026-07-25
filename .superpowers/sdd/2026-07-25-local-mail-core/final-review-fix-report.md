# Final review invariant fix report

## Scope

- Branch: `codex/local-mail-core`
- Fix base: `a41dd15c6f0d4ee8f06bffb209afa43f18c4c02e`
- Scope: the six Important findings in `final-review-findings.md`
- No frontend, tRPC route, or provider-driver cutover was made.
- The user's untracked `AGENTS.md` is excluded from the staged snapshot.

## Finding 1: immutable Submission payload

### RED

- The focused pure-core regression failed because a Submission exposed only
  `draftRevision`; after Draft replacement/destruction and GC, it had no immutable Raw or
  attachment references.
- The initial PostgreSQL invariant suite could not reload the accepted Raw MIME
  byte-for-byte independently of the mutable Draft.

### Implementation

- Added ordered `SubmissionBlobReference` records (`raw`, `text`, `html`, `part`) with
  Blob ID, position, digest, size, content type, and object key.
- Added normalized `mail0_submission_blob` storage with account-composite Submission and
  Blob foreign keys.
- Snapshot creation and Submission insertion share one transaction. Idempotent retries
  return the original snapshot even if the Draft has since changed.
- Memory and PostgreSQL repositories hydrate snapshots in deterministic
  raw/text/html/part-position order.
- GC treats every frozen Submission reference as strong.
- Draft and Import quota accounting unions Email and frozen Submission references in one
  Blob-ID Set, so a Blob is counted exactly once even when both projections reference it.

### Retention decision

Phase one retains frozen references for terminal as well as nonterminal Submissions.
This deliberately keeps the accepted payload/audit snapshot loadable and prevents GC
release until a future explicit retention/release policy exists.

### GREEN

- Pure-core attachment-bearing update/destroy/GC regression loads the original Raw MIME
  byte-for-byte.
- Real PostgreSQL test does the same and directly proves cross-account relation rejection.

## Finding 2: account-level serialization

### RED

- Barrier-start PostgreSQL probes demonstrated that Identity default selection, independent
  Identity updates, and mutual Mailbox parenting needed one account serialization point.
- Adding the unique default constraint also exposed an update-order failure when deleting
  the current default Identity and promoting its replacement.

### Implementation

- `createIdentity`, `updateIdentity`, and `updateMailbox` lock the account before the first
  domain read.
- Added the active-default partial unique index and safe
  `IDENTITY_DEFAULT_CONFLICT` mapping.
- Default Identity destruction now deletes the old default before promoting the
  replacement in the same transaction, satisfying the unique index without an observable
  gap.
- Constraint mapping recursively unwraps driver `cause` objects and never exposes SQL
  details.

### GREEN

- Barrier-based real PostgreSQL coverage passes for default creation/switch, two
  non-overlapping Identity updates, and mutual parent updates.
- Focused nested-driver-cause mapping test passes.

## Finding 3: Connection ownership

### RED

- The initial direct PostgreSQL mismatch probe showed that independent Connection and User
  foreign keys did not prove common ownership.

### Implementation

- Added referencable unique `(connection.id, connection.user_id)`.
- Replaced the independent MailAccount Connection reference with composite
  `(connection_id, user_id)` ownership.
- Mapped the ownership constraint to safe `CROSS_ACCOUNT_REFERENCE`.

### GREEN

- Real PostgreSQL tests pass for valid same-user creation and invalid cross-user creation;
  the latter returns only the stable core error.

## Finding 4: minimal sensitive tombstone

### RED

- Focused tests initially found retained address/content/search projections and sensitive
  subject/preview data after destroy.

### Implementation

- Added the narrow account-scoped `deleteSearchDocument` repository operation.
- Email and Draft destroy now clear Blob/reply/Identity references, Mailbox/restore/Keyword
  relations, address arrays, body/part projections, subject, preview,
  Message-ID/In-Reply-To/References headers, size, attachment marker, and parse warnings in
  the account-locked transaction.
- The search projection is physically deleted in that same transaction.

### GREEN

- Pure-core tests prove a blank minimal tombstone and absent memory search document.
- Direct PostgreSQL assertions first seed nonempty Message-ID/In-Reply-To/References and
  then prove those headers are cleared while address/content/part/search rows are absent or
  blank.

## Finding 5: Draft patch invariants

### RED

- Pure-core tests showed generic Email patches could remove `$draft`/Drafts from a Draft or
  add them to a non-Draft.

### Implementation

- Generic patches now reject either direction with `INVALID_PATCH`; lifecycle transitions
  remain owned by dedicated commands.
- Validation occurs before state allocation and Change publication.

### GREEN

- Both pure-core directions pass.
- PostgreSQL rollback coverage proves aggregate rows, state, and Changes remain unchanged.

## Finding 6: canonical Blob metadata

### RED

- Pure-core Draft regressions initially created duplicate metadata rows for identical body
  bytes.
- The legacy GC test directly seeded duplicate digest/size metadata, demonstrating the old
  non-unique behavior.

### Implementation

- Added unique `(mail_account_id, sha256, size_bytes)` in Drizzle and migration metadata.
- Draft allocation under the account lock resolves and byte-verifies an existing ready
  Blob, inserts/commits only genuinely new metadata, and counts unique Blob IDs for quota.
- Submission snapshots are included in Draft and Import quota accounting and GC
  reachability. Email and frozen Submission references are unioned by Blob ID before
  summing, preventing both omission and double charging.
- Memory storage rejects duplicate metadata with safe `BLOB_INTEGRITY`; PostgreSQL maps the
  residual unique race to the same nonleaking invariant error.
- The conflicting legacy GC test now proves duplicate metadata rejection and canonical
  object collection rather than preserving prohibited duplicate ownership.

### GREEN

- Pure-core repeated-body/compensation/GC regressions pass.
- Real PostgreSQL coverage proves one metadata row for identical Draft body bytes.
- Pure-core and PostgreSQL regressions prove a destroyed submitted Draft still consumes
  Import quota through its frozen references.

## Aggregate verification

- `pnpm test:mail-core`: PASS
  - pure core: 23 files, 229 tests
  - server mail-core: 15 files, 69 tests
  - total: 38 files, 298 tests
- `pnpm --dir packages/mail-core typecheck`: PASS
- `pnpm --dir apps/server exec drizzle-kit check`: PASS (`Everything's fine`)
- PostgreSQL migrations ran from scratch in the integration harness; all 69 server tests
  passed, including the 6-test final-review invariant suite.
- Server `tsc --noEmit --pretty false`:
  - fix base: 83 established diagnostics
  - current: 79 established diagnostics
  - normalized comparison: 4 base-only, 0 current-only
  - diagnostics in fix paths: 0
- Prettier: PASS on every touched TypeScript source/test path.
- ESLint: PASS on all touched server mail/schema/tests using the app config and all touched
  pure-core files using `packages/eslint-config/config.ts`.
- `git diff --check`: PASS.
- No-cutover diff against `main` and the unstaged snapshot is empty for `apps/mail`,
  server routes/tRPC, and provider drivers.

## Schema safety

- Only the unshipped `0041_local_mail_core.sql` and its matching
  `meta/0041_snapshot.json` were amended.
- `meta/_journal.json` is unchanged.
- All added local-mail tables retain the `mail0_` prefix.
- Schema/catalog tests cover the Submission Blob table/FKs/order key, Connection ownership
  key/FK, default Identity index, and Blob digest uniqueness.

## Exact staged paths

- `.superpowers/sdd/2026-07-25-local-mail-core/final-review-fix-report.md`
- `apps/server/src/db/migrations/0041_local_mail_core.sql`
- `apps/server/src/db/migrations/meta/0041_snapshot.json`
- `apps/server/src/db/schema.ts`
- `apps/server/src/modules/mail/postgres/repositories/database.ts`
- `apps/server/src/modules/mail/postgres/repositories/email-repository.ts`
- `apps/server/src/modules/mail/postgres/repositories/submission-repository.ts`
- `apps/server/src/modules/mail/postgres/schema/accounts.ts`
- `apps/server/src/modules/mail/postgres/schema/blobs.ts`
- `apps/server/src/modules/mail/postgres/schema/submissions.ts`
- `apps/server/tests/mail-core/constraints.integration.test.ts`
- `apps/server/tests/mail-core/drafts.integration.test.ts`
- `apps/server/tests/mail-core/final-review-invariants.integration.test.ts`
- `apps/server/tests/mail-core/postgres-unit-of-work.test.ts`
- `apps/server/tests/mail-core/schema-definition.test.ts`
- `packages/mail-core/src/account/manage-identity.ts`
- `packages/mail-core/src/mailbox/update-mailbox.ts`
- `packages/mail-core/src/message/create-draft.ts`
- `packages/mail-core/src/message/destroy-draft.ts`
- `packages/mail-core/src/message/destroy-email.ts`
- `packages/mail-core/src/message/garbage-collect-blobs.ts`
- `packages/mail-core/src/message/import-email.ts`
- `packages/mail-core/src/message/update-draft.ts`
- `packages/mail-core/src/message/update-email.ts`
- `packages/mail-core/src/store/repositories.ts`
- `packages/mail-core/src/submission/create-submission.ts`
- `packages/mail-core/src/testing/memory-mail-store.ts`
- `packages/mail-core/src/types/errors.ts`
- `packages/mail-core/tests/account/create-account.test.ts`
- `packages/mail-core/tests/message/destroy-email.test.ts`
- `packages/mail-core/tests/message/draft.test.ts`
- `packages/mail-core/tests/message/garbage-collect-blobs.test.ts`
- `packages/mail-core/tests/message/import-email.test.ts`
- `packages/mail-core/tests/message/update-email.test.ts`
- `packages/mail-core/tests/submission/submission.test.ts`

## Scoped re-review

The first scoped re-review closed original findings 1, 2, 3, 5, and 6 but returned
`0 Critical / 2 Important`:

1. tombstones still retained Message-ID/In-Reply-To/References;
2. Import quota counted only Email references and omitted frozen Submission references.

Both residuals were reproduced RED, fixed, and verified GREEN in pure core and real
PostgreSQL as described above. A second scoped re-review by the original
`/root/final_branch_review` is pending. Commit is prohibited until it reports zero
Critical/Important findings and all three final verdicts pass.
