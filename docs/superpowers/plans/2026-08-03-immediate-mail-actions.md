# 邮件操作立即提交 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除邮件操作的默认五秒延迟提交，使刷新页面不再丢失回收站、垃圾邮件、稍后处理和草稿删除操作。

**Architecture:** 将立即、不可逆操作的异步生命周期提取为纯执行器；`createPendingAction` 创建记录后立即启动执行器。已有 `startImmediateReversibleAction` 继续处理具备真实反向请求的操作，Toast 不再启动正向请求。

**Tech Stack:** TypeScript、React、Vitest、TanStack Query、Sonner。

## Global Constraints

- 不修改外部邮箱渠道，回收站仅修改 Zero 本地数据。
- 不执行构建、打包、Docker 或完整测试套件。
- 定向测试必须使用单进程参数，避免 Windows 高负载。
- 保留工作区现有 `.env.example` 修改。

---

### Task 1: 立即执行不可逆操作

**Files:**
- Modify: `apps/mail/lib/optimistic-actions-manager.ts`
- Modify: `apps/mail/lib/optimistic-actions-manager.test.ts`

**Interfaces:**
- Produces: `startImmediatePendingAction(options): Promise<void>`，立即调用 `execute` 并按结果调用 `onCommitted` 或 `onFailed`。

- [x] **Step 1: Write the failing test**

新增测试，在不等待微任务的情况下断言 `execute` 已被调用，并分别覆盖成功与失败回调。

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/mail exec vitest run lib/optimistic-actions-manager.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: FAIL，因为 `startImmediatePendingAction` 尚未导出。

- [x] **Step 3: Write minimal implementation**

实现同步启动、异步收敛的执行器；同步异常也必须进入 `onFailed`。

- [x] **Step 4: Run test to verify it passes**

重复执行相同单文件、单进程命令，Expected: PASS。

### Task 2: 删除默认延迟分支

**Files:**
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`

**Interfaces:**
- Consumes: `startImmediatePendingAction`。
- Produces: `createPendingAction` 的普通路径立即执行；仅可逆路径设置 Toast 撤销和 `lastActionId`。

- [x] **Step 1: Replace delayed execution**

删除 `onAutoClose/onDismiss -> doAction` 分支以及 `immediate` 参数。普通路径创建后立即调用 `startImmediatePendingAction`，Toast 只显示状态，不携带撤销按钮。

- [x] **Step 2: Restrict global undo**

只有 `revert + queueKey` 配置完整时才设置 `lastActionId`；普通操作清空该字段，避免快捷键执行假撤销。

- [x] **Step 3: Verify call sites**

确认 Move、快捷键删除、Snooze、Unsnooze、Delete Draft 均不再依赖 Toast 关闭事件，且现有 Read、Star、Important、Archive 的可逆执行不变。

### Task 3: 定向回归验证

**Files:**
- Test: `apps/mail/lib/optimistic-actions-manager.test.ts`
- Test: `apps/mail/lib/immediate-reversible-action.test.ts`

**Interfaces:**
- Consumes: 两种立即执行器的最终实现。

- [x] **Step 1: Run focused tests**

Run: `pnpm --dir apps/mail exec vitest run lib/optimistic-actions-manager.test.ts lib/immediate-reversible-action.test.ts --pool=forks --poolOptions.forks.singleFork=true`

Expected: 两个测试文件全部 PASS，且只启用一个 fork。

- [x] **Step 2: Inspect diff and status**

确认没有修改 `.env.example`，没有生成构建产物，代码中不存在通过 Toast 关闭事件启动邮件写请求的路径。
