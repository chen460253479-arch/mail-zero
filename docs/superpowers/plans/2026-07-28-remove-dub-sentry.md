# Dub Analytics and Sentry Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove Dub Analytics and Sentry from Zero's browser and server runtimes.

**Architecture:** Express the no-telemetry decision as an architecture regression test, then remove the frontend SDK entrypoints, Better Auth plugin, Sentry relay route, workspace build allowance, and all direct/lockfile dependencies. Nango, BIMI, PostHog, and mail behavior remain unchanged.

**Tech Stack:** TypeScript, React Router, Hono, Better Auth, Vitest, pnpm workspaces.

## Global Constraints

- Do not modify Nango, BIMI, PostHog, mail synchronization, outbound delivery, authentication behavior, or mailbox persistence.
- Do not download or install dependencies; update the lockfile with pnpm's offline lockfile-only mode.
- Do not create a Git commit until the user explicitly requests one.
- Work directly on the current branch in `D:\WorkSpace\Zero`; do not create a worktree.

---

### Task 1: Add the no-Dub/no-Sentry architecture guard

**Files:**

- Create: `apps/server/tests/architecture/no-external-telemetry-surface.test.ts`

**Interfaces:**

- Consumes: repository source files and package manifests through Node filesystem APIs.
- Produces: a Vitest architecture policy that fails whenever Dub or Sentry runtime surfaces return.

- [x] **Step 1: Write the failing test**

Create a test that checks:

```ts
expect(existsSync(resolve(repositoryRoot, 'apps/mail/app/instrument.ts'))).toBe(false);
expect(frontendEntrypointsContainingDubOrSentry).toEqual([]);
expect(serverEntrypointsContainingDubOrSentry).toEqual([]);
expect(directDubOrSentryDependencies).toEqual([]);
expect(lockfileDubOrSentryRecords).toEqual([]);
```

The forbidden runtime tokens include `@dub/analytics`, `@dub/better-auth`, `new Dub`, `dubAnalytics`, `@sentry/react`, `monitoring/sentry`, `ingest.us.sentry.io`, `Sentry.captureException`, and `Sentry.reactErrorHandler`.

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/no-external-telemetry-surface.test.ts
```

Expected: the test fails because the current frontend, server, manifests, and lockfile still contain Dub and Sentry.

### Task 2: Remove browser and server runtime entrypoints

**Files:**

- Modify: `apps/mail/app/root.tsx`
- Modify: `apps/mail/app/entry.client.tsx`
- Delete: `apps/mail/app/instrument.ts`
- Modify: `apps/server/src/lib/auth.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**

- Consumes: existing React Router hydration, Better Auth configuration, and Hono route chain.
- Produces: the same application runtime without Dub tracking, Sentry capture/replay, or the Sentry relay endpoint.

- [x] **Step 1: Remove frontend telemetry**

Remove the `DubAnalytics` and Sentry imports, the `<DubAnalytics>` component, the `./instrument` side-effect import, Sentry React hydration handlers, and Sentry calls in the root error boundary. Preserve local `console.error`/`console.warn` behavior so development errors remain visible.

- [x] **Step 2: Remove backend telemetry**

Remove `dubAnalytics`, `Dub`, `new Dub()`, and the Dub Better Auth plugin. Keep `jwt()` and `bearer()` as the only existing authentication plugins.

Remove `SENTRY_HOST`, `SENTRY_PROJECT_IDS`, and the `/monitoring/sentry` Hono route without changing adjacent health, OAuth, API, or Gmail push routes.

- [x] **Step 3: Run the focused test**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/no-external-telemetry-surface.test.ts
```

Expected: source-entrypoint assertions pass; dependency and lockfile assertions may still fail until Task 3.

### Task 3: Remove dependencies and verify the workspace

**Files:**

- Modify: `apps/mail/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: pnpm workspace manifests.
- Produces: a dependency graph with no Dub or Sentry packages.

- [x] **Step 1: Remove direct dependency declarations**

Delete:

```text
apps/mail: @dub/analytics, @sentry/react
apps/server: @dub/better-auth, dub
pnpm-workspace onlyBuiltDependencies: @sentry/cli
```

- [x] **Step 2: Update only the lockfile without downloads or lifecycle scripts**

Run:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts
```

Expected: exit code 0 and no package download or installation.

- [x] **Step 3: Verify the focused architecture policy**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/no-external-telemetry-surface.test.ts
```

Expected: all tests pass.

- [x] **Step 4: Run proportional regression checks**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/no-agent-ai-surface.test.ts tests/architecture/mail-architecture.test.ts
pnpm --filter @zero/server lint
pnpm --filter @zero/mail lint
pnpm --filter @zero/mail build
```

Expected: every command exits with code 0 and no Dub/Sentry bundle resolution remains.

Result: the architecture tests, changed-file ESLint checks, and production build passed. The
repository-wide server and mail ESLint commands remain blocked by pre-existing errors in files
outside this change.

- [x] **Step 5: Review the final diff**

Run:

```powershell
git status --short
git diff --check
git diff --stat
git grep -n -I -E '@sentry|SENTRY_|monitoring/sentry|DubAnalytics|dubAnalytics|@dub/|new Dub|dub_id|dubcdn\.com' -- . ':!docs/superpowers'
```

Expected: only the planned source, manifest, lockfile, test, and plan/spec files changed; the final grep produces no runtime or dependency matches.
