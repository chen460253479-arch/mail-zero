# External Runtime Surface Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dormant external telemetry, orphan cookie analytics, and non-essential automatic frontend network requests while preserving required mailbox networking.

**Architecture:** Enforce the boundary in the existing architecture test, then delete each runtime/configuration surface. Keep Zero backend, provider, attachment, unsubscribe, user-opened link, and explicitly enabled email-image behavior unchanged.

**Tech Stack:** TypeScript, React Router, Hono/TRPC, Vitest, pnpm lockfile.

## Global Constraints

- Preserve the in-memory `TraceContext`; it does not export data.
- Preserve Better Auth and Hono authentication/session cookies.
- Preserve Gmail, Google Pub/Sub, Nango, attachment/blob, unsubscribe, user-opened link, and explicitly enabled email-image networking.
- Do not alter `node_modules` or run lifecycle scripts; only an offline,
  lockfile-only metadata synchronization is allowed.
- Do not create or use a Git worktree.

---

### Task 1: Add the external-runtime boundary

**Files:**
- Modify: `apps/server/tests/architecture/no-external-telemetry-surface.test.ts`

**Interfaces:**
- Consumes: repository source files and package manifests through the existing `readSource`/`readManifest` helpers.
- Produces: architecture assertions that fail while the forbidden runtime/configuration surfaces remain.

- [ ] **Step 1: Extend the test with the forbidden dependency and runtime surface**

Add assertions covering:

```ts
const forbiddenDependencies = [
  '@coinbase/cookie-manager',
  '@microlabs/otel-cf-workers',
  '@opentelemetry/api',
];

const forbiddenRuntimeTokens = [
  'react-scan',
  'unpkg.com',
  'api.axiom.co',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'AXIOM_API_TOKEN',
  'api.github.com/repos/',
  'placehold.co',
];
```

Also assert that these paths no longer exist after implementation:

```ts
expect(existsSync(resolve(repositoryRoot, 'apps/mail/app/(full-width)/contributors.tsx'))).toBe(false);
expect(existsSync(resolve(repositoryRoot, 'apps/server/src/lib/cookies.ts'))).toBe(false);
expect(existsSync(resolve(repositoryRoot, 'apps/server/src/lib/tracing.ts'))).toBe(false);
expect(existsSync(resolve(repositoryRoot, 'apps/server/src/trpc/routes/cookies.ts'))).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/architecture/no-external-telemetry-surface.test.ts
```

Expected: FAIL because React Scan, Axiom/OpenTelemetry, cookie analytics, GitHub API calls, remote placeholders, and the contributor page still exist.

### Task 2: Remove Axiom/OpenTelemetry and cookie analytics

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/trpc/index.ts`
- Modify: `apps/server/wrangler.jsonc`
- Delete: `apps/server/src/lib/tracing.ts`
- Delete: `apps/server/src/lib/cookies.ts`
- Delete: `apps/server/src/trpc/routes/cookies.ts`
- Modify: `apps/mail/app/(routes)/settings/general/page.tsx`

**Interfaces:**
- Consumes: existing server entrypoint and TRPC composition.
- Produces: the same server API minus the unused cookie-preference router and dormant external exporter surface.

- [ ] **Step 1: Remove direct dependencies and environment/config declarations**

Delete the following manifest dependencies:

```json
"@coinbase/cookie-manager": "1.1.8",
"@microlabs/otel-cf-workers": "1.0.0-rc.52",
"@opentelemetry/api": "1.9.0"
```

Delete `REACT_SCAN`, `AXIOM_*`, and `OTEL_*` declarations from `ZeroEnv`, and remove the OTLP endpoint/service variables from all Wrangler environments.

- [ ] **Step 2: Remove unused server modules and composition**

Delete `lib/tracing.ts`, `lib/cookies.ts`, and `trpc/routes/cookies.ts`. Remove `cookiePreferencesRouter` from `trpc/index.ts`, and remove the commented OpenTelemetry import/exporter block from `main.ts`.

- [ ] **Step 3: Remove the orphan frontend comment**

Delete the commented `cookiePreferences` mutation block from the general settings page.

### Task 3: Remove non-essential automatic frontend networking

**Files:**
- Modify: `apps/mail/app/root.tsx`
- Modify: `apps/mail/app/routes.ts`
- Delete: `apps/mail/app/(full-width)/contributors.tsx`
- Modify: `apps/mail/components/navigation.tsx`
- Modify: `apps/mail/components/home/footer.tsx`
- Modify: `apps/mail/components/home/HomeContent.tsx`

**Interfaces:**
- Consumes: existing static navigation and homepage layout.
- Produces: equivalent navigation/home rendering without automatic requests to unpkg, GitHub API/avatar hosts, or placehold.co.

- [ ] **Step 1: Remove React Scan**

Delete the conditional script from the document head:

```tsx
{import.meta.env.REACT_SCAN && (
  <script crossOrigin="anonymous" src="//unpkg.com/react-scan/dist/auto.global.js" />
)}
```

- [ ] **Step 2: Delete the contributor surface**

Delete the contributor route and page, remove the `aboutLinks` contributor item, and remove the footer link to `/contributors`.

- [ ] **Step 3: Make navigation static**

Remove `useQuery`, `useEffect`, `AnimatedNumber`, `Star`, the GitHub response interface, star state, GitHub API request, and the dynamic star-count element. Preserve the explicit GitHub anchor.

- [ ] **Step 4: Replace remote placeholders**

Replace each `placehold.co` avatar with a local text avatar:

```tsx
<span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-neutral-200 text-[7px] text-neutral-700">
  A
</span>
```

Use `N` and `S` for the other two demo users.

### Task 4: Synchronize the lockfile without installing dependencies

**Files:**
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the updated server manifest.
- Produces: a frozen-install-compatible lockfile without direct cookie-manager/Microlabs telemetry entries or their orphan dependency graph.

- [ ] **Step 1: Regenerate lockfile metadata only**

Run no package installation. Update the lockfile from the modified manifest with:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts
```

This command must not update `node_modules` or execute lifecycle scripts. If the offline metadata operation cannot complete, stop and report that the user must run the lockfile synchronization command.

- [ ] **Step 2: Confirm removed records**

Check that direct importer and package/snapshot records for the removed dependencies are gone, while unrelated OpenTelemetry records required by another package are not deleted blindly.

### Task 5: Verify the cleanup

**Files:**
- Verify only.

**Interfaces:**
- Consumes: the completed implementation.
- Produces: fresh test, type, lint, and repository evidence.

- [ ] **Step 1: Run focused architecture verification**

```powershell
pnpm --dir apps/server exec vitest run tests/architecture/no-external-telemetry-surface.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run type checks**

```powershell
pnpm --filter @zero/mail exec tsc --noEmit
pnpm --filter @zero/server exec tsc --noEmit
```

Expected: both commands exit successfully.

- [ ] **Step 3: Run relevant lint checks**

```powershell
pnpm --filter @zero/mail exec eslint app/root.tsx app/routes.ts components/navigation.tsx components/home/footer.tsx components/home/HomeContent.tsx
pnpm --filter @zero/server exec eslint src/env.ts src/main.ts src/trpc/index.ts tests/architecture/no-external-telemetry-surface.test.ts
```

Expected: zero errors and zero warnings.

- [ ] **Step 4: Inspect the final diff and residue**

Verify that tracked production/configuration files contain none of:

```text
react-scan
unpkg.com
api.axiom.co
@microlabs/otel-cf-workers
@coinbase/cookie-manager
api.github.com/repos/
placehold.co
/contributors
```

Confirm that required Gmail/Nango and user-initiated mail networking remains present.
