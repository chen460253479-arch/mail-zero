# Zero 本地邮箱 API 接口层设计

日期：2026-07-27  
状态：设计已确认

## 1. 背景

Zero 已经具备本地 Mail Core、PostgreSQL 存储、Gmail Inbox 增量同步、Provider-neutral
MailChannel、EmailSubmission、投递 Spool 和 Gmail API 发件链路。下一阶段需要用新的本地邮箱
API 替换原有直接依赖 Gmail Driver、Durable Object 和供应商数据形状的接口，并为前端切换
提供稳定边界。

现有 `mail`、`drafts` 和 `labels` tRPC Router 混合了本地邮箱、供应商同步、投递、HTML
处理、邮件验证和联系人建议等职责。前端类型中仍存在 `historyId`、`$raw`、Gmail Label
语义和供应商能力分支。新接口不得把这些旧边界包装成另一套兼容 API。

## 2. 目标

1. 对外提供唯一、统一的本地邮箱 API 模块。
2. 保留 Zero 的 tRPC 传输和端到端 TypeScript 类型推导。
3. 采用 JMAP 的资源、状态、批量写入、并发控制和错误语义。
4. API 只以本地 Mail Core 为邮件事实来源。
5. Gmail、Outlook、Zoho 和 IMAP/SMTP 等渠道实现不得进入 API DTO。
6. 为当前线程式前端提供不会产生 N+1 请求的只读投影。
7. 支持前端切换完成后一次性删除旧邮件 Router，不保留长期兼容层。

## 3. 非目标

1. 本阶段不实现完整 JMAP HTTP Wire Protocol、Session 文档或方法调用引用。
2. 本阶段不切换现有前端。
3. 本阶段不反向同步本地文件夹、标签、已读、星标等状态到 Gmail。
4. 本阶段不扩大 Gmail 同步范围，仍只同步 Inbox 增量邮件。
5. API 不直接负责供应商授权、凭据刷新或 Gmail API 调用。
6. API 不直接访问 Drizzle 表或 PostgreSQL。

## 4. 参考项目审查结论

### 4.1 Stalwart

Stalwart 是主要参考。

- `crates/jmap/src/api/request.rs` 提供统一 JMAP 请求分派入口。
- 入口统一完成权限检查、`accountId` 解析和资源访问校验。
- `Email/get`、`Mailbox/get`、`Thread/get`、`EmailSubmission/get` 等请求再分派到资源方法。
- `crates/jmap/src/email`、`mailbox`、`thread`、`submission` 分别组织各资源的
  `get/query/set` 实现。
- `crates/jmap/src/api/auth.rs` 集中处理方法级权限。
- `crates/jmap/src/api/mod.rs` 集中完成协议错误到 HTTP 响应的映射。

这证明成熟实现采用的是“统一协议门面 + 资源级方法模块 + 内部存储/服务能力”，而不是让每个
路由自行访问数据库或投递渠道。

### 4.2 EmailEngine

EmailEngine 的 `workers/api.js` 是统一 API 装配入口，再注册：

- `message-routes`
- `mailbox-routes`
- `outbox-routes`
- `submit-routes`

其 Message、Mailbox、Attachment、Submit 和 Outbox 的分离值得参考；部分 Handler 直接
调用 Worker RPC 的实现方式不作为 Zero 领域边界的模板。

### 4.3 sync-engine

sync-engine 通过 `inbox/api/srv.py` 注册统一 Blueprint，并在同一 API 下暴露 Thread、
Message、Folder、Label、Draft、File 和 Send 资源。它证明面向邮箱客户端提供线程级
接口和批量操作是合理的。

但是大量资源都集中在 `inbox/api/ns_api.py`，同时写操作会进入 Provider syncback。这两点
不适合 Zero：

- Zero 必须拆分小型资源 Router 和应用服务；
- Zero 的本地整理操作不得反向写入邮箱服务商。

### 4.4 Postal

Postal 主要用于参考发送、队列和投递状态，不作为本地 Mailbox/Email 读取 API 的依据。

## 5. 核心架构决策

### 5.1 一个统一模块对外

代码中只有 `apps/server/src/modules/mail-api/index.ts` 是公共出口。它导出：

```ts
export { mailApiRouter } from './router';
export { registerMailBlobRoutes } from './http';
```

服务器其他模块不得直接导入 `mail-api/routers`、`application` 或 `projections` 内部文件。

最终 tRPC 只挂载一个 `mail` 命名空间：

```text
trpc.mail.account.*
trpc.mail.mailbox.*
trpc.mail.email.*
trpc.mail.thread.*
trpc.mail.identity.*
trpc.mail.submission.*
trpc.mail.view.*
trpc.mail.action.*
```

资源 Router 是统一 Mail API 内部的分区，不是互相独立的系统。

### 5.2 固定依赖方向

```text
Frontend
  -> Mail API Router / Blob HTTP Adapter
    -> Mail API Application Service
      -> Mail Core public facade
      -> Mail read projection port
      -> Mail Outbound public facade
```

约束：

- Router 只负责输入校验、调用应用服务和输出 DTO。
- Application Service 负责鉴权后的账户上下文、批量编排、事务要求、幂等和结果组装。
- Mail Core 负责邮箱领域规则和状态变化。
- Projection 负责线程列表等 UI 优化读取。
- Repository 只实现 Mail Core 或 Projection 定义的 Port。
- Mail API 不导入 Gmail 插件、Nango、OAuth 凭据或 Provider SDK。
- Mail Core 不反向依赖 Mail API。

### 5.3 JMAP 语义，不伪装成完整 JMAP

采用 RFC 8620 和 RFC 8621 中已经验证的机制：

- 显式 `accountId`
- `get/query/set/changes`
- `state`、`oldState`、`newState`
- `ifInState`
- 批量 create/update/destroy
- 单项失败的 `notCreated/notUpdated/notDestroyed`
- EmailSubmission 与 Email 分离
- Blob 数据面与 JSON 控制面分离

不实现 JMAP 单请求多方法调用、Result Reference、完整 Session/Capability Wire Format。

规范：

- RFC 8620：https://www.rfc-editor.org/info/rfc8620/
- RFC 8621：https://www.rfc-editor.org/info/rfc8621/

### 5.4 标准资源与 Zero 扩展分离

标准资源接口保持 JMAP 风格：

```text
account
mailbox
email
thread
identity
submission
```

Zero 前端扩展明确放入：

```text
view       只读 UI 投影
action     线程级批量应用命令
```

扩展不得复制 Mail Core 业务规则。

## 6. 目录结构

```text
apps/server/src/modules/mail-api/
├── index.ts
├── router.ts
├── contracts/
│   ├── common.ts
│   ├── account.ts
│   ├── mailbox.ts
│   ├── email.ts
│   ├── thread.ts
│   ├── identity.ts
│   ├── submission.ts
│   ├── view.ts
│   └── action.ts
├── procedures/
│   └── mail-account-procedure.ts
├── application/
│   ├── account-service.ts
│   ├── mailbox-service.ts
│   ├── email-service.ts
│   ├── thread-service.ts
│   ├── identity-service.ts
│   ├── submission-service.ts
│   └── thread-action-service.ts
├── projections/
│   ├── port.ts
│   ├── thread-page.ts
│   ├── thread-detail.ts
│   └── postgres/
├── routers/
│   ├── account.ts
│   ├── mailbox.ts
│   ├── email.ts
│   ├── thread.ts
│   ├── identity.ts
│   ├── submission.ts
│   ├── view.ts
│   └── action.ts
├── http/
│   ├── index.ts
│   ├── upload-blob.ts
│   ├── download-blob.ts
│   └── download-raw-email.ts
└── errors/
    ├── mail-api-error.ts
    └── map-mail-core-error.ts
```

与相邻模块的边界：

```text
modules/mail          Mail Core 的 PostgreSQL、Blob 和 Search 适配器
modules/mail-api      前端/API 适配与应用编排
modules/mail-sync     Provider-neutral 入站同步
modules/mail-outbound EmailSubmission 投递和 Spool
mail-channel          渠道插件
```

## 7. 通用协议约定

### 7.1 标识与账户

- 每个邮箱请求显式携带本地 `mailAccountId`，字段名为 `accountId`。
- `connectionId` 只用于账户绑定和账户选择，不作为 Mailbox/Email 资源主键。
- 默认连接只是一项 UI 偏好，不作为服务端隐式账户上下文。
- 账户解析必须验证 `mail.account.userId === session.user.id`。
- 跨账户实体统一对客户端表现为 `NOT_FOUND`，避免实体探测。

### 7.2 DTO

- 日期统一使用 ISO 8601 UTC 字符串。
- PostgreSQL `bigint` 和大小字段统一使用十进制字符串。
- `state` 是不透明字符串，客户端不得解析或自行递增。
- Mailbox membership 和 Keyword 使用 JMAP Map 语义。
- API 不返回数据库行、Drizzle 类型或内部 Object Key。
- API 不返回 Provider messageId、Provider threadId、historyId 或 Provider Label ID。

### 7.3 分页

- 第一阶段使用签名后的不透明 Cursor。
- Cursor 绑定 `accountId`、过滤条件和排序条件。
- 修改查询条件后旧 Cursor 必须返回 `INVALID_CURSOR`。
- 默认 `limit` 为 50，最大值为 200。

### 7.4 状态

- `get` 返回资源集合的 `state`。
- `set` 返回 `oldState` 和 `newState`。
- `changes` 返回 `oldState/newState/hasMoreChanges` 以及 created/updated/destroyed。
- 第一阶段 Query 可以返回 `canCalculateChanges: false`。
- 当 Query 不能计算增量变化时，前端依据集合状态重新查询该页面。

## 8. Account API

### 8.1 `mail.account.list`

输入：`void`

输出：

```ts
{
  accounts: Array<{
    id: string;
    connectionId: string;
    status: 'active' | 'suspended' | 'deleting';
    timezone: string;
    state: string;
    storageQuotaBytes: string | null;
  }>;
}
```

### 8.2 `mail.account.get`

输入：

```ts
{
  accountId: string;
}
```

输出账户、状态及 Mail、Submission、Blob Upload 和 Snooze 能力。

## 9. Mailbox API

本地文件夹和标签统一建模为 Mailbox，使用 `kind` 区分，不再根据渠道能力在前端切换两套
数据结构。

### 9.1 `mail.mailbox.get`

输入：

```ts
{
  accountId: string;
  ids?: string[];
}
```

输出：

```ts
{
  accountId: string;
  state: string;
  list: Mailbox[];
  notFound: string[];
}
```

Mailbox DTO 包含：

```ts
{
  id: string;
  parentId: string | null;
  name: string;
  kind: 'system' | 'folder' | 'label';
  role:
    | 'inbox'
    | 'sent'
    | 'drafts'
    | 'trash'
    | 'junk'
    | 'archive'
    | 'outbox'
    | 'scheduled'
    | null;
  color: string | null;
  sortOrder: number;
  isSubscribed: boolean;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
}
```

### 9.2 `mail.mailbox.set`

输入包含 `accountId`、可选 `ifInState`、`create`、`update` 和 `destroy`。

响应包含：

```text
accountId
oldState
newState
created
updated
destroyed
notCreated
notUpdated
notDestroyed
```

系统 Mailbox 的角色和删除规则继续由 Mail Core 控制，Router 不复制规则。

### 9.3 `mail.mailbox.changes`

输入 `accountId/sinceState/maxChanges`，输出标准 Changes 结果。

## 10. Email API

### 10.1 `mail.email.get`

输入：

```ts
{
  accountId: string;
  ids: string[];
  properties?: EmailProperty[];
  fetchTextBodyValues?: boolean;
  fetchHTMLBodyValues?: boolean;
  maxBodyValueBytes?: number;
}
```

Email DTO 包含：

```text
id
threadId
blobId
mailboxIds
keywords
lifecycle
draftRevision
messageId
inReplyTo
references
sender/from/replyTo/to/cc/bcc
subject
preview
sentAt
receivedAt
size
hasAttachment
textBody
htmlBody
attachments
bodyValues
```

正文只在请求相应 Body Values 时读取，避免列表接口传输完整正文。

### 10.2 `mail.email.query`

支持：

```text
inMailbox
hasKeyword
notKeyword
after
before
from
to
address
text
hasAttachment
lifecycle
```

支持 `receivedAt/sentAt/size/subject` 排序，返回 ID、Query State、Cursor 和可选 Total。

### 10.3 `mail.email.set`

统一替代 Draft CRUD、单邮件 Mailbox 变更、已读、星标、重要和永久删除。

```ts
{
  accountId: string;
  ifInState?: string;
  create?: Record<string, DraftCreate>;
  update?: Record<string, EmailPatch>;
  destroy?: string[];
}
```

Email Patch 使用：

```ts
{
  mailboxIds?: Record<string, true | null>;
  keywords?: Record<string, true | null>;

  // 以下属性只允许 Draft 修改
  ifDraftRevision?: number;
  identityId?: string;
  replyToEmailId?: string | null;
  to?: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  attachmentBlobIds?: string[];
}
```

语义：

- 移入 Trash 是 Mailbox 更新，不是 Destroy。
- Destroy 表示永久删除。
- 已接收和已发送邮件不得修改正文。
- Draft 更新要求 `ifDraftRevision`。
- 批量 Set 允许部分成功，并返回单项错误。

### 10.4 `mail.email.changes`

用于前端更新 Email 对象缓存，不与 Gmail History 绑定。

## 11. Thread API

### 11.1 `mail.thread.get`

Thread 标准对象只包含：

```ts
{
  id: string;
  emailIds: string[];
}
```

### 11.2 `mail.thread.changes`

返回线程创建、更新和删除 ID。

不提供 `thread.set`。Thread 状态由其 Email 聚合产生，不能形成第二套可写真相。

## 12. Identity API

提供：

```text
mail.identity.get
mail.identity.set
mail.identity.changes
```

Identity 是本地发件身份。MailChannel 在投递时仍必须验证该 From 地址是否允许通过对应渠道
发送，API 不把 Provider 授权细节暴露给前端。

## 13. EmailSubmission API

提供：

```text
mail.submission.get
mail.submission.query
mail.submission.set
mail.submission.changes
```

创建输入：

```ts
{
  emailId: string;
  identityId: string;
  sendAt?: string | null;
  idempotencyKey: string;
}
```

状态：

```text
scheduled
queued
sent
failed
canceled
```

创建 Submission 只表示已接受投递请求。只有投递 Worker 收到 Gmail API 成功响应并完成
Mail Core 原子 Finalize 后，状态才是 `sent`，Draft 才迁移到 Sent。

取消只允许发生在可取消状态；API 不返回供应商原始错误或凭据错误。

## 14. 前端只读投影

### 14.1 `mail.view.threadPage`

用于替换旧 `mail.listThreads` 并消除列表逐条获取 Thread Detail 的 N+1 请求。

输入包含：

```text
accountId
mailboxId
text
hasKeyword
lifecycle
snoozed
cursor
limit
```

输出 Thread Summary：

```text
id
emailIds
emailCount
unreadCount
hasAttachment
subject
preview
participants
latestReceivedAt
mailboxIds
keywords
latestEmail
```

投影是只读模型，不允许在其中实现写入规则。

### 14.2 `mail.view.threadDetail`

一次返回 Thread 和按时间排序的 Email DTO，可按需读取正文。用于替换旧 `mail.get`。

## 15. 线程级应用命令

### 15.1 `mail.action.updateThreads`

当前 Zero UI 以 Thread 为选择单位，因此提供一个明确标记为 Zero 扩展的批量命令：

```ts
{
  accountId: string;
  threadIds: string[];
  ifInState?: string;
  addMailboxIds?: string[];
  removeMailboxIds?: string[];
  addKeywords?: string[];
  removeKeywords?: string[];
  clientMutationId: string;
}
```

服务端在事务内展开 Thread 中的全部 Email，并调用 Mail Core 批量变更能力。该命令替换
旧的 mark read/unread、star、important、archive、delete 和 modify labels 接口。

该命令不得调用 Provider API。

## 16. Blob 与附件

tRPC 用于 JSON 控制面；二进制数据使用同一 Mail API 模块导出的 HTTP Handler：

```http
POST /api/mail/accounts/{accountId}/blobs
GET  /api/mail/accounts/{accountId}/blobs/{blobId}/{filename}
GET  /api/mail/accounts/{accountId}/emails/{emailId}/raw
```

Blob 上传响应：

```ts
{
  accountId: string;
  blobId: string;
  type: string;
  size: string;
}
```

下载必须重新验证 Session 和账户所有权，并设置：

```text
Content-Type
Content-Length
Content-Disposition
X-Content-Type-Options: nosniff
```

前端不得继续把附件 Base64 编码后塞入 tRPC JSON。

## 17. 相邻职责

以下职责不进入统一 Mail API 领域资源：

```text
mailSync.triggerIncremental
mailSync.getStatus

mailContent.renderHtml
mailSecurity.verify

recipient.suggest
ai.*
```

规则：

- Mail Sync 只触发 Provider-neutral 同步任务。
- HTML Render 接收本地 `accountId/emailId/partId`，不接受客户端提交的任意 HTML。
- Recipient Suggest 只从本地地址索引或本地邮件数据读取。
- AI 功能独立使用本地 Mail API 或受控查询服务。

## 18. Snooze 扩展

Snooze 不是 RFC 8621 标准资源，作为 Zero 本地扩展：

```text
mail.action.snoozeThreads
mail.action.unsnoozeThreads
```

需要本地持久化：

```text
accountId
threadId
wakeAt
restoreMailboxIds
status
createdAt
updatedAt
```

到期 Worker 恢复本地 Mailbox membership 并记录 Email、Thread、Mailbox Changes。不得继续
把 Snooze 存在 KV 或 Gmail Label 中。

## 19. 错误规范

顶层错误使用稳定机器码：

```text
ACCOUNT_NOT_FOUND
ACCOUNT_NOT_ACTIVE
STATE_MISMATCH
REVISION_MISMATCH
INVALID_ARGUMENTS
INVALID_CURSOR
NOT_FOUND
FORBIDDEN
OVER_QUOTA
REQUEST_TOO_LARGE
MAILBOX_HAS_CHILD
MAILBOX_HAS_EMAIL
SUBMISSION_NOT_CANCELABLE
STORAGE_FAILURE
```

公共错误数据：

```ts
{
  code: string;
  retryable: boolean;
  requestId: string;
}
```

批量单项错误放入 `notCreated/notUpdated/notDestroyed`，不得因为一个实体失败而伪造整个
请求失败。日志可记录内部错误链，客户端响应不得包含 Provider Token、SQL、Object Key
或原始 Gmail 响应。

## 20. 安全与限制

1. 所有资源操作先验证 Session 和账户所有权。
2. Account、Entity 和 Blob 授权必须在服务端执行，不能信任前端缓存。
3. Blob 响应禁止 MIME Sniffing，文件名必须安全编码。
4. Body Values、批量 ID、上传大小和 Query Limit 必须有硬上限。
5. API 限流键使用 `userId + accountId + procedure`。
6. 跨账户引用不泄露目标实体是否存在。
7. Provider 凭据和授权错误只由 MailChannel/Integration 边界处理。

## 21. Mail Core 前置补全

在 API 宣布完成前，Mail Core 必须补齐：

1. Account 和 Identity 的公共读取能力。
2. Submission 的 get/query。
3. Blob 上传、校验和注册。
4. Email Body/Attachment 的公共投影能力。
5. 事务化批量 Set。
6. 同一事务内的 `ifInState` 检查。
7. Mailbox `color/sortOrder/isSubscribed` 更新。
8. 支持本地搜索的 Thread Page Projection。
9. Snooze 本地模型和到期恢复任务。
10. API 可用的不透明 State 和 Query State。

Router 不得通过直接查询表来绕过这些缺口。

## 22. 测试策略

### 22.1 Contract 测试

- 所有输入和输出 Zod Schema。
- DTO 不包含 Provider 和存储内部字段。
- Date、BigInt、State 和 Cursor 序列化稳定。
- 批量部分失败响应符合规范。

### 22.2 Application 测试

- Account ownership。
- `ifInState` 和 Draft Revision 冲突。
- Mailbox、Keyword 和 Draft 规则。
- Thread 批量命令。
- Submission 幂等和取消。
- Core Error 到 API Error 映射。

### 22.3 PostgreSQL 集成测试

- Projection 查询、排序、Cursor 和账户隔离。
- Mailbox 计数与 Thread Summary。
- 批量事务和 Changes。
- Blob 元数据和对象存储一致性。

### 22.4 HTTP 安全测试

- 未登录、跨账户和不存在 Blob。
- 上传大小、Content Type 和完整性。
- Content-Disposition 和 `nosniff`。
- Raw Email 下载权限。

### 22.5 切换验收

- 前端不再导入旧 Driver 类型。
- 前端不再依赖 `historyId`、`$raw` 和 Gmail Label。
- 邮件页面不再通过 Durable Object 获取邮箱状态。
- 前端邮件操作不会调用 Provider API。
- 旧 `mail/drafts/labels` Router 完全删除。

## 23. 迁移与发布

1. 在 `modules/mail-api` 内实现并通过独立 Router Caller 测试，暂不挂载到主 App Router。
2. 补齐 Mail Core 前置能力。
3. 完成标准资源、Projection、Action 和 Blob API。
4. 完成后端契约、应用、PostgreSQL 和 HTTP 测试。
5. 前端切换时，将 App Router 的 `mail` 挂载从旧 Router 一次性替换为
   `mailApiRouter`。
6. 同一阶段删除旧 `draftsRouter`、`labelsRouter` 和前端旧调用。
7. 删除旧 Driver、Durable Object 邮件状态和 Gmail 数据形状。
8. 不提供 `mailV2`，不保留长期兼容层，不进行双写。

## 24. 完成标准

满足以下全部条件才可认定本地邮箱 API 完成：

1. 统一模块是邮件 API 的唯一公共出口。
2. 所有邮件资源显式使用本地 `accountId`。
3. Mailbox、Email、Thread、Identity、Submission 和 Blob 链路完整。
4. 前端所需 Thread Page 和 Thread Detail 无 N+1 查询。
5. 所有本地整理动作仅修改本地模型。
6. 发送通过 EmailSubmission 和 Outbound 公共边界完成。
7. Provider 信息不进入公共 DTO。
8. 批量、状态、并发、账户隔离和错误测试通过。
9. 前端切换后旧邮件 Router 和旧类型可以完整删除。
