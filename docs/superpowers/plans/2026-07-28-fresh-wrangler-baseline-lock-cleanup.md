# Fresh Wrangler Baseline and Lockfile Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inherited Durable Object migration history with the single current ZeroDB baseline and remove unreachable retired Agent runtime records from the pnpm lockfile.

**Architecture:** Treat every Zero Cloudflare environment as a rebuildable new deployment. Keep the current `ZERO_DB` binding and declare `ZeroDB` once with SQLite storage; do not preserve create-then-delete history for retired runtime classes. Recompute lockfile reachability from current workspace manifests without installing dependencies.

**Tech Stack:** TypeScript, Vitest, Wrangler 4.32, pnpm 10 lockfile, Cloudflare Workers

## Global Constraints

- Do not change PostgreSQL table structure or the single `0000` database template.
- Do not remove `ZERO_DB`, `THREADS_BUCKET`, Hyperdrive, `MAIL_INGRESS_QUEUE`, or `MAIL_OUTBOUND_QUEUE`.
- Do not run `pnpm install` against the working workspace or install/update dependencies.
- Do not operate on remote Cloudflare, GCP, Gmail, or Nango resources.
- The flattened Wrangler configuration is for new or explicitly rebuildable Worker deployments only.

---

### Task 1: Lock the fresh infrastructure baseline in architecture tests

**Files:**
- Modify: `apps/server/src/mail-architecture.test.ts`

- [x] Add an assertion that `wrangler.jsonc` contains exactly three `v1` migrations, each declaring only `ZeroDB` through `new_sqlite_classes`.
- [x] Add assertions that retired Durable Object class names, `new_classes`, and `deleted_classes` are absent.
- [x] Add an assertion that retired direct Agent runtime package records are absent from `pnpm-lock.yaml`.
- [x] Run the focused architecture test and confirm it fails against the inherited configuration.

### Task 2: Flatten Wrangler configuration

**Files:**
- Modify: `apps/server/wrangler.jsonc`

- [x] Replace the local migration chain with one `v1` `new_sqlite_classes: ["ZeroDB"]` entry.
- [x] Apply the same current baseline to staging and production.
- [x] Preserve current bindings, queues, R2, Hyperdrive, variables, and all non-migration configuration.
- [x] Run the focused architecture test and confirm the Wrangler assertions pass.

### Task 3: Remove unreachable lockfile records

**Files:**
- Modify: `pnpm-lock.yaml`

- [x] Resolve the current lock graph from all workspace manifests in an isolated temporary directory without installing workspace dependencies.
- [x] Apply only the resulting unreachable-record deletions to the repository lockfile.
- [x] Confirm current manifests and lockfile contain no direct retired Agent runtime packages.
- [x] Run the focused architecture test.

### Task 4: Update the active deployment checklist and local hygiene

**Files:**
- Modify: `docs/deployment/2026-07-27-mail-backend-cutover-checklist.md`
- Remove generated local state and caches: `apps/server/.wrangler/`, `apps/mail/.wrangler/`,
  `node-compile-cache/`, `update-check/`

- [x] Replace incremental old Durable Object retirement instructions with the fresh Worker baseline.
- [x] State that existing original Zero Workers must not receive the flattened configuration.
- [x] Remove only the four verified generated local-state/cache directories.

### Task 5: Verify the cleanup

- [x] Run the mail architecture, no-legacy-RPC, and no-Agent surface tests.
- [x] Run Wrangler dry-run for local, staging, and production without deploying.
- [x] Run TypeScript checking for the server.
- [x] Check `git diff --check`, scan current runtime/configuration for retired names, and review the complete diff.
- [x] Do not commit or push until requested by the user.
