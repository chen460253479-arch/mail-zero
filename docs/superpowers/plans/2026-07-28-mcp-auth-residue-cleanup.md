# MCP OAuth And Authentication Residue Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining MCP OAuth discovery surface and unused OIDC Provider tables while preserving Zero authentication and Gmail OAuth.

**Architecture:** Lock the removal boundary with architecture tests, remove the HTTP and schema surfaces, fold the schema change into the sole development initialization template, and use the existing Better Auth `signOut` operation for current-session cleanup.

**Tech Stack:** TypeScript 5.8, Better Auth 1.3, Hono, PostgreSQL, Drizzle ORM, Vitest.

## Global Constraints

- Work directly in `D:\WorkSpace\Zero`; do not create a worktree.
- Do not install or upgrade dependencies.
- Do not start, rebuild, or restart Docker.
- Preserve `auth.jwks`, `jwt()`, `bearer()`, and `integration.oauth_session`.
- Keep one `0000` development initialization template and no chronological `0001`.
- Do not commit or push unless the user explicitly requests it.

---

### Task 1: Lock the MCP and authentication removal boundary

**Files:**

- Modify: `apps/server/tests/architecture/no-agent-ai-surface.test.ts`
- Create: `apps/server/tests/architecture/auth-session-cleanup.test.ts`

**Interfaces:**

- Consumes: source files as architecture-test text fixtures.
- Produces: regression guards for MCP Discovery, OIDC Provider tables, and invalid session cleanup.

- [ ] Add assertions that `main.ts` contains neither `oAuthDiscoveryMetadata` nor `oauth-authorization-server`.
- [ ] Add assertions that `schema.ts` contains none of `oauthApplication`, `oauthAccessToken`, and `oauthConsent`.
- [ ] Add a session cleanup test requiring `signOut` and forbidding `revokeSession`.
- [ ] Run both tests and verify they fail for the expected existing residues.

### Task 2: Remove MCP Discovery and repair current-session cleanup

**Files:**

- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/lib/server-utils.ts`

**Interfaces:**

- Removes: public MCP OAuth Discovery endpoint.
- Preserves: Better Auth current-session `signOut`.

- [ ] Delete the `oAuthDiscoveryMetadata` import and route.
- [ ] Delete the redundant `auth.api.revokeSession({ headers })` call.
- [ ] Run the architecture tests and verify the HTTP/authentication portion passes.

### Task 3: Remove unused OIDC Provider data models

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/tests/helpers/mail-core/schema-contract.ts`
- Modify: `apps/server/tests/unit/mail-core/__snapshots__/schema-structure-parity.test.ts.snap`
- Modify: `apps/server/src/db/migrations/0000_steady_silver_centurion.sql`
- Modify: `apps/server/src/db/migrations/meta/0000_snapshot.json`

**Interfaces:**

- Removes: `auth.oauth_application`, `auth.oauth_access_token`, `auth.oauth_consent`.
- Preserves: `auth.jwks` and `integration.oauth_session`.

- [ ] Remove the three Drizzle table definitions and schema-contract entries.
- [ ] Update the structural snapshot through the existing parity test.
- [ ] Generate a temporary Drizzle delta, fold the deletion into `0000`, and remove the temporary migration.
- [ ] Rerun `db:generate` and verify no schema changes remain.

### Task 4: Verify the complete cleanup

**Files:**

- Verify all files changed by Tasks 1–3.

**Interfaces:**

- Produces: evidence that no MCP/OIDC residue or authentication type failure remains.

- [ ] Run architecture and schema unit tests.
- [ ] Run PostgreSQL schema integration tests.
- [ ] Run focused ESLint.
- [ ] Run `tsc --noEmit` and verify both prior type errors are gone.
- [ ] Run `git diff --check`, residue searches, and working-tree scope review.
