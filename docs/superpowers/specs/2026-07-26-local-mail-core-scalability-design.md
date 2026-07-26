# 本地邮箱内核规模化改进设计

## 状态

用户已于 2026-07-26 批准本设计。规模化改进已在
`codex/local-mail-core` 分支实现；实际交付结果和疏漏分类记录在
`docs/superpowers/plans/2026-07-25-local-mail-core-omission-audit-report.md`。

实现过程中规模测试进一步确认：Mailbox 过滤应直接读取
`mail0_mailbox_thread` 投影，而不是由 PostgreSQL 将 Email 相关子查询改写成
账户级哈希连接。Thread 查询同时显式使用
`latest_received_at DESC NULLS LAST, id ASC`，与物理索引排序完全一致。

## 目标

在不切换当前前端、不接入 Gmail 服务商的前提下，使 Zero 现有本地邮箱内核
能够安全承载大型托管邮箱账号。

本项目将完成以下改进：

- 消除常规查询和写操作中的账户级 Email、Thread 全量加载。
- 将 Mailbox、Thread 全量计数重建改为有界的增量更新。
- 参考 Stalwart 与 Sync Engine，引入带索引的本地线程匹配机制。
- 补充与查询能力对应的 PostgreSQL 字段及索引。
- 建立可重建、可验证的派生数据维护机制。

## 全局约束

- PostgreSQL 继续作为本地邮箱的事实来源。
- `packages/mail-core` 必须保持服务商无关、数据库无关。
- 服务商专有标识不得进入核心 Email、Mailbox、Thread 记录。
- 当前前端行为保持不变。
- 本地 Mailbox、Keyword 的修改永远不反向同步到邮件服务商。
- 直接在 `D:\WorkSpace\Zero` 当前分支开发，不使用 Git worktree。
- 保留用户已有改动，包括根目录未跟踪的 `AGENTS.md`。
- 所有行为变更必须遵循测试驱动开发。

## 参照项目及转换原则

### Stalwart

Stalwart 是本项目最主要的邮箱语义和规模化实现参照：

- 通过规范化主题和 Message-ID 引用哈希索引缩小候选线程范围，而不是扫描
  账户全部邮件。
- 通过紧凑的索引投影执行筛选和排序，而不是水合所有 Email 聚合对象。
- 将聚合、搜索数据视为可重建的派生状态。

Zero 将这些机制转换为 PostgreSQL 关系表、索引和 TypeScript 端口，不复制
Stalwart 的 Rust 类型、KV 表示或 Roaring Bitmap 存储。

### Sync Engine

Sync Engine 是关系型数据组织的主要参照：

- Message-ID 与规范化主题共同参与线程查询。
- Thread 是一等聚合实体。
- 类似 Category 的归属关系与 Message 分离存储。
- MIME Part 与内容寻址对象采用独立关系。

Zero 保留现有 Email/Mailbox 多对多关系和 Blob Store，不复制 Sync Engine
中混入 Message 表的服务商专有字段。

### EmailEngine 与 Postal

EmailEngine 和 Postal 不作为本子项目的直接实现参照。它们的同步运行状态、
队列领取、租约和重试机制将在本地内核规模化验收通过后的独立子项目中使用。

## 当前问题

### Thread 查询

`queryThreads` 当前加载账户下全部可见 Email 和全部 Thread，在 TypeScript
中分组、排序后才截取一页。PostgreSQL Email 仓储又会为每封 Email 执行多组
关联查询，形成严重的 N+1 查询。

### 线程匹配

`importEmail` 当前加载账户全部 Email 和 Thread，再匹配 `Message-ID`、
`In-Reply-To`、`References`。合并 Thread 时还会再次遍历账户邮件。

### 聚合维护

导入邮件、创建和修改草稿、修改邮件状态、销毁邮件时，都会根据账户全部可见
Email 重新计算所有 Mailbox 计数。成本同时随 Mailbox 数量和 Email 数量增长。

### 配套索引

Thread 排序、Email 发送时间排序、大小排序、主题排序、规范化地址过滤没有全部
获得匹配的 PostgreSQL 索引。

## 总体架构

### 查询投影端口

领域包新增面向用途的查询投影端口，避免使用聚合仓储执行大范围查询：

```ts
export interface ThreadQueryStore {
  query(input: ThreadQueryInput): Promise<ThreadQueryPage>;
  get(input: ThreadGetInput): Promise<ThreadProjection | null>;
}
```

`ThreadQueryPage` 只包含请求页以及该页需要的有界 Email ID 集合。
PostgreSQL 负责：

- 账户范围限制。
- 可选 Mailbox 过滤。
- 排序。
- Keyset 分页。

端口不得暴露 Drizzle 类型或 SQL 概念。

### 线程引用索引

新增 `mail0_thread_reference`：

```text
mail_account_id          text，非空
normalized_subject_hash text，非空
message_id_hash          text，非空
email_id                 text，非空
thread_id                text，非空
created_at               timestamptz，非空
```

约束和索引：

```text
主键 (mail_account_id, email_id, message_id_hash)
外键 (email_id, mail_account_id) -> mail0_email
外键 (thread_id, mail_account_id) -> mail0_thread
索引 (mail_account_id, normalized_subject_hash, message_id_hash)
索引 (mail_account_id, thread_id, email_id)
```

只把邮件自身的规范化 Message-ID 作为可匹配目标写入索引。新邮件的
`In-Reply-To` 和 `References` 在规范化并哈希后，与规范化主题哈希一起查询
该关系。

哈希统一采用确定性的、小写十六进制 SHA-256。原始服务商标识和原始邮件头
不得直接作为索引键。

### 线程匹配流程

导入 Email 时依次执行：

1. 使用现有本地主题规则规范化 Subject。
2. 规范化并去重 `In-Reply-To` 和 `References`。
3. 计算规范化主题和引用 Message-ID 的哈希。
4. 只查询索引命中的候选线程。
5. 继续使用现有确定性的 create/use/merge 决策。
6. 合并线程时，在同一数据库事务内把败方 Thread 的 Email 和引用行更新到
   胜方 Thread。
7. Email 创建成功后写入该邮件自身的 Message-ID 引用。

没有可用 Message-ID 的邮件仍然允许导入，但不创建线程引用行。

### Mailbox-Thread 聚合关系

新增 `mail0_mailbox_thread`：

```text
mail_account_id    text，非空
mailbox_id         text，非空
thread_id          text，非空
email_count        integer，非空
unread_email_count integer，非空
updated_at         timestamptz，非空
```

约束：

```text
主键 (mail_account_id, mailbox_id, thread_id)
email_count > 0
unread_email_count >= 0
unread_email_count <= email_count
```

该关系使 Mailbox 的 Thread 级计数可以增量维护：

- 创建关系行：`mailbox.totalThreads + 1`。
- 删除关系行：`mailbox.totalThreads - 1`。
- `unread_email_count` 从 0 变为正数：
  `mailbox.unreadThreads + 1`。
- `unread_email_count` 从正数变为 0：
  `mailbox.unreadThreads - 1`。

Email 级 Mailbox 计数直接根据 Email 变更前后的归属关系计算。Thread 聚合计数
直接根据 Email 可见性和 `$seen` 状态变化计算。

### 增量输入

计数变化根据不可变的 before/after 投影计算：

```ts
export type EmailAggregateProjection = {
  emailId: EmailId;
  threadId: ThreadId;
  mailboxIds: MailboxId[];
  visible: boolean;
  unread: boolean;
  hasAttachment: boolean;
  receivedAt: Date;
};
```

每次 Email 修改都必须提供 `before` 和 `after`：

- 新建时使用 `before: null`。
- 永久销毁时使用 `after: null`。

聚合服务只更新受影响的 Thread、Mailbox 组合，禁止调用
`emails.listByAccount()`。

### 重建与校验

增量聚合仍然属于派生数据。新增有界的维护命令，根据 SQL 事实数据重建单个
账户的聚合状态，并在修复前报告差异。

重建功能不能用于常规 Email 修改，只用于：

- 数据迁移回填。
- 运维修复。
- 一致性测试。

## PostgreSQL 索引调整

新增或确认以下索引：

```text
thread (mail_account_id, latest_received_at desc, id)
email (mail_account_id, sent_at, id)
email (mail_account_id, size_bytes, id)
email (mail_account_id, normalized_subject, id)
email_address (mail_account_id, normalized_email, kind, email_id)
```

在 Email 保存 `normalized_subject`，在 EmailAddress 保存
`normalized_email`，避免常规查询依赖无法有效使用索引的表达式计算。

迁移顺序：

1. 新增允许为空的规范化字段、聚合表、线程引用表。
2. 分批回填规范化字段、线程引用、Mailbox-Thread 聚合。
3. 回填完成后添加非空约束和索引。
4. 将写路径切换到增量维护。
5. 将 Thread 读路径切换到 `ThreadQueryStore`。
6. 移除生产写路径中的账户级全量重建调用。

迁移必须可以安全重启。重复执行回填必须收敛，不能产生重复关系或重复计数。

## 事务与并发

第一版继续保留现有账户行锁，因为它保护全局状态版本分配，也便于审计聚合
变化的正确性。本项目减少持锁期间的工作量，但暂不替换账户级串行化机制。

新查询和聚合路径不得新增对象存储或邮件服务商网络操作。

同一服务商 Email 的并发导入继续依赖现有 `remote_email` 唯一键。并发聚合
修改由账户锁和数据库约束共同保护。

只有在获得有界查询、有界写入的基准数据后，才能重新评估账户锁粒度。

## 错误处理

- 缺失引用和跨账户引用继续使用现有 MailCore 错误码。
- 格式异常的 Message-ID 不阻止邮件导入；该值不进入引用索引，并在适用时
  通过现有解析警告记录。
- 计数下溢、不可能的 Mailbox-Thread 状态转换、指向不存在 Email 的引用统一
  报告为 `STORAGE_FAILURE`。
- 聚合重建发现差异时返回结构化维护结果；只有显式指定修复选项才允许写入。

## 测试策略

### 领域单元测试

覆盖：

- 引用规范化和哈希。
- 候选查询输入构造。
- 确定性的 create/use/merge 决策。
- 新建、移动、已读、未读、移入垃圾箱、恢复、线程合并、创建草稿、销毁邮件
  的聚合增量。
- 计数从 0 到正数、从正数到 0 的边界。

### PostgreSQL 集成测试

覆盖：

- Thread 查询只返回一页，且不调用聚合全量列表仓储。
- Mailbox 过滤和 Keyset 分页保持稳定。
- 引用索引只能找到同账户、同主题候选。
- Thread 合并原子更新 Email、Thread Reference、Thread Aggregate、
  Mailbox Aggregate、Search Projection 和 Changes。
- 并发修改后计数保持非负且正确。
- 全量重建结果与增量状态完全一致。
- 回填脚本重复执行结果一致。

### 规模测试

使用确定性数据集，至少包含：

- 100,000 封 Email。
- 20,000 个 Thread。
- 30 个 Mailbox。
- 混合已读/未读状态。
- 多 Mailbox 归属。

验收条件：

- 查询 50 个 Thread 时不水合账户全部 Email。
- SQL 数量由固定批次决定，不随页外数据量增长。
- 修改单封 Email 的 Keyword 或 Mailbox 时不扫描账户全部 Email。
- 查询计划使用新增的账户前缀索引，不执行账户级全量排序。
- 测试内存只与请求页和受影响聚合组合相关。

与硬件有关的延迟数据作为基准证据记录，但不单独作为唯一通过条件。

## 公共 API 兼容性

现有 MailCore 命令名称和结果结构保持兼容。后续 Changes/Query 独立项目可能
增加 `queryState` 字段，但不属于本项目。

本项目不切换任何前端路由。

## 交付物

1. Thread 查询投影端口及 PostgreSQL 实现。
2. Thread Reference 表、仓储、回填和索引匹配。
3. Mailbox-Thread 聚合表和增量聚合服务。
4. Email 规范化主题、地址字段及匹配索引。
5. 聚合重建和校验维护命令。
6. 单元、集成、并发、迁移、规模回归测试。
7. 更新本地邮箱内核设计和疏漏审查文档。

## 明确延后

以下能力必须分别建立设计和实施计划，不包含在本子项目中：

- Submission 对 Sent、Outbox、Scheduled 的本地投影。
- 持久化发件任务领取、租约和退避重试。
- Blob 外部 I/O 事务边界调整。
- Changes 保留策略和查询状态版本。
- 服务商无关同步状态表。
- Gmail History 增量同步和 Gmail API 发件。
- JMAP HTTP 接口和前端迁移。

本项目通过完整验证门槛后，才能依次启动上述子项目。
