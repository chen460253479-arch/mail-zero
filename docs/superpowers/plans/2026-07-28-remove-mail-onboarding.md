# Zero 邮件新手引导完整移除实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整删除邮件页面的新手引导弹窗、兼容逻辑和专用依赖。

**Architecture:** 使用现有邮件架构测试保护“无 onboarding 表面”边界，再从 Mail 路由布局删除入口、删除独立组件、清理 Playwright 兼容分支和专用依赖。保持登录、邮箱绑定、首次同步及空邮箱页面不变。

**Tech Stack:** TypeScript、React Router、Vitest、Playwright、pnpm。

## Global Constraints

- 不保留隐藏组件、功能开关或旧兼容分支。
- 不主动清理用户浏览器中已有的 `hasCompletedOnboarding` 键。
- 不修改通用 Dialog、Button、邮箱绑定、同步或空状态逻辑。
- 锁文件只能通过 `pnpm install --lockfile-only --offline --ignore-scripts` 同步；不得下载依赖、修改 `node_modules` 或运行生命周期脚本。
- 不创建 Git worktree，不推送远程分支。

---

### Task 1: 建立新手引导移除回归约束

**Files:**
- Modify: `apps/server/src/mail-architecture.test.ts`
- Test: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: 仓库根路径、Mail 前端清单、邮件布局和三个 Playwright 用例。
- Produces: `contains no retired mail onboarding surface` 架构约束。

- [ ] **Step 1: 写入失败测试**

在 `mail server architecture` 测试组中增加：

```ts
it('contains no retired mail onboarding surface', () => {
  const onboardingPath = resolve(repositoryRoot, 'apps/mail/components/onboarding.tsx');
  const inspectedFiles = [
    'apps/mail/app/(routes)/mail/layout.tsx',
    'packages/testing/e2e/mail-actions.spec.ts',
    'packages/testing/e2e/mail-inbox.spec.ts',
    'packages/testing/e2e/search-bar.spec.ts',
  ];
  const source = inspectedFiles
    .map((path) => readFileSync(resolve(repositoryRoot, path), 'utf8'))
    .join('\n');
  const retiredReferences = [
    'OnboardingDialog',
    'OnboardingWrapper',
    'hasCompletedOnboarding',
    'Welcome to Zero Email',
  ];
  const dependencies = dependencyNames(readManifest('apps/mail/package.json'));

  expect(existsSync(onboardingPath)).toBe(false);
  expect(retiredReferences.filter((reference) => source.includes(reference))).toEqual([]);
  expect(
    ['canvas-confetti', '@types/canvas-confetti'].filter((name) => dependencies.includes(name)),
  ).toEqual([]);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts -t "contains no retired mail onboarding surface"
```

Expected: FAIL；报告 onboarding 文件仍存在、引用仍存在和两个专用依赖仍被声明。

---

### Task 2: 删除新手引导及专用依赖

**Files:**
- Modify: `apps/mail/app/(routes)/mail/layout.tsx`
- Delete: `apps/mail/components/onboarding.tsx`
- Modify: `packages/testing/e2e/mail-actions.spec.ts`
- Modify: `packages/testing/e2e/mail-inbox.spec.ts`
- Modify: `packages/testing/e2e/search-bar.spec.ts`
- Modify: `apps/mail/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: Task 1 的失败约束。
- Produces: 无新手引导入口、组件、兼容分支和专用依赖的 Mail 前端。

- [ ] **Step 1: 删除运行时入口和组件**

从 Mail 布局删除：

```ts
import { OnboardingWrapper } from '@/components/onboarding';
```

以及：

```tsx
<OnboardingWrapper />
```

删除 `apps/mail/components/onboarding.tsx` 整个文件。

- [ ] **Step 2: 删除 E2E 兼容分支**

从三个 Playwright 用例删除从 `await page.waitForTimeout(2000)` 开始、用于查找
`Welcome to Zero Email!` 并点击页面关闭弹窗的 `try/catch` 块。保留进入收件箱和后续业务断言。

- [ ] **Step 3: 删除专用依赖并离线同步锁文件**

从 `apps/mail/package.json` 删除：

```json
"canvas-confetti": "1.9.3"
"@types/canvas-confetti": "1.9.0"
```

Run:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts
```

Expected: exit 0；`downloaded 0`、`added 0`，不执行安装脚本。

- [ ] **Step 4: 运行目标测试并确认 GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts -t "contains no retired mail onboarding surface"
```

Expected: PASS。

---

### Task 3: 验证完整删除和前端构建

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-remove-mail-onboarding.md`
- Verify: `apps/mail`
- Verify: `apps/server/src/mail-architecture.test.ts`
- Verify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Tasks 1–2 的完整删除结果。
- Produces: 可提交的、无残留的新手引导删除变更。

- [ ] **Step 1: 运行相关回归测试和类型检查**

Run:

```powershell
pnpm --filter @zero/server exec vitest run src/mail-architecture.test.ts
pnpm --filter @zero/mail test
pnpm --filter @zero/mail exec tsc --noEmit --incremental false
```

Expected: 全部 exit 0。

- [ ] **Step 2: 验证生产构建**

Run:

```powershell
pnpm --filter @zero/mail build
```

Expected: exit 0。

- [ ] **Step 3: 验证锁文件和残留**

Run:

```powershell
pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile
git grep -n -i "OnboardingDialog\|OnboardingWrapper\|hasCompletedOnboarding\|Welcome to Zero Email\|canvas-confetti" -- . ':!docs/superpowers/**'
git diff --check
git status --short
```

Expected: 冻结锁文件校验 exit 0；代码、依赖清单和锁文件中没有 onboarding 或
`canvas-confetti` 残留；只有计划内文件发生变化。

- [ ] **Step 4: 清理生成目录并更新复选框**

删除本轮验证产生的 `apps/mail/build`、`.wrangler`、`node-compile-cache` 和
`update-check` 等被忽略或未跟踪的生成目录；将所有已完成步骤更新为 `- [x]`。

- [ ] **Step 5: 提交实现**

```powershell
git add 'apps/mail/app/(routes)/mail/layout.tsx' apps/server/src/mail-architecture.test.ts packages/testing/e2e/mail-actions.spec.ts packages/testing/e2e/mail-inbox.spec.ts packages/testing/e2e/search-bar.spec.ts apps/mail/package.json pnpm-lock.yaml docs/superpowers/plans/2026-07-28-remove-mail-onboarding.md
git add -u -- apps/mail/components/onboarding.tsx
git commit -m "refactor(mail): remove onboarding surface"
```

Expected: 创建一个包含完整删除和回归约束的提交；不推送远程分支。
