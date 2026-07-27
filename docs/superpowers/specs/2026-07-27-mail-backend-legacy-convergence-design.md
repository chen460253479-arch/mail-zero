# Zero 后端旧邮件链路收敛与移除设计

日期：2026-07-27
状态：设计已确认，待书面审阅

## 1. 背景

Zero 已经具备以下正式邮件能力：

- `@zero/mail-core` 本地邮箱内核；
- PostgreSQL 本地 Email、Thread、Mailbox、Keyword、Draft、Identity 和 Change Log；
- Provider-neutral `mail-sync`；
- Gmail Inbox 增量发现与原始 MIME 导入；
- Provider-neutral `mail-outbound`；
- EmailSubmission、持久化投递 Spool、Gmail API 发件和 Draft 到 Sent 的本地最终确认；
- 统一的本地 Mail API；
- 已切换到本地 Mail API 的标准邮箱前端。

服务端仍保留 Zero 原项目的旧邮件运行时，包括旧 Driver、远端 Gmail 状态操作、
Durable Object、KV、Workflow、旧订阅队列，以及与 Agent、Chat、Brain 混合的邮件读取和
Gmail Watch 激活逻辑。继续长期保留两套体系会导致数据权威、运行资源、账户生命周期和
故障恢复边界不清晰。

本设计采用“分阶段硬切换”。每项职责在新链路满足验收条件后，立即切换调用方并删除旧
实现，不创建长期兼容层，不维护 Mail V1/Mail V2 双轨。

## 2. 已确认的产品边界

1. Zero 托管 Gmail 等外部邮件服务商账号。
2. 外部服务商只负责收件同步和发件投递。
3. Email、Thread、Mailbox、Keyword、Label、Folder、Draft、Sent、Trash、Archive、
   Junk、Snooze、搜索和变更记录均以本地 Mail Core 为事实来源。
4. 本地邮件操作不反向同步到 Gmail。
5. Gmail 首期只同步 Inbox。
6. Gmail 首期只做增量同步，不导入绑定前历史邮件。
7. Gmail 发件使用 Gmail API，不使用 Gmail Draft、Label 或远端 Mailbox API。
8. Gmail 支持必须实现为进程内 TypeScript MailChannel 插件，后续 Outlook、Zoho 和
   IMAP/SMTP 通过相同契约接入。
9. Zero OAuth 和 Nango 只是两种凭证来源，不形成两套 Gmail 收发实现。
10. 同一个 Gmail 邮箱地址在 Zero 全局最多只能有一个有效绑定。

## 3. 目标

1. 完整删除 Agent、Chat、Brain 及独立邮件 AI 撰写、主题生成和 AI 搜索能力。
2. 审查旧链路中的标准邮箱职责，只补齐新链路真实缺口。
3. 将 Gmail Watch 激活从 Brain 中剥离，纳入正式邮箱账户生命周期。
4. 将 Gmail Pub/Sub 调整为集成/GCP Project 级共享基础设施。
5. 解决 Pub/Sub、定时对账、手动触发和重试同时发生时的并发与信号丢失问题。
6. 完善绑定、激活、断开、重新授权、删除和数据清理生命周期。
7. 删除旧 Driver、Pipeline、Workflow、Durable Object、KV、Queue 和旧邮件 Router。
8. 使用架构约束和自动化测试防止旧职责重新进入正式邮件链路。

## 4. 非目标

1. 不扩展 Gmail 同步范围，仍只同步 Inbox。
2. 不增加绑定前历史邮件导入。
3. 不把本地标签、文件夹、已读、星标、归档和删除状态写回 Gmail。
4. 不实现 Outlook、Zoho 或 IMAP/SMTP 插件。
5. 不重新设计标准邮箱前端视觉。
6. 不删除 Notes、Templates、普通设置等独立非邮件业务。
7. 不把 ZeroDB 整体删除；只移除其旧邮件、Agent、Chat 和 Brain 职责。仍有非邮件调用
   的部分必须按其实际业务边界保留。
8. 不把参考项目的语言、Redis 中心架构、单进程运行方式或远端状态语义原样复制到 Zero。

## 5. 参考项目采用原则

遵循以下原则：

> 学习成熟项目已经验证的机制，转换成适合 Zero 的 TypeScript、PostgreSQL、
> Cloudflare Queue 和进程内插件架构。

### 5.1 Stalwart

采用：

- 本地 Email、Thread、Mailbox、Keyword 和 Change Log 是权威数据；
- Email 与 EmailSubmission 分离；
- Submission 与投递队列分离；
- 账户级删除和清理具有明确边界；
- Provider 通知基础设施不进入 Mail Core。

不采用：

- Stalwart 自身 SMTP/IMAP Server 的网络协议实现；
- 与外部 Gmail 账号同步无关的完整邮件服务器职责。

### 5.2 EmailEngine

采用：

- OAuth/PubSub Application 级共享 Topic 和 Subscription；
- 每个邮箱独立调用 `users.watch` 并保存 Watch 到期时间；
- 通知通过规范化 `emailAddress` 路由到本地账号；
- Pub/Sub、定时补偿、手动同步和重连检查进入同一个同步入口；
- 同账号同步互斥；
- 同步执行期间的新 History ID 被合并，当前同步完成后继续处理；
- Pub/Sub 资源存在检查、并发保护和资源所有权区分；
- Watch 定期续期，History 定期补偿。

转换：

- EmailEngine 使用单账号进程内 `processingHistory + pendingHistoryId`；
- Zero 使用 PostgreSQL 持久化工作版本、数据库租约和 Queue 唤醒，适配分布式 Worker；
- EmailEngine 使用 Pull Subscription；
- Zero 保留适合 Cloudflare Worker 的 Push Subscription。

### 5.3 sync-engine

采用：

- Provider-neutral Sync Monitor/Adapter 分层；
- 同一账号或同步范围只有一个有效同步执行者；
- 初始同步、IDLE、轮询和重试共用同步状态机；
- 同步可停止、重试和恢复。

不采用：

- Gmail All Mail 全量同步；
- 远端 Gmail Label 和 Thread ID 作为本地权威模型；
- 远端状态反向写入。

### 5.4 Postal

采用：

- PostgreSQL 持久化队列是真实状态；
- Queue 只负责唤醒；
- Worker 租约、过期接管、有限重试和 Attempt 审计；
- 临时错误、永久错误和不确定结果分离。

Postal 只作为 outbound 可靠性参考，不参与 Gmail inbound 或 Pub/Sub 设计。

## 6. 目标架构

```text
Mail API
  -> Mail Core
  -> Mail Accounts
  -> Mail Sync
  -> Mail Outbound
       |
       v
MailChannel Registry
  -> Gmail
       |- auth
       |- inbound
       |- outbound
       `- shared

Runtime Composition
  -> PostgreSQL
  -> R2 Blob
  -> Cloudflare Queue
  -> Gmail Pub/Sub Push Endpoint
```

固定事实来源：

| 数据 | 事实来源 |
| --- | --- |
| Email/Thread/Mailbox/Keyword/Draft/Sent | PostgreSQL Mail Core |
| Connection/AuthorizationBinding | PostgreSQL Mail Accounts |
| History Checkpoint/Watch/Sync Item | PostgreSQL Mail Sync |
| Submission/Delivery/Attempt | PostgreSQL Mail Core + Mail Outbound |
| Topic/Subscription | 部署级 Gmail 集成配置 |
| Queue 消息 | 非权威唤醒信号 |
| Gmail messageId/threadId | 外部映射 |

禁止出现：

- 新链路导入旧 Driver、Pipeline、Workflow 或旧 Durable Object；
- Gmail 插件直接访问数据库、Queue、HTTP Router 或 tRPC；
- Mail Core 导入 Gmail、Nango、Pub/Sub 或 Cloudflare 运行资源；
- Zero OAuth 和 Nango 各自实现 Gmail 同步或发件；
- 新旧邮件运行时兼容代理。

## 7. 分阶段硬切换

### 7.1 阶段一：完整删除 Agent、Chat、Brain

删除范围包括：

- 服务端 Chat HTTP Route；
- Agent Route、Agent 工具、Agent MCP、Agent SQLite Schema 和相关运行类；
- Brain tRPC Router；
- `lib/brain*`；
- 只为 Agent/Chat/Brain 服务的 Prompt、Pipeline、Workflow 和线程工具；
- 前端 AI Chat、邮件 AI 撰写、AI 主题、AI 搜索和对应入口；
- Agent/Chat/Brain 专用评测、测试、图片和无引用依赖；
- Agent/Chat/Brain 专用 Durable Object、KV、环境变量、Binding 和配置；
- Router、导出、类型和启动入口中的对应注册。

标准邮件主题规范化不是 AI 能力，`mail-core` 中用于 Thread 归并的 Subject Normalize
必须保留。

当前 Brain 还夹带 Gmail Watch 激活副作用。删除 Brain 前必须先把这项职责切换到阶段二
定义的账户绑定/激活编排器。切换完成后在同一阶段删除 Brain 调用，不保留
`enableBrainFunction` 或 `disableBrainFunction` 兼容包装。

阶段一退出条件：

- Agent、Chat、Brain 路由不可访问；
- 前端不存在对应入口；
- Gmail 绑定和 Watch 激活不再依赖 Brain；
- Agent、Chat、Brain 专用运行资源不再由应用代码引用；
- 标准 Mail API、Inbox 同步和 Gmail 发件不受影响。

### 7.2 阶段二：新链路缺口优先、选择性补齐

阶段二不是“迁移旧代码”，而是：

1. 列出旧职责；
2. 判断新链路是否已经覆盖；
3. 已覆盖则直接删除旧实现；
4. 只有标准邮箱职责、且新链路确实缺失时，才参考成熟项目重新实现；
5. 新实现必须进入正确的新模块，不复制旧目录和旧数据模型。

每一项缺口在完成调用切换后立即删除原负责人，不保留双轨。

### 7.3 阶段三：删除旧邮件运行时

在阶段二所有退出条件满足后删除：

- `lib/driver` 及 `GoogleMailManager`；
- 旧 `lib/mail-channel` Gmail 包装；
- 旧 Subscription Factory；
- 旧 Pipeline 和邮件 Workflow；
- 旧线程同步 Workflow、Coordinator 和 Worker；
- 旧 Gmail History、Processing、Subscription、Label KV；
- 旧 pending/scheduled send KV 和旧发送 Queue；
- 旧 `subscribe_queue` 和 `gmail_sub_age`；
- 旧 Durable Object 邮件分片和线程状态；
- 旧 Mail/Draft/Label Router 及 Driver DTO；
- 旧定时任务分支、Queue Consumer 和启动导出；
- 不再使用的 Cloudflare Binding、Workflow、Queue、KV 和环境类型。

Cloudflare 已部署环境的 Durable Object 删除必须使用新的 `deleted_classes` migration。
已经发布的 Wrangler migration 历史不能为了“目录整洁”而改写；完整移除指运行类、
Binding 和资源被正式退役，而不是破坏 Cloudflare 的迁移历史。

阶段三退出条件：

- 正式邮件链路只依赖新 Mail Core、Mail Accounts、Mail Sync、Mail Outbound 和
  MailChannel；
- 代码扫描不存在对旧 Driver、Factory、Pipeline、Workflow 和旧 Mail Router 的引用；
- 旧 Queue、KV、Workflow、Durable Object 不再产生运行流量；
- 新链路测试和生产构建通过；
- 此时才进行完整前后端真实运行验收。

## 8. 阶段二职责决策矩阵

### 8.1 新链路已经覆盖：不迁移旧实现

以下职责已存在正式实现，旧代码直接删除：

- Email、Thread、Mailbox、Keyword、Label 和 Attachment 本地模型；
- Mailbox、Email、Thread 和 Submission Changes；
- 本地搜索；
- 本地 Draft；
- EmailSubmission、Delivery Spool、Attempt 和 Gmail outbound；
- Gmail Inbox 增量发现；
- 原始 MIME 获取、解析、Blob 保存和 Mail Core 导入；
- Provider Credential Resolver；
- Zero OAuth/Nango 凭证来源；
- Gmail Watch 续期和定时对账的基础能力。

### 8.2 明确删除：不提供替代迁移

- Gmail 远端已读、星标、标签、归档、Trash 和 Spam 写操作；
- Gmail Draft API；
- Gmail Alias/Send-As 同步；
- 旧 Outlook Driver；
- 旧发送队列和旧定时发送状态；
- 旧 listChanges、Pipeline 和 Workflow；
- 旧 Durable Object/KV 邮件状态；
- Agent、Chat、Brain 和独立邮件 AI 能力。

### 8.3 必须补齐的新链路缺口

1. `modules/mail-accounts/postgres`：
   - 提供聚焦的 Connection、AuthorizationBinding 和 MailAccount Repository；
   - 从巨大运行入口和旧 ZeroDB 职责中移出邮件账户持久化。

2. 统一绑定/激活编排器：
   - Zero OAuth 和 Nango 绑定共用同一个应用用例；
   - 验证 Gmail 身份；
   - 建立 Connection/AuthorizationBinding；
   - 创建或复用本地 MailAccount；
   - 创建系统 Mailbox 和默认 Identity；
   - 建立增量 Checkpoint；
   - 调用 `users.watch`；
   - 激活 `inbound_sync`。

3. 默认 Identity：
   - 使用已经验证的邮箱地址创建本地发件 Identity；
   - 不从 Gmail Alias/Send-As 导入第二套身份模型。

4. Gmail Pub/Sub 基础设施：
   - 从 Brain 和每账号 Subscription Factory 中移出；
   - 调整为集成/GCP Project 级共享资源；
   - 账号只保存 Watch 和同步状态。

5. 断开和重新授权：
   - 统一暂停 inbound/outbound；
   - 等待或使现有租约失效；
   - 对该 Gmail 账号执行 best-effort `users.stop`；
   - Zero OAuth 在安全允许时撤销 Refresh Token；
   - Nango 凭证解绑不擅自删除 Nango 平台 Connection；
   - 重新授权复用本地 MailAccount 和邮件数据。

6. 断开时的 outbound：
   - 尚未调用 Provider 的 Delivery 停止领取；
   - 已 leased 的任务等待结果或租约到期；
   - uncertain 任务保留诊断状态，禁止盲目重发；
   - 不把尚未成功发送的 Draft 标记为 Sent。

7. 账户数据清理：
   - 使用 `mail.account.status = deleting` 阻止新读写；
   - 先按 `mail.blob.objectKey` 幂等删除 R2 对象；
   - 再执行 PostgreSQL 账户级级联清理；
   - 清理可重试，任意步骤崩溃后可继续；
   - 用户删除复用相同生命周期，不维护第二套清理实现。

8. 重新授权基线：
   - 首期只支持增量同步；
   - 重新授权后获取当前 Gmail History ID 作为新基线；
   - 不补导断开期间的历史邮件；
   - 本地已有邮件继续保留。

## 9. Gmail Pub/Sub 共享基础设施

### 9.1 资源范围

每一个 Gmail 集成所对应的 Google Cloud Project 拥有一套共享资源：

```text
Google Cloud Project
  -> one Topic
  -> one Push Subscription
  -> Zero Pub/Sub Endpoint
```

多个 Gmail 账号分别调用 `users.watch`，但传入同一个 Topic。

如果 Zero OAuth 和 Nango 的 OAuth Client 属于同一个 GCP Project，可以共享同一套资源；
如果属于不同 Project，必须分别配置一套 Topic/Subscription。不能跨 Project 强行共用，
因为 Gmail Watch 要求 Topic 与执行 Watch 的 OAuth Client 所属 Project 匹配。

### 9.2 资源所有权

Topic、Subscription、Push Endpoint 和 IAM 由部署配置预先创建和管理：

- 部署清单和环境配置是 GCP Project、Topic、Subscription、Push Audience 与认证服务账号
  的事实来源；
- 应用启动时把部署配置解析成只读 `GmailNotificationInfrastructure` 运行时契约；
- 数据库中的系统集成记录只引用不可变 `infrastructureKey`，不允许在账号请求中改写资源
  名称；
- 账号绑定流程只验证配置并调用 `users.watch`；
- 删除一个邮箱账号不得删除 Topic 或 Subscription；
- 应用运行时不得把共享资源写成账号级资源；
- 资源删除属于部署退役操作，不属于普通账号断开操作。

部署任务负责幂等创建和更新资源；应用提供只读健康检查，验证 Topic、Subscription、Gmail
Publisher IAM 和 Push 配置。账号请求不得创建、更新或删除共享资源。

### 9.3 账号级状态

每个 `inbound_sync` 独立保存：

- Provider；
- MailAccount；
- 同步 Scope；
- Gmail History Checkpoint；
- Watch 到期时间；
- 最后通知时间；
- 最后完整对账时间；
- 同步状态；
- 错误状态；
- Discovery Lease；
- 持久化工作版本。

### 9.4 通知路由

```text
Pub/Sub payload
  -> authenticate Google Pub/Sub push request
  -> validate envelope/emailAddress/historyId
  -> normalize emailAddress
  -> find globally unique active Gmail binding
  -> persist sync request
  -> enqueue provider-neutral discover wake-up
  -> acknowledge Pub/Sub
```

Push Endpoint 必须验证部署配置指定的 OIDC Audience、Issuer 和服务账号身份；认证失败直接
拒绝请求，不进入账号路由。通过认证后再解码 Pub/Sub Envelope 和 Base64 Data。

没有匹配账号、账号未激活或 Payload 非法时记录安全诊断，不泄露邮箱正文或 Token。

Pub/Sub ACK 的边界是“同步请求已经持久化”，不是“全部邮件已经导入”。Queue 发送失败也
不能丢失请求，定时扫描必须能从 PostgreSQL 找到未完成工作并重新唤醒。

## 10. Pub/Sub 与定时对账的统一并发模型

### 10.1 基本原则

Pub/Sub 是低延迟唤醒；定时对账是可靠性补偿。两者不是两套同步算法，而是同一个
Discovery 状态机的两个触发来源。

所有来源统一进入：

```text
request sync
  -> persist requested generation
  -> enqueue discover
  -> acquire one sync lease
  -> discover from committed checkpoint
  -> persist events/checkpoint
  -> detect requests that arrived during the run
  -> continue or finish
```

### 10.2 持久化工作版本

`inbound_sync` 增加或形成等价的持久化状态：

| 字段 | 作用 |
| --- | --- |
| `requested_generation` | 每次需要同步时单调递增 |
| `completed_generation` | 已被完整处理的工作版本 |
| `pending_cursor_hint` | Provider 可选提示；Gmail 保存最大 History ID |
| `next_reconcile_at` | 下一次可靠性对账时间 |
| `reconcile_claimed_until` | 防止多个调度器重复派发 |

通用层不能假设所有 Provider Cursor 都可比较：

- `requested_generation` 负责通用正确性；
- `pending_cursor_hint` 是 Adapter 可选优化；
- Gmail Adapter 可以把 History ID 作为整数语义比较并保留最大值；
- Outlook Delta Token、IMAP UID 状态等未来实现可以采用各自合并规则；
- 已提交 `checkpoint` 始终是实际增量读取起点，Cursor Hint 不能替代 Checkpoint。

### 10.3 同时触发时的处理

1. Pub/Sub 和定时任务都先持久化新的 `requested_generation`。
2. 多条 Queue 消息可以到达，但只有一个 Worker 能取得 Discovery Lease。
3. Worker 记录本轮开始时看到的 Generation。
4. Worker 始终从已提交 Checkpoint 调用 Provider 增量接口。
5. 每页事件与 Checkpoint 在持有有效租约时事务性保存。
6. 只有处理到最终页，才更新 `lastReconciledAt` 和本轮 `completed_generation`。
7. 完成后重新读取当前 `requested_generation`。
8. 如果执行期间 Generation 增加，立即继续一轮或重新入队。
9. 如果没有新增请求，释放租约。

因此：

- 先到的任务不会覆盖后到任务；
- 后到任务即使得到 `busy` 也不会丢失；
- 第一轮已经包含全部变更时，第二轮只会得到空增量；
- 邮件恰好出现在第一轮 Provider 快照之后时，第二轮会捕获；
- 相同远端邮件由 `(sync_id, remote_message_id)` 唯一约束去重；
- 只有有效租约持有者可以推进 Checkpoint。

### 10.4 租约续期和过期接管

- Discovery 在每次 Provider 分页调用前后检查租约；
- 长任务在租约剩余时间低于阈值时续租；
- 所有状态写入同时校验 Owner 和未过期时间；
- 过期 Worker 返回后不得提交旧 Checkpoint；
- 新 Worker 从最后已提交 Checkpoint 重新发现；
- 导入 Item 继续使用独立 Item Lease，允许 Discovery 与 MIME 导入安全并行。

### 10.5 调度原子认领

定时调度使用 PostgreSQL 原子认领到期记录：

- `FOR UPDATE SKIP LOCKED` 选择有限批次；
- 写入 `reconcile_claimed_until` 后提交；
- 再发送非权威 Queue 唤醒；
- Queue 发送失败时，Claim 到期后可重新选择；
- Worker 完成后更新 `next_reconcile_at` 并清除 Claim；
- 周期加入抖动，避免所有账号在同一时刻访问 Gmail。

调度器同时扫描：

- 到期对账；
- `requested_generation > completed_generation` 的未完成工作；
- Watch 即将到期；
- 到期的 Pending/Processing Import Item。

## 11. 账户绑定与激活事务边界

外部 OAuth、Nango、Gmail API 和 PostgreSQL 无法组成一个分布式事务，因此使用可恢复
状态机，而不是伪造全局原子性。

推荐状态：

```text
binding
  -> activating
  -> active
  -> auth_error | paused
  -> disconnecting
  -> disconnected | deleting
```

绑定流程：

1. 验证 OAuth/Nango 凭证。
2. 读取并规范化 Gmail Profile 邮箱地址。
3. 检查全局唯一有效 Gmail 绑定。
4. 创建或复用 Connection 和 AuthorizationBinding。
5. 创建或复用 MailAccount 和系统 Mailbox。
6. 创建默认本地 Identity。
7. 获取当前 History ID 作为增量基线。
8. 使用部署级共享 Topic 调用 `users.watch`。
9. 保存 Watch 到期时间并激活 `inbound_sync`。
10. 提交后发送非权威同步唤醒。

所有步骤必须幂等。任何步骤失败后，根据持久化状态从缺失步骤继续，不能创建第二个
MailAccount、Identity 或 Sync Stream。

## 12. 断开、重新授权与删除

### 12.1 断开

1. 将账号改为 `disconnecting`，阻止新 Discovery 和新 Delivery 领取。
2. 等待现有短租约结束，或让租约安全过期。
3. 对 Gmail 账号 best-effort 调用 `users.stop`。
4. Zero OAuth 根据授权所有权执行安全 Token 撤销。
5. Nango 授权只解除 Zero 内部绑定；除非产品显式要求，不删除 Nango 平台 Connection。
6. 将账号改为 `disconnected`。
7. 共享 Topic/Subscription 保持不变。

### 12.2 重新授权

1. 复用原 Connection 逻辑身份、MailAccount、本地邮件和 Mailbox。
2. 更新 AuthorizationBinding。
3. 重新验证 Gmail Profile，邮箱地址必须与原账号一致。
4. 获取当前 History ID，建立新的增量基线。
5. 重新调用 `users.watch`。
6. 激活同步。
7. 不导入断开期间历史邮件。

### 12.3 删除账号

1. 将 MailAccount 标记为 `deleting`。
2. 阻止 API、同步和发件创建新工作。
3. 停止 Watch 并处理有效租约。
4. 根据数据库中的 Blob Object Key 幂等删除 R2 对象。
5. 删除 Provider 映射、Sync、Spool、Attempt、Mail Core 数据和账户关系。
6. 最后删除 Connection/AuthorizationBinding。
7. 任意步骤失败后可从 `deleting` 状态继续。

用户删除复用该流程，不单独编写一套邮件数据清理逻辑。

## 13. Cloudflare 资源退役

需要按环境分别审查并退役：

- Agent/Chat/Brain Durable Object；
- 旧邮件 Driver/线程同步 Durable Object；
- Sync Threads Workflow 和 Coordinator；
- 旧 Subscribe Queue；
- 旧 Send Queue；
- 旧 Gmail History/Processing/Subscription/Label KV；
- 旧 Pending/Scheduled Email KV；
- Prompt/Agent 专用 KV；
- 不再使用的 Vectorize/AI Binding；
- 对应 Worker Export、Env 类型和 Docker 开发配置。

退役顺序：

1. 停止新生产者；
2. 切换消费者到新链路；
3. 检查并处理旧队列剩余消息；
4. 部署不再读取旧状态的版本；
5. 移除 Binding；
6. 删除外部资源；
7. 为 Durable Object 增加合法删除迁移；
8. 保留必须保留的 Cloudflare migration 历史。

`THREADS_BUCKET` 当前也承载正式 Mail Core Blob。不能因为名称来自旧项目就整体删除；
只能按数据库权威 Object Key 清理旧对象，并在确认无正式 Blob 引用后再决定是否重命名
Bucket。

## 14. 数据库边界

- Mail Core 表继续位于 `mail` Schema；
- Connection、AuthorizationBinding、Sync、Remote Mapping 和 Outbound 位于
  `integration` Schema；
- 不新增 `gmail_*` 业务表；
- Gmail Provider 状态通过版本化 JSON 或通用字段保存；
- 当前开发阶段继续维护一份可清空重建的数据库模板；
- 本阶段新增字段和约束进入当前模板，不制造无意义开发时间线 SQL；
- Cloudflare 已部署资源迁移不受 PostgreSQL 模板策略影响。

关键约束：

- 同一 MailAccount/Provider/Scope 只有一个 Sync；
- 同一 Gmail 邮箱只有一个有效绑定；
- Checkpoint 只能在有效 Discovery Lease 下更新；
- `completed_generation <= requested_generation`；
- 同一 Sync/Remote Message 只有一个 Sync Item；
- 同一 MailAccount 的默认 Identity 不重复；
- 删除状态账号不能创建新同步或发件任务。

## 15. 错误处理

- Pub/Sub Payload 非法：安全记录并确认，避免永久毒消息循环；
- 无账号匹配：安全记录并确认；
- 多账号匹配：视为数据完整性错误，不任选一个账号；
- Queue 发送失败：请求已经持久化，由扫描器重新唤醒；
- Discovery Lease busy：不视为失败，依靠持久化 Generation 保证续跑；
- Gmail 认证错误：Sync 进入 `auth_error`，停止自动 API 重试；
- Gmail History 过期：进入明确 `GMAIL_HISTORY_GAP` 状态；首期重新授权或人工重建增量
  基线，不擅自全量同步；
- Gmail 临时错误：带抖动有限重试；
- Watch 续期失败：保留当前 Checkpoint，继续定时对账并重试续期；
- `users.stop` 失败：记录安全诊断，继续本地断开，不能删除共享 Pub/Sub；
- Blob 删除失败：账号保持 `deleting`，不提前删除数据库中的 Object Key。

日志禁止包含：

- Access Token、Refresh Token、Nango Secret；
- 原始 MIME、正文或附件；
- 完整 Provider 错误正文；
- 未脱敏的 Pub/Sub Payload。

## 16. 自动化测试

### 16.1 Agent/Chat/Brain 删除

- Router 不再挂载 Agent、Chat、Brain；
- 前端不存在对应调用和入口；
- Env 类型和 Wrangler 中不存在已退役 Binding；
- 标准 Subject Normalize 仍通过测试；
- Gmail 绑定不再调用 Brain。

### 16.2 账户生命周期

- Zero OAuth 与 Nango 共用绑定编排器；
- 重复回调不会创建第二个 MailAccount、Identity 或 Sync；
- 同一 Gmail 邮箱重复绑定被拒绝；
- 激活失败可恢复；
- 断开阻止新同步和新发件；
- 重新授权复用本地数据并重建增量基线；
- 删除流程在每个失败点都可重试。

### 16.3 Pub/Sub

- 多账号共享同一个 Topic；
- 不同 GCP Project 使用不同 Topic 配置；
- 删除一个账号不删除共享 Topic/Subscription；
- `emailAddress` 路由唯一账号；
- 非法、未匹配和重复通知安全处理；
- 数据库提交前不 ACK；
- Queue 发送失败后扫描器可重新唤醒。

### 16.4 Pub/Sub 与定时对账竞争

- Pub/Sub 和定时任务同时触发时只有一个 Discovery Lease；
- Worker 运行期间收到更高 Gmail History ID 会增加 Generation 并续跑；
- busy 命令不会丢失同步请求；
- 第一轮已经覆盖变更时第二轮为空；
- 第一轮快照后出现的邮件由第二轮发现；
- 重复 Remote Message 不创建第二个 Sync Item；
- 最终页前不更新完整 Reconcile 时间；
- 过期 Worker 不能提交 Checkpoint；
- 长分页任务可以续租；
- 多调度器不会重复认领同一到期记录；
- Claim 或 Queue 发送失败后可以恢复。

### 16.5 旧运行时删除

- 新目录不导入旧 Driver、Factory、Pipeline、Workflow 或旧 Mail Router；
- 生产入口不导出旧 Durable Object 和 Workflow；
- Scheduled Handler 不再执行旧订阅或旧线程同步；
- Queue Handler 不再消费旧 Subscribe/Send Queue；
- KV/DO/Workflow 类型引用归零；
- Mail Core、Mail API、Inbox Sync、Gmail Outbound 和前端标准邮箱回归通过。

## 17. 验收顺序

1. 先完成静态架构审查和自动化测试。
2. 再完成 PostgreSQL 集成测试。
3. 再完成 Mail API、Inbox Sync 和 Outbound Worker 回归。
4. 再完成生产构建。
5. 旧运行时与资源已实际删除后，才启动完整前后端真实运行验收。
6. 不在旧链路仍存在时把浏览器验收误称为改造完成验收。

不自动安装 Playwright Browser、依赖或系统工具。需要额外安装时先向用户说明命令和原因，
由用户决定是否执行。

## 18. 实施顺序

1. 建立当前新旧职责和运行资源的可执行审计清单。
2. 为架构边界、账户生命周期和同步竞争补充失败测试。
3. 实现 `modules/mail-accounts/postgres`。
4. 实现统一绑定/激活编排器和默认 Identity。
5. 把 Gmail Watch 激活从 Brain 切换到新编排器。
6. 删除 Agent、Chat、Brain 和独立邮件 AI 能力。
7. 配置集成/GCP Project 级共享 Pub/Sub。
8. 实现持久化 Generation、Cursor Hint、租约续期和原子调度认领。
9. 实现断开、重新授权和 `users.stop`。
10. 实现安全的 outbound 停止和账户级数据清理。
11. 切换所有剩余调用方。
12. 删除旧 Driver、Factory、Pipeline、Workflow、Router、DO、KV 和 Queue 代码。
13. 按环境退役 Cloudflare 外部资源。
14. 执行自动化、集成、构建和最终真实运行验收。

每一阶段都必须满足：

- 新职责已经通过测试；
- 调用方已经硬切换；
- 旧职责立即删除；
- 不引入兼容层；
- 工作区不残留生成日志、临时报告或无关文件。

## 19. 完成标准

只有同时满足以下条件，才能声明“后端旧邮件链路收敛与移除完成”：

- Agent、Chat、Brain 和独立邮件 AI 能力完整删除；
- Gmail Watch 激活不依赖 Brain 或旧 Subscription Factory；
- Gmail Pub/Sub 按集成/GCP Project 共享；
- Pub/Sub 与定时对账通过同一持久化同步状态机；
- 同步期间的新通知不会丢失；
- Discovery Lease 可续期、过期 Worker 不可提交；
- Zero OAuth 和 Nango 共用账户绑定、同步和发件链路；
- 默认 Identity、断开、重新授权、删除和数据清理生命周期完整；
- 同一 Gmail 邮箱全局唯一有效绑定；
- 旧 Driver、Pipeline、Workflow、DO、KV、Queue 和旧 Mail Router 已删除；
- Cloudflare 运行资源已按环境退役；
- Notes、Templates 和正式 Mail Core Blob 未被误删；
- 架构测试、单元测试、PostgreSQL 集成测试和生产构建通过；
- 完整前后端运行验收在旧链路删除后通过；
- 项目中只剩一套正式邮件体系。
