# Zero 本地邮箱前端切换实施计划

> **执行要求：** 每个生产行为遵循 RED -> GREEN -> REFACTOR；文档和纯配置除外。不要创建
> Git worktree。开发期间可以保留未接线的新模块，但最终切换不得保留两套运行时邮件链路。

**目标：** 保留现有 Zero 邮件界面，将标准邮箱主链路切换为本地 Mail API，并删除旧
`mail/drafts/labels` 链路。

**架构：** 在 `apps/mail/modules/mail` 建立账户隔离的前端邮箱领域层。TanStack Query
管理服务端状态，Jotai 只管理临时 UI 状态。页面通过 View Model 和 Command Hook 消费统一
Mail API；最终把后端 `appRouter.mail` 原子切换为 `mailApiRouter`。

---

## Task 1：建立前端邮箱领域模型、缓存键和路由解析

**文件：**

- Create: `apps/mail/modules/mail/model/*.ts`
- Create: `apps/mail/modules/mail/api/query-keys.ts`
- Create: `apps/mail/modules/mail/routing/mailbox-route.ts`
- Create: `apps/mail/modules/mail/index.ts`
- Test: `apps/mail/modules/mail/model/model.test.ts`
- Test: `apps/mail/modules/mail/api/query-keys.test.ts`
- Test: `apps/mail/modules/mail/routing/mailbox-route.test.ts`
- Modify: `apps/mail/package.json`

**RED：**

- 不同 `accountId` 产生不同 Query Key。
- 相同过滤条件规范化为相同 Key，不同 Mailbox/Cursor 不复用。
- 标准 slug 映射到本地 role，`snoozed` 映射为本地视图过滤。
- 自定义 ID 不被解释成 Gmail Label。

**GREEN：**

- 定义 Provider-neutral View Model。
- 实现 Query Key factory 和纯函数路由解析。
- 为 `@zero/mail` 增加可独立运行的 Vitest 脚本。

**验证：**

```bash
pnpm --dir apps/mail test --run modules/mail
pnpm --dir apps/mail exec tsc --noEmit
```

---

## Task 2：实现 DTO Adapter 与账户上下文

**文件：**

- Create: `apps/mail/modules/mail/adapters/*.ts`
- Create: `apps/mail/modules/mail/providers/mail-account-provider.tsx`
- Create: `apps/mail/modules/mail/queries/use-mail-account.ts`
- Test: `apps/mail/modules/mail/adapters/adapters.test.ts`
- Test: `apps/mail/modules/mail/providers/mail-account-provider.test.tsx`
- Modify: `apps/mail/providers/query-provider.tsx`
- Modify: `apps/mail/app/root.tsx`

**RED：**

- Connection 只解析所属本地账户，不作为资源主键。
- Mailbox、Thread Summary、Thread Detail、Email 和 Submission DTO 转换为稳定 View Model。
- QueryClient 和 IndexedDB key 按已认证 `userId` 隔离，Mail Query Key 再按 `accountId`
  隔离。
- 用户身份变化时不得恢复上一个用户的持久缓存。
- 无本地账户时不发起 Thread 请求。

**GREEN：**

- 建立 Mail Account Provider。
- 将 Query Provider 的缓存隔离从 nullable connection 改为已认证用户，并移除全局
  `connectionId` hash。
- Adapter 不输出 Provider ID 或 Gmail Label。

**验证：**

```bash
pnpm --dir apps/mail test --run modules/mail
pnpm --dir apps/mail exec tsc --noEmit
```

---

## Task 3：迁移 Mailbox、Thread 列表和详情只读链路

**文件：**

- Create: `apps/mail/modules/mail/queries/use-mailboxes.ts`
- Create: `apps/mail/modules/mail/queries/use-thread-page.ts`
- Create: `apps/mail/modules/mail/queries/use-thread-detail.ts`
- Modify: `apps/mail/hooks/use-labels.ts`
- Modify: `apps/mail/hooks/use-threads.ts`
- Modify: `apps/mail/app/(routes)/mail/[folder]/page.tsx`
- Modify: `apps/mail/components/mail/mail-list.tsx`
- Modify: `apps/mail/components/mail/mail-display.tsx`
- Modify: `apps/mail/components/mail/thread-display.tsx`
- Test: `apps/mail/modules/mail/queries/thread-query-options.test.ts`

**RED：**

- 列表请求只使用 Thread Page Summary。
- 详情打开前不请求正文，打开后按需请求 Body Values。
- Folder route 被解析为本地 mailboxId/role。
- Infinite Query 使用服务端 opaque cursor。

**GREEN：**

- 新 Query Hook 返回现有视觉组件所需 View Model。
- 删除列表读取旧 Driver Thread DTO 的路径。
- 附件地址改为本地 Blob URL。

**验证：**

```bash
pnpm --dir apps/mail test --run modules/mail
pnpm --dir apps/mail exec tsc --noEmit
```

---

## Task 4：实现 Changes 收敛与线程操作

**文件：**

- Create: `apps/mail/modules/mail/queries/use-mail-changes.ts`
- Create: `apps/mail/modules/mail/mutations/use-thread-actions.ts`
- Modify: `apps/mail/hooks/use-optimistic-actions.ts`
- Modify: `apps/mail/components/context/thread-context.tsx`
- Modify: `apps/mail/lib/thread-actions.ts`
- Test: `apps/mail/modules/mail/queries/changes-reconciler.test.ts`
- Test: `apps/mail/modules/mail/mutations/thread-optimistic-update.test.ts`

**RED：**

- `hasMoreChanges` 被排空。
- invalid state 只失效当前账户相关缓存。
- 批量部分失败只回滚失败 Thread。
- State mismatch 刷新状态并保留可重试命令。
- 归档、Trash、移动和标签使用 Mailbox ID，不使用 Gmail 常量。

**GREEN：**

- 建立 Changes reconciler。
- 使用 `mail.action.updateThreads/snoozeThreads/unsnoozeThreads`。
- 移除 Jotai 中作为第二服务端状态的 background queue。

**验证：**

```bash
pnpm --dir apps/mail test --run modules/mail
pnpm --dir apps/mail exec tsc --noEmit
```

---

## Task 5：迁移 Draft、Blob、Identity 和 EmailSubmission

**文件：**

- Create: `apps/mail/modules/mail/api/blobs.ts`
- Create: `apps/mail/modules/mail/mutations/use-draft-actions.ts`
- Create: `apps/mail/modules/mail/mutations/use-submission-actions.ts`
- Modify: `apps/mail/components/create/email-composer.tsx`
- Modify: `apps/mail/components/create/create-email.tsx`
- Modify: `apps/mail/components/mail/reply-composer.tsx`
- Modify: `apps/mail/hooks/use-drafts.ts`
- Modify: `apps/mail/hooks/use-email-aliases.ts`
- Modify: `apps/mail/hooks/use-undo-send.ts`
- Test: `apps/mail/modules/mail/api/blobs.test.ts`
- Test: `apps/mail/modules/mail/mutations/draft-input.test.ts`
- Test: `apps/mail/modules/mail/mutations/submission-state.test.ts`

**RED：**

- 附件先上传 Blob，Draft 只保存 blobId。
- Draft 更新携带 `ifDraftRevision`。
- Reply 只提交 `replyToEmailId`。
- 普通发送创建 scheduled Submission，撤销取消 Submission。
- queued 不显示成 sent，failed 保留 Draft。

**GREEN：**

- 使用 Identity API 替换旧 alias API。
- 使用 Email Set 替换旧 Draft Router。
- 使用 Submission Set 替换旧 send/unsend。
- 删除 Base64/localStorage 撤销发送数据。

**验证：**

```bash
pnpm --dir apps/mail test --run modules/mail
pnpm --dir apps/mail exec tsc --noEmit
```

---

## Task 6：迁移设置页、AI 和客户端命令入口

**文件：**

- Modify: `apps/mail/app/(routes)/settings/labels/page.tsx`
- Modify: `apps/mail/components/context/label-sidebar-context.tsx`
- Modify: `apps/mail/components/ui/nav-main.tsx`
- Modify: `apps/mail/components/ui/nav-user.tsx`
- Modify: `apps/mail/components/ui/ai-sidebar.tsx`
- Modify: `apps/mail/lib/elevenlabs-tools.ts`
- Modify: `apps/mail/lib/email-utils.client.tsx`
- Create or modify provider-neutral auxiliary Router only where required.

**RED：**

- 设置页通过 Mailbox Set 管理本地 label/folder。
- AI 和语音命令通过本地 View Model/Command Facade 读取或操作邮件。
- 手动同步进入独立 Mail Sync 命名空间。
- Recipient Suggest 和 Verify 不保留对旧 Mail Router 的依赖。

**GREEN：**

- 迁移全部剩余调用方。
- 辅助能力按 `mailSync/recipient/mailSecurity/ai` 边界接线。

**验证：**

```bash
git grep -n "trpc\\.drafts\\|trpc\\.labels\\|mail\\.listThreads\\|mail\\.get" -- apps/mail
pnpm --dir apps/mail exec tsc --noEmit
```

预期：不存在旧邮件资源调用。

---

## Task 7：后端 Router 原子切换并删除旧邮件实现

**文件：**

- Modify: `apps/server/src/trpc/index.ts`
- Delete: `apps/server/src/trpc/routes/mail.ts`
- Delete: `apps/server/src/trpc/routes/drafts.ts`
- Delete: `apps/server/src/trpc/routes/label.ts`
- Delete only after import audit: legacy Driver DTO、旧 DO 邮件状态和不再使用的 KV 代码。
- Modify: architecture tests.

**RED：**

- App Router 只暴露新嵌套 `mail` Router。
- 不存在顶层 `drafts/labels`。
- 旧 Router 和 Provider DTO 不得被任何生产代码导入。

**GREEN：**

- `mail: mailApiRouter` 成为唯一正式入口。
- 删除旧入口和无引用实现。
- 不新增 `mailV2/localMail/legacyMail`。

**验证：**

```bash
pnpm --dir apps/server exec vitest run src/modules/mail-api src/mail-architecture.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

---

## Task 8：端到端验收与遗漏修复

**文件：**

- Modify: `packages/testing/e2e/mail-inbox.spec.ts`
- Modify: `packages/testing/e2e/mail-actions.spec.ts`
- Add: Draft/Blob/Submission E2E where the local test environment permits.
- Create: `docs/superpowers/plans/2026-07-27-local-mail-frontend-cutover-acceptance.md`

**验收场景：**

- 多账户缓存隔离。
- 标准 Mailbox 和自定义 Mailbox 路由。
- Inbox Thread Page、详情正文和附件。
- 已读、星标、重要、归档、Trash、标签和 Snooze。
- Draft 自动保存、revision 冲突和 Blob。
- scheduled、cancel、queued、sent、failed。
- 页面、AI 和命令入口不再调用旧邮件 Router。

**完整验证：**

```bash
pnpm --dir apps/mail test --run
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail lint
pnpm --dir apps/mail build
pnpm --dir apps/server test:mail-core
pnpm --dir apps/server exec vitest run src/modules/mail-api src/modules/mail-outbound
pnpm test:ui
git diff --check
git status --short
```

若仓库级历史基线仍有无关错误，验收记录必须给出原始输出，并证明改动文件没有新增错误。
