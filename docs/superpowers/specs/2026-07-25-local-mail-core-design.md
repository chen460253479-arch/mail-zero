# Zero 本地邮箱内核设计

日期：2026-07-25  
分支：`codex/local-mail-core`

## 1. 结论

Zero 第一阶段只实现“后端本地邮箱内核 + 自动化测试”。

本阶段建立与邮件服务商无关的本地权威邮箱数据层。Gmail、Outlook、Zoho 和
IMAP/SMTP 以后只通过 Provider 插件提供邮件导入和发件能力，不能拥有或修改
Zero 的本地邮箱业务状态。

本地邮箱内核采用：

```text
JMAP-compatible canonical model
+ PostgreSQL normalized storage
+ RFC 5322/MIME immutable blobs
+ TypeScript domain core
```

JMAP RFC 8620/8621 是规范依据；Stalwart 是主要行为和模块参考。Nylas Sync
Engine、Postal 和 EmailEngine 只补充各自擅长的关系模型、发件事务与 Provider
边界。

## 2. 已确认的产品边界

### 2.1 本地权威

下列状态只由 Zero 管理：

- Email、Mailbox、Thread；
- 已读、星标、重要、已回复、已转发等 Keyword；
- 系统邮箱、自定义文件夹和标签；
- 草稿；
- 回收站、恢复和永久删除；
- EmailSubmission、定时发送、撤销发送和投递尝试；
- 搜索、统计、Change Log 和本地状态版本。

这些状态不反向同步到绑定的 Gmail 等邮件服务商。

### 2.2 服务商职责

服务商只负责：

- 提供新邮件和历史邮件；
- 提供 Raw MIME、正文和附件下载；
- 执行发件；
- 返回服务商消息 ID、错误和发送回执。

服务商侧的已读、标签、归档和删除等变化不覆盖 Zero 本地状态。服务商删除一封
已经导入的邮件时，Zero 默认保留本地副本。

### 2.3 第一阶段范围

第一阶段包含：

- `packages/mail-core` 纯 TypeScript 邮箱内核；
- PostgreSQL Drizzle schema 和 repository；
- Blob Store 接口及内存测试实现；
- JMAP 语义的 Email、Mailbox、Thread、Keyword、Blob、EmailSubmission 和
  Changes；
- 本地导入、查询和修改服务；
- 单元测试和 PostgreSQL 集成测试。

第一阶段不包含：

- Gmail API、History API 或 Push Notification；
- 任何 Provider 插件；
- Outlook、Zoho、IMAP/SMTP；
- 前端切换；
- 现有 Durable Object/R2 邮件数据迁移；
- 真实邮件发送；
- JMAP HTTP 协议服务器；
- SMTP、IMAP、POP3、MX、DKIM、SPF 或反垃圾系统。

## 3. 参考项目与使用边界

### 3.1 Stalwart

Stalwart 是主要参考：

- `crates/types`：Email、Mailbox、Thread、Keyword、Blob 等词汇；
- `crates/email`：导入、线程、Mailbox、Message、Submission 行为；
- `crates/store`：核心与物理存储分离；
- `crates/jmap`：get/query/set/changes 的语义。

Zero 不复制 Stalwart 的 Rust、二进制序列化、自定义 Store、协议服务器或完整邮件
服务器能力。

Stalwart 使用 AGPL-3.0/SELv2 双许可证。Zero 只参照公开标准、模块边界和外部可
观察行为，TypeScript 代码和测试必须独立编写，禁止逐行翻译或复制 Stalwart
实现。

### 3.2 Nylas Sync Engine

用于参考：

- 关系型 Message、Thread、Category、Block、Part；
- Provider ID 与本地 ID 分离；
- Raw 内容哈希和 Block Store；
- Draft 复用 Message；
- Transaction insert/update/delete 日志。

不沿用其 Python 2 实现、Provider 专用字段混入 Message、JSON 地址字段和过时的
同步框架。

### 3.3 Postal

只用于参考：

- 持久化发送队列；
- 锁和重试时间；
- Submission Attempt 历史；
- 错误分类和有限退避。

不引入其 SMTP/MX 投递、短期消息日志或事务邮件服务器模型。

### 3.4 EmailEngine

只用于第二阶段 Provider 插件参考：

- Provider Client 边界；
- 账号运行状态；
- 重连、限流和错误标准化；
- Worker 与协议客户端分离。

第一阶段不依赖 EmailEngine。

## 4. 总体架构

```text
apps/server
├── PostgreSQL adapter
├── Blob Store adapter
├── Search adapter
└── Runtime composition
          |
          v
packages/mail-core
├── JMAP-compatible types
├── Email/Mailbox/Thread behavior
├── Draft and Submission behavior
├── Change Log
└── Store ports
```

依赖只能指向内层：

```text
apps/server -> packages/mail-core
packages/mail-core -X-> apps/server
packages/mail-core -X-> Gmail/Cloudflare/tRPC/Drizzle
```

## 5. 目录结构

```text
packages/mail-core/
├── package.json
├── tsconfig.json
├── src/
│   ├── types/
│   │   ├── ids.ts
│   │   ├── address.ts
│   │   ├── keyword.ts
│   │   ├── special-use.ts
│   │   ├── errors.ts
│   │   └── index.ts
│   ├── account/
│   ├── mailbox/
│   ├── message/
│   │   ├── ingest.ts
│   │   ├── mime.ts
│   │   ├── metadata.ts
│   │   ├── commands.ts
│   │   └── queries.ts
│   ├── thread/
│   │   ├── calculate-thread.ts
│   │   ├── normalize-subject.ts
│   │   └── queries.ts
│   ├── submission/
│   │   ├── outbox.ts
│   │   ├── delivery-status.ts
│   │   └── retry-policy.ts
│   ├── changes/
│   │   ├── change-log.ts
│   │   └── state-token.ts
│   ├── search/
│   ├── store/
│   │   ├── mail-store.ts
│   │   ├── blob-store.ts
│   │   ├── search-store.ts
│   │   └── unit-of-work.ts
│   └── index.ts
└── tests/
    ├── message/
    ├── thread/
    ├── mailbox/
    ├── submission/
    └── changes/

apps/server/src/modules/mail/
├── postgres/
│   ├── schema/
│   │   ├── accounts.ts
│   │   ├── mailboxes.ts
│   │   ├── emails.ts
│   │   ├── threads.ts
│   │   ├── blobs.ts
│   │   ├── submissions.ts
│   │   ├── changes.ts
│   │   └── index.ts
│   ├── repositories/
│   └── postgres-unit-of-work.ts
├── blob/
│   ├── r2-blob-store.ts
│   └── memory-blob-store.ts
├── search/
│   └── postgres-search-store.ts
├── runtime/
│   └── create-mail-core.ts
└── index.ts

apps/server/tests/mail-core/
├── schema.integration.test.ts
├── repositories.integration.test.ts
├── import-email.integration.test.ts
├── mailbox-operations.integration.test.ts
├── drafts.integration.test.ts
├── submissions.integration.test.ts
└── changes.integration.test.ts
```

目录禁止使用承载大量无关行为的 `mail-service.ts`、`helpers.ts` 或通用
`utils.ts`。共享代码只有在两个明确调用者出现后才能提取。

## 6. JMAP 兼容模型

JMAP 是领域语义和 API 契约，不是数据库物理格式。Zero 不把整封 JMAP JSON 作为
单一文档存储。

| JMAP 对象       | Zero 实体                                               |
| --------------- | ------------------------------------------------------- |
| Account         | `mail_account`                                          |
| Mailbox         | `mailbox`, `email_mailbox`                              |
| Email           | `email`, `email_address`, `email_content`, `email_part` |
| Thread          | `thread`                                                |
| Blob            | `blob`                                                  |
| Identity        | `mail_identity`                                         |
| EmailSubmission | `email_submission`, `submission_attempt`                |
| Keywords        | `email_keyword`                                         |
| Changes         | `mail_change`                                           |

`SearchSnippet` 是查询结果或短期缓存，不是权威实体。PushSubscription 属于后续
Provider/JMAP API 阶段。

## 7. 数据模型

所有表继续使用 Zero 的 `mail0_` 前缀。

### 7.1 `mail_account`

用途：本地邮箱根实体。

关键字段：

- `id`：本地 ULID；
- `connection_id`：唯一关联现有 `connection.id`；
- `user_id`；
- `status`：`active | suspended | deleting`；
- `state_version`：单调递增的 bigint；
- `timezone`；
- `storage_quota_bytes`；
- `created_at`, `updated_at`。

约束：

- 一个 Connection 最多对应一个 MailAccount；
- 一个 MailAccount 只能属于一个 Zero User；
- Provider 凭据不得进入本表。

### 7.2 `mailbox`

JMAP Mailbox 同时承载系统邮箱、传统文件夹和产品标签。

关键字段：

- `id`, `mail_account_id`；
- `parent_id`；
- `name`, `normalized_name`；
- `kind`：`system | folder | label`；
- `role`：`inbox | sent | drafts | trash | junk | archive | outbox |
scheduled | null`；
- `color`, `sort_order`, `is_subscribed`；
- `total_emails`, `unread_emails`, `total_threads`, `unread_threads`；
- `created_at`, `updated_at`, `deleted_at`。

约束：

- 同一账号下非空系统 Role 唯一；
- 同一父 Mailbox 下规范化名称唯一；
- 系统 Mailbox 不允许删除或改变 Role；
- Parent 必须属于同一账号；
- 邮件在未销毁时至少属于一个 Mailbox。

### 7.3 `thread`

关键字段：

- `id`, `mail_account_id`；
- `normalized_subject`；
- `latest_received_at`；
- `email_count`, `unread_count`；
- `has_attachment`；
- `participant_summary`, `preview`；
- `created_at`, `updated_at`。

Thread 是可重建聚合。Mailbox、Keyword 和删除状态的权威来源在 Email 及其关系
表，不在 Thread。

### 7.4 `email`

关键字段：

- `id`, `mail_account_id`, `thread_id`；
- `blob_id`：Raw RFC 5322/MIME；
- `message_id_header`；
- `in_reply_to`, `references`；
- `subject`, `preview`；
- `sent_at`, `received_at`；
- `size_bytes`, `has_attachment`；
- `lifecycle`：`draft | received | sent`；
- `draft_revision`；
- `created_at`, `updated_at`, `destroyed_at`。

规则：

- 普通接收邮件和已发送邮件的内容不可变；
- Draft Email 允许修改，并使用 `draft_revision` 乐观锁；
- 每封未销毁 Email 必须属于一个 Thread；
- Provider ID 不得作为 Email 主键。

### 7.5 `email_address`

关键字段：

- `email_id`；
- `kind`：`sender | from | to | cc | bcc | reply_to`；
- `position`；
- `name`, `email`。

地址按标准化邮箱索引，但保留原始显示名称和顺序。

### 7.6 `email_mailbox`

Email 与 Mailbox 多对多关系。

主键：

```text
(email_id, mailbox_id)
```

两个实体必须属于同一个 MailAccount。

`email_trash_restore` 保存 Email 移入 Trash 前的非 Trash Mailbox 集合。恢复操作使用
该关系重建原位置；永久删除时同步清除。该表不是用户可见 Mailbox 关系，也不参与
Mailbox 计数。

### 7.7 `email_keyword`

Email 的 JMAP Keyword 集合。

主键：

```text
(email_id, keyword)
```

标准 Keyword 至少支持：

```text
$seen
$flagged
$draft
$answered
$forwarded
$important
$junk
```

Mailbox 和 Thread 的未读统计由 `$seen` 和 `$draft` 派生。为了查询性能可以维护
统计缓存，但缓存不是权威来源。

### 7.8 `email_content` 与 `email_part`

`email_content` 保存：

- 解析版本；
- 纯文本正文；
- 清洗后的 HTML；
- 预览；
- 解析告警。

`email_part` 保存：

- Parent Part；
- MIME Part 路径；
- Content-Type、Charset、Disposition；
- 文件名、Content-ID；
- Blob ID、字节数；
- Body/Inline/Attachment 分类。

解析器升级后必须可以从 Raw Blob 重建这些数据。

### 7.9 `blob`

关键字段：

- `id`, `mail_account_id`；
- `sha256`, `size_bytes`, `content_type`；
- `object_key`；
- `status`：`pending | ready | deleting`；
- `created_at`, `ready_at`, `deleted_at`。

约束：

- Blob 不允许原地覆盖；
- 同账号内 `(sha256, size_bytes)` 唯一；
- Email Raw、MIME Part 和附件都引用 Blob；
- Blob 字节保存在 R2/S3，PostgreSQL 保存元数据。

### 7.10 `mail_identity`

保存 Zero 本地可用的发件身份：

- `id`, `mail_account_id`；
- `name`, `email`, `reply_to`；
- `is_default`；
- `created_at`, `updated_at`。

第一阶段只实现本地模型，不验证 Provider Send-As 权限。

### 7.11 `email_submission`

关键字段：

- `id`, `mail_account_id`, `email_id`, `identity_id`；
- `status`：`scheduled | queued | sending | retry_wait | sent | failed |
canceled`；
- `send_at`；
- `idempotency_key`；
- `attempt_count`；
- `next_attempt_at`；
- `provider_message_id`；
- `last_error_code`, `last_error_message`；
- `created_at`, `updated_at`, `sent_at`。

状态只允许：

```text
scheduled -> queued
queued -> sending
sending -> sent
sending -> retry_wait
sending -> failed
retry_wait -> queued
scheduled | queued | retry_wait -> canceled
```

终态 `sent | failed | canceled` 不允许倒退。

### 7.12 `submission_attempt`

每次发送尝试独立记录：

- `id`, `submission_id`, `attempt_number`；
- `started_at`, `finished_at`；
- `outcome`：`sent | transient_failure | permanent_failure`；
- `provider_code`, `safe_response`；
- `retry_at`。

敏感凭据和完整邮件内容不得进入错误字段。

### 7.13 `remote_email`

Provider 中立的远程映射：

- `mail_account_id`, `provider`；
- `remote_email_id`；
- `remote_thread_id`；
- `email_id`；
- `content_fingerprint`；
- `first_seen_at`, `last_seen_at`。

唯一键：

```text
(mail_account_id, provider, remote_email_id)
```

本表支持第二阶段 Gmail 导入幂等，不使核心依赖 Gmail。

### 7.14 `mail_change`

记录账号内可观察变化：

- `mail_account_id`；
- `state_version`；
- `collection`：`mailbox | email | thread | identity | email_submission`；
- `entity_id`；
- `change_type`：`created | updated | destroyed`；
- `changed_properties`；
- `created_at`。

同一业务事务内的全部 Change 共享一个 `state_version`。事务提交时同时更新
`mail_account.state_version`。

### 7.15 删除

删除分三层：

1. 移入 Trash：只改变 `email_mailbox`；
2. 永久删除：设置 `destroyed_at`、移除可见关系并写 Destroyed Change；
3. Blob GC：确认无引用后异步删除对象。

永久删除后保留最小 Tombstone/Change 信息，确保旧 State 客户端可以观察到
Destroyed。

## 8. Thread 规则

每封 Email 必须属于一个 Thread。

线程计算顺序：

1. 解析 `Message-ID`, `In-Reply-To`, `References`；
2. 对这些 ID 做规范化和去重；
3. 规范化 Subject，移除常见 `Re:`, `Fwd:` 和列表前缀；
4. 只有引用链与规范化 Subject 均满足条件时合并；
5. 没有可用引用时创建新 Thread；
6. Provider Thread ID 仅保存在 `remote_email`，不直接决定本地 Thread。

后到邮件可能连接两个已有 Thread。第一阶段允许事务内合并 Thread，但必须保留
稳定的胜出 Thread ID，并为被合并 Thread 生成 Destroyed Change。

## 9. 内核服务

```ts
interface MailCore {
  createAccount(input: CreateMailAccount): Promise<MailAccount>;

  createIdentity(input: CreateIdentity): Promise<Identity>;
  updateIdentity(input: UpdateIdentity): Promise<Identity>;
  destroyIdentity(input: DestroyIdentity): Promise<void>;

  createMailbox(input: CreateMailbox): Promise<Mailbox>;
  updateMailbox(input: UpdateMailbox): Promise<Mailbox>;
  destroyMailbox(input: DestroyMailbox): Promise<void>;

  importEmail(input: ImportEmail): Promise<ImportEmailResult>;
  getEmail(input: GetEmail): Promise<Email>;
  queryEmails(input: QueryEmails): Promise<EmailQueryResult>;
  updateEmail(input: UpdateEmail): Promise<Email>;
  destroyEmail(input: DestroyEmail): Promise<void>;

  createDraft(input: CreateDraft): Promise<Email>;
  updateDraft(input: UpdateDraft): Promise<Email>;
  destroyDraft(input: DestroyDraft): Promise<void>;

  createSubmission(input: CreateSubmission): Promise<EmailSubmission>;
  cancelSubmission(input: CancelSubmission): Promise<EmailSubmission>;

  getThread(input: GetThread): Promise<Thread>;
  queryThreads(input: QueryThreads): Promise<ThreadQueryResult>;

  getChanges(input: GetChanges): Promise<ChangesResult>;
}
```

Draft 方法是便捷命令，底层操作带 `$draft` Keyword 且位于 Drafts Mailbox 的
Email。

本阶段服务不能：

- 调用 Gmail 或其他网络 Provider；
- 读取 OAuth Token；
- 依赖 Cloudflare Request Context；
- 直接发送队列消息；
- 返回 Provider 专用 ID；
- 修改服务商侧状态。

## 10. Store Ports

`packages/mail-core` 只依赖以下端口：

```ts
interface UnitOfWork {
  run<T>(operation: (stores: MailStores) => Promise<T>): Promise<T>;
}

interface MailStore {
  // Account, Mailbox, Email, Thread, Submission and Change repositories.
}

interface BlobStore {
  put(input: PutBlobInput): Promise<PendingBlob>;
  commit(input: CommitBlobInput): Promise<ReadyBlob>;
  get(input: GetBlobInput): Promise<ReadableStream>;
  delete(input: DeleteBlobInput): Promise<void>;
}

interface SearchStore {
  query(input: SearchEmailInput): Promise<SearchEmailResult>;
}
```

具体 repository 在实施计划中按聚合拆分，禁止形成一个包含所有 SQL 的巨型
Repository。

## 11. 事务与一致性

所有修改命令执行：

```text
验证 MailAccount
-> 读取并锁定当前 state_version
-> 验证领域不变量
-> 修改权威数据
-> 重建受影响统计
-> state_version + 1
-> 写入 mail_change
-> 同一 PostgreSQL 事务提交
```

规则：

- 跨账号引用必须在数据库约束和服务层同时拒绝；
- 修改 Email Mailbox/Keyword 和销毁操作必须产生 Change；
- Mailbox 计数、Thread 计数与权威关系在同一事务更新；
- Draft 使用 `draft_revision` 乐观锁；
- Import 使用 Remote ID 和内容指纹幂等；
- Submission 使用 `idempotency_key` 幂等；
- 命令重试不能重复生成 Email 或 Submission。

## 12. Blob 一致性

Blob 使用补偿式两阶段流程：

```text
写入临时对象
-> 校验 SHA-256 和大小
-> 创建 pending Blob 元数据
-> 邮件数据库事务引用 Blob
-> 提升对象并标记 Blob ready
```

失败处理：

- 对象写入失败：不开始邮件事务；
- 数据库事务失败：临时对象成为可回收孤儿；
- 对象提升失败：Blob 保持 pending，邮件不可对外可见，由恢复任务重试；
- GC 只删除超过安全时间且没有数据库引用的对象；
- 下载时再次校验对象长度，校验和异常返回安全错误并记录审计事件。

第一阶段提供 MemoryBlobStore 以进行确定性测试；R2 Adapter 只实现接口，不改变
核心行为。

## 13. 错误模型

核心错误使用稳定错误码：

```text
MAIL_ACCOUNT_NOT_FOUND
MAILBOX_NOT_FOUND
EMAIL_NOT_FOUND
THREAD_NOT_FOUND
BLOB_NOT_FOUND
CROSS_ACCOUNT_REFERENCE
MAILBOX_ROLE_CONFLICT
MAILBOX_NAME_CONFLICT
MAILBOX_HAS_CHILD
MAILBOX_HAS_EMAIL
EMAIL_MUST_HAVE_MAILBOX
EMAIL_CONTENT_IMMUTABLE
DRAFT_REVISION_CONFLICT
INVALID_EMAIL
INVALID_KEYWORD
INVALID_CURSOR
INVALID_BLOB_KEY
IDENTITY_IN_USE
INVALID_SUBMISSION_TRANSITION
IDEMPOTENCY_CONFLICT
STATE_MISMATCH
OVER_QUOTA
```

错误可以携带安全的实体 ID、当前版本和可重试标志，但不得携带邮件正文、Raw
MIME、Access Token 或对象存储签名 URL。

## 14. 查询与搜索

第一阶段支持：

- Email get；
- Email query；
- Thread get/query；
- Mailbox 列表；
- Mailbox、Keyword、日期、发件人、收件人和附件过滤；
- `receivedAt`, `sentAt`, `size`, `subject` 排序；
- 稳定游标分页；
- PostgreSQL 全文搜索；
- Changes 分页。

分页游标至少编码排序键、实体 ID 和查询版本。游标不使用裸 Offset，防止同步写入
导致重复或漏项。

第一阶段使用 PostgreSQL `tsvector` 搜索投影。投影与 Email 内容在同一个数据库
事务中更新；永久删除 Email 时同步移除。搜索投影是可重建派生数据，不保存任何
Raw MIME 或 Provider 凭据。后续接入独立搜索引擎时，必须另行设计持久化索引
任务和恢复机制，不能让外部搜索服务成为 Email 写入事务的一部分。

## 15. 自动化测试

### 15.1 Domain 单元测试

- Keyword 规范化；
- Mailbox Role 唯一和系统 Mailbox 限制；
- Subject 规范化；
- Message-ID/References Thread 归并；
- Draft revision；
- Submission 状态机；
- 删除语义；
- 重试策略。

### 15.2 应用服务测试

- Import 幂等；
- Email 必须属于 Mailbox 和 Thread；
- `$seen` 更新未读统计；
- `$draft` 更新 Drafts 统计；
- Mailbox/Keyword 修改产生 Change；
- 同一事务的 Change 共享 State；
- Thread 合并产生正确 Created/Updated/Destroyed；
- 跨账号关系被拒绝；
- Blob 失败不产生可见 Email；
- Submission 幂等和非法状态倒退被拒绝。

### 15.3 PostgreSQL 集成测试

- 全部外键、唯一键和 Check Constraint；
- Repository 行为；
- 并发 Draft revision；
- 并发 Mailbox Role 创建；
- 并发 Import 去重；
- State version 原子递增；
- 事务回滚；
- 查询索引和稳定游标。

### 15.4 参考行为测试

测试依据顺序：

1. RFC 8620/8621；
2. Stalwart 外部可观察行为；
3. 本设计明确的 Zero 扩展。

测试不得复制 Stalwart AGPL 测试源码。

## 16. 验收标准

- `packages/mail-core` 不导入 Gmail、Cloudflare、tRPC、Drizzle 或 Server 模块；
- Drizzle migration 可在空 PostgreSQL 数据库完整应用；
- 所有邮箱表使用 `mail0_` 前缀；
- Email、Mailbox、Thread、Keyword、Blob、Identity、Submission 和 Change 模型
  可用；
- Raw MIME 与 Blob 元数据分离；
- 普通 Email 内容不可变，Draft 使用 revision 更新；
- Email 至少属于一个 Mailbox 和一个 Thread；
- Provider ID 与本地 ID 分离；
- Mailbox/Keyword/销毁操作产生一致 Change；
- Mailbox 和 Thread 统计与权威数据一致；
- Trash、永久删除和 Blob GC 语义区分；
- Submission 状态机和 Attempt 历史可用；
- Domain 与 PostgreSQL 集成测试全部通过；
- 现有前端、现有 Gmail Driver 和现有邮件读取路径不切换；
- 第一阶段不产生任何真实 Provider 网络请求。

## 17. 后续阶段

本内核验收后，按以下顺序继续：

1. `packages/mail-provider-core`；
2. `packages/mail-provider-gmail`；
3. Gmail 全量导入；
4. Gmail History 增量导入；
5. 本地 Outbox 通过 Gmail API 发件；
6. tRPC 查询和修改切换到本地内核；
7. 前端逐功能切换；
8. 旧 Durable Object/R2 数据迁移和下线；
9. Outlook、Zoho、IMAP/SMTP 插件。

每个后续阶段必须有独立设计、实施计划、迁移策略和验收门槛。

## 18. 参考

- RFC 8620：The JSON Meta Application Protocol
- RFC 8621：The JSON Meta Application Protocol for Mail
- RFC 5322：Internet Message Format
- RFC 2045–2049：Multipurpose Internet Mail Extensions
- `D:\WorkSpace\zmail\stalwart-main`
- `D:\WorkSpace\zmail\sync-engine-master`
- `D:\WorkSpace\zmail\emailengine-master`
- `D:\WorkSpace\zmail\postal-main`
