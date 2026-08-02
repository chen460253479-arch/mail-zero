# Mail List Important Indicator and Action Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在邮件列表显示重要状态，并为仅图标的文件夹和标签操作补充悬停提示。

**Architecture:** 复用列表已经计算完成的 `optimisticLabels`，仅扩展系统标签到图标的展示映射。Tooltip 封装在两个可复用菜单组件内部，并根据 `label` 是否存在决定是否启用，保持所有调用点一致。

**Tech Stack:** React 19、TypeScript、Radix Tooltip/Popover、Vitest、Paraglide。

## Global Constraints

- 不新增邮件状态或后端接口。
- 不改变文件夹移动和标签提交逻辑。
- 不自动构建或部署。

---

### Task 1: 重要标签图标

**Files:**

- Create: `apps/mail/components/mail/system-mail-label-icon.tsx`
- Create: `apps/mail/components/mail/system-mail-label-icon.test.tsx`
- Create: `apps/mail/components/mail/mail-list-labels.ts`
- Create: `apps/mail/components/mail/mail-list-labels.test.ts`
- Modify: `apps/mail/components/mail/mail-list.tsx`

**Interfaces:**

- Consumes: `{ label: string }`。
- Produces: `SystemMailLabelIcon`，为 `STARRED`、`IMPORTANT` 返回图标，其他标签返回 `null`。

- [x] **Step 1: 写失败测试**

使用 `renderToStaticMarkup` 断言 `IMPORTANT` 输出带“重要”无障碍名称的 SVG，`STARRED` 仍输出星标，普通标签不输出图标。

- [x] **Step 2: 验证测试因缺少组件而失败**

Run: `pnpm --dir apps/mail exec vitest run components/mail/system-mail-label-icon.test.tsx`

Expected: FAIL，因为 `system-mail-label-icon.tsx` 尚不存在。

- [x] **Step 3: 最小实现并接入列表**

实现系统标签图标映射，并让 `MailLabels` 调用该组件，删除 `mail-list.tsx` 内部只支持星标的旧映射函数。

- [x] **Step 4: 验证定向测试通过**

Run: `pnpm --dir apps/mail exec vitest run components/mail/system-mail-label-icon.test.tsx`

Expected: PASS。

- [x] **Step 5: 让列表标签即时合并重要与星标**

先用 `mail-list-labels.test.ts` 证明列表缺少统一合并入口，再实现 `buildOptimisticMailListLabels`：复用 `applyOptimisticKeywordTags`，同时保留现有自定义标签添加与移除行为，并在 `mail-list.tsx` 中替换只处理星标的分支。

### Task 2: 图标菜单 Tooltip

**Files:**

- Create: `apps/mail/components/mailbox/icon-action-tooltip.tsx`
- Create: `apps/mail/components/mailbox/icon-action-tooltip.test.tsx`
- Modify: `apps/mail/components/mailbox/move-to-folder-menu.tsx`
- Modify: `apps/mail/components/mailbox/label-picker.tsx`

**Interfaces:**

- Consumes: `{ label?: string; tooltip: string; children: ReactElement }`。
- Produces: `IconActionTooltip`；有文字标签时原样返回 Trigger，没有文字标签时包装 Tooltip。

- [x] **Step 1: 写失败测试并验证 Tooltip 显示条件**

断言无文字 `label` 时启用 Tooltip，带文字 `label` 时不重复启用 Tooltip。运行：

`pnpm --dir apps/mail exec vitest run components/mailbox/icon-action-tooltip.test.tsx --maxWorkers=1`

Expected: FAIL，因为 `icon-action-tooltip.tsx` 尚不存在。

- [x] **Step 2: 将 Tooltip 封装在菜单 Trigger 层**

用 `IconActionTooltip` 包装 `PopoverTrigger`，Tooltip Trigger 与 Popover Trigger 都使用 `asChild` 组合到同一个按钮。

- [x] **Step 3: 复用现有本地化文案**

文件夹使用 `common.mailboxes.moveToFolder`，标签使用 `common.mailboxes.manageLabels`，带文字模式跳过 Tooltip。

- [x] **Step 4: 运行相关定向测试和格式检查**

Run: `pnpm --dir apps/mail exec vitest run components/mail/system-mail-label-icon.test.tsx components/mailbox/mail-action-menus.test.tsx`

Expected: PASS；随后运行涉及文件的 `prettier --check` 与 `git diff --check`，不执行构建。

### Task 3: 移动菜单系统邮箱本地化

**Files:**

- Create: `apps/mail/components/mailbox/mailbox-display-name.ts`
- Create: `apps/mail/components/mailbox/mailbox-display-name.test.ts`
- Modify: `apps/mail/components/mailbox/mail-action-menu-domain.ts`
- Modify: `apps/mail/components/mailbox/mail-action-menus.test.tsx`
- Modify: `apps/mail/components/mailbox/move-to-folder-menu.tsx`

- [x] **Step 1: 写系统邮箱 role 显示名称与本地化搜索失败测试**

断言系统邮箱使用传入的本地化 role 名称、自定义文件夹保留原名，并且 `buildMoveTargets` 可以用本地化显示名称搜索。

- [x] **Step 2: 实现统一显示名称并接入菜单**

新增 `getMailboxDisplayName`，移动目标携带同一个 `displayName` 用于搜索与渲染；菜单传入现有侧栏本地化文案。

- [x] **Step 3: 运行定向测试与静态检查**

只运行邮箱显示名称、操作菜单以及本批已有测试，不执行构建或部署。
