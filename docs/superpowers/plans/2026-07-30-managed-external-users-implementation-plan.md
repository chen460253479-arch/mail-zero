# 托管外部用户与统一登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将外部 Nango 邮箱直接绑定到由 `externalUserId` 标识的 Zero 普通用户，并让密码登录与
CRM Launch 建立同一种标准普通用户 Session、使用同一完整界面和 `userId` 数据边界。

**Architecture:** 外部绑定接口先幂等创建托管普通用户，再使用该用户 ID 调用现有 Nango 邮箱绑定
内核。Launch Grant 只保存目标用户和一次性 Code 摘要，Code 由 Better Auth 自定义端点消费并写入
标准 Session Cookie。普通用户始终按 `userId` 隔离；超管通过角色获得实例级 Connection 和
Mail Account 访问范围。

**Tech Stack:** TypeScript、Hono、Better Auth 1.3.7、tRPC、Drizzle ORM、PostgreSQL、React
Router 7、React Query、Vitest。

## Global Constraints

- 前端公开注册和用户创建入口保持关闭。
- `externalUserId` 是普通用户的 Better Auth Username，也是初始密码。
- 第一次密码登录必须修改密码；Launch 登录不受首次改密阻断。
- CRM Launch 与普通用户密码登录的菜单、路由、邮箱范围和操作权限完全相同。
- 同一个 Nango Connection 永远只能属于一个普通用户。
- CRM Launch 请求不再接收 `allowedNangoConnectIds`。
- Webhook payload 继续严格保持 `{ "eventId": string, "messageId": string }`。
- 不实现首次历史邮件同步。
- 当前为开发阶段：不编写历史数据迁移、旧邮箱认领、旧 Session 兼容或回填逻辑。
- 不修改或暂存用户现有的 `.gitignore` 变更。
- 不创建 Git worktree；直接在 `codex/local-mail-core` 分支实施。

---

### Task 1: 托管普通用户与 Nango 邮箱唯一归属

**Files:**

- Modify: `apps/server/src/db/core-schema.ts`
- Create: `apps/server/src/modules/external-integration/application/provision-managed-user.ts`
- Create: `apps/server/src/modules/external-integration/postgres/managed-user-repository.ts`
- Modify: `apps/server/src/modules/external-integration/contracts/bind.ts`
- Modify: `apps/server/src/modules/external-integration/http/router.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.ts`
- Modify: `apps/server/src/modules/mail-accounts/postgres/connection-repository.ts`
- Modify: `apps/server/src/lib/admin-provisioning.ts`
- Test: `apps/server/tests/unit/modules/external-integration/application/provision-managed-user.test.ts`
- Test: `apps/server/tests/unit/modules/external-integration/http/bind.test.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts`
- Test: `apps/server/tests/integration/modules/external-integration/managed-user.integration.test.ts`

**Interfaces:**

- Produces:
  `provisionManagedUser({ externalUserId }, dependencies): Promise<{ userId: string; created: boolean }>`
- Produces:
  `ManagedUserRepository.findOrCreate(input): Promise<{ userId: string; created: boolean }>`
- Changes bind body to:
  `{ externalUserId: string; channelId: MailChannelId; connectionId: string }`
- Changes `findByNangoReference` result to:
  `{ connectionId: string; userId: string } | null`

- [ ] **Step 1: Write failing managed-user contract and application tests**

  Add literal cases for `user_200`, invalid whitespace/characters, idempotent lookup, `role = user`,
  `mustChangePassword = true`, deterministic internal email, initial password hashing, and rejection
  when the existing Username belongs to a non-user role.

  ```ts
  await expect(
    provisionManagedUser(
      { externalUserId: 'user_200' },
      {
        repository,
        hashPassword: async (value) => `hashed:${value}`,
        now: () => now,
        newId: () => 'managed-user-1',
      },
    ),
  ).resolves.toEqual({ userId: 'managed-user-1', created: true });
  expect(repository.created).toMatchObject({
    username: 'user_200',
    role: 'user',
    mustChangePassword: true,
    passwordHash: 'hashed:user_200',
  });
  ```

- [ ] **Step 2: Run the new tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/provision-managed-user.test.ts`

  Expected: FAIL because `provision-managed-user.ts` and the schema fields do not exist.

- [ ] **Step 3: Implement managed-user schema and repository**

  Add the Better Auth Username fields and password state:

  ```ts
  username: text('username').unique(),
  displayUsername: text('display_username'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  role: text('role').notNull().default('user'),
  ```

  `externalUserId` must match `^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$`. Generate the required internal
  email as `managed-<sha256(externalUserId)>@zero.invalid`; never expose it as the login identifier.
  The PostgreSQL repository must create `auth.user_account`, the credential `auth.account`, and
  default `app.user_settings` in one transaction protected by an advisory lock based on
  `externalUserId`.

- [ ] **Step 4: Write and run failing bind ownership tests**

  Update bind tests so the route rejects a missing `externalUserId`, provisions/looks up the user,
  and passes that returned `userId` to `connectNangoMailbox`.

  Add binding-kernel cases:

  ```ts
  it('returns the existing mailbox for the same user and Nango reference', async () => {
    // bound reference: { connectionId: 'mailbox-1', userId: 'user-1' }
    // expected: { id: 'mailbox-1', identity }
  });

  it('rejects a Nango reference already owned by another user', async () => {
    await expect(bindNangoMailbox(inputForUser2, dependencies)).rejects.toMatchObject({
      code: 'NANGO_CONNECTION_ALREADY_BOUND',
    });
  });
  ```

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/http/bind.test.ts tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts`

  Expected: FAIL because the route still binds to `zero-external-integration` and repeat binding
  returns `MAILBOX_ALREADY_CONNECTED`.

- [ ] **Step 5: Implement user-owned, idempotent bind**

  Resolve `externalUserId` before binding and call:

  ```ts
  await dependencies.connect(
    {
      userId: managedUser.userId,
      channelId: parsed.data.channelId,
      connectionId: parsed.data.connectionId,
    },
    services,
  );
  ```

  Return the existing mailbox ID when the Nango reference is already bound to the same user.
  Return `NANGO_CONNECTION_ALREADY_BOUND` when its stored `connection.userId` differs.

- [ ] **Step 6: Fix administrator provisioning with multiple users**

  Replace the total-user count rule with a `role = 'admin'` lookup under the existing advisory lock.
  Existing ordinary users must not block first admin creation; a second different admin must still
  raise `AdminProvisioningConflictError`.

- [ ] **Step 7: Run Task 1 tests and commit**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/provision-managed-user.test.ts tests/unit/modules/external-integration/http/bind.test.ts tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts tests/integration/modules/external-integration/managed-user.integration.test.ts`

  Expected: PASS.

  Commit:

  ```bash
  git add apps/server/src/db/core-schema.ts apps/server/src/modules/external-integration apps/server/src/modules/mail-accounts apps/server/src/lib/admin-provisioning.ts apps/server/tests
  git commit -m "feat(integration): bind Nango mailboxes to managed users"
  ```

---

### Task 2: 一次性 Launch Code 建立标准 Better Auth Session

**Files:**

- Modify: `apps/server/src/modules/external-integration/contracts/access.ts`
- Modify: `apps/server/src/modules/external-integration/application/create-access-grant.ts`
- Modify: `apps/server/src/modules/external-integration/application/consume-launch-code.ts`
- Create: `apps/server/src/modules/external-integration/auth/managed-launch.ts`
- Modify: `apps/server/src/modules/external-integration/http/launch.ts`
- Modify: `apps/server/src/modules/external-integration/http/router.ts`
- Modify: `apps/server/src/modules/external-integration/postgres/schema.ts`
- Modify: `apps/server/src/modules/external-integration/postgres/repository.ts`
- Modify: `apps/server/src/lib/auth.ts`
- Delete: `apps/server/src/modules/external-integration/session/cookie.ts`
- Delete: `apps/server/src/modules/external-integration/session/resolve.ts`
- Delete: `apps/server/src/modules/external-integration/application/list-scoped-connections.ts`
- Delete: `apps/server/src/modules/external-integration/trpc/router.ts`
- Test: `apps/server/tests/unit/modules/external-integration/application/create-access-grant.test.ts`
- Test: `apps/server/tests/unit/modules/external-integration/application/consume-launch-code.test.ts`
- Test: `apps/server/tests/unit/modules/external-integration/auth/managed-launch.test.ts`
- Test: `apps/server/tests/unit/modules/external-integration/http/launch.test.ts`
- Test: `apps/server/tests/integration/modules/external-integration/access-session.integration.test.ts`

**Interfaces:**

- Changes Grant input to `{ externalUserId: string }`.
- Produces Grant record:
  `{ id; userId; codeDigest; createdAt; expiresAt; consumedAt: null }`.
- Changes `consumeLaunchCode` output to `{ userId: string }`.
- Produces Better Auth API:
  `auth.api.consumeManagedLaunch({ body: { launchCode }, asResponse: true }): Promise<Response>`.

- [ ] **Step 1: Write failing Grant tests**

  Cover exact input shape, unknown user, user without active mailbox, digest-only persistence,
  five-minute expiry and one-time consumption.

  ```ts
  expect(accessGrantInputSchema.parse({ externalUserId: 'user_200' })).toEqual({
    externalUserId: 'user_200',
  });
  expect(() =>
    accessGrantInputSchema.parse({
      externalUserId: 'user_200',
      allowedNangoConnectIds: ['connect-1'],
    }),
  ).toThrow();
  ```

- [ ] **Step 2: Run Grant tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/create-access-grant.test.ts tests/unit/modules/external-integration/application/consume-launch-code.test.ts`

  Expected: FAIL because the implementation still resolves mailbox scopes and creates an external
  browser session.

- [ ] **Step 3: Implement user-only Grant persistence**

  `createAccessGrant` must resolve the `role = user` row by Username, verify at least one connected
  Connection with an active Mail Account, and store only `userId` plus the code digest.
  `consumeLaunchCode` must atomically set `consumedAt` and return only the target `userId`.
  Delete the `external_browser_session` Drizzle table and all Scope/session repository methods.

- [ ] **Step 4: Write failing standard-session endpoint test**

  Test the Better Auth plugin handler with real endpoint behavior: it consumes the code, calls
  `internalAdapter.createSession(userId, ctx, false, { authMethod: 'launch' })`, sets the Better Auth
  signed Session Cookie, returns status 303 and redirects only to the configured `/mail/inbox`.
  Assert the response contains no `zero-external-session` cookie.

- [ ] **Step 5: Run endpoint tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/auth/managed-launch.test.ts tests/unit/modules/external-integration/http/launch.test.ts`

  Expected: FAIL because the managed Launch Better Auth plugin does not exist.

- [ ] **Step 6: Implement Better Auth managed Launch plugin**

  Configure:

  ```ts
  session: {
    additionalFields: {
      authMethod: {
        type: 'string',
        required: false,
        defaultValue: 'password',
        input: false,
      },
    },
  },
  plugins: [
    username({ minUsernameLength: 3, maxUsernameLength: 64, usernameNormalization: false }),
    managedLaunch({ consumeLaunchCode, publicAppUrl }),
    jwt(),
    bearer(),
  ],
  ```

  In the plugin endpoint, load the target user, create the standard Session with
  `{ authMethod: 'launch' }`, call Better Auth `setSessionCookie`, then return:

  ```ts
  return ctx.json(null, {
    status: 303,
    headers: { Location: new URL('/mail/inbox', publicAppUrl).toString() },
  });
  ```

  The existing `/api/integrations/launch` form handler delegates to this typed Better Auth API.

- [ ] **Step 7: Run Task 2 tests and commit**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/create-access-grant.test.ts tests/unit/modules/external-integration/application/consume-launch-code.test.ts tests/unit/modules/external-integration/auth/managed-launch.test.ts tests/unit/modules/external-integration/http/launch.test.ts tests/integration/modules/external-integration/access-session.integration.test.ts`

  Expected: PASS.

  Commit:

  ```bash
  git add apps/server/src/modules/external-integration apps/server/src/lib/auth.ts apps/server/tests
  git commit -m "feat(auth): exchange Launch Codes for user sessions"
  ```

---

### Task 3: Username 登录与首次强制修改密码

**Files:**

- Modify: `apps/server/src/ctx.ts`
- Modify: `apps/server/src/runtime/node/application.ts`
- Modify: `apps/server/src/trpc/trpc.ts`
- Modify: `apps/server/src/trpc/routes/user.ts`
- Modify: `apps/mail/lib/auth-client.ts`
- Modify: `apps/mail/lib/auth-proxy.ts`
- Create: `apps/mail/modules/auth/login-method.ts`
- Modify: `apps/mail/app/(auth)/login/login-client.tsx`
- Create: `apps/mail/app/(auth)/change-password/page.tsx`
- Create: `apps/mail/app/(auth)/change-password/change-password-client.tsx`
- Modify: `apps/mail/app/(routes)/layout.tsx`
- Test: `apps/server/tests/unit/trpc/routes/user.test.ts`
- Test: `apps/server/tests/unit/runtime/node/application.test.ts`
- Test: `apps/mail/modules/auth/login-method.test.ts`
- Test: `apps/mail/app/(auth)/change-password/change-password-client.test.tsx`

**Interfaces:**

- Produces `authenticatedProcedure`: requires a Better Auth Session only.
- Keeps `privateProcedure`: additionally rejects password Sessions with
  `user.mustChangePassword === true` as `PASSWORD_CHANGE_REQUIRED`.
- Produces `user.changePassword({ currentPassword, newPassword })`.
- Adds `signIn.username` to the browser auth client.

- [ ] **Step 1: Write failing server password-gate tests**

  Test four literal cases: anonymous rejected, initial password Session rejected,
  Launch Session allowed, and changed-password Session allowed.

  ```ts
  expect(
    requiresPasswordChange({
      user: { role: 'user', mustChangePassword: true },
      session: { authMethod: 'password' },
    }),
  ).toBe(true);
  expect(
    requiresPasswordChange({
      user: { role: 'user', mustChangePassword: true },
      session: { authMethod: 'launch' },
    }),
  ).toBe(false);
  ```

- [ ] **Step 2: Run server tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/trpc/routes/user.test.ts tests/unit/runtime/node/application.test.ts`

  Expected: FAIL because the request context stores only `sessionUser` and no password-change gate
  exists.

- [ ] **Step 3: Implement server gate and password mutation**

  Store both `session.user` and `session.session` in Hono/tRPC context. Build
  `authenticatedProcedure` from the current authentication middleware, then layer
  `privateProcedure` and `mailSessionProcedure` on the password-change check.
  `user.changePassword` must use `authenticatedProcedure`, require a minimum 12-character new
  password different from `sessionUser.username`, call Better Auth `changePassword`, and only after
  success set `mustChangePassword = false`.

- [ ] **Step 4: Write failing frontend login and redirect tests**

  `resolveLoginMethod('admin@example.test')` must be `email`;
  `resolveLoginMethod('user_200')` must be `username`.
  The route guard must redirect only password Sessions requiring a change to `/change-password`.

- [ ] **Step 5: Run frontend tests and verify RED**

  Run:
  `pnpm --dir apps/mail exec vitest run modules/auth/login-method.test.ts app/(auth)/change-password/change-password-client.test.tsx`

  Expected: FAIL because username login selection and the change-password page do not exist.

- [ ] **Step 6: Implement unified login and change-password UI**

  Add `usernameClient()` to both browser and server auth clients. Replace the login email field with
  an Account field and call `signIn.email` only for email-shaped input; otherwise call
  `signIn.username`. Do not impose a 12-character minimum on the current password field because the
  accepted initial password is `externalUserId`.

  The change-password form sends:

  ```ts
  await changePassword.mutateAsync({
    currentPassword,
    newPassword,
  });
  ```

  On success it redirects to `/mail/inbox`. The authenticated route layout redirects a required
  password Session to this page, while a Launch Session renders the normal application.

- [ ] **Step 7: Run Task 3 tests and commit**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/trpc/routes/user.test.ts tests/unit/runtime/node/application.test.ts`

  Run:
  `pnpm --dir apps/mail exec vitest run modules/auth/login-method.test.ts app/(auth)/change-password/change-password-client.test.tsx`

  Expected: PASS.

  Commit:

  ```bash
  git add apps/server/src/ctx.ts apps/server/src/runtime/node/application.ts apps/server/src/trpc apps/mail
  git commit -m "feat(auth): add managed user password login"
  ```

---

### Task 4: 删除外部受限前端与外部 Session 分支

**Files:**

- Modify: `apps/mail/app/root.tsx`
- Modify: `apps/mail/app/page.tsx`
- Modify: `apps/mail/app/(routes)/mail/layout.tsx`
- Modify: `apps/mail/app/(routes)/settings/layout.tsx`
- Modify: `apps/mail/components/ui/app-sidebar.tsx`
- Modify: `apps/mail/modules/external-access/access-context.tsx`
- Delete: `apps/mail/components/ui/external-account-switcher.tsx`
- Delete: `apps/mail/components/ui/external-account-switcher.test.tsx`
- Delete: `apps/mail/modules/external-access/mail-route-loader.test.ts`
- Modify: `apps/mail/modules/external-access/access-context.test.tsx`
- Modify: `apps/server/src/trpc/index.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/modules/mail-api/procedures/mail-account-procedure.ts`
- Modify: `apps/server/src/modules/mail-api/routers/account.ts`
- Modify: `apps/server/src/modules/mail-api/http/authorize-mail-account.ts`
- Modify: `apps/server/tests/architecture/external-mail-frontend-boundary.test.ts`
- Replace: `apps/server/tests/architecture/external-session-permissions.test.ts`

**Interfaces:**

- Reduces app access to:
  `{ mode: 'anonymous'; cacheSubject: null } | { mode: 'user'; cacheSubject: `user:${string}` }`.
- Reduces `MailAccessSubject` to authenticated user/admin subjects; no Scope or external session.

- [ ] **Step 1: Rewrite architecture and access-context tests first**

  Assert that production source contains none of:
  `zero-external-session`, `externalBrowserSession`, `allowedNangoConnectIds`,
  `ExternalAccountSwitcher`, `mode === 'external'`, or `ctx.externalSession`.
  Assert password and Launch Sessions resolve to the same `user:<id>` cache subject.

- [ ] **Step 2: Run tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/architecture/external-mail-frontend-boundary.test.ts tests/architecture/external-session-permissions.test.ts`

  Run:
  `pnpm --dir apps/mail exec vitest run modules/external-access/access-context.test.tsx`

  Expected: FAIL while external UI/session branches remain.

- [ ] **Step 3: Remove external UI and server branches**

  Root loads only Better Auth Session identity. `AppSidebar` always renders `NavUser` for a Session
  and always renders the normal footer. Settings requires a standard Session but never checks a
  Launch mode. Connections and Mail API procedures operate only from the standard authenticated
  subject.

- [ ] **Step 4: Run Task 4 tests and commit**

  Repeat Step 2 commands. Expected: PASS.

  Commit:

  ```bash
  git add apps/mail apps/server/src/ctx.ts apps/server/src/runtime/node/application.ts apps/server/src/trpc apps/server/src/modules/mail-api apps/server/tests/architecture
  git commit -m "refactor(auth): unify Launch and password application access"
  ```

---

### Task 5: 超管实例级邮箱范围

**Files:**

- Modify: `apps/server/src/modules/mail-accounts/postgres/connection-repository.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/modules/mail-api/application/account-service.ts`
- Modify: `apps/server/src/modules/mail-api/runtime/create-mail-api.ts`
- Modify: `apps/server/src/modules/mail-api/procedures/mail-account-procedure.ts`
- Modify: `apps/server/src/modules/mail-api/routers/account.ts`
- Modify: `apps/server/src/modules/mail-api/http/authorize-mail-account.ts`
- Test: `apps/server/tests/unit/modules/mail-api/procedures/mail-account-procedure.test.ts`
- Test: `apps/server/tests/unit/modules/mail-api/routers/resource-routers.test.ts`
- Test: `apps/server/tests/integration/mail-core/app-connection-scope.integration.test.ts`

**Interfaces:**

- Adds repository methods:
  `listAllConnectionsWithAuthorization()`,
  `findConnection(connectionId)`, and
  `findFirstConnection()`.
- Adds `openAccessibleMailApiRuntime({ actorUserId, isAdministrator, accountId }, services)`.

- [ ] **Step 1: Write failing admin-scope tests**

  Seed two ordinary users with one mailbox each and one admin. Assert:
  - each ordinary user lists/opens only its own mailbox;
  - admin lists both Connections and Mail Accounts;
  - admin can set either Connection active and open its account;
  - an ordinary user receives `NOT_FOUND` for the other account.

- [ ] **Step 2: Run admin-scope tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/mail-api/procedures/mail-account-procedure.test.ts tests/unit/modules/mail-api/routers/resource-routers.test.ts tests/integration/mail-core/app-connection-scope.integration.test.ts`

  Expected: FAIL because every authenticated subject is currently constrained to its own
  `userId`.

- [ ] **Step 3: Implement role-aware access**

  For `role = admin`, Connections list/getDefault/setDefault resolve across the instance. For
  `role = user`, retain the existing `connection.userId = sessionUser.id` predicates.

  `openAccessibleMailApiRuntime` loads the Mail Account first and enforces:

  ```ts
  if (!isAdministrator && account.userId !== actorUserId) {
    throw notFound();
  }
  ```

  HTTP blob/raw routes use the same rule. Disconnect/delete operations resolve the target
  Connection owner for admins before calling the existing lifecycle; ordinary users continue to
  pass their own ID.

- [ ] **Step 4: Run Task 5 tests and commit**

  Repeat Step 2 command. Expected: PASS.

  Commit:

  ```bash
  git add apps/server/src/modules/mail-accounts apps/server/src/modules/mail-api apps/server/src/trpc/routes/connections.ts apps/server/tests
  git commit -m "feat(mail): add administrator mailbox scope"
  ```

---

### Task 6: 全局 ID 邮件回查、数据库 DDL 与端到端回归

**Files:**

- Modify: `apps/server/src/modules/external-integration/application/read-message.ts`
- Modify: `apps/server/src/modules/external-integration/http/mail.ts`
- Modify: `apps/server/src/modules/external-integration/http/router.ts`
- Modify: `apps/server/src/modules/external-integration/postgres/repository.ts`
- Delete: `apps/server/src/modules/external-integration/principal.ts`
- Modify: `apps/server/src/modules/external-integration/errors.ts`
- Modify: `apps/server/tests/unit/modules/external-integration/application/read-message.test.ts`
- Modify: `apps/server/tests/integration/modules/external-integration/message-read.integration.test.ts`
- Modify: `apps/server/tests/integration/external-integration-flow.integration.test.ts`
- Generate: `apps/server/src/db/migrations/0003_*.sql`
- Generate: `apps/server/src/db/migrations/meta/0003_snapshot.json`
- Modify: `apps/server/src/db/migrations/meta/_journal.json`
- Modify: `docs/superpowers/specs/2026-07-30-managed-external-users-design.md`

**Interfaces:**

- Changes `ExternalMessageRepository.findMessageScope({ messageId })` to return the actual
  `mailAccountId`, `userId`, Nango connection and channel.
- Changes attachment lookup equivalently; no fixed integration-principal ownership filter.

- [ ] **Step 1: Write failing cross-user service-read tests**

  Seed messages owned by two different managed users. With the fixed integration service Token,
  each message ID must resolve its own Mail Account and return only that message's summary/content.
  Unknown IDs remain `MESSAGE_NOT_FOUND`.

- [ ] **Step 2: Run message tests and verify RED**

  Run:
  `pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/read-message.test.ts tests/integration/modules/external-integration/message-read.integration.test.ts`

  Expected: FAIL because the repository still filters on `zero-external-integration`.

- [ ] **Step 3: Implement global ID lookup behind the service Token**

  Remove `ownerUserId` from the reader and repository inputs. Resolve the real owner through
  `email -> mail.account -> connection -> authorization_binding`, require Nango authorization, and
  open blobs/content only with the resolved `mailAccountId`. Keep route authorization solely on
  `INTEGRATION_API_TOKEN`.

- [ ] **Step 4: Generate schema migration**

  Run:
  `pnpm db:generate`

  Inspect the generated DDL and require exactly these schema effects:
  - user Username/display Username columns and unique Username index;
  - `must_change_password` with default `false`;
  - Session `auth_method` with default `password`;
  - user role default changed to `user`;
  - Access Grant Scope removed and target `user_id` retained;
  - external Browser Session table dropped.

  This is schema DDL only. Do not add data copy, backfill, compatibility tables or old-session
  conversion.

- [ ] **Step 5: Rewrite the end-to-end flow test**

  The flow must:
  1. bind `{ externalUserId, channelId, connectionId }`;
  2. verify the Nango mailbox belongs to the created ordinary user;
  3. verify repeat bind is idempotent and cross-user bind conflicts;
  4. import mail and deliver the unchanged ID-only Webhook;
  5. query summary/content/attachment by ID with the service Token;
  6. create Grant using only `{ externalUserId }`;
  7. consume the code once and receive a Better Auth Session Cookie;
  8. call normal tRPC settings and mail endpoints successfully with that cookie;
  9. verify password login for the same Username sees the same mailbox set;
  10. verify another ordinary user cannot access it.

- [ ] **Step 6: Run targeted end-to-end and schema tests**

  Run:
  `pnpm --dir apps/server exec vitest run tests/integration/external-integration-flow.integration.test.ts tests/integration/modules/external-integration/access-session.integration.test.ts tests/integration/modules/external-integration/message-read.integration.test.ts tests/unit/mail-core/schema-definition.test.ts tests/unit/mail-core/schema-structure-parity.test.ts`

  Expected: PASS.

- [ ] **Step 7: Run targeted formatting, type checks, tests and builds**

  Format only changed files:

  ```bash
  pnpm exec prettier --write <changed-files>
  ```

  Verify:

  ```bash
  pnpm --filter @zero/server exec tsc --noEmit
  pnpm --filter @zero/mail exec tsc --noEmit
  pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration tests/integration/modules/external-integration tests/integration/external-integration-flow.integration.test.ts tests/architecture/external-integration-contract.test.ts tests/architecture/external-mail-frontend-boundary.test.ts tests/architecture/external-session-permissions.test.ts
  pnpm --dir apps/mail exec vitest run
  pnpm --filter @zero/server build
  pnpm --filter @zero/mail build
  git diff --check
  ```

  Expected: every command exits 0 with no test failures or type errors.

- [ ] **Step 8: Commit final integration**

  ```bash
  git add docs/superpowers/specs/2026-07-30-managed-external-users-design.md apps/server apps/mail
  git commit -m "test(integration): verify managed user mail flow"
  ```
