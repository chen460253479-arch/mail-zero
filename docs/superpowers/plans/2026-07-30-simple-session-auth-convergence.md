# 单一 Session 登录收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Better Auth Session 成为唯一登录状态，前端只保留一个受保护
路由守卫，用户查询缓存只按 `userId` 隔离。

**Architecture:** 根布局只提供公共 UI Provider，不读取或判断登录状态。
`(routes)/layout.tsx` 的 `clientLoader` 检查 Session、处理首次改密并返回
`userId`；同一布局使用 `user:<userId>` 创建 QueryProvider。服务端继续
根据 Session 强制执行角色和数据权限。

**Tech Stack:** React 19、React Router 7、Better Auth、TanStack Query、
TypeScript、Vitest。

## 全局约束

- 不新增第二套登录状态或 CRM Launch 专用模式。
- 不改变 Better Auth Session、服务端权限和用户数据隔离。
- 不自动构建、打包或重启 Docker。
- 不修改或提交用户已有的 `.gitignore` 变更。
- 不创建 Git worktree。

---

### Task 1: 让受保护路由成为唯一前端登录守卫

**Files:**

- Modify: `apps/mail/app/(routes)/layout.tsx`
- Modify: `apps/mail/app/routes.ts`
- Create: `apps/mail/modules/auth/protected-route-session.ts`
- Test: `apps/mail/modules/external-access/protected-route-session.test.ts`

- [x] 测试有效 Session 返回 `{ userId: 'user-1' }`，当前实现返回
      `null`，先确认 RED。
- [x] 保留未登录跳转 `/login` 和普通用户首次改密跳转。
- [x] 将 `/change-password` 注册在同一受保护布局下，复用 Session 与
      QueryProvider，避免重定向循环。
- [x] 让 `clientLoader` 在通过检查后返回 Session 用户 ID。

### Task 2: 将用户缓存隔离放入受保护路由

**Files:**

- Modify: `apps/mail/app/(routes)/layout.tsx`
- Modify: `apps/mail/providers/client-providers.tsx`
- Create: `apps/mail/providers/user-theme-sync.tsx`
- Test: `apps/mail/modules/mail/routing/mail-route-provider-order.test.tsx`

- [x] 在受保护布局读取 loader 的 `userId`，使用 `user:<userId>` 缓存主体创建
      QueryProvider。
- [x] 将用户主题设置同步放入 QueryProvider 内；公共 Provider 使用
      `system` 默认主题，不再依赖用户 API。
- [x] 首次改密页只挂载 QueryProvider，不提前发起主题和邮箱账户查询。

### Task 3: 删除重复登录状态

**Files:**

- Modify: `apps/mail/app/root.tsx`
- Modify: `apps/mail/app/page.tsx`
- Modify: `apps/mail/app/(routes)/mail/layout.tsx`
- Modify: `apps/mail/app/(routes)/settings/layout.tsx`
- Delete: `apps/mail/providers/server-providers.tsx`
- Delete: `apps/mail/modules/external-access/access-context.tsx`
- Delete: `apps/mail/modules/external-access/access-context.test.tsx`

- [x] 根布局删除 Session loader、AppAccessProvider 和用户缓存逻辑。
- [x] 首页只依赖自身 `clientLoader` 完成已登录重定向。
- [x] 邮件布局删除 `anonymous` 二次判断，只渲染受保护路由内容。
- [x] 全仓搜索确认生产代码不再引用 AppAccessContext。

### Task 4: 验证与提交

- [x] 运行登录、缓存隔离、路由守卫定向测试。
- [x] 运行 `pnpm --filter @zero/mail exec tsc --noEmit`。
- [x] 运行 `pnpm --dir apps/mail test`。
- [x] 运行 `git diff --check` 并复审差异。
- [x] 仅提交本次认证收敛文件，排除 `.gitignore`。
- [x] 只提供手动 Docker 更新命令，不自动执行。
