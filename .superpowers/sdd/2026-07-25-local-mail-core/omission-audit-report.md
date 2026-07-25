# Local mail core omission audit

## Scope and verdict

- Branch: `codex/local-mail-core`
- Audit date: 2026-07-26
- Baseline: `a0c188d62d191bba4a6e890906a3d76269c047a0`
- Scope: phase-one backend local mail core and automated tests.
- Excluded by design: Gmail/provider plugins, frontend cutover, and existing tRPC mail
  route cutover.

The original 12-task implementation plan is complete. The omission audit found no
remaining Critical or Important defect after the fixes and independent re-review.

## Findings closed

The first omission pass identified ten Important and two Minor findings. The Important
findings were closed by:

- exposing account-scoped Mailbox listing and serializing Mailbox creation;
- applying the documented equal-time Thread tie-break;
- making Draft attachment ingestion single-read, correctly classified, recipient-safe,
  and HTML-sanitized;
- implementing `from` and `to` Email filters;
- adding account-scoped Blob reads with size/SHA-256 validation and fail-closed audit;
- making compensation leftovers discoverable and reclaimable;
- persisting every MIME leaf with its own bytes, content type, body role, hierarchy, and
  path;
- correcting the documented missing-account error.

The follow-up review identified transaction, lifecycle, and API-boundary omissions. They
were closed by:

- moving Blob storage reads, hashes, and physical deletes outside database transactions;
- using durable lifecycle-valid orphan reservations before external deletion;
- retaining and retrying reservations across deletion failure or acknowledgement loss;
- separating destructive maintenance operations from the user-facing `MailCore` facade;
- preserving role-specific content types and every ordered non-body MIME occurrence in
  immutable Submission snapshots;
- using bounded, resumable object/temporary scans instead of account-wide materialization
  and sorting.

The reconciliation cursor records each opaque provider cursor plus an explicit exhausted
state. Each kind scans at most ten pages per invocation, candidates remain bounded by the
validated batch limit, metadata-owned objects cannot starve temporary cleanup, and an
unselected candidate is not skipped when the deletion limit is reached. Ownership is
checked by canonical object key rather than storage-reported size. Any deletion resets
that kind to the start of a new scan so position-based cursors cannot skip entries after
the underlying list shrinks. Durable reservations are revalidated under the account lock;
if an ordinary Blob row owns the same key, only the conflicting reservation is removed.
The ownership lookup is backed by the `blob_account_object_key_idx` migration.
Reservation retry scans are backed by
`blob_account_status_content_created_idx`, matching account, lifecycle, content type, and
the deterministic creation order.

## Minor decisions

- Immediate submission is represented by an effective `sendAt` equal to `createdAt`.
  A `null` request and an explicit timestamp exactly equal to creation time are therefore
  intentionally not distinguishable after persistence in phase one. Changing that would
  require a new scheduling-intent field and a schema migration, without changing current
  dispatch behavior.
- The design document now uses the implemented stable missing-account error.

## Verification evidence

- `pnpm test:mail-core`: 25 core files / 261 tests and 16 server files / 75 tests passed
  (336 total).
- Real PostgreSQL Blob maintenance lifecycle test passed.
- `pnpm --filter=@zero/mail-core typecheck`: passed.
- `drizzle-kit check`: passed.
- Mail server module/tests ESLint: passed.
- Changed mail-core TypeScript ESLint: passed.
- Prettier and `git diff --check`: passed.
- Full server TypeScript currently reports the repository baseline of 79 diagnostics;
  zero diagnostics refer to the mail-core package, mail server module, or mail-core tests.
- Frontend/provider/tRPC route cutover diff: zero files.

The user-owned untracked `AGENTS.md` was not modified or included.
