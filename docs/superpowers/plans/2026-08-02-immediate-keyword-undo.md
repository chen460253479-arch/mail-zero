# 邮件关键字立即提交与反向撤销实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已读、重要和星标改为点击后立即写入后端，并在撤销时按顺序提交反向关键字变更。

**Architecture:** 新增无 UI 依赖的可逆异步操作控制器和按键队列，用单元测试覆盖立即执行、撤销等待、失败与顺序。`useOptimisticActions` 仅让关键字操作使用新控制器，其他动作继续使用原有延迟执行路径。

**Tech Stack:** TypeScript、React 19、TanStack Query、Jotai、tRPC、Vitest。

## Global Constraints

- 保留五秒撤销窗口。
- 已读、重要和星标继续使用幂等关键字目标状态，不传递 `ifInState`。
- 不改变移动、归档、标签、删除、暂停和草稿删除行为。
- 不修改 Server API、Mail Core、PostgreSQL 表结构或已有邮件数据。
- 不增加第三方依赖。

---

### Task 1: 可逆异步操作控制器

**Files:**

- Create: `apps/mail/lib/immediate-reversible-action.test.ts`
- Create: `apps/mail/lib/immediate-reversible-action.ts`

**Interfaces:**

- Produces: `KeyedActionQueue.enqueue<T>(key: string, operation: () => Promise<T>): Promise<T>`
- Produces: `startImmediateReversibleAction(options): { undo(): Promise<void>; finalize(): Promise<void> }`
- `options` 包含 `execute`、`revert`、`onUndoRequested`、`onCommitted`、`onForwardFailed`、`onReverted` 和 `onRevertFailed`。

- [x] **Step 1: 编写失败测试**

测试创建控制器后主请求立即开始、主请求成功后撤销调用反向请求、主请求未完成时撤销等待主请求，以及主请求失败时不调用反向请求。

- [x] **Step 2: 运行测试并验证失败**

```powershell
pnpm --dir apps/mail exec vitest run lib/immediate-reversible-action.test.ts
```

预期：模块尚不存在，测试失败。

- [x] **Step 3: 实现最小控制器**

实现按键串行队列和可逆控制器。无前序任务时同步调用主操作；有前序任务时等待同一键的任务完成。撤销只在主操作成功后执行反向操作。

- [x] **Step 4: 运行测试并验证通过**

运行 Step 2 命令，预期全部通过。

### Task 2: 接入关键字乐观操作

**Files:**

- Modify: `apps/mail/hooks/use-optimistic-actions.ts`
- Create: `apps/mail/modules/mail/mutations/keyword-action-operations.ts`
- Create: `apps/mail/modules/mail/mutations/keyword-action-operations.test.ts`

**Interfaces:**

- `createPendingAction` 新增可选 `revert?: () => Promise<void>`；存在 `revert` 时立即启动主请求。
- `createKeywordActionOperations` 生成正向、反向操作和账户关键字队列键。
- 已读的反向状态为未读，重要的反向状态为非重要，星标的反向状态为非星标，反之亦然。
- `PendingAction.undo` 仍保持同步调用接口，内部以 `void` 启动异步反向请求，兼容 Toast 和快捷键调用者。

- [x] **Step 1: 编写关键字正向与反向映射失败测试**

验证正向操作使用目标状态，反向操作使用相反状态，并生成账户与关键字级队列键。

- [x] **Step 2: 运行测试并验证失败**

```powershell
pnpm --dir apps/mail exec vitest run modules/mail/mutations/keyword-action-operations.test.ts
```

- [x] **Step 3: 实现关键字操作映射**

实现 `createKeywordActionOperations`，集中定义目标状态与相反状态，避免 Hook 中重复手写撤销参数。

- [x] **Step 4: 接入可逆执行路径**

关键字操作传入反向 `updateKeyword`。主请求创建时立即启动；Toast 自动结束时只负责刷新和清理；撤销时立即回退 UI，并在主请求成功后调用反向请求。主请求或反向请求失败时刷新真实数据并显示失败提示。

- [x] **Step 5: 保持非关键字路径不变**

确认没有 `revert` 的操作仍只在 Toast 自动关闭或手动关闭时执行，不改变现有归档、移动等交互。

- [x] **Step 6: 运行相关测试**

```powershell
pnpm --dir apps/mail exec vitest run lib/immediate-reversible-action.test.ts lib/optimistic-actions-manager.test.ts modules/mail/mutations/thread-action-input.test.ts components/mail/optimistic-keyword-tags.test.ts lib/thread-actions.test.ts
```

### Task 3: 完整验证

**Files:**

- Verify: Tasks 1-2 中的全部文件。

- [x] **Step 1: 运行 Mail 全量测试**

```powershell
pnpm --dir apps/mail test
```

- [x] **Step 2: 运行 Mail 生产构建**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2048'; pnpm --dir apps/mail build
```

- [x] **Step 3: 检查格式与差异**

运行目标文件 Prettier 检查、`git diff --check` 和 `git status --short`，确认没有构建产物或无关修改。
