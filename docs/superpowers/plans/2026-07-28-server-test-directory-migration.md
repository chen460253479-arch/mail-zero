# Server Test Directory Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every Server test out of `apps/server/src` and normalize all Server tests under type-based directories in `apps/server/tests`.

**Architecture:** Preserve test semantics by generating a validated source-to-destination map and rewriting relative module specifiers against their original resolved targets. Enforce the final layout with a repository architecture test, then compare the post-migration suite against the recorded baseline.

**Tech Stack:** TypeScript, Vitest, Node.js filesystem/path APIs, pnpm workspaces.

## Global Constraints

- Do not change production behavior, database schemas, assertions, fixtures, or test data.
- Do not fix the 16 test failures recorded before migration unless the migration itself creates an additional path-resolution failure.
- Do not update historical plans or reports merely because they contain historical test paths.
- Do not install dependencies, commit, or push.
- Work directly on the current branch in `D:\WorkSpace\Zero`; do not create a worktree.

---

### Task 1: Protect the desired layout

**Files:**

- Create: `apps/server/tests/architecture/test-directory-layout.test.ts`

**Interfaces:**

- Consumes: the physical Server source and test directory trees.
- Produces: a Vitest policy that rejects tests under `src` and unclassified test roots.

- [x] **Step 1: Add the failing layout policy**

The test recursively collects files and asserts:

```ts
expect(testFilesBelow(srcRoot)).toEqual([]);
expect(topLevelTestEntries).toEqual(['architecture', 'e2e', 'helpers', 'integration', 'unit']);
```

- [x] **Step 2: Verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/test-directory-layout.test.ts
```

Expected: failure reporting the 79 tests still below `src` and legacy test roots.

### Task 2: Generate and validate the migration map

**Files:**

- Create temporarily: `scripts/migrate-server-test-layout.mjs`
- Delete after migration: `scripts/migrate-server-test-layout.mjs`

**Interfaces:**

- Consumes: the existing 128 tests, 4 helpers, and 1 snapshot.
- Produces: 133 collision-free moves into the five target roots.

- [x] **Step 1: Encode classification rules**

The migration script must classify `src` tests by filename and explicit architecture names, classify existing `mail-core`/`mail-sync` trees, and route support files to `helpers`.

- [x] **Step 2: Validate without writing**

Run:

```powershell
node scripts/migrate-server-test-layout.mjs --check
```

Expected: 133 moves, 79 source tests, 0 destination collisions, and every resolved path inside `apps/server`.

### Task 3: Move files and preserve imports

**Files:**

- Move: all mapped files below `apps/server/src` and `apps/server/tests`
- Modify mechanically: relative import/export, dynamic import, `require`, and Vitest mock specifiers

**Interfaces:**

- Consumes: the validated Task 2 map.
- Produces: identical tests at their classified destinations with imports resolving to the same modules.

- [x] **Step 1: Execute the migration**

Run:

```powershell
node scripts/migrate-server-test-layout.mjs --write
```

- [x] **Step 2: Remove the temporary script**

Delete `scripts/migrate-server-test-layout.mjs` after its output and move counts have been reviewed.

- [x] **Step 3: Remove empty legacy directories**

Remove only directories proven empty below `apps/server/src`, `apps/server/tests/mail-core`, and `apps/server/tests/mail-sync`.

### Task 4: Repair location-derived paths and scripts

**Files:**

- Modify: moved architecture tests that derive `srcRoot` or `repositoryRoot`
- Modify: `apps/server/package.json`
- Modify: `apps/server/tests/architecture/test-directory-layout.test.ts`

**Interfaces:**

- Consumes: the new directory layout.
- Produces: valid filesystem roots and test commands for the classified directories.

- [x] **Step 1: Update location-derived filesystem roots**

Every moved test using `import.meta.url` must derive `serverRoot`, `srcRoot`, and `repositoryRoot` from its new location.

- [x] **Step 2: Preserve `test:mail-core` scope**

Replace the old `src/modules/mail tests/mail-core` paths with the two classified roots that actually contain the Mail Core tests:

```json
"test:mail-core": "vitest run tests/unit/mail-core tests/integration/mail-core"
```

- [x] **Step 3: Verify GREEN for the layout policy**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/test-directory-layout.test.ts
```

Expected: pass with zero tests below `src`.

### Task 5: Verify semantics and hygiene

**Files:**

- Verify all moved Server tests and support files.

**Interfaces:**

- Consumes: the completed migration.
- Produces: evidence that location changed without new behavior failures.

- [x] **Step 1: Run architecture and unit tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture tests/unit
```

Expected: no path-resolution failures introduced by the migration.

- [x] **Step 2: Run the complete Server suite**

Run:

```powershell
pnpm --filter @zero/server exec vitest run
```

Expected: no new failure category compared with the 16-failure migration baseline.

- [x] **Step 3: Verify filesystem invariants**

Confirm:

```text
src test/spec files = 0
total tests = 129 (128 migrated tests + 1 new directory boundary test)
top-level test roots = architecture, e2e, helpers, integration, unit
empty legacy test directories = 0
```

- [x] **Step 4: Review Git and formatting**

Run `git diff --check`, targeted Prettier/ESLint where practical, and inspect Git rename detection without changing production files.

## Execution Record

- The original 128 test files, 4 helpers, and 1 snapshot were migrated without path collisions.
- The final tree contains 129 test files because the migration adds one directory-boundary guard.
- `src` contains no test/spec files, and neither `src` nor `tests` contains empty directories.
- The directory guard passes all three checks: source isolation, approved top-level roots, and suffix-based classification.
- All moved suites load from their new paths. Targeted filesystem-path tests pass after their roots were adjusted.
- The remaining failures are outside this migration: three Nango architecture assertions still target previously removed legacy files, and database-backed tests cannot connect when PostgreSQL is not listening on local port 5432.
- Targeted ESLint and Prettier checks pass, and `git diff --check` reports no whitespace errors.
