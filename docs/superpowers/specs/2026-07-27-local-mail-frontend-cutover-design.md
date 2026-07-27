# Zero 本地邮箱前端切换设计

日期：2026-07-27  
状态：设计已确认

## 1. 背景

Zero 已具备本地 Mail Core、PostgreSQL 邮件存储、Gmail Inbox 增量同步、
Provider-neutral MailChannel、EmailSubmission、投递 Spool、Gmail 发件链路和统一
Mail API。现有前端仍直接依赖旧 `mail`、`drafts`、`labels` tRPC Router，并把 Gmail
Label、Driver DTO、Durable Object 状态和本地界面状态混合在同一组 Hook 中。

本阶段保留现有视觉界面和主要交互，重建前端邮箱领域层，并将标准邮箱主链路完整切换到
本地 Mail API。辅助能力按领域边界迁移，最终删除旧邮件 Router，不保留长期双轨。

## 2. 目标

1. 本地 Mail Core 成为前端邮件数据的唯一事实来源。
2. 页面和视觉组件只依赖稳定的前端邮箱 View Model，不直接依赖 tRPC DTO。
3. 所有邮件查询、缓存和写操作显式绑定本地 `accountId`。
4. 使用本地 Mailbox、Thread、Email、Identity、EmailSubmission 语义替换 Gmail Label
   和旧 Driver 语义。
5. 列表采用 Thread Summary，详情按需读取正文，避免 N+1 和无界正文传输。
6. 使用 JMAP 风格的 `state`、`ifInState` 和 `changes` 完成并发控制与缓存收敛。
7. 附件使用 Blob HTTP 接口，不再把 Base64 放入 tRPC JSON 或 localStorage。
8. 发送界面真实展示 `scheduled/queued/sent/failed/canceled` 生命周期。
9. 最终只挂载一个正式 `mail` Router，并删除旧 `drafts`、`labels` Router。

## 3. 非目标

1. 本阶段不重做邮件产品的视觉设计。
2. 本阶段不扩展 Gmail 同步范围，仍只处理已约定的 Inbox 增量同步。
3. 本阶段不把本地已读、星标、文件夹或标签反向同步给 Gmail。
4. 本阶段不实现完整 JMAP HTTP Wire Protocol。
5. 本阶段不让前端感知 Gmail、Nango、Outlook 或其他渠道实现细节。
6. 本阶段不长期维护旧 DTO 到新 DTO 的后端兼容层。

## 4. 参考项目采用的机制

### 4.1 Stalwart

- 使用 `Query -> Get -> Changes` 分离集合检索、实体读取和增量收敛。
- 使用不透明 `state` 和 `ifInState` 控制并发写入。
- Email 与 EmailSubmission 分离，提交成功不等于渠道已经投递成功。
- Mailbox 使用角色和 ID 表达，不在客户端暴露供应商标签。

### 4.2 sync-engine

- Thread 是前端列表和操作的一级聚合对象。
- Thread Summary 排除 Draft 对普通收件摘要的污染，并聚合参与者、未读和时间。
- Message/Thread 的本地模型独立于供应商数据形状。

### 4.3 EmailEngine

- 每个资源请求显式绑定账户。
- 列表使用游标分页。
- 渠道差异隐藏在账户/渠道适配层之后，不进入通用邮件 UI。

### 4.4 Postal

- 发送呈现排队、处理中、成功和失败的生命周期。
- UI 不在 API 接受请求时提前显示“已发送”。

## 5. 总体架构

```text
Route / Visual Component
  -> Mail Feature Hook
    -> Frontend Mail Domain Model
      -> DTO Adapter
        -> Unified Mail API / Blob HTTP
          -> Local Mail Core
            -> MailChannel Plugin
```

固定依赖方向：

- 页面只负责路由、布局和组合。
- 视觉组件接收 View Model 和命令回调。
- Query/Mutation Hook 负责 TanStack Query 编排。
- Adapter 是唯一允许理解 Mail API DTO 的前端层。
- Gmail、Nango 和供应商 ID 不得出现在 `apps/mail/modules/mail`。

## 6. 目录结构

```text
apps/mail/modules/mail/
├── api/
│   ├── blobs.ts
│   └── query-keys.ts
├── model/
│   ├── account.ts
│   ├── mailbox.ts
│   ├── thread.ts
│   ├── email.ts
│   ├── draft.ts
│   └── submission.ts
├── adapters/
│   ├── account-adapter.ts
│   ├── mailbox-adapter.ts
│   ├── thread-adapter.ts
│   ├── email-adapter.ts
│   └── submission-adapter.ts
├── routing/
│   └── mailbox-route.ts
├── queries/
│   ├── use-mail-account.ts
│   ├── use-mailboxes.ts
│   ├── use-thread-page.ts
│   ├── use-thread-detail.ts
│   └── use-mail-changes.ts
├── mutations/
│   ├── use-thread-actions.ts
│   ├── use-draft-actions.ts
│   └── use-submission-actions.ts
├── providers/
│   └── mail-account-provider.tsx
└── index.ts
```

现有 `apps/mail/components/mail` 保留为视觉组件目录。旧 `hooks` 中的邮件数据 Hook 在调用方
全部迁移后删除，不在新目录中复制旧职责。

## 7. 账户与缓存隔离

- `mail.account.list` 返回当前用户可访问的本地邮件账户。
- 当前连接只用于选择账户：通过 `account.connectionId` 解析本地 `accountId`。
- `MailAccountProvider` 向邮件页面提供当前账户、加载状态和缺失账户状态。
- 每个 Query Key 的第一维必须包含 `accountId`。
- QueryClient 和 IndexedDB 持久化边界绑定已认证的本地 `userId`，持久化键使用
  `zero-query-cache-{userId}`；未取得用户身份前不恢复持久缓存。
- 同一用户可以在一个 QueryClient 中缓存多个账户，但所有 Mail Query Key 都必须带
  `accountId`；切换账户不复用另一个账户的 Query Data。
- 退出登录、会话失效或用户身份变化时销毁当前 QueryClient 并清理对应持久缓存。
- `connectionId` 不再参与全局 Query Key Hash；它只用于账户绑定和当前账户选择。
- `state` 作为不透明字符串存储，不解析、不递增、不跨账户复用。

## 8. Mailbox 与路由

标准路由只映射到本地 Mailbox role：

```text
inbox     -> inbox
draft     -> drafts
sent      -> sent
spam      -> junk
bin       -> trash
archive   -> archive
snoozed   -> view.threadPage({ snoozed: true })
```

其他路由参数按 Mailbox ID 解析本地 `folder` 或 `label`。前端不再使用
`CATEGORY_*`、`INBOX`、`TRASH` 等 Gmail Label 常量。不存在的路由显示明确的空状态或
404，不回退到供应商文件夹。

## 9. 读取链路

### 9.1 Thread Page

- 页面调用 `mail.view.threadPage`。
- 游标由 TanStack Infinite Query 管理。
- 列表仅消费 Thread Summary，不读取正文。
- 搜索、Mailbox、Keyword、Lifecycle 和 Snooze 都进入规范化 Query Key。
- 过滤条件改变时从第一页重新查询，不复用旧 Cursor。

### 9.2 Thread Detail

- 打开线程时调用 `mail.view.threadDetail`。
- 仅详情查询启用 `fetchTextBodyValues/fetchHTMLBodyValues`。
- Adapter 把 Email DTO 转换为现有视觉组件需要的 Message View Model。
- 附件链接由本地 Blob URL 生成。

### 9.3 Changes

- 前台活动账户按可见性和窗口焦点进行温和轮询。
- 使用 Mailbox、Email、Thread、Submission 各自的 `changes`。
- 当 `hasMoreChanges` 为真时继续排空，不丢弃中间状态。
- Created/Updated 触发相应实体或可见页面刷新；Destroyed 从实体缓存移除。
- `sinceState` 无效或无法计算 Query Changes 时，失效对应账户的列表缓存并重新查询。

## 10. 写操作与乐观更新

- Thread 批量操作统一调用 `mail.action.updateThreads`。
- 已读、未读、星标、重要、归档、移入 Trash、移动和标签操作都转换为本地 Mailbox ID
  与 Keyword 变更。
- 每次写入携带当前 `ifInState` 和唯一 `clientMutationId`。
- 乐观更新只修改当前账户相关缓存，并保存精确回滚快照。
- 服务端允许部分成功；客户端只回滚失败 ID，成功项通过 `newState` 和 Changes 收敛。
- State mismatch 不静默覆盖，先刷新集合状态，再提示用户重试。
- Jotai 只保存选择、弹窗、编辑器等临时界面状态，不再维护第二份邮件服务器状态队列。

## 11. 草稿、附件与发送

1. 选择附件后直接上传 Blob HTTP，获得 `blobId`。
2. 使用 `mail.email.set` 创建或更新 Draft。
3. Draft 更新携带 `ifDraftRevision`，冲突时保留用户编辑内容并提示重新合并。
4. Reply 使用 `replyToEmailId`，不由前端手工维护供应商 Thread ID。
5. 点击发送时先确保 Draft 已保存，再用 `mail.submission.set` 创建 Submission。
6. 普通“撤销发送”通过创建未来 `sendAt` 的 scheduled Submission 实现。
7. 撤销窗口内取消 Submission；不把完整邮件和 Base64 附件写入 localStorage。
8. UI 根据 Submission 状态展示已计划、已排队、已发送、失败或已取消。
9. 只有 Worker 完成 Gmail API 接受和本地原子 Finalize 后，UI 才显示 sent。

## 12. 辅助能力边界

- `recipient.suggest`：从本地地址索引或本地邮件参与者生成，不进入 Mail 资源 Router。
- `mailSync.triggerIncremental/getStatus`：调用 Provider-neutral 同步编排，不进入 Mail Core。
- `mailContent.renderHtml`：只处理本地 Email/Part，不接受任意供应商正文。
- `mailSecurity.verify`：保留在独立安全模块。
- `ai.*`：消费本地 Thread/Email View Model，不直接调用旧 Mail Router。
- ElevenLabs 等工具复用新的前端 Mail Command Facade，不直接调用 tRPC 原始过程。

辅助能力可以在标准主链路之后迁移，但不得成为保留旧邮件数据链路的理由。

## 13. 原子切换

迁移分步骤开发，但正式运行切换在同一阶段完成：

1. 所有前端邮件调用已迁移到新领域层。
2. `appRouter.mail` 改为 `mailApiRouter`。
3. 删除顶层 `drafts` 和 `labels` Router。
4. 删除旧 Mail Router、旧 Driver DTO、旧 Draft/Label 调用和旧 DO 邮件状态。
5. 删除不再使用的 KV 绑定和 Gmail Label 前端常量。
6. 运行类型检查、单元测试、后端 Mail API 测试和端到端邮箱主链路测试。

不新增永久 `mailV2`、`localMail` 或旧接口代理。

## 14. 错误与空状态

- 账户未建立本地 Mail Account：显示连接初始化状态，不请求邮件列表。
- Mailbox 不存在：显示路由无效，不猜测其他文件夹。
- State mismatch：刷新并保留用户意图，允许重试。
- Draft revision conflict：保留编辑器本地内容，禁止静默覆盖。
- Submission failed：显示稳定错误码，Draft 保持可编辑。
- Blob 上传失败：附件保持本地失败状态，禁止提交引用缺失 Blob 的 Draft。
- 部分批量失败：成功项保留，失败项恢复并逐项提示。

## 15. 验收标准

- 标准邮箱页面不再引用旧 `mail.listThreads/mail.get`。
- 不再存在前端 `trpc.drafts`、`trpc.labels` 调用。
- Gmail Label 和 Provider ID 不进入新前端邮箱模块。
- 两个账户的缓存、Mailbox、Thread 和 Draft 不会互相污染。
- Inbox、Drafts、Sent、Trash、Archive、Junk、Snoozed 和自定义 Mailbox 路由正确。
- Thread 列表无正文 N+1，详情按需读取正文。
- 已读、星标、重要、移动、标签、Trash、Snooze 支持乐观更新和失败回滚。
- Draft 自动保存使用 revision；附件使用 Blob。
- 发送状态不会把 queued 提前显示为 sent，撤销发送取消 scheduled Submission。
- 新 Router 是唯一正式邮件 API；旧邮件 Router 和状态实现已删除。
