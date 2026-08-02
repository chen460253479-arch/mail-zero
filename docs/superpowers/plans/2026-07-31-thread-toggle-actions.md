# Thread Toggle Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复重要标记和归档状态只能单向操作及乐观状态不能清理的问题。

**Architecture:** 保留现有 API 与撤销窗口，在乐观操作管理器中集中完成待处理记录清理和“是否需要刷新”的判定。前端操作入口使用纯函数决定归档切换目标，并始终渲染重要状态的双向菜单。

**Tech Stack:** React 19、Jotai、TanStack Query、Vitest、TypeScript

## Global Constraints

- 不修改后端 API、Mail Core 或数据库。
- 不创建 Git worktree。
- 未经用户明确要求不提交或推送。
- 必须先看到回归测试按预期失败，再修改生产代码。

---

### Task 1: 乐观操作完成清理

**Files:**

- Modify: `apps/mail/lib/optimistic-actions-manager.ts`
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`
- Test: `apps/mail/lib/optimistic-actions-manager.test.ts`

**Interfaces:**

- Produces: `settlePendingAction(manager, actionId, type): { shouldRefresh: boolean }`
- Consumes: `OptimisticActionsManager.pendingActions` 与 `pendingActionsByType`

- [ ] **Step 1: 编写失败测试**

覆盖单个、多个同类型以及最后一个同类型操作完成后的清理和刷新判定。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @zero/mail test -- lib/optimistic-actions-manager.test.ts --reporter=dot`

Expected: FAIL，因为 `settlePendingAction` 尚不存在。

- [ ] **Step 3: 实现最小清理函数并接入**

完成当前 pending 记录清理；每次成功均移除当前乐观状态，仅在类型集合为空时刷新真实数据。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter @zero/mail test -- lib/optimistic-actions-manager.test.ts --reporter=dot`

Expected: PASS。

### Task 2: 重要与归档双向入口

**Files:**

- Modify: `apps/mail/lib/thread-actions.ts`
- Modify: `apps/mail/components/mail/mail-list.tsx`
- Modify: `apps/mail/components/mail/thread-display.tsx`
- Test: `apps/mail/lib/thread-actions.test.ts`
- Test: `apps/mail/components/mail/thread-toggle-actions.test.ts`

**Interfaces:**

- Produces: `getArchiveToggleDestination(folder): 'archive' | 'inbox'`
- Consumes: `FolderLocation` 与 `FOLDERS.ARCHIVE`

- [ ] **Step 1: 编写失败测试**

验证 Archive 返回 Inbox、其他目录返回 Archive，并验证重要菜单包含标记和取消标记两种状态。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @zero/mail test -- lib/thread-actions.test.ts components/mail/thread-toggle-actions.test.ts --reporter=dot`

Expected: FAIL，因为归档切换函数和双向重要菜单尚未实现。

- [ ] **Step 3: 实现最小 UI 修改**

列表归档按钮使用切换目标；线程详情菜单始终渲染重要操作，并按当前状态显示相反动作。

- [ ] **Step 4: 运行相关测试**

Run: `pnpm --filter @zero/mail test -- lib/optimistic-actions-manager.test.ts lib/thread-actions.test.ts components/mail/thread-toggle-actions.test.ts modules/mail/mutations/thread-action-input.test.ts --reporter=dot`

Expected: PASS。

- [ ] **Step 5: 类型与格式验证**

Run: `pnpm --filter @zero/mail exec tsc --noEmit --pretty false`

Run: `pnpm exec prettier --check apps/mail/lib/optimistic-actions-manager.ts apps/mail/hooks/use-optimistic-actions.ts apps/mail/lib/thread-actions.ts apps/mail/components/mail/mail-list.tsx apps/mail/components/mail/thread-display.tsx`
