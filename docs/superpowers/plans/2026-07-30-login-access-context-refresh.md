# 登录后访问上下文刷新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录成功后完整跳转到 `/mail/inbox`，让根加载器使用新 Session
重新建立用户访问上下文。

**Architecture:** 保留现有登录接口、Cookie 和路由访问检查，只替换登录
成功后的导航方式。登录客户端通过一个可测试的
`enterMailboxAfterLogin` 函数调用 `window.location.assign`，从而触发完整
文档导航。

**Tech Stack:** React 19、React Router 7、Better Auth、TypeScript、Vitest。

## 全局约束

- 不移除 `MailLayout` 的匿名访问检查。
- 不改变登录失败和请求异常处理。
- 不改变 CRM Launch 登录流程。
- 不自动执行 Docker 构建、打包、容器重启或项目构建。
- 不修改或提交用户已有的 `.gitignore` 变更。
- 不创建 Git worktree。

---

### Task 1: 登录成功后执行完整页面跳转

**Files:**

- Modify: `apps/mail/app/(auth)/login/login-client.tsx`
- Create: `apps/mail/modules/auth/login-navigation.ts`
- Create: `apps/mail/modules/auth/login-navigation.test.ts`

**Interfaces:**

- Consumes: 浏览器 `Location.assign(url: string): void`。
- Produces:
  `enterMailboxAfterLogin(location?: Pick<Location, 'assign'>): void`。

- [ ] **Step 1: 写入失败测试**

```tsx
import { describe, expect, it, vi } from 'vitest';

import { enterMailboxAfterLogin } from './login-navigation';

describe('successful login navigation', () => {
  it('reloads the document so the root access context sees the new Session', () => {
    const assign = vi.fn();

    enterMailboxAfterLogin({ assign });

    expect(assign).toHaveBeenCalledWith('/mail/inbox');
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "modules/auth/login-navigation.test.ts"
```

Expected: FAIL，`enterMailboxAfterLogin` 当前为 `undefined`。

- [ ] **Step 3: 实施最小修复**

在 `modules/auth/login-navigation.ts` 中增加：

```tsx
export const enterMailboxAfterLogin = (location: Pick<Location, 'assign'> = window.location) => {
  location.assign('/mail/inbox');
};
```

登录成功后把：

```tsx
navigate('/mail/inbox', { replace: true });
```

替换为：

```tsx
enterMailboxAfterLogin();
```

`login-client.tsx` 从 `@/modules/auth/login-navigation` 导入该函数，并删除
`useNavigate`。

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Run:

```powershell
pnpm --dir apps/mail exec vitest run `
  "modules/auth/login-navigation.test.ts" `
  "modules/auth/login-method.test.ts" `
  "modules/external-access/access-context.test.tsx"
```

Expected: PASS。

- [ ] **Step 5: 运行前端类型检查**

Run:

```powershell
pnpm --filter @zero/mail exec tsc --noEmit
```

Expected: exit code 0。

- [ ] **Step 6: 检查差异并提交**

```powershell
git diff --check
git add -- `
  "apps/mail/app/(auth)/login/login-client.tsx" `
  "apps/mail/modules/auth/login-navigation.ts" `
  "apps/mail/modules/auth/login-navigation.test.ts" `
  "docs/superpowers/plans/2026-07-30-login-access-context-refresh.md"
git commit -m "fix(auth): refresh access context after login"
```

Expected: `.gitignore` 不在暂存或提交列表中。

- [ ] **Step 7: 提供手动 Docker 验证流程**

只向用户提供以下命令，不自动执行：

```powershell
docker compose build mail
docker compose up --detach --no-deps mail
docker compose ps
docker compose logs --tail=100 mail
```

验收结果：管理员登录后最终停留在 `/mail/inbox`，页面不再返回
`/login`。
