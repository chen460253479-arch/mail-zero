# PostgreSQL 业务 Schema 化设计

## 目标

Zero 继续使用一个 PostgreSQL Database，但将当前平铺在 `public` 下并带有
`mail0_` 前缀的业务表，按照业务边界迁移到 `auth`、`app`、`integration`、
`mail` 四个 Schema。

本次调整必须同时满足：

- 物理表名移除 `mail0_` 前缀；
- 同一个 Database 内继续使用外键、事务和 JOIN；
- 全新本地数据库仍可通过 `pnpm db:push` 初始化；
- 当前开发数据库全部允许清空重建，不保留旧迁移升级路径；
- 仓库只保留一份能够从空库创建目标结构的基线迁移；
- 本地邮箱内核的 TypeScript 接口和业务行为保持不变；
- 完成后再开发 Gmail 入栈同步。

本次不实现 Gmail 同步，不拆分多个 PostgreSQL Database，不按用户、邮箱账号或
邮件服务商创建 Schema。

## 不变量与非目标

本次是数据库命名空间调整，不是表数据模型重构。除 Schema 归属和已经确认的物理
表名调整外，现有表定义必须保持结构等价：

- 不新增或删除业务表；
- 不新增、删除或重命名字段；
- 不改变字段类型、长度、精度、数组类型或自定义类型；
- 不改变 `NOT NULL`、默认值和生成规则；
- 不改变主键、唯一约束、检查约束及其字段组合或条件；
- 不改变普通索引、唯一索引、部分索引的字段顺序、排序方式、索引方法或过滤条件；
- 不改变外键的本地字段、目标字段、复合账户边界及 `ON DELETE`、`ON UPDATE`
  语义；
- 基线迁移不包含演示、测试或默认业务数据；
- 不借 Schema 调整重构 TypeScript 领域接口、Repository 行为或邮件业务规则。

索引和约束的物理名称可以随表名去除 `mail0_`，但它们的定义和约束语义必须保持
完全一致。新基线相对于当前声明式模型的差异只能是 Schema 限定名、表名以及由此
派生的数据库对象名称。

## 方案比较

### 方案 A：继续使用 `public` 和 `mail0_` 前缀

改动最少，但表仍然平铺，前缀只能提供命名提示，不能提供清晰的业务目录、所有权
或权限边界。随着同步、远端映射、Webhook 和投递表增加，维护成本会持续上升。

### 方案 B：一个 Database、多个业务 Schema

使用 PostgreSQL 原生 Schema 表达业务归属，保留本地邮箱内核需要的事务和外键，
同时允许不同领域使用简洁表名。该方案符合 Zero 当前的模块化单体和进程内
TypeScript 插件架构。

### 方案 C：每个业务使用独立 Database

可以获得更强的物理隔离，但会失去直接跨库外键，并引入多连接池、分布式一致性、
独立迁移和独立备份。当前 Zero 尚未形成独立部署的服务边界，不采用该方案。

采用方案 B。

## Schema 边界

### `auth`

存放 Zero 身份认证、会话和 Zero 自身 OAuth 服务数据：

| TypeScript 导出    | 当前物理表                        | 目标物理表                |
| ------------------ | --------------------------------- | ------------------------- |
| `user`             | `public.mail0_user`               | `auth.user_account`       |
| `session`          | `public.mail0_session`            | `auth.session`            |
| `account`          | `public.mail0_account`            | `auth.account`            |
| `verification`     | `public.mail0_verification`       | `auth.verification`       |
| `jwks`             | `public.mail0_jwks`               | `auth.jwks`               |
| `oauthApplication` | `public.mail0_oauth_application`  | `auth.oauth_application`  |
| `oauthAccessToken` | `public.mail0_oauth_access_token` | `auth.oauth_access_token` |
| `oauthConsent`     | `public.mail0_oauth_consent`      | `auth.oauth_consent`      |

`user_account` 避免直接使用 SQL 上下文中容易混淆的 `user` 名称。现有 TypeScript
导出名不变，避免把物理命名调整扩散为无关的应用 API 重构。

### `app`

存放 Zero 应用层、用户偏好和 AI 辅助功能数据：

| TypeScript 导出      | 当前物理表                          | 目标物理表                 |
| -------------------- | ----------------------------------- | -------------------------- |
| `earlyAccess`        | `public.mail0_early_access`         | `app.early_access`         |
| `userHotkeys`        | `public.mail0_user_hotkeys`         | `app.user_hotkeys`         |
| `summary`            | `public.mail0_summary`              | `app.summary`              |
| `note`               | `public.mail0_note`                 | `app.note`                 |
| `userSettings`       | `public.mail0_user_settings`        | `app.user_settings`        |
| `writingStyleMatrix` | `public.mail0_writing_style_matrix` | `app.writing_style_matrix` |
| `emailTemplate`      | `public.mail0_email_template`       | `app.email_template`       |

### `integration`

存放外部邮件服务商连接、授权绑定和提供商交互状态：

| TypeScript 导出             | 当前物理表                                 | 目标物理表                          |
| --------------------------- | ------------------------------------------ | ----------------------------------- |
| `connection`                | `public.mail0_connection`                  | `integration.connection`            |
| `authorizationBinding`      | `public.mail0_authorization_binding`       | `integration.authorization_binding` |
| `systemIntegrationConfig`   | `public.mail0_system_integration_config`   | `integration.system_config`         |
| `channelIntegrationMapping` | `public.mail0_channel_integration_mapping` | `integration.channel_mapping`       |
| `integrationOAuthSession`   | `public.mail0_integration_oauth_session`   | `integration.oauth_session`         |
| `remoteEmail`               | `public.mail0_remote_email`                | `integration.remote_email`          |
| `submissionAttempt`         | `public.mail0_submission_attempt`          | `integration.send_attempt`          |

`remote_email` 是提供商远端标识到本地标准 Email 的映射；`send_attempt` 是通过
提供商 API 发件的运行记录。两者属于集成边界，但仍可通过跨 Schema 外键引用
`mail` 中的规范化对象。

后续 Gmail 插件产生的同步游标、租约、任务、推送订阅和 Webhook 事件也进入
`integration`，而不是为 Gmail 创建独立 Schema。

### `mail`

存放提供商无关的本地邮箱规范数据：

| TypeScript 导出     | 当前物理表                         | 目标物理表                 |
| ------------------- | ---------------------------------- | -------------------------- |
| `mailAccount`       | `public.mail0_mail_account`        | `mail.account`             |
| `mailIdentity`      | `public.mail0_mail_identity`       | `mail.identity`            |
| `blob`              | `public.mail0_blob`                | `mail.blob`                |
| `mailChange`        | `public.mail0_mail_change`         | `mail.change`              |
| `email`             | `public.mail0_email`               | `mail.email`               |
| `emailSearch`       | `public.mail0_email_search`        | `mail.email_search`        |
| `emailAddress`      | `public.mail0_email_address`       | `mail.email_address`       |
| `emailMailbox`      | `public.mail0_email_mailbox`       | `mail.email_mailbox`       |
| `emailTrashRestore` | `public.mail0_email_trash_restore` | `mail.email_trash_restore` |
| `emailKeyword`      | `public.mail0_email_keyword`       | `mail.email_keyword`       |
| `emailContent`      | `public.mail0_email_content`       | `mail.email_content`       |
| `emailPart`         | `public.mail0_email_part`          | `mail.email_part`          |
| `mailboxThread`     | `public.mail0_mailbox_thread`      | `mail.mailbox_thread`      |
| `mailbox`           | `public.mail0_mailbox`             | `mail.mailbox`             |
| `emailSubmission`   | `public.mail0_email_submission`    | `mail.submission`          |
| `submissionBlob`    | `public.mail0_submission_blob`     | `mail.submission_blob`     |
| `threadReference`   | `public.mail0_thread_reference`    | `mail.thread_reference`    |
| `thread`            | `public.mail0_thread`              | `mail.thread`              |

邮件原文和附件的对象内容继续由 Blob Store 保存，PostgreSQL 的 `mail.blob`
仅保存归属、校验、状态和对象键等结构化元数据。

## 数据关系

Schema 化不改变现有租户边界、级联策略、唯一约束和复合外键：

- `mail.account.user_id` 引用 `auth.user_account.id`；
- `mail.account.connection_id` 引用 `integration.connection.id`；
- `integration.connection.user_id` 引用 `auth.user_account.id`；
- `integration.remote_email` 引用 `mail.account` 与 `mail.email`；
- `integration.send_attempt` 引用 `mail.account` 与 `mail.submission`；
- `app` 中的用户数据引用 `auth.user_account`；
- `app.writing_style_matrix` 引用 `integration.connection`。

所有邮箱账户隔离外键和复合唯一键继续保留，不能因为表移动到 Schema 而退化为
仅由应用代码保证的数据约束。

## Drizzle 模型

数据库模型使用 `pgSchema` 显式声明目标 Schema，不依赖运行时 `search_path`：

```ts
export const authSchema = pgSchema('auth');
export const appSchema = pgSchema('app');
export const integrationSchema = pgSchema('integration');
export const mailSchema = pgSchema('mail');
```

现有 `createTable` 和 `createMailTable` 的 `mail0_` 前缀工厂被移除。表的
TypeScript 导出名与字段名保持稳定，Repository 和上层服务只因 Drizzle 表对象的
物理限定名变化而更新，不改变领域接口。

`drizzle.config.ts` 不再使用只匹配 `mail0_*` 的 `tablesFilter`。配置应覆盖上述
四个业务 Schema，使 `db:generate`、`db:migrate`、`db:push` 和 Studio 看到一致
的数据库模型。

## 开发期基线迁移

当前 Zero 尚处于开发阶段，所有开发数据库都允许清空重建，不要求保留其中已有
数据。因此本次不在 `0047` 后追加 Schema 转换 SQL，而是将现有迁移时间线压缩为
唯一一份基线迁移：

1. 删除现有历史 SQL、迁移日志和历史快照；
2. 以调整后的 Drizzle 声明式模型作为唯一结构来源；
3. 生成新的 `0000` 基线迁移和对应快照；
4. 基线直接创建 `auth`、`app`、`integration`、`mail` Schema；
5. 基线直接创建移除 `mail0_` 后的目标表名；
6. 表字段、类型、默认值、约束、索引和外键定义与当前模型保持结构等价；
7. 基线不执行旧表移动、旧表重命名或业务数据复制。

从该基线建立以后，后续数据库结构开发才新增版本化增量 SQL，不再重写基线。首个
需要保存数据的共享、测试、预发布或生产环境建立后，必须冻结已经执行的迁移历史。

基线是数据库结构模板，不是业务数据模板。示例数据、测试数据和开发种子数据必须
使用独立 seed 机制管理，不能写入结构迁移。

## `db:push` 与初始化

全新空数据库执行 `pnpm db:push` 时，Drizzle 直接创建四个 Schema 和无前缀表，
不会先创建 `public.mail0_*` 再迁移。

当前已有开发数据库必须清空重建。空库可以选择：

- `pnpm db:push`：由声明式模型快速初始化本地开发库；
- `pnpm db:migrate`：执行唯一基线迁移初始化空库。

两条路径产生的业务 Schema、表、字段、约束、索引和外键必须等价。

## 测试设计

### Schema 定义测试

测试 Drizzle 元数据中的每个表：

- Schema 与本设计映射一致；
- 物理表名不以 `mail0_` 开头；
- 所有现有表都被纳入映射；
- 跨 Schema 外键仍存在。

该测试先替换现有“所有邮件表必须有 `mail0_` 前缀”的断言，并在生产模型修改前
产生预期失败。

### 集成测试数据库隔离

当前邮件集成测试通过临时 Schema 和 `search_path` 重定向 `public` 表。显式
Schema 后该方式不再有效。

测试助手改为创建名称满足严格安全正则的临时 Database，在该 Database 中使用标准
`auth`、`app`、`integration`、`mail` Schema，执行完整迁移，测试结束后关闭连接
并删除临时 Database。失败清理继续独立执行，不能因为前一个清理动作失败而泄漏
后续资源。

### 基线一致性测试

基线测试必须：

1. 在一次性空 Database 中执行唯一基线迁移；
2. 断言四个业务 Schema 和全部目标表存在；
3. 断言 `public` 中没有 Zero 业务表；
4. 断言数据库中的字段、类型、空值、默认值、约束、索引和外键与 Drizzle 模型
   一致；
5. 断言跨 Schema 外键可以阻止非法引用；
6. 验证同一声明式模型可以通过 `db:push` 初始化另一空 Database；
7. 对比 `db:migrate` 与 `db:push` 的结果，忽略数据库自动生成的内部名称后必须
   结构等价。

### 回归验证

至少执行：

```text
pnpm --dir apps/server test:mail-core
pnpm --filter=@zero/mail-core test
pnpm --dir apps/server lint
pnpm db:generate
pnpm db:push
pnpm db:migrate
```

`db:generate` 在目标模型和最新快照一致时不得继续产生未预期的结构漂移。`db:push`
应在一次性空数据库上验证，不能覆盖用户当前数据库。

## 权限与部署

Schema 归属与运行时权限是部署层责任：

- 迁移角色拥有 DDL 权限；
- 应用运行角色只获得所需 Schema 的 `USAGE` 与表级 DML 权限；
- 生产环境审查 `public` 的 `CREATE` 权限；
- 应用查询使用 Drizzle 生成的显式 Schema 限定名，不把可写 Schema 放入不受控的
  `search_path`。

本次迁移不擅自修改现有部署角色或撤销权限，避免破坏当前本地开发和既有部署。

## 验收标准

- 四个 Schema 归属与本设计一致；
- 当前业务表全部移除 `mail0_` 物理前缀；
- `public` 不再承载 Zero 业务表；
- 新基线相对于当前模型的字段、类型、默认值、约束、索引和外键语义完全一致；
- 空数据库可以通过 `db:push` 初始化；
- 空数据库可以通过唯一基线迁移初始化；
- `db:push` 与基线迁移产生结构等价的数据库；
- 旧迁移时间线、日志和历史快照不再保留；
- 本地邮箱内核全部自动化测试通过；
- Server 类型检查、Lint 与构建不因 Schema 调整失败；
- Gmail 入栈同步尚未开始，且后续集成表有明确归属位置。
