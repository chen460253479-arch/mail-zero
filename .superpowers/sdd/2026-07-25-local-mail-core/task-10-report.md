# Task 10 Report — Queries, Stable Cursors, Changes, and Public Facade

## Scope

Implemented Task 10 from base `d424ffb9107766ef098a10e73a7dcb1162a935e2`
on `codex/local-mail-core`. The change is limited to the pure mail core, its
public ports/barrels, and real memory adapter/test support. It does not modify
frontend, provider, server, Drizzle, R2, or network behavior.

## TDD evidence

The bounded cursor and Changes RED command:

```text
pnpm --filter=@zero/mail-core test -- tests/search/cursor.test.ts tests/changes/get-changes.test.ts
```

Initial result: 2/2 files failed and 32/32 tests failed on the missing
cursor/Changes production surface. The bounded slice then passed 32/32.

The Email/Thread/facade RED command:

```text
pnpm --filter=@zero/mail-core test -- tests/message/query-emails.test.ts tests/thread/query-threads.test.ts tests/mail-core.test.ts
```

Initial result: 3/3 files failed and 26/26 tests failed because
`queryEmails`, `queryThreads`, and `createMailCore` did not exist. The first
GREEN passed 26/26.

The first independent staged review found three Important issues. Regression
tests were added first. The fix-round RED result was 4 failed and 40 passed:

- ChangeRepository split a state group at its record limit;
- `getChanges` had no bounded read/retention-boundary support;
- real-memory text search omitted body-only content.

The fix-round GREEN passed 44/44. Re-review found one additional Important
account-scoping defect. Its RED was 1 failed and 21 passed: a foreign account's
missing body blob could reject the requested account's query. Filtering the
requested account before body access produced GREEN at 22/22.

## Implementation

- Added Email query filters for Mailbox, Keyword, exclusive received-time
  bounds, normalized address, attachment presence, and SearchStore text.
- Added deterministic sort/keyset semantics for received time, nullable sent
  time, bigint size, and case-folded subject with Email ID tie-breaking.
- Added strict bounded limits and canonical applied filter/sort results.
- Added versioned, entity-typed, account-bound, query-bound canonical
  base64url cursors with strict Zod decoding and lossless Date/bigint/null/string
  sort values.
- Added visible Thread query/get projections with mailbox filtering,
  chronological Email members, deterministic latest-received ordering, and an
  independent Thread cursor.
- Added account-scoped `getEmail` and `getThread` with stable not-found and
  cross-account errors.
- Added bounded Changes reads, complete cutoff-state groups, collapse rules,
  deterministic ordering, retained-history validation, and exact state tokens.
- Added the public `createMailCore(dependencies): MailCore` facade for every
  user-facing command while retaining `garbageCollectBlobs` only as a standalone
  maintenance command.
- Extended the real memory SearchStore to execute production-port filter,
  sorting, keyset, and full parsed body text/HTML semantics without exporting
  testing adapters from the package root.

Rejected reads do not allocate account state or mail Changes.

## Independent staged-diff review

First review: NOT PASS, with three Important findings:

1. Changes fetched the entire remaining history before pagination.
2. Changes had no explicit oldest retained-state boundary.
3. Memory SearchStore searched only subject/preview/address, not full body.

All three were fixed with RED regressions. The first re-review confirmed those
fixes and found one new Important issue: body text was loaded before
account/destroyed filtering. A cross-account missing-blob RED regression was
added and fixed.

The final read-only staged re-review returned PASS with no Critical or
Important findings.

Minor ledger: none.

## Verification

Final verification:

```text
pnpm --filter=@zero/mail-core test -- tests/message/query-emails.test.ts tests/thread/query-threads.test.ts tests/search tests/changes/get-changes.test.ts tests/store/change-repository.test.ts tests/mail-core.test.ts
  6 files, 64 tests passed

pnpm --filter=@zero/mail-core test
  23 files, 222 tests passed

pnpm --filter=@zero/mail-core typecheck
  passed

pnpm exec prettier --check <all Task 10 touched files and report>
  passed

git diff --cached --check
  passed
```

## Task 11 adapter requirements

- PostgreSQL `SearchStore.query` must consume typed keyset positions and return
  typed next positions, applying all account-scoped filters, null-last sent-time
  ordering, normalized subject/address semantics, full-body text search,
  deterministic Email ID ties, and limit-plus-one pagination natively.
- PostgreSQL `ChangeRepository.queryChanges` must treat `limit` as a soft
  record boundary and include the entire cutoff state group, without reading
  the remaining tail.
- PostgreSQL `ChangeRepository.hasChanges` must use a bounded existence query.
- PostgreSQL `ChangeRepository.oldestAvailableState` must return the account's
  authoritative oldest valid retained state token; retention/pruning must
  advance it atomically with deletion.
- `queryChanges`, `hasChanges`, the retained-state boundary, and the account's
  current state must be observed inside one consistent Unit of Work.
- PostgreSQL `ThreadRepository` must implement `existsOutsideAccount`.
- Adapters must preserve branded IDs, bigint/date cursor values, account
  scoping, destroyed visibility, and repository ordering exactly as expressed
  by the exported ports.

The user's untracked `AGENTS.md` was preserved and never staged.
