# Frontend AI Residue Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining frontend AI/Agent dead code and stale repository descriptions without changing standard mail-editor behavior.

**Architecture:** Extend the existing architecture guard so retired paths and tokens fail before implementation. Then delete unreferenced files, remove the unreachable AI editor state and empty bubble, and correct stale documentation.

**Tech Stack:** React 19, TypeScript 5.8, Vitest, ESLint, Oxlint.

## Global Constraints

- Work directly in `D:\WorkSpace\Zero`; do not create a worktree.
- Do not install, upgrade, or remove dependencies.
- Do not start, rebuild, or restart Docker.
- Preserve the standard `novel`/Tiptap email editor.
- Preserve ordinary human-facing “chat with the team” wording.
- Do not commit or push unless the user explicitly requests it.

---

### Task 1: Add a failing architecture regression

**Files:**

- Modify: `apps/server/tests/architecture/no-agent-ai-surface.test.ts`

**Interfaces:**

- Consumes: frontend source and repository documentation as text fixtures.
- Produces: a regression guard that rejects the remaining retired paths and tokens.

- [ ] Add `ai-textarea.tsx`, `editor-menu.tsx`, and `party.tsx` to the retired frontend paths.
- [ ] Reject `openAI`, `TOGGLE_AI`, `tokens-agent-`, the retired roadmap item, and the stale Sentry statement.
- [ ] Run the architecture test and verify it fails on the identified residues.

### Task 2: Remove frontend AI and Agent dead code

**Files:**

- Delete: `apps/mail/components/create/ai-textarea.tsx`
- Delete: `apps/mail/components/create/editor-menu.tsx`
- Delete: `apps/mail/components/party.tsx`
- Modify: `apps/mail/components/create/editor.tsx`
- Modify: `apps/mail/components/home/HomeContent.tsx`

**Interfaces:**

- Removes: unused Agent/Chat event enums, AI input, AI highlight bubble, AI reducer state, and decorative Agent naming.
- Preserves: normal content editing, slash commands, formatting, attachments, and editor focus behavior.

- [ ] Delete the three unreferenced source files.
- [ ] Remove the unused reducer and empty `EditorMenu` from the editor.
- [ ] Remove the empty decorative `tokens-agent-*` element.
- [ ] Run the architecture test and verify the source cleanup passes.

### Task 3: Correct stale documentation and verify

**Files:**

- Modify: `ROADMAP.md`
- Modify: `AGENT.md`

**Interfaces:**

- Removes: the retired AI roadmap item and false Sentry integration statement.
- Preserves: the remaining email roadmap and repository workflow instructions.

- [ ] Remove the two stale statements.
- [ ] Run the architecture regression, frontend type check, and targeted lint.
- [ ] Scan runtime source, manifests, lockfile, environment configuration, and tracked paths for remaining AI/Agent/MCP residues.
- [ ] Run `git diff --check` and review the exact cleanup diff.
