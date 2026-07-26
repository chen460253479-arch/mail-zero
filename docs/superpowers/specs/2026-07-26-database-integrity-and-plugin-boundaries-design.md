# Zero 数据完整性与插件边界修复设计

日期：2026-07-26  
分支：`codex/local-mail-core`  
状态：方案 A 已获用户批准，等待书面规格复核

## 1. 目标

本项目修复本地邮箱内核完成后发现的数据库初始化安全、约束、索引、多账户作用域
和插件连接模型问题，使 Zero 在开始 Gmail 入栈同步前具备稳定、可扩展的数据库
基础。

修复完成后必须满足：

- 全新开发数据库可以通过 `db:push` 或唯一基线迁移初始化。
- `db:push` 在发现已有 Zero 业务结构时必须先提示，由用户选择取消或清空重建。
- Drizzle 或 PostgreSQL 报错时，数据库命令必须返回非零退出码。
- `mail` 数据模型保持服务商无关，并继续以本地 Email、Mailbox、Thread、
  Keyword、Draft、Trash、Submission 和 Changes 为权威状态。
- `integration` 可以表示 Gmail、Outlook、Zoho 和通用 IMAP/SMTP 连接，不把
  OAuth 专有要求固化到通用连接记录。
- 现有前端暂不切换到本地邮箱内核，但其 Summary 和 Note 数据不能在多账户间
  发生标识冲突。
- 所有正常邮件查询和维护路径具有与访问模式匹配的账户前缀索引。

## 2. 全局约束

- 直接在 `D:\WorkSpace\Zero` 的当前分支开发，不创建 Git worktree。
- 保留并且不提交用户未跟踪的根目录 `AGENTS.md`。
- 当前所有开发数据库允许清空重建，不保留现有业务数据。
- 仓库继续只保留一份开发期基线迁移，不追加用于保留旧开发数据的时间线 SQL。
- 不接入 Gmail API，不切换现有前端，不实现反向同步。
- 不复制 Stalwart 的 Rust/存储代码；只参考标准、模块边界和外部可观察机制，
  独立实现 TypeScript/PostgreSQL 版本。
- 所有行为修复采用测试驱动开发：先建立能够复现问题的失败测试，再修改生产
  Schema、仓储或脚本。

## 3. 参照项目与转换原则

### 3.1 Stalwart

主要参考：

- JMAP 兼容的 Email、Mailbox、Thread、Blob、Submission 和 Changes 语义。
- 账户作用域作为所有索引和关系的第一隔离维度。
- 权威事实数据与可重建投影分离。
- 对象更新、状态版本和 Changes 在同一事务内提交。

Zero 不采用 Stalwart 的 KV 键空间、位图索引、Rust 类型或协议服务器实现。
对应机制转换为 PostgreSQL 外键、复合键、部分索引和 TypeScript 仓储。

### 3.2 Nylas Sync Engine

主要参考：

- Provider ID 与本地对象 ID 分离。
- Thread 是一等本地聚合，Message 与 Folder/Label 使用关系表关联。
- Message、Thread、Folder/Label 查询均以账户或 Namespace 为索引前缀。
- MIME Part 和内容对象独立存储。

Zero 不沿用其旧版 MySQL 特性、Python 2 同步框架或把 Provider 专有字段混入
核心 Email 表的做法。

### 3.3 EmailEngine

主要参考：

- 连接类型、认证方式和 Provider 运行时分离。
- OAuth、Basic 和服务商专有认证不能共享一组强制字段。
- 账户级锁、错误标准化和重连状态。
- Provider 适配器负责远端行为，本地业务模型不依赖适配器内部存储。

EmailEngine 以 Redis 和远端邮箱为主要事实来源，因此不作为 Zero 本地邮件
关系模型的直接来源。

### 3.4 Postal

只参考 Submission 队列、投递尝试、幂等键、退避和错误分类。Postal 的
SMTP/MX、短期 Message DB 和事务邮件模型不进入本项目。

## 4. 修复范围

项目拆分为三个顺序执行、独立验收的批次。三个批次全部完成才算方案 A 完成。

### 4.1 批次一：安全初始化、约束与索引

#### 4.1.1 受保护的 `db:push`

Zero 将项目级 `db:push` 定位为开发期初始化/重建命令，不再把 Drizzle 原生
`push` 当作已有数据库的增量迁移机制。

执行流程：

1. 解析并显示目标数据库的主机、端口和数据库名，不显示用户名、密码或其他
   凭据。
2. 检查 `auth`、`app`、`integration`、`mail` 四个业务 Schema 是否已经存在
   Zero 表。
3. 如果不存在 Zero 表，直接调用 Drizzle `push` 初始化。
4. 如果已经存在 Zero 表，显示各 Schema 的表数量和将被删除的范围。
5. 交互终端要求用户选择取消或清空重建；默认选择必须是取消。
6. 用户取消时不执行任何 DDL，并以成功的“未变更”结果结束。
7. 用户确认时删除并重建四个业务 Schema，同时清理对应的
   `drizzle.__drizzle_migrations` 开发基线记录，然后从声明模型重新初始化。
8. 非交互环境禁止等待输入或自动删除；必须同时提供显式重建参数和确认参数才
   能执行，例如 `--reset --yes`，否则返回非零退出码。
9. `NODE_ENV=production` 时无条件拒绝清空重建参数；生产数据库只能使用经过
   审核的 `db:migrate`。

生产修复包括：

- 所有主键、唯一约束、检查约束和外键使用不超过 PostgreSQL 63 字节限制的
  显式稳定名称。
- `email_part` 自引用外键继续保证父 Part 与子 Part 同属一个 Account 和
  Email；不为了支持已有数据库的重复 `push` 改写这一正确语义。
- `writing_style_matrix` 等当前由工具自动命名的主键改用显式名称。
- `authorization_binding`、`channel_mapping`、`connection` 等自动生成的长唯一
  约束改用短名称。
- 项目 `db:push` 命令负责传播错误：子进程非零、Drizzle 错误块或 PostgreSQL
  错误均视为失败，不得报告初始化成功。
- 清空动作只允许作用于上述业务 Schema 和 Drizzle 开发基线元数据，不执行
  `DROP DATABASE`，不删除其他 Schema、扩展或数据库对象。

#### 4.1.2 主键和逻辑身份

- `integration.remote_email` 现有
  `(mail_account_id, provider, remote_email_id)` 唯一索引已经提供可靠逻辑
  身份，本项目不因形式上没有主键而强制改型。
- `mail.submission_blob` 现有
  `(mail_account_id, submission_id, kind, position)` 唯一约束已经提供可靠
  逻辑身份，本项目不因形式上没有主键而强制改型。
- 不为纯关系表无意义地增加随机代理键。
- 所有实体表继续保留稳定本地 ID；Provider ID 不能成为 `mail.email`、
  `mail.thread` 或 `mail.mailbox` 的主键。

#### 4.1.3 外键支持索引

为删除、级联和维护链路补充以外键本地列开头的索引，重点包括：

- `mail.email(blob_id, mail_account_id)`。
- `mail.email_content(text_blob_id, mail_account_id)`。
- `mail.email_content(html_blob_id, mail_account_id)`。
- `mail.email_part(blob_id, mail_account_id)`。
- `mail.email_part(parent_part_id, email_id, mail_account_id)`。
- `integration.remote_email(email_id, mail_account_id)`。
- `mail.submission(email_id, mail_account_id)`。
- `mail.submission(identity_id, mail_account_id)`。

只增加能够支持真实删除、级联或查询路径的索引，不机械地为每个外键复制已经
存在且具有相同左前缀的唯一索引。

#### 4.1.4 仓储查询索引

查询索引必须与仓储的过滤、排序和分页顺序一致：

- Identity：
  `(mail_account_id, created_at, id) WHERE deleted_at IS NULL`。
- Mailbox：
  `(mail_account_id, sort_order, id) WHERE deleted_at IS NULL`。
- Blob 账户列举：
  `(mail_account_id, created_at, id)`。
- Submission 账户列举：
  `(mail_account_id, created_at, id)`。
- Submission 按 Identity 列举：
  `(mail_account_id, identity_id, created_at, id)`。

Mailbox 和 Identity 的正常列表查询在 SQL 中排除软删除记录，不再把全部历史
记录加载到 TypeScript 后过滤。

#### 4.1.5 冗余索引

- 删除与 `mail.change` 主键列和顺序完全相同的普通索引。
- 删除已被 `mail.thread_reference` 主键左前缀完整覆盖、且没有独立排序收益的
  普通索引。
- 使用 PostgreSQL 目录和 `EXPLAIN` 证明索引确实重复后才删除，不依赖名称
  推断。

### 4.2 批次二：旧应用投影的多账户作用域

#### 4.2.1 Summary

当前 `app.summary.message_id` 不能继续假定在全部连接间全局唯一。

目标键为：

```text
PRIMARY KEY (connection_id, message_id)
```

所有读取、更新和删除必须同时携带已授权的 `connection_id`。现有前端参数可以
保持不变，但 Server 必须从当前已授权连接上下文补充账户作用域，不能信任客户
端任意传入其他连接 ID。

在前端切换到本地邮箱内核前，`message_id` 仍表示 Provider 侧消息标识；后续
迁移时再改为引用本地 `mail.email`，本项目不伪造尚不存在的映射。

#### 4.2.2 Note

Note 增加非空 `connection_id` 并引用 `integration.connection`。Provider
Thread ID 的查询键变为：

```text
(user_id, connection_id, thread_id)
```

创建 Note 时由 Server 使用当前已授权连接填充 `connection_id`。这样既不要求
当前前端切换到本地 Thread ID，也不会让相同 Provider Thread ID 在不同连接间
互相覆盖。

Note 后续切换本地邮箱内核时，应增加本地 Thread 映射并最终引用
`mail.thread`；该切换属于前端迁移阶段。

### 4.3 批次三：服务商无关连接模型

#### 4.3.1 Connection

`integration.connection` 只保存连接身份和运行状态：

- `id`、`user_id`。
- `channel_id`：插件通道，例如 Gmail API、Microsoft Graph、Zoho API、
  IMAP/SMTP。
- `provider_key`：插件注册键，使用稳定格式检查，不使用数据库白名单枚举。
- `email`、`normalized_email`、显示名称和头像。
- `status`、`disconnected_at`。
- `created_at`、`updated_at`。

连接唯一性调整为：

```text
UNIQUE (user_id, channel_id, normalized_email)
```

同一用户不能通过同一通道重复绑定同一地址；不同通道可以显式绑定同一地址，
以支持迁移或并行验证。是否允许用户界面创建这种配置由应用策略决定，不由数据
库错误地假定邮箱地址全局唯一。

OAuth 专有的 `access_token`、`refresh_token`、`scope` 和 `expires_at` 不再是
通用 Connection 的必填属性。

#### 4.3.2 Authorization Binding

凭据继续由 `integration.authorization_binding` 承载：

- `auth_source`：
  `zero_oauth | nango | manual`。
- `credential_type`：
  `oauth2 | basic | custom`。
- 加密凭据快照和外部凭据引用。
- 可空的访问令牌过期时间和凭据抓取时间。

数据库增加状态和凭据类型检查约束。OAuth 可以具有 Scope 和过期时间；
Basic/IMAP/SMTP 不要求伪造 OAuth 字段。

插件的能力声明、协议客户端和发送/同步行为保留在进程内 TypeScript 插件注册
表中，不用 JSONB 能力字段重复存入 Connection。

#### 4.3.3 状态与时间

- `connection.status`、`authorization_binding.auth_source`、
  `authorization_binding.credential_type` 及其他稳定生命周期字段增加数据库
  `CHECK`。
- `integration` 与邮件执行相关的时间统一使用 `timestamptz`。
- `auth` 中由 Better Auth 控制的表不在没有兼容性证据时批量改型；通过适配层
  明确其时间语义，避免破坏认证库契约。

## 5. 数据流与事务边界

### 5.1 本地邮件

```text
Provider 插件
    -> 远端 ID 映射（integration.remote_email）
    -> 导入命令
    -> mail.email / thread / mailbox / keyword / blob
    -> mail.change
```

远端映射与本地 Email 导入必须在可重试事务边界内完成。Provider ID 只存在于
`integration`，本地业务状态只存在于 `mail`。

### 5.2 连接与凭据

```text
connection：是谁、属于谁、使用哪个插件、当前状态
authorization_binding：怎样取得凭据
插件运行时：如何同步、下载和发送
```

Connection 删除继续级联清理 Authorization Binding、本地 Mail Account 和
相关应用投影。凭据错误只改变连接/授权状态，不直接删除已同步本地邮件。

### 5.3 Summary 与 Note

前端请求先通过认证用户和当前连接授权，再访问
`(connection_id, provider_object_id)`。任何只凭 Message-ID 或 Thread-ID 的
跨连接查询都视为数据隔离缺陷。

## 6. 错误处理

- 数据库初始化或推送出现任何 PostgreSQL 错误时立即失败并返回非零退出码。
- 已有 Zero 结构的数据库在用户确认前不得执行删除、修改或重建。
- 非交互环境缺少 `--reset --yes` 时必须拒绝清空；生产环境即使提供该参数也
  必须拒绝。
- 约束冲突必须保留 PostgreSQL 原始诊断供日志使用，对外转换为安全的领域错误。
- 插件不支持某种认证类型时，在连接创建阶段拒绝，不能写入半有效连接。
- 外键删除失败必须由维护命令报告具体引用表，不自动关闭约束或级联删除范围。
- Schema 目录与声明模型不一致时，CI 失败，不自动接受漂移。

## 7. 测试设计

### 7.1 声明式 Schema 测试

验证：

- 所有显式约束名唯一且不超过 63 字节。
- 所有稳定枚举字段具有数据库 `CHECK`。
- 预期主键、外键和索引列顺序完全一致。
- 不存在已确认的重复索引。

### 7.2 临时 PostgreSQL 集成测试

每个测试使用独立临时 Database，结束后关闭连接并删除 Database：

- 空数据库执行 `db:push` 后得到完整目标结构。
- 已有 Zero 结构时默认进入取消路径，数据库目录和数据保持不变。
- 交互确认重建后旧结构和测试数据被清除，并得到完整目标结构。
- 非交互环境缺少显式参数时拒绝清空。
- `NODE_ENV=production` 时拒绝清空。
- `db:push` 与 `db:migrate` 的 Schema、表、列、默认值、约束、索引和外键
  等价。
- 强制失败返回非零退出码。
- 跨账户 Email、Blob、Mailbox、Thread、Submission 和 RemoteEmail 引用被
  数据库拒绝。
- 完整账户删除级联行为正确。
- Summary 和 Note 在两个连接使用相同远端 ID 时保持隔离。
- OAuth 连接和 Basic/IMAP 连接都能在不伪造无关字段的情况下合法保存。

### 7.3 查询计划测试

使用确定性数据并执行 `ANALYZE`，通过 `EXPLAIN` 验证：

- Blob 删除检查使用 Blob 引用索引。
- Identity、Mailbox、Blob 和 Submission 分页使用账户前缀索引。
- 软删除列表不扫描并返回历史记录。
- RemoteEmail 反向清理使用 Email 引用索引。

规模测试继续使用至少 100,000 封 Email、20,000 个 Thread 和 30 个 Mailbox。

### 7.4 回归门槛

至少执行：

```text
pnpm --filter=@zero/mail-core test
pnpm --dir apps/server test:mail-core
pnpm --filter=@zero/mail-core typecheck
针对本轮文件的 Server TypeScript/ESLint 检查
显式 PostgreSQL 规模测试
pnpm db:generate
临时空库执行 pnpm --dir apps/server db:push
临时已有库分别验证取消和确认重建
临时库 pnpm --dir apps/server db:migrate
pnpm build
git diff --check
```

完整 Server 既有诊断必须与本轮新增诊断分开记录，不能把既有失败描述成本轮
通过，也不能以既有失败掩盖本轮新增问题。

## 8. 开发基线

三个批次全部完成后：

1. 删除当前开发期 `0000` SQL、快照和迁移日志。
2. 从最终 Drizzle 声明模型生成一份新的 `0000` 基线。
3. 基线只包含结构，不包含演示、测试或默认业务数据。
4. 从空数据库分别验证 `db:push` 和 `db:migrate`。
5. 确认 `db:generate` 再次执行时输出无结构变化。

建立需要保留数据的共享、测试、预发布或生产环境后，不再重写已经执行的基线，
后续结构变化一律使用增量迁移。

## 9. 明确不包含

- Gmail History API、Push Notification、Webhook 和真实邮件同步。
- Gmail、Graph、Zoho 或 IMAP/SMTP 的真实发件。
- Outlook、Zoho 和 IMAP/SMTP 插件的凭据解析、协议客户端与运行时驱动；本阶段只要求
  通用连接模型可以合法表达这些后续插件，并保证未安装插件的连接列表不会导致服务失败。
- 前端改用本地 Email/Thread/Mailbox。
- 把本地标签、文件夹、已读或删除状态反向写回 Provider。
- JMAP HTTP 服务、IMAP/SMTP Server、MX、DKIM、SPF。
- 保留当前开发数据库已有数据的迁移脚本。

## 10. 完成定义

只有同时满足以下条件才能声明本项目完成：

- 三个修复批次全部具有红灯、绿灯和回归证据。
- `db:push` 能区分空库和已有库，取消、确认重建、非交互拒绝和生产拒绝行为
  全部正确，错误退出码可靠。
- 所有确认的高风险外键和查询路径具有有效索引。
- Summary、Note 和 Connection 的账户/连接作用域测试通过。
- 插件连接模型可以表达 OAuth 与 Basic/IMAP/SMTP。
- 新唯一基线和声明模型完全一致。
- MailCore 测试、规模测试、相关类型/格式检查和构建通过。
- 最终疏漏审查没有剩余 Critical 或 Important 问题。
- 用户文件和无关改动未被覆盖或提交。
