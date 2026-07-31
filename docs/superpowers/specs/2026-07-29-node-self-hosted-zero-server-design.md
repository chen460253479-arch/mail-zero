# 纯 Node.js 自托管 Zero Server 设计

## 1. 背景

Zero 当前已经完成前端静态运行和 Server 预构建运行：

- `zero-mail-runtime` 使用 Nginx 提供独立的前端静态资源；
- `zero-server-runtime` 使用预构建 Worker Bundle，运行时不再热编译 TypeScript；
- IMAP/SMTP 协议操作仍由独立的 `protocol-worker` 容器执行；
- Server 仍通过 Wrangler/workerd 运行，并依赖 Hyperdrive、Cloudflare Queue、Cron、R2、Durable Object 和 `ExecutionContext.waitUntil()`。

上一阶段保留 Wrangler 是为了先移除热编译，降低一次性迁移风险。本阶段的目标是完成下一步切换：彻底移除 Wrangler/workerd 和 Cloudflare Bindings，将 Server 改造成完全自托管的纯 Node.js 后端。

## 2. 目标

完成后，Zero 的部署边界为：

```text
zero-mail
└─ 独立前端静态镜像

zero-server
├─ 原生 Node.js HTTP Server
├─ 认证、tRPC 和本地邮箱 API
├─ Gmail、Outlook、Zoho 和 IMAP/SMTP 渠道插件
├─ Gmail、Outlook 和 Zoho Webhook
├─ PostgreSQL 持久化邮件任务队列
├─ 邮件同步、投递和 Snooze 调度器
├─ 入站和投递 Worker
└─ 进程内 IMAP/SMTP 协议执行器

postgres
valkey
upstash-proxy
```

约束如下：

- 前端和后端保持两个独立应用镜像，不创建包含前端资源的 `zero-runtime` 聚合镜像；
- 后端只有一个 `zero-server` 镜像和一个默认 `zero-server` 容器；
- 后端运行时不包含 Wrangler、workerd 或 Cloudflare Binding；
- 不再创建独立的 Protocol Worker 镜像、服务或容器；
- 邮件任务、邮件数据和附件在容器重启后不得丢失；
- 继续保持 Mail Core、渠道插件、同步、投递、存储和 API 之间的代码边界；
- 为以后使用同一个 `zero-server` 镜像按角色扩容保留能力，但本阶段默认只部署一个后端容器。

## 3. 参考项目机制

本设计综合采用参考项目中已经验证的机制，而不是直接复制某个项目的部署形态：

- **Stalwart**：一个后端运行单元内部组合协议、调度、队列和存储服务；业务元数据与 Blob 存储分离；
- **EmailEngine**：统一后端内部划分 API、同步和投递职责，通过持久化队列进行工作分发；
- **Postal**：投递状态由持久化数据维护，Worker 领取工作后执行，镜像与职责分离不是同一个概念；
- **Nylas sync-engine**：调度和同步执行职责分离，并通过租约防止多个执行器同时处理同一个邮箱。

Zero 采用“单后端进程、内部职责分层、PostgreSQL 持久化任务、租约控制并发”的实现，适合当前 TypeScript、PostgreSQL 和插件架构。

## 4. 当前 Cloudflare 能力及替代关系

| 当前能力             | 实际职责                       | Node.js 替代                          |
| -------------------- | ------------------------------ | ------------------------------------- |
| Worker `fetch`       | Hono HTTP、认证、tRPC、Webhook | `@hono/node-server`                   |
| Hyperdrive           | PostgreSQL 连接字符串          | 共享 PostgreSQL 连接池                |
| Cloudflare Queue     | 收件同步和投递命令             | PostgreSQL 持久化邮件任务             |
| Cloudflare Cron      | 扫描到期同步、投递和 Snooze    | 进程内调度器                          |
| R2                   | 邮件正文和附件 Blob            | 本地文件 `BlobStore` 和 Docker 数据卷 |
| Durable Object       | 包装用户维度 PostgreSQL 查询   | 普通 Repository/Application Service   |
| `waitUntil()`        | Nango 初始化和后台更新         | 启动生命周期和显式异步处理            |
| Protocol Worker HTTP | IMAP/SMTP 跨容器调用           | 进程内 TypeScript 接口调用            |

Durable Object 当前不保存 Durable Object Storage 数据，只是把 PostgreSQL 查询包装成 RPC，因此删除该包装层不需要迁移业务数据。

## 5. Node.js Server 结构

### 5.1 启动入口

新增原生 Node.js 入口，按以下顺序启动：

1. 读取并校验 `process.env`；
2. 创建共享 PostgreSQL 连接和 Drizzle 实例；
3. 初始化本地 Blob 存储目录并验证可读写；
4. 创建 Mail Core、渠道注册表、任务仓储和应用服务；
5. 执行 Nango 环境验证并记录可用状态；
6. 启动邮件任务 Worker；
7. 启动到期工作调度器；
8. 使用 `@hono/node-server` 启动 Hono HTTP 服务。

启动过程中数据库、Blob 根目录或必要安全配置不可用时，进程立即以非零状态退出。Nango 不可用不阻止本地邮箱 API 启动，但必须记录错误并向前端暴露“不可用”状态。

### 5.2 依赖注入

Cloudflare 的 `c.env` 和全局 `cloudflare:workers` 环境对象改为显式的运行时依赖：

```text
RuntimeConfig
RuntimeServices
├─ database
├─ blobStore
├─ taskQueue
├─ mailCore
├─ channelRegistry
├─ ingressRuntime
├─ outboundRuntime
└─ integrationHealth
```

HTTP 路由、tRPC、Webhook、调度器和 Worker 使用同一组服务实例。业务模块不得直接读取 Cloudflare Binding，也不得在每次操作中重新创建数据库连接池。

### 5.3 进程模型

默认只运行一个 Node.js 进程。HTTP、调度器和邮件 Worker 是同一进程内的独立生命周期组件。

IMAP、SMTP 和服务商 API 调用属于异步网络 I/O，通过有上限的并发执行器处理，不建立独立进程或镜像。当前不使用 Worker Threads；只有以后确认 MIME 解析、索引或加密成为 CPU 瓶颈时，才针对 CPU 工作单独引入线程池。

## 6. PostgreSQL 生命周期

当前代码多处为每次操作调用 `postgres(url)` 并在操作结束时关闭连接。Node.js 常驻进程应改为：

- 启动时创建一个共享 `postgres` 连接池；
- 通过该连接池创建共享 Drizzle 实例；
- Repository 和应用服务通过依赖注入使用共享数据库；
- 为连接数、连接超时和空闲超时设置保守默认值；
- `SIGTERM`/`SIGINT` 关闭过程中，在 Worker 停止领取新任务后统一关闭连接池。

所有 `HYPERDRIVE.connectionString` 调用改为共享数据库依赖。数据库地址只从 `DATABASE_URL` 读取。

## 7. PostgreSQL 持久化邮件任务

### 7.1 选择

Cloudflare Queue 不使用进程内数组替代。进程内数组在容器重启、进程崩溃或部署替换时会丢失尚未执行的同步和投递任务。

本设计在 `mail` Schema 中增加持久化任务表，并使用 PostgreSQL 作为任务事实来源。Valkey 仍保留现有缓存和限流职责，不在本阶段引入 BullMQ。

### 7.2 数据结构

任务至少包含：

- `id`
- `queue`：`ingress` 或 `outbound`
- `type`
- `payload`
- `dedupe_key`
- `status`：`ready`、`running`、`retry`、`dead`
- `run_at`
- `attempts`
- `max_attempts`
- `lease_owner`
- `lease_expires_at`
- `last_error_code`
- `last_error_message`
- `created_at`
- `updated_at`
- `completed_at`

索引必须支持：

- 按队列、状态和 `run_at` 领取到期任务；
- 按租约过期时间恢复失效任务；
- 防止同一业务工作存在多个有效任务；
- 查询终止任务用于诊断和清理。

开发阶段仍使用唯一数据库初始化模板。新增任务表写入当前模板，由 `db:push` 清空非系统 Schema 后重新初始化，不创建面向历史开发数据库的时间线增量迁移。

### 7.3 领取与执行

Worker 使用 `FOR UPDATE SKIP LOCKED` 批量领取任务：

1. 选择已经到期且未被有效租约占用的任务；
2. 原子更新为 `running` 并写入租约所有者和到期时间；
3. 在事务提交后执行任务；
4. 成功后完成或清理任务；
5. 可重试错误按退避策略写回 `retry` 和下一次执行时间；
6. 永久错误或超过最大尝试次数后进入 `dead`；
7. 容器异常终止后，由后续扫描恢复租约已过期的任务。

同步和投递现有的领域错误分类继续决定永久失败或重试，不重新建立第二套错误语义。

### 7.4 去重和业务状态

持久化任务只负责“某项工作需要执行”，不能替代现有业务状态：

- 入站同步状态仍由 `inbound_sync` 和 `inbound_sync_item` 管理；
- 发件状态仍由 EmailSubmission 和 Delivery Spool 管理；
- Snooze 状态仍由当前 Snooze 表管理；
- 任务使用业务标识生成稳定的去重键；
- 调度器允许重复扫描，但不能产生重复的有效任务；
- 现有领域租约继续阻止同一邮箱、同步项或投递被并发处理。

### 7.5 Worker 并发

Worker 使用有上限的异步并发：

- ingress 和 outbound 分别限制并发；
- 同一账户仍受现有同步租约保护；
- SMTP 不确定结果继续进入 reconciliation，不得直接重发；
- 停机后不再领取新任务，正在执行的任务在宽限期内完成；
- 超过宽限期的任务依靠租约过期恢复。

## 8. 调度器

Node.js 调度器以短周期运行，只负责扫描和持久化到期任务：

- 到期的增量同步；
- Gmail、Outlook 和 Zoho 订阅续期；
- 等待导入的同步项目；
- 到期的 EmailSubmission/Delivery；
- 过期投递租约恢复；
- 不确定投递 reconciliation；
- 到期 Snooze；
- 终止任务和临时 Blob 的保留期清理。

调度器不得直接执行长时间的 IMAP、SMTP 或服务商 API 操作。重复调度通过任务去重键和现有领域租约处理，因此以后运行多个 `zero-server` 实例时不会重复产生业务副作用。

## 9. 本地 Blob 存储

### 9.1 默认存储

新增 `LocalBlobStore` 实现现有 `@zero/mail-core` `BlobStore` 接口，默认根目录为：

```text
/var/lib/zero/mail-blobs
```

对象键继续使用现有内容寻址结构：

```text
mail/{accountId}/sha256/{sha256前两位}/{sha256}
mail/{accountId}/temporary/{temporaryId}
```

Compose 为该目录挂载独立命名卷。数据库继续保存 Blob 元数据和对象键，不把完整邮件正文或附件以 `bytea` 形式放入 PostgreSQL。

### 9.2 完整性和安全

`LocalBlobStore` 必须：

- 复用现有账户 ID、对象键和 SHA-256 校验；
- 拒绝目录穿越和不合法路径；
- 临时文件与正式对象处于同一文件系统；
- 使用临时文件、独占创建和原子重命名提交；
- 对同一哈希的重复提交保持幂等；
- 已存在对象内容不一致时返回完整性错误；
- 支持 Range 读取；
- 删除账户时只删除该账户对象前缀；
- 不在日志中输出邮件正文、附件内容或凭据。

### 9.3 后续扩展

`BlobStore` 接口保持不变，以后可以增加外部 S3 驱动。本阶段不新增内置对象存储容器，也不保留 R2 兼容层。

## 10. Durable Object 移除

`ZeroDB` 和 `DbRpcDO` 当前只执行 PostgreSQL 查询，不使用 Durable Object Storage。迁移方式为：

- 把用户、设置、快捷键、备注和邮件模板操作移动到普通 Repository/Application Service；
- `getZeroDB(userId)` 改为获取用户作用域服务；
- 所有用户所有权条件继续保留；
- 删除 `WorkerEntrypoint`、`DurableObject` 和 `RpcTarget`；
- 删除测试中的 `cloudflare:workers` Mock。

该迁移不改变表结构和 API 契约。

## 11. Protocol Worker 收敛

删除独立 Protocol Worker 的 HTTP 边界：

- 删除 `protocol-worker` Compose 服务；
- 删除 `/v1/verify`、`/v1/imap/*` 和 `/v1/smtp/send` 内部 HTTP Server；
- 删除 `MAIL_PROTOCOL_WORKER_URL`；
- 删除 `MAIL_PROTOCOL_WORKER_SECRET`；
- 删除 `MAIL_PROTOCOL_WORKER_PORT`；
- 删除内部 Bearer Token 和 JSON 往返；
- 删除 Protocol Worker 健康检查。

保留并迁移有价值的协议实现：

- IMAP 连接验证；
- SMTP 连接验证；
- IMAP 基线建立；
- 增量发现；
- 原始邮件获取；
- SMTP 发送；
- 主机允许列表；
- 请求超时、连接超时和错误分类。

这些能力移动到 IMAP/SMTP 渠道插件的 runtime 层，通过类型化接口直接调用。渠道插件仍只依赖统一协议端口，不直接依赖 HTTP 或 Docker 服务名。

## 12. HTTP、认证和 Webhook

Hono 路由、tRPC 契约、Better Auth 和现有 URL 保持不变。Node.js 入口通过 `@hono/node-server` 接管 Fetch API 请求。

保留以下公开接口：

- `/health`
- `/api/auth/*`
- `/api/trpc/*`
- Gmail Push Webhook
- Outlook Webhook
- Zoho Webhook
- OAuth 验证和连接回调
- 邮件 Blob 下载接口

Webhook 必须先把工作持久化，再返回成功响应。Nginx 仍负责公网 HTTPS 和反向代理，Zero 不在本阶段管理证书。

## 13. 运行生命周期

### 13.1 就绪状态

`/health` 只有在以下核心能力可用时返回健康：

- HTTP Server 已启动；
- PostgreSQL 可访问；
- Blob 根目录可读写；
- 调度器和任务 Worker 已启动。

Nango 不可用记录为集成状态，不使整个 Server 不健康。

### 13.2 优雅关闭

收到 `SIGTERM` 或 `SIGINT` 后：

1. 标记服务正在关闭；
2. 停止接受新 HTTP 请求；
3. 停止调度器；
4. 停止领取新任务；
5. 等待正在执行的任务完成，直到宽限期结束；
6. 关闭 IMAP/SMTP 连接和其他外部客户端；
7. 关闭 PostgreSQL 连接池；
8. 以正确退出码结束进程。

无法在宽限期内完成的任务由租约过期机制恢复。

## 14. Docker 构建与部署

### 14.1 Server 镜像

`docker/server/Dockerfile` 改为纯 Node.js 多阶段构建：

- Builder 安装锁文件指定的依赖；
- 使用现有构建工具生成 Node.js 22 ESM 产物；
- Runtime 只复制构建产物、必要生产依赖和启动入口；
- 不复制 `.env`；
- 不包含 Wrangler、workerd、源代码挂载或 TypeScript 运行时编译；
- 容器启动命令为 `node /app/dist/main.js`。

### 14.2 Compose

删除：

- `protocol-worker` 服务；
- `x-zero-development`；
- 开发依赖命名卷；
- `zero-wrangler-state`；
- Hyperdrive 本地连接变量；
- `ZERO_WRANGLER_ENV`；
- Protocol Worker URL、Secret 和端口；
- Protocol Worker `depends_on`。

新增：

- `zero-mail-blobs:/var/lib/zero/mail-blobs`；
- Server 健康检查；
- Server 优雅关闭宽限期。

`pnpm docker:deploy` 不再运行 `install-dependencies` 临时容器，只构建不可变镜像并启动服务。

## 15. Wrangler/workerd 完整删除

Server 删除：

- `apps/server/wrangler.jsonc`
- `apps/server/worker-configuration.d.ts`
- Server 的 `wrangler dev/deploy/types` 脚本
- Server 的 Wrangler 开发依赖
- `docker/server/write-runtime-env.mjs`
- Wrangler Server 入口和状态卷
- Cloudflare 类型、Binding 和相关测试断言

前端已经使用 Nginx 静态镜像，以下孤立部署入口也一并删除：

- `apps/mail/wrangler.jsonc`
- Mail 的 `wrangler dev/deploy/types` 脚本
- Mail 的 Wrangler 开发依赖

最后清理 Workspace catalog 和锁文件中的 Wrangler 孤立记录。仓库运行代码和部署配置中不再存在 Wrangler/workerd 路径。

## 16. 安全边界

- 所有 Secret 只在容器启动时从环境变量读取；
- 配置使用白名单 Schema 校验，未知或缺失的关键配置使启动失败；
- 不再生成包含 Secret 的 Wrangler dotenv 文件；
- Protocol 能力不再监听内部 HTTP 端口；
- Blob 路径只能由经过校验的对象键派生；
- PostgreSQL 任务错误只记录错误代码和必要摘要，不记录邮件正文和凭据；
- Webhook、认证和 CORS 的现有安全校验必须保持；
- Server Runtime 不包含构建工具和开发依赖。

## 17. 错误处理

- 配置、数据库和 Blob 初始化失败：启动失败；
- Nango 验证失败：记录不可用状态，Server 继续运行；
- 可重试邮件错误：任务进入退避重试；
- 永久邮件错误：任务进入终止状态，业务状态同步更新；
- SMTP 结果不确定：进入 reconciliation，不直接重复发送；
- Worker 循环异常：记录错误并继续下一轮，不静默停止；
- 数据库暂时不可用：健康检查失败，任务保留；
- Blob 完整性错误：拒绝导入或发送，不覆盖已有对象。

## 18. 测试与验收

### 18.1 架构测试

验证：

- 仓库运行代码中不存在 `cloudflare:workers`；
- Server 和 Mail manifest 中不存在 Wrangler；
- 不存在 `wrangler.jsonc`、Wrangler 状态卷和 Hyperdrive 环境变量；
- Compose 只有一个后端服务；
- 不存在 Protocol Worker 服务和内部 HTTP 配置；
- Server Docker Runtime 只执行 Node.js 构建产物；
- 前端和后端镜像继续独立。

### 18.2 任务测试

覆盖：

- 任务持久化和解析；
- `SKIP LOCKED` 并发领取；
- 去重；
- 成功完成；
- 永久失败；
- 退避重试；
- 租约过期恢复；
- ingress/outbound 公平性；
- 容器重启后的未完成任务恢复；
- SMTP 不确定状态不会直接重复投递。

### 18.3 Blob 测试

沿用现有 BlobStore 合同测试，并增加：

- 原子提交；
- 重复提交；
- 内容冲突；
- Range 读取；
- 临时文件清理；
- 账户边界；
- 路径穿越；
- 容器重启后的持久化。

### 18.4 运行验收

- 构建 `zero-mail-runtime` 和新的 `zero-server`；
- `docker compose up --detach --build` 后所有服务健康；
- 登录和 Session 正常；
- 本地邮箱 API 正常；
- Gmail、Outlook 和 Zoho Webhook 能持久化任务；
- Gmail/Outlook/Zoho 增量同步正常；
- IMAP 增量同步和 SMTP 发送正常；
- Draft → EmailSubmission → Spool → Sent 链路正常；
- Server 重启后未完成任务继续执行；
- 邮件 Blob 在 Server 容器替换后仍存在；
- 运行日志不包含 Wrangler、workerd、运行时编译或 Protocol Worker HTTP；
- `pnpm docker:deploy` 不再初始化开发依赖卷。

## 19. 分阶段迁移

虽然最终目标是彻底切换，但实施仍按可验证边界分阶段进行：

1. 建立 Node.js 配置、数据库生命周期和 HTTP 入口；
2. 引入 PostgreSQL 持久化任务及 Worker；
3. 将 Cloudflare Queue 和 Cron 切换到任务队列与调度器；
4. 引入 `LocalBlobStore` 并替换 R2；
5. 移除 Durable Object 和 `waitUntil()`；
6. 将 Protocol Worker 收敛为进程内渠道 runtime；
7. 切换 Docker Runtime 和 Compose；
8. 删除 Wrangler/workerd、Cloudflare 类型和全部孤立依赖；
9. 完成端到端验收和工作区卫生检查。

每一阶段必须先建立自动化合同测试，再切换生产调用点。不得保留新旧两套运行链路作为长期兼容层。

## 20. 非目标

本阶段不处理：

- 把前端资源合并进 Server；
- 改变现有前端 API 契约；
- 新增内置对象存储服务；
- 新增 BullMQ；
- 修改 Gmail、Outlook、Zoho 或 IMAP/SMTP 的业务能力边界；
- 增加完整历史邮件同步；
- 反向同步本地标签和文件夹到服务商；
- 为多节点部署引入 Kubernetes；
- 同时重构 Valkey/Upstash 限流链路。

这些事项必须在纯 Node.js Server 稳定验收后单独审查。
