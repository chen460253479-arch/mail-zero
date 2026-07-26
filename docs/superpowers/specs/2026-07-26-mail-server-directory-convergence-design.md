# Zero 邮件服务端目录收敛设计

日期：2026-07-26

## 1. 结论

Zero 邮件服务端采用一套正式邮件体系：

```text
Zero 管理的 Google OAuth ─┐
                         ├─→ 统一凭证解析
Nango 托管的 Gmail 授权 ──┘
                                │
                                ▼
                         Gmail 渠道插件
                      ┌─────────┴─────────┐
                      ▼                   ▼
                 Inbox 入站同步      Gmail API 发件
                      │                   │
                      ▼                   ▼
                 统一 Mail Core     EmailSubmission
                      │                   │
                      └─────────┬─────────┘
                                ▼
                    PostgreSQL 本地邮箱数据
```

`zero_oauth` 与 `nango` 只是两种凭证来源，不形成两套 Gmail 实现。Gmail 收件和发件都通过同一个渠道插件，邮件、线程、邮箱、标签、关键字、草稿、删除状态、附件、搜索和变更记录均以本地 Mail Core 为事实源。

本次先完成新版本服务端的目录和依赖边界调整，不切换现有前端，不改变数据库表结构，不实现 Gmail 发件。现有 Zero 远程邮件代码暂时保留原位置，只用于维持当前前端；新架构禁止依赖它。Gmail 新发送链路完成后，再在前端 API 切换阶段替换现有接口内部实现，并彻底删除旧代码和旧运行资源。

## 2. 范围

本次目录收敛只覆盖邮件平台相关代码：

- 本地 Mail Core 的服务端适配；
- 邮箱账号、连接和授权生命周期；
- Zero OAuth、Nango 和统一凭证解析；
- 邮件渠道插件契约、注册表和 Gmail 插件；
- Provider 无关的入站同步；
- 与上述模块直接相关的 HTTP、tRPC 和运行时装配；
- 相关自动化测试和架构边界检查。

本次不调整 AI、Notes、Templates、通用聊天、写作风格和其他无关业务。若这些模块仍调用旧邮件接口，本阶段保持调用方式不变，直到前端 API 切换阶段统一迁移。

## 3. 参考项目采用的机制

目录设计学习参考项目已验证的职责分离方式，但转换为适合 Zero 的 TypeScript、PostgreSQL、Cloudflare 和进程内插件架构。

### 3.1 Stalwart

Stalwart 将邮件领域、JMAP、SMTP、存储和服务运行时拆成独立 crate，并进一步分离 Email Submission、SMTP outbound queue 和存储后端。Zero 对应采用：

- `modules/mail` 表达本地邮件领域的服务端适配；
- `modules/mail-sync` 表达入站同步编排；
- 未来 `modules/mail-outbound` 表达 Submission 之后的持久投递；
- `mail-channel` 表达外部服务商协议和 API 适配；
- `integrations` 表达 Nango 等外部基础设施。

### 3.2 EmailEngine

EmailEngine 将基础邮件客户端、Gmail/Outlook/IMAP 客户端、OAuth、提交 Worker 和其他 Worker 分离。Zero 不复制其 Redis 中心架构，但学习以下机制：

- Provider 客户端放在各自渠道目录；
- OAuth 与邮件 API 操作分离；
- 通用编排不判断具体 Provider；
- 发件请求和实际投递 Worker 分离。

### 3.3 sync-engine

sync-engine 将数据模型、mailsync、sendmail、actions 和 API 分离。Zero 对应确保：

- 本地模型不依赖 Gmail；
- 入站同步和发送是两个独立应用模块；
- API 只负责鉴权、参数转换和调用应用服务；
- 服务商事件先规范化，再进入本地模型。

### 3.4 Postal

Postal 将发送业务、sender、后台任务和持久化状态分离。Zero 后续发送阶段采用 PostgreSQL 作为投递事实源，Cloudflare Queue 只承担唤醒作用，不把队列消息当作权威状态。

## 4. 目标目录

```text
apps/server/src/
├── modules/
│   ├── mail/
│   │   ├── blob/
│   │   ├── postgres/
│   │   ├── search/
│   │   └── runtime/
│   ├── mail-accounts/
│   │   ├── application/
│   │   ├── credentials/
│   │   ├── postgres/
│   │   └── runtime/
│   └── mail-sync/
│       ├── application/
│       ├── domain/
│       ├── postgres/
│       └── runtime/
├── mail-channel/
│   ├── contracts/
│   ├── registry/
│   └── gmail/
│       ├── plugin.ts
│       ├── shared/
│       ├── auth/
│       └── inbound/
├── integrations/
│   ├── core/
│   └── nango/
├── infrastructure/
│   └── security/
├── runtime/
│   └── mail/
├── routes/
├── trpc/
├── db/
└── lib/
```

未来发送阶段增加：

```text
apps/server/src/
├── modules/mail-outbound/
│   ├── application/
│   ├── domain/
│   ├── postgres/
│   └── runtime/
└── mail-channel/gmail/outbound/
```

本次不创建空的 `mail-outbound` 或 `gmail/outbound` 目录。

## 5. 各模块职责

### 5.1 `modules/mail`

负责将 `@zero/mail-core` 接入服务器运行环境：

- PostgreSQL Unit of Work 和 Repository；
- R2、内存 Blob Store；
- PostgreSQL 搜索；
- Mail Core 运行时装配；
- HTML 清理等通过接口注入的基础实现。

它不得导入 `mail-channel`、Nango、Gmail、连接路由或同步编排。

### 5.2 `modules/mail-accounts`

负责邮箱账号与授权生命周期：

- Connection 和 AuthorizationBinding 的查询与持久化；
- 邮箱身份验证；
- Zero OAuth 和 Nango 绑定；
- 统一凭证解析、缓存、刷新、失效和重试；
- 断开、重新授权和连接状态变更；
- 为渠道运行时提供经过验证的凭证和邮箱身份。

Nango 绑定邮箱属于本模块的应用用例，而不是 Nango 客户端或 Gmail 插件的职责。

### 5.3 `modules/mail-sync`

负责 Provider 无关的入站同步：

- 激活、信号接收、增量发现、待处理邮件导入；
- checkpoint、租约、重试、attempt 和订阅续期；
- 调用 `MailIngressAdapter`；
- 调用 Mail Core 导入规范化邮件。

其 domain 和 application 层不得出现 Gmail History、Outlook Delta、IMAP UID 或具体 Provider 分支。

### 5.4 `mail-channel`

负责邮件服务商插件体系：

- 通用插件、身份、凭证、入站能力和错误契约；
- 插件注册与能力查找；
- Gmail、Outlook、Zoho Mail、IMAP/SMTP 等独立插件目录；
- Provider API 数据到 Zero 通用数据的转换；
- Provider 错误到 Zero 错误的分类。

插件不得直接访问 PostgreSQL、Cloudflare Queue、HTTP 路由或 tRPC。

### 5.5 `integrations`

负责外部集成平台和系统级集成配置：

- `core` 保存系统集成配置 Schema、Repository 和管理员权限；
- `nango` 保存 Nango HTTP 客户端、响应 Schema、错误、配置服务和运行时。

Nango 不属于邮件渠道。`integrations/nango` 不得导入 Gmail 插件或邮箱账号应用用例。

### 5.6 `infrastructure`

保存没有邮件业务含义、但属于服务端基础设施的实现。本次只迁移带认证加密能力：

- 加密和解密凭证快照；
- 密钥格式验证；
- 安全错误处理。

### 5.7 `routes` 和 `trpc`

只负责：

- 请求鉴权和管理员权限；
- 输入解析；
- 调用 application/runtime；
- 将领域错误映射成 HTTP 或 tRPC 错误；
- 输出安全 DTO。

它们不得直接创建 Gmail API 或 Nango 客户端，不得直接解析和刷新凭证。

### 5.8 `runtime/mail`

负责跨模块组合：

- 打开和关闭数据库连接；
- 将 mail-accounts 凭证解析器、MailChannelRegistry、mail-sync 和 Mail Core 连接起来；
- 处理 Cloudflare Queue、scheduled handler 和其他运行时触发；
- 注入环境变量、时钟、ID Factory、Blob Store 和日志。

跨模块组合不能放入 Gmail 插件或 mail-sync domain/application。该目录可以依赖各正式模块，但不得包含邮件领域规则或 Provider 数据映射。

## 6. 新版本文件迁移

### 6.1 邮件渠道

现有 `src/lib/mail-channel` 中属于新入站实现的文件迁移到顶层：

```text
lib/mail-channel/gmail/gmail-api-client.ts
→ mail-channel/gmail/shared/api-client.ts

lib/mail-channel/gmail/errors.ts
→ mail-channel/gmail/shared/errors.ts

lib/mail-channel/gmail/driver-transport.ts
→ mail-channel/gmail/shared/api-transport.ts

lib/mail-channel/gmail/history-mapper.ts
→ mail-channel/gmail/inbound/history-mapper.ts

lib/mail-channel/gmail/ingress-adapter.ts
→ mail-channel/gmail/inbound/adapter.ts

lib/mail-channel/gmail/handle-push.ts
→ mail-channel/gmail/inbound/handle-push.ts

lib/mail-channel/gmail/pubsub-policy.ts
→ mail-channel/gmail/inbound/pubsub-policy.ts

lib/mail-channel/gmail/ingress-runtime.ts
→ runtime/mail/gmail-inbound.ts
```

现有 `channel.ts` 按共享 API 客户端工厂、入站适配器工厂和插件装配职责拆分。顶层 `plugin.ts` 只声明 Gmail 元数据和已实现能力，不包含 PostgreSQL 或 Queue 运行时。

### 6.2 邮箱账号和凭证

```text
lib/connection-lifecycle.ts
→ modules/mail-accounts/application/

lib/credentials/resolve.ts
→ modules/mail-accounts/credentials/resolve.ts

lib/credentials/zero-oauth.ts
→ modules/mail-accounts/credentials/zero-oauth.ts

lib/credentials/nango.ts
→ modules/mail-accounts/credentials/nango.ts

lib/credentials/retrying-client.ts
→ modules/mail-accounts/credentials/retry.ts

lib/nango/bind.ts
→ modules/mail-accounts/application/bind-nango-mailbox.ts

lib/nango/channel-catalog.ts
→ modules/mail-accounts/application/list-nango-channels.ts
```

数据库相关实现从业务用例中拆到 `modules/mail-accounts/postgres`，运行环境装配进入 `modules/mail-accounts/runtime`。

### 6.3 Nango 和系统集成

```text
lib/nango/client.ts
→ integrations/nango/client.ts

lib/nango/types.ts
→ integrations/nango/schemas.ts

lib/integrations/repository.ts
→ integrations/core/repository.ts

lib/integrations/schemas.ts
→ integrations/core/schemas.ts

lib/integrations/permissions.ts
→ integrations/core/permissions.ts

lib/integrations/nango-service.ts
→ 拆分到 integrations/nango/service.ts
  和 modules/mail-accounts/application/
```

`NangoIntegrationService` 中通用配置、校验和权限检查保留在 `integrations/nango`；Gmail 渠道筛选和邮箱映射进入邮箱账号应用层，不允许 Nango 通用服务导入 Gmail 元数据。

### 6.4 Gmail OAuth

Google OAuth HTTP 协议实现进入 Gmail 插件：

```text
lib/integrations/google-gmail-oauth.ts
→ mail-channel/gmail/auth/google-oauth-gateway.ts
```

系统配置读取进入 `integrations/core` 与 Gmail auth 的运行时装配；连接邮箱、验证回调、保存授权绑定等应用用例进入 `modules/mail-accounts/application`。OAuth 网关本身不访问数据库。

### 6.5 凭证加密

```text
lib/credentials/encryption.ts
→ infrastructure/security/credential-encryption.ts
```

所有调用方通过新路径引用，不保留第二份实现。

## 7. 旧版本临时保留规则

以下代码本阶段暂时保留原位置：

- `lib/driver`；
- `lib/factories`；
- `pipelines.ts`；
- `workflows/sync-threads-*`；
- 旧 Durable Object 邮件分片访问；
- 旧 Gmail KV 同步和处理状态；
- 当前前端仍调用的旧 tRPC 邮件实现。

约束：

1. 不将这些文件迁入正式新目录；
2. 不创建 `compat` 作为长期模块；
3. 不在旧代码中增加新业务能力；
4. 新目录不得导入这些旧文件；
5. 旧代码可以继续维持当前前端，但不能作为新 Gmail 入站或未来发送的依赖；
6. 阶段三完成前，旧代码只接受保障现有行为所需的最小修复；
7. 阶段三完成后必须删除代码、Cloudflare binding、KV、DO、队列和配置中的对应资源。

开发过程允许短暂共存，但阶段性共存不是目标架构。

## 8. 新 Gmail 入站运行时收敛

当前 Gmail 入站运行时通过 `server-utils.ts → connectionToDriver → GoogleMailManager` 获取 API executor，这违反新架构不得依赖旧 Driver 的规则。

重构后：

1. `modules/mail-sync/runtime` 根据 `MailChannelRegistry` 查找已注册插件；
2. `modules/mail-accounts` 根据 AuthorizationBinding 解析 `ResolvedCredential`；
3. Gmail 插件使用 `ResolvedCredential` 创建 Gmail API transport；
4. Gmail inbound adapter 负责 History、message raw 和 Watch；
5. `modules/mail-sync` 负责 PostgreSQL 状态、Queue 唤醒和 Mail Core 导入；
6. 不再存在 `if (provider !== 'gmail')` 的运行时硬编码路由；
7. 不再调用旧 `connectionToDriver` 或 `GoogleMailManager`。

Zero OAuth 与 Nango 都输出同一个 `ResolvedCredential`，因此不会产生两套 Gmail 入站实现。

## 9. 依赖规则

允许的主要依赖：

```text
routes/trpc/runtime
    → modules/*
    → integrations/*
    → mail-channel registry

modules/mail-accounts
    → mail-channel contracts/registry
    → integrations/*
    → infrastructure/security

modules/mail-sync
    → mail-channel contracts
    → modules/mail

mail-channel/gmail
    → mail-channel contracts

integrations/nango
    → integrations/core
    → infrastructure/security

modules/mail
    → @zero/mail-core
```

禁止：

- `@zero/mail-core → apps/server`；
- `modules/mail → mail-channel|integrations|mail-sync`；
- `mail-channel → db|routes|trpc|Cloudflare Queue`；
- `integrations/nango → mail-channel/gmail`；
- `modules/mail-sync/domain|application → mail-channel/gmail`；
- `mail-channel/gmail → runtime/mail`；
- 任意新目录导入旧 Driver、旧 Pipeline、旧 Workflow 或旧 DO 邮件存储。

通过静态架构测试扫描 import specifier，防止后续重新产生跨层依赖。

## 10. 错误处理

- Provider API 错误由 Gmail 插件分类，不把 Google SDK 错误传播到通用模块；
- 凭证失效由 `modules/mail-accounts` 标记 `reconnect_required`；
- Nango 客户端错误由 `integrations/nango` 映射为 Nango 领域错误；
- mail-sync 只处理统一的 rate limit、临时错误、授权错误、checkpoint 过期和远程邮件不存在；
- routes/tRPC 将应用错误映射为稳定的客户端错误码；
- 日志不得包含 access token、refresh token、Nango secret、原始 MIME 或完整邮件正文。

目录迁移不得改变现有错误语义。

## 11. 测试策略

### 11.1 搬迁回归

每组文件迁移后运行对应测试，确保只有 import 路径和职责拆分发生变化。

### 11.2 架构边界测试

增加静态测试验证：

- 新目录不存在对 `lib/driver`、`lib/factories`、`pipelines`、旧 workflows 和 `server-utils` 的引用；
- `mail-channel` 不导入 DB、routes、tRPC 和 Queue；
- mail-sync domain/application 不导入 Gmail；
- integrations/nango 不导入 Gmail；
- routes/tRPC 不直接导入 Nango client 或 Gmail SDK；
- 不存在同名新旧 Nango、credentials、integrations 实现的重复入口。

### 11.3 功能回归

- Mail Core 全量测试；
- mail-accounts 凭证、绑定和生命周期测试；
- Nango 客户端、配置与安全响应测试；
- Gmail OAuth 测试；
- Gmail 入站适配和运行时测试；
- mail-sync 全量测试；
- PostgreSQL 集成测试；
- server 类型检查和构建；
- 现有前端 API 回归测试。

## 12. 实施顺序

1. 建立架构边界测试和目标目录；
2. 迁移 `infrastructure/security`；
3. 迁移并拆分 `integrations/core` 与 `integrations/nango`；
4. 建立 `modules/mail-accounts`，迁移授权、凭证、绑定和生命周期；
5. 建立顶层 `mail-channel` 契约与注册表；
6. 重构 Gmail 插件为 `shared/auth/inbound`；
7. 在 `runtime/mail` 中通过插件注册表和统一凭证解析装配 mail-sync 入站运行时；
8. 更新 routes、tRPC 和 runtime 的新模块引用；
9. 确认旧前端链路仍能运行，但新模块对旧体系零依赖；
10. 删除已经完全迁移且不再使用的 `lib/nango`、`lib/credentials` 和 `lib/integrations` 新版代码入口；
11. 运行架构扫描、全量测试、类型检查和构建；
12. 审查是否具备 Gmail 新发送链路的开发前提。

## 13. 后续阶段

### 13.1 Gmail 发送

新增 Provider 无关的 `modules/mail-outbound`，实现：

```text
MailCore EmailSubmission
→ PostgreSQL authoritative spool
→ Cloudflare Queue wake signal
→ MailChannelRegistry
→ Gmail outbound adapter
→ Gmail API
```

Zero OAuth 和 Nango 共用同一个 Gmail outbound adapter。

### 13.2 前端 API 切换与旧体系删除

逐个将邮件列表、详情、标签、文件夹、关键字、草稿、附件、搜索和发送接口切到本地 Mail Core。前端同步适配本地 ID 和分页模型。验收后删除旧 Driver、Pipeline、Workflow、DO 邮件存储、旧 KV 和相关 Cloudflare 配置。

## 14. 本阶段验收标准

- 目标正式目录已建立，文件职责符合本设计；
- `src/lib` 不再保存新版 Nango、系统集成、凭证和邮件渠道业务模块；
- Gmail 插件具备明确的 `shared/auth/inbound` 层级；
- mail-accounts 统一处理 Zero OAuth 和 Nango 凭证；
- Gmail 入站不依赖旧 Driver、旧 server-utils 或旧同步链路；
- mail-sync 通用层不包含 Gmail 分支；
- 新目录对旧体系零依赖；
- 旧前端仍能保持当前行为；
- 数据库 Schema 和表结构没有变化；
- 自动化测试、类型检查和构建全部通过；
- 没有空目录、占位模块、重复实现或循环依赖；
- 具备在新架构中增加 `mail-outbound` 和 Gmail outbound adapter 的条件。
