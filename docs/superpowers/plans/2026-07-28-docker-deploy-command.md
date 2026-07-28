# Docker Deploy Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pnpm docker:deploy` as the safe, cross-platform entry point for building, initializing, starting, health-checking, and displaying the current Docker stack.

**Architecture:** The root pnpm script composes existing Docker Compose operations in a fail-fast sequence. Existing Compose images, dependency fingerprinting, named volumes, and health checks remain the source of truth; no new deployment runtime or shell-specific wrapper is introduced.

**Tech Stack:** pnpm 10.15.0, Docker Compose v2, Vitest

## Global Constraints

- Keep the command name exactly `docker:deploy`.
- Build all Compose images before dependency initialization.
- Run dependency initialization with `--rm --no-deps`.
- Wait at most 180 seconds for existing Compose health checks.
- Display `docker compose ps` only after a healthy startup.
- Never clear, recreate, migrate, push, or seed PostgreSQL data.
- Leave implementation changes uncommitted and unpushed until the user explicitly requests it.

---

### Task 1: Protect and implement the deployment command

**Files:**

- Modify: `apps/server/tests/architecture/docker-development-stack.test.ts`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: existing Compose services and `server install-dependencies` entrypoint command.
- Produces: root command `pnpm docker:deploy`.

- [x] **Step 1: Write the failing architecture test**

Add a test that parses the root `package.json`, splits `scripts["docker:deploy"]` into ordered
operations, and expects these four literal operations:

```ts
[
  'docker compose build',
  'docker compose run --rm --no-deps server install-dependencies',
  'docker compose up --detach --wait --wait-timeout 180',
  'docker compose ps',
];
```

Also assert that the command contains none of `down`, `--volumes`, `db:push`, `db:migrate`, or
`db:seed`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-development-stack.test.ts
```

Expected: failure because `scripts["docker:deploy"]` is missing.

- [x] **Step 3: Add the minimal root command**

Add this root package script:

```json
"docker:deploy": "docker compose build && docker compose run --rm --no-deps server install-dependencies && docker compose up --detach --wait --wait-timeout 180 && docker compose ps"
```

- [x] **Step 4: Document full-stack and Mail-only workflows**

Use `pnpm docker:deploy` for initial complete-stack startup and full updates. Keep
`docker compose up --detach --build --no-deps mail` documented for frontend-only updates. State
that neither command initializes or clears application database schemas.

- [x] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-development-stack.test.ts tests/architecture/docker-mail-static-runtime.test.ts tests/architecture/docker-workspace-dependencies.test.ts
```

Expected: all focused Docker architecture tests pass.

- [x] **Step 6: Verify the real command**

Run:

```powershell
pnpm docker:deploy
```

Expected: images build, dependency initialization exits successfully, all services become healthy
within 180 seconds, and Compose prints the final status. Existing PostgreSQL volumes remain
attached.

- [x] **Step 7: Validate formatting and workspace state**

Run:

```powershell
pnpm exec prettier --check package.json README.md apps/server/tests/architecture/docker-development-stack.test.ts docs/superpowers/specs/2026-07-28-docker-deploy-command-design.md docs/superpowers/plans/2026-07-28-docker-deploy-command.md
git diff --check
git status --short
```

Expected: formatting and diff checks pass; the deployment implementation remains uncommitted.
