# Task 9 Report — EmailSubmission State Machine and Attempt History

## Scope

Implemented Task 9 from base `f9baf27db39dc6195e0d54b692ad15cf142e1758` on
`codex/local-mail-core`. The change is limited to the pure mail core, its memory
adapter/test support, Draft identity retention required by Submission validation,
and Identity-in-use enforcement. It does not add provider, server, Drizzle,
frontend, or network-send behavior.

## TDD evidence

Initial RED command:

```text
pnpm --filter=@zero/mail-core test -- tests/submission
```

Initial result: 2 test files failed, 49/49 tests failed. Representative failures
were:

```text
TypeError: (0 , createSubmission) is not a function
TypeError: (0 , calculateRetryAt) is not a function
```

After the first GREEN implementation, the focused suite passed 49/49 and the
full mail-core suite passed 152/152.

The independent staged review found three Important issues. Regression tests
were added before each fix. The fix-round RED result was 7 failed and 49 passed:

- missing exact Draft-to-Identity retention/validation;
- creation status based on a pre-lock clock sample;
- due gates and Attempt timestamps based on a pre-lock clock sample;
- four safe-response denylist bypasses.

After the fixes, the focused suite passed 56/56.

## Implementation

- Added account-scoped, lock-serialized `createSubmission` with ready Raw Blob,
  visible Draft, recipient, exact Identity, frozen revision, schedule, and
  idempotency validation.
- Added the exact seven-state transition map and thin `cancelSubmission`.
- Added due-time gates using time sampled after acquiring the account lock.
- Added immutable Attempt creation/finalization and bounded retry history.
- Added the exact retry delays: 30 seconds, 2 minutes, 10 minutes, 30 minutes,
  and 2 hours; attempt six is permanent.
- Added stable provider-code filtering and a closed safe-response category
  allowlist. Arbitrary provider text, bodies, credentials, tokens, URLs, and
  thrown-error data are not persisted.
- Added Draft `identityId` retention so a Submission can prove the requested
  Identity belongs to the exact Draft revision.
- Added account locking to `destroyIdentity` and retained its nonterminal
  Submission protection.
- Extended memory repositories with cross-account existence checks and
  open-Attempt finalization that rejects overwriting completed Attempts.

Every accepted creation/transition increments account state exactly once and
records one `email_submission` Change in the same transaction. Rejected
operations roll back without allocating state or Change.

## Independent staged-diff review

First review: NOT PASS, with three Important findings:

1. Draft Identity association was not retained or verified.
2. Creation and transition sampled time before acquiring the account lock.
3. Safe response storage used an incomplete denylist.

All three were fixed with new RED regressions. The read-only staged re-review
returned PASS with no Critical or Important findings.

Minor ledger:

- `sendAt: null` and an explicit timestamp exactly equal to creation time share
  the same normalized idempotency representation.
- Some representative rejected-transition tests assert the stable error but do
  not also repeat state-version and Change-count rollback assertions.

## Verification

Final verification:

```text
pnpm --filter=@zero/mail-core test -- tests/submission
  2 files, 56 tests passed

pnpm --filter=@zero/mail-core test
  18 files, 159 tests passed

pnpm --filter=@zero/mail-core typecheck
  passed

pnpm exec prettier --check <all Task 9 touched files>
  passed

git diff --cached --check
  passed
```

## Deferred integration requirements

- The future Drizzle/server adapter must persist and map Draft
  `EmailRecord.identityId` and frozen `SubmissionRecord.draftRevision`.
- The future repository adapter must implement `existsOutsideAccount` for
  Email/Identity and atomic open-Attempt finalization via `updateAttempt`.
- Provider integration must map arbitrary provider responses to the exported
  closed `SubmissionSafeResponse` categories before calling the core.
- The two Minor review items above remain explicitly deferred.

The user's untracked `AGENTS.md` was preserved and never staged.
