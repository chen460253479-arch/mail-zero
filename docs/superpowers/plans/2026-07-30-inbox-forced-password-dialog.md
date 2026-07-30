# Inbox Forced Password Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 普通用户使用初始密码登录后直接进入 `/mail/inbox`，通过不可关闭的弹窗完成改密，并在不退出当前 Session 的情况下进入正常邮箱界面。

**Architecture:** Better Auth Session 仍是唯一登录状态来源。受保护路由 loader 返回 `userId` 和 `passwordChangeRequired`；布局在需要改密时只挂载用户级 QueryProvider、静态 Inbox 背景和改密弹窗，不挂载任何会请求私有邮箱数据的 Provider。改密成功后通过完整页面导航重新读取同一 Session。

**Tech Stack:** React 19、React Router 7、Better Auth、TanStack Query、tRPC、Radix Dialog、TypeScript、Vitest。

## Global Constraints

- 不新增第二套登录状态或 CRM Launch 专用前端模式。
- 不削弱服务端 `PASSWORD_CHANGE_REQUIRED` 限制。
- CRM Launch、管理员和已完成改密的普通用户不显示强制改密弹窗。
- 改密成功后不调用 `signOut`，不要求重新登录。
- 不自动构建、打包、重启或重新创建 Docker 容器。
- 只运行定向测试、完整测试、TypeScript 和差异检查。
- 不修改或提交用户已有的 `.gitignore` 变更。
- 按仓库要求直接在 `D:\WorkSpace\Zero` 当前分支工作，不创建 Git worktree。

---

### Task 1: 将首次改密改为 Session 界面标记

**Files:**

- Modify: `apps/mail/modules/auth/protected-route-session.ts`
- Modify: `apps/mail/modules/external-access/protected-route-session.test.ts`
- Modify: `apps/mail/app/routes.ts`
- Delete: `apps/mail/app/(auth)/change-password/page.tsx`

**Interfaces:**

- Consumes: `requiresInitialPasswordChange(session): boolean`
- Produces: `loadProtectedRouteSession(...): Promise<{ userId: string; passwordChangeRequired: boolean }>`

- [x] **Step 1: 修改测试，描述 Inbox 弹窗所需的 Session 合约**

将密码登录普通用户的断言从 `/change-password` 重定向改为：

```ts
await expect(
  loadProtectedRouteSession(new Request('http://localhost:3000/mail/inbox'), {
    getSession: vi.fn(async () => ({
      user: { id: 'user-1', role: 'user', mustChangePassword: true },
      session: { authMethod: 'password' },
    })),
  }),
).resolves.toEqual({
  userId: 'user-1',
  passwordChangeRequired: true,
});
```

同时使用现有 Session fixture 分别断言：

```ts
await expect(loadProtectedRouteSession(request, launchDependencies)).resolves.toEqual({
  userId: 'user-1',
  passwordChangeRequired: false,
});
await expect(loadProtectedRouteSession(request, adminDependencies)).resolves.toEqual({
  userId: 'admin-1',
  passwordChangeRequired: false,
});
expect(protectedLayout?.children).not.toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      file: '(auth)/change-password/page.tsx',
      path: '/change-password',
    }),
  ]),
);
```

- [x] **Step 2: 运行测试并确认 RED**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "modules/external-access/protected-route-session.test.ts"
```

Expected: FAIL，因为当前实现仍抛出 `/change-password` 重定向、返回值没有 `passwordChangeRequired`，并且路由仍存在。

- [x] **Step 3: 实现最小 Session 合约并移除独立路由**

将 loader 收敛为：

```ts
export async function loadProtectedRouteSession(
  request: Pick<Request, 'headers'>,
  dependencies: ProtectedRouteSessionDependencies,
): Promise<{ userId: string; passwordChangeRequired: boolean }> {
  const session = await dependencies.getSession({ headers: request.headers });
  if (!session) throw redirect('/login');
  return {
    userId: session.user.id,
    passwordChangeRequired: requiresInitialPasswordChange(session),
  };
}
```

从 `routes.ts` 删除：

```ts
route('/change-password', '(auth)/change-password/page.tsx'),
```

删除不再被路由引用的 `apps/mail/app/(auth)/change-password/page.tsx`。

- [x] **Step 4: 运行定向测试并确认 GREEN**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "modules/external-access/protected-route-session.test.ts" "modules/auth/login-method.test.ts"
```

Expected: PASS。

- [x] **Step 5: 提交 Session 合约**

```powershell
git add -- "apps/mail/modules/auth/protected-route-session.ts" "apps/mail/modules/external-access/protected-route-session.test.ts" "apps/mail/app/routes.ts" "apps/mail/app/(auth)/change-password/page.tsx"
git commit -m "refactor(auth): expose password change requirement"
```

---

### Task 2: 将改密表单改为不可关闭弹窗并保持当前 Session

**Files:**

- Modify then move: `apps/mail/app/(auth)/change-password/change-password-client.tsx` → `apps/mail/modules/auth/forced-password-change-dialog.tsx`
- Modify then move: `apps/mail/app/(auth)/change-password/change-password-client.test.tsx` → `apps/mail/modules/auth/forced-password-change-dialog.test.tsx`

**Interfaces:**

- Consumes: `trpc.user.changePassword`
- Produces: `submitForcedPasswordChange(input, dependencies): Promise<void>`
- Produces: `ForcedPasswordChangeDialog(): JSX.Element`

- [x] **Step 1: 为保持 Session 的成功流程编写失败测试**

先在现有 `change-password-client.test.tsx` 中修改提交测试。测试仍调用当前
`submitPasswordChange`，同时传入旧 `navigate` 和新 `reloadInbox`，使当前实现产生明确的断言失败而不是模块加载错误：

```ts
const changePassword = vi.fn(async () => ({ success: true }));
const navigate = vi.fn();
const reloadInbox = vi.fn();
const dependencies = { changePassword, navigate, reloadInbox };

await submitPasswordChange(
  {
    currentPassword: 'user_200',
    newPassword: 'new-secure-password',
  },
  dependencies,
);

expect(changePassword).toHaveBeenCalledWith({
  currentPassword: 'user_200',
  newPassword: 'new-secure-password',
});
expect(reloadInbox).toHaveBeenCalledOnce();
expect(navigate).not.toHaveBeenCalled();
```

失败 mutation 必须满足：

```ts
const changePassword = vi.fn(async () => {
  throw new Error('INVALID_PASSWORD');
});
const navigate = vi.fn();
const reloadInbox = vi.fn();
const submission = submitPasswordChange(
  {
    currentPassword: 'wrong-password',
    newPassword: 'new-secure-password',
  },
  { changePassword, navigate, reloadInbox },
);

await expect(submission).rejects.toThrow('INVALID_PASSWORD');
expect(reloadInbox).not.toHaveBeenCalled();
expect(navigate).not.toHaveBeenCalled();
```

在同一测试文件 mock `useMutation`、`useTRPC` 和 Dialog 原语，然后渲染当前
`ChangePasswordClient`。当前页面没有 Dialog 标记，因此断言会失败：

```ts
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('@/providers/query-provider', () => ({
  useTRPC: () => ({
    user: { changePassword: { mutationOptions: () => ({}) } },
  }),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (
    <div data-dialog-open={String(open)}>{children}</div>
  ),
  DialogContent: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <section {...props}>{children}</section>
  ),
  DialogHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));

const html = renderToStaticMarkup(<ChangePasswordClient />);

expect(html).toContain('data-forced-password-dialog="true"');
expect(html).toContain('data-dialog-open="true"');
expect(html).not.toContain('data-dialog-close');
```

- [x] **Step 2: 运行新测试并确认 RED**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "app/(auth)/change-password/change-password-client.test.tsx"
```

Expected: FAIL，因为当前 helper 仍调用 SPA `navigate`，组件仍是独立全屏页面。

- [x] **Step 3: 实现不可关闭弹窗**

先在现有文件中将提交 helper 改为：

```ts
type ForcedPasswordChangeDependencies = {
  changePassword(input: PasswordChangeInput): Promise<unknown>;
  reloadInbox(): void;
};

export const submitForcedPasswordChange = async (
  input: PasswordChangeInput,
  dependencies: ForcedPasswordChangeDependencies,
): Promise<void> => {
  await dependencies.changePassword(input);
  dependencies.reloadInbox();
};
```

将组件改为受控打开的 Dialog。保留现有三个受控输入和校验逻辑，完整结构为：

```tsx
export function ForcedPasswordChangeDialog() {
  const trpc = useTRPC();
  const changePassword = useMutation(trpc.user.changePassword.mutationOptions());
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    if (newPassword.length < 12) {
      setError('The new password must contain at least 12 characters');
      return;
    }
    if (newPassword !== confirmation) {
      setError('The new passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different');
      return;
    }
    try {
      await submitForcedPasswordChange(
        { currentPassword, newPassword },
        {
          changePassword: changePassword.mutateAsync,
          reloadInbox: () => window.location.assign('/mail/inbox'),
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change the password');
    }
  };

  return (
    <Dialog open>
      <DialogContent
        showOverlay
        data-forced-password-dialog="true"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>
            Change the initial password before using your mailbox.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span>Current password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="block space-y-2">
            <span>New password</span>
            <input
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={12}
            />
          </label>
          <label className="block space-y-2">
            <span>Confirm new password</span>
            <input
              autoComplete="new-password"
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={12}
            />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <Button type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending ? 'Updating…' : 'Change password'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

不渲染 `DialogClose`，不调用 `signOut`，不调用 SPA `navigate`。GREEN 后使用
`apply_patch` 的 move 操作把组件和测试移动到最终模块路径，并更新测试 import。

- [x] **Step 4: 运行弹窗测试并确认 GREEN**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "modules/auth/forced-password-change-dialog.test.tsx"
```

Expected: PASS。

- [x] **Step 5: 提交弹窗组件**

```powershell
git add -- "apps/mail/modules/auth/forced-password-change-dialog.tsx" "apps/mail/modules/auth/forced-password-change-dialog.test.tsx" "apps/mail/app/(auth)/change-password/change-password-client.tsx" "apps/mail/app/(auth)/change-password/change-password-client.test.tsx"
git commit -m "feat(auth): add forced password change dialog"
```

---

### Task 3: 在 Inbox 门禁中暂停私有数据加载

**Files:**

- Create: `apps/mail/modules/auth/password-change-required-view.tsx`
- Modify: `apps/mail/app/(routes)/layout.tsx`
- Modify: `apps/mail/modules/mail/routing/mail-route-provider-order.test.tsx`

**Interfaces:**

- Consumes: `passwordChangeRequired` from protected route loader
- Consumes: `ForcedPasswordChangeDialog`
- Produces: `PasswordChangeRequiredView(): JSX.Element`

- [x] **Step 1: 修改 Provider 生命周期测试并确认目标行为**

让 `useLoaderData` mock 返回可变状态：

```ts
const loaderState = vi.hoisted(() => ({
  userId: 'user-1',
  passwordChangeRequired: false,
}));

vi.mock('react-router', () => ({
  Outlet: () => <main>mail route</main>,
  useLoaderData: () => loaderState,
}));
```

正常 Inbox 断言：

```ts
expect(html).toContain('data-mail-account-status="ready"');
expect(html).not.toContain('data-password-change-required');
```

必须改密时断言：

```ts
loaderState.passwordChangeRequired = true;
const html = renderToStaticMarkup(<MailRouteLayout />);

expect(html).toContain('data-password-change-required="true"');
expect(html).not.toContain('data-mail-account-status');
expect(html).toContain('data-cache-subject="user:user-1"');
expect(html).not.toContain('mail route');
```

- [x] **Step 2: 运行 Provider 测试并确认 RED**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "modules/mail/routing/mail-route-provider-order.test.tsx"
```

Expected: FAIL，因为布局仍按 `/change-password` pathname 分支，尚未使用 Session 标记。

- [x] **Step 3: 实现静态 Inbox 背景和布局门禁**

`PasswordChangeRequiredView` 只能引用无数据查询的 UI 组件，例如 `Skeleton` 和 `ForcedPasswordChangeDialog`：

```tsx
export function PasswordChangeRequiredView() {
  return (
    <div
      data-password-change-required="true"
      className="bg-background relative h-screen w-full overflow-hidden"
    >
      <div aria-hidden="true" className="pointer-events-none flex h-full select-none">
        <aside className="bg-sidebar w-64 border-r p-5">
          <div className="mb-8 flex items-center gap-3">
            <img src="/white-icon.svg" alt="" className="h-8 w-8" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center border-b px-6">
            <Skeleton className="h-8 w-64" />
          </header>
          <section className="space-y-3 p-6">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </section>
        </main>
      </div>
      <ForcedPasswordChangeDialog />
    </div>
  );
}
```

在受保护布局中只根据 loader 返回值分支：

```tsx
const { userId, passwordChangeRequired } = useLoaderData<typeof clientLoader>();

return (
  <QueryProvider cacheSubject={`user:${userId}`}>
    {passwordChangeRequired ? (
      <PasswordChangeRequiredView />
    ) : (
      <>
        <UserThemeSync />
        <MailAccountBootstrapProvider>
          <CommandPaletteProvider>
            <HotkeyProviderWrapper>
              <div className="relative flex max-h-screen w-full overflow-hidden">
                <Outlet />
              </div>
            </HotkeyProviderWrapper>
          </CommandPaletteProvider>
        </MailAccountBootstrapProvider>
      </>
    )}
  </QueryProvider>
);
```

删除 `useLocation` 和 `/change-password` pathname 分支。必须改密时不挂载：

- `UserThemeSync`
- `MailAccountBootstrapProvider`
- `CommandPaletteProvider`
- `HotkeyProviderWrapper`
- `Outlet`

- [x] **Step 4: 运行登录与 Provider 定向测试并确认 GREEN**

Run:

```powershell
pnpm --dir apps/mail exec vitest run "modules/mail/routing/mail-route-provider-order.test.tsx" "modules/external-access/protected-route-session.test.ts" "modules/auth/forced-password-change-dialog.test.tsx" "modules/auth/login-navigation.test.ts"
```

Expected: PASS。

- [x] **Step 5: 提交 Inbox 门禁**

```powershell
git add -- "apps/mail/modules/auth/password-change-required-view.tsx" "apps/mail/app/(routes)/layout.tsx" "apps/mail/modules/mail/routing/mail-route-provider-order.test.tsx"
git commit -m "feat(auth): gate inbox with password dialog"
```

---

### Task 4: 完整验证与交付

**Files:**

- Modify: `docs/superpowers/plans/2026-07-30-inbox-forced-password-dialog.md`

**Interfaces:**

- Consumes: Tasks 1–3 的最终实现
- Produces: 可审查的验证记录和干净的认证改动提交

- [x] **Step 1: 运行邮件应用完整测试**

Run:

```powershell
pnpm --dir apps/mail test
```

Expected: 所有测试文件和测试用例通过，0 failures。

- [x] **Step 2: 运行 TypeScript 检查**

Run:

```powershell
pnpm --filter @zero/mail exec tsc --noEmit
```

Expected: exit code 0。

- [x] **Step 3: 运行定向格式和差异检查**

Run:

```powershell
pnpm exec prettier --check "apps/mail/modules/auth/forced-password-change-dialog.tsx" "apps/mail/modules/auth/forced-password-change-dialog.test.tsx" "apps/mail/modules/auth/password-change-required-view.tsx" "apps/mail/modules/auth/protected-route-session.ts" "apps/mail/modules/external-access/protected-route-session.test.ts" "apps/mail/modules/mail/routing/mail-route-provider-order.test.tsx" "apps/mail/app/(routes)/layout.tsx" "apps/mail/app/routes.ts" "docs/superpowers/plans/2026-07-30-inbox-forced-password-dialog.md"
git diff --check
```

Expected: 格式通过且没有空白错误。

- [x] **Step 4: 复审需求覆盖**

逐项确认：

- 首次密码登录进入 `/mail/inbox`。
- 弹窗不可关闭。
- 改密前不挂载私有数据 Provider。
- 改密成功后保留 Session 并完整刷新 Inbox。
- CRM Launch、管理员和已改密用户直接进入完整页面。
- 独立 `/change-password` 路由和旧页面已移除。
- `.gitignore` 未暂存。
- 未执行构建、打包或 Docker 操作。

- [x] **Step 5: 提交计划完成状态**

```powershell
git add -- "docs/superpowers/plans/2026-07-30-inbox-forced-password-dialog.md"
git commit -m "docs(auth): complete inbox password dialog plan"
```
