# Zero 通用邮件出站与 Gmail 发送设计

日期：2026-07-26

分支：`codex/local-mail-core`

## 1. 结论

Zero 采用以下正式发送链路：

```text
EmailSubmission
      |
      v
PostgreSQL Delivery Spool
      |
      v
mail-outbound 通用编排与路由
      |
      v
MailChannel outbound adapter
      |
      v
gmail/outbound -> Gmail API
      |
      v
PostgreSQL 本地最终确认事务
```

首个渠道只实现 Gmail。`mail-outbound`、Delivery Spool、状态机、重试、租约、尝试记录和本地
最终确认全部保持 Provider 中立；后续 Outlook、Zoho Mail 和通用 IMAP/SMTP 只增加各自的
outbound adapter，不复制发送编排。

Gmail `users.messages.send` 返回成功后，Zero 将其解释为服务商已经接受发送。随后在一个短
PostgreSQL 事务中同时完成 Submission、Spool、Attempt、本地 Email、邮箱归属、远端映射、
Change Log 和聚合计数的最终确认。

Gmail API 调用不包含在 PostgreSQL 事务中。二者不存在分布式事务能力，因此通过持久化
Spool、稳定 Message-ID、租约恢复和 uncertain 对账处理外部成功、本地尚未提交的崩溃窗口。

## 2. 范围

本阶段包括：

- Provider 中立的 `mail-outbound` 模块；
- `EmailSubmission -> Delivery Spool` 原子入队；
- PostgreSQL 到期任务领取、租约、续约、超时接管和有限重试；
- MailChannel outbound 契约和插件注册；
- Gmail MIME 发送适配器；
- Gmail 返回 message ID 和 thread ID 的标准化；
- Gmail 成功后的本地 Draft -> Sent 最终确认；
- 不确定发送结果的 Gmail 对账；
- 自动化测试和 PostgreSQL 集成测试。

本阶段不包括：

- 前端切换；
- 删除旧 Driver、Pipeline、KV 或旧发送队列；
- Gmail Draft、Label、Mailbox 或状态反向同步；
- Gmail Sent 全量或增量同步；
- Outlook、Zoho 或通用 SMTP 的具体适配器；
- JMAP HTTP 服务端；
- 投递到最终收件人邮箱后的送达、打开或阅读确认。

## 3. 参考项目机制

本设计遵循：

> 学习成熟项目已验证的机制，转换成适合 Zero 的 TypeScript + PostgreSQL + 进程内插件架构；
> 不逐行翻译或复制参考项目源码。

### 3.1 Stalwart：主架构

重点采用：

- JMAP EmailSubmission 与 SMTP Spool 分离；
- Submission 保存并关联 queue ID；
- 持久化到期事件驱动投递；
- 带有效期的投递锁；
- 临时失败保留消息并更新下一次到期时间；
- 最终完成后移除活动队列；
- Submission 查询从队列和归档投递状态中组合结果；
- 取消发送通过 Submission 找到仍在队列中的消息。

参考位置：

- `crates/jmap/src/submission/set.rs`
- `crates/jmap/src/submission/get.rs`
- `crates/smtp/src/queue/spool.rs`
- `crates/smtp/src/outbound/delivery.rs`

Zero 不复制 Stalwart 的 Rust Store、SMTP Session 或二进制归档格式，而是将相同职责转换成
PostgreSQL 关系模型和 TypeScript 应用服务。

### 3.2 Postal：PostgreSQL Spool

重点采用：

- `queued_messages` 作为权威待投递记录；
- `locked_by`、`locked_at` 表达执行所有权；
- `retry_after` 和 `attempts` 表达退避；
- 原子更新领取任务；
- 临时失败清除租约并设置下一次执行时间；
- 最终结果写入独立 Delivery 记录；
- 最终成功或永久失败后结束活动队列项。

参考位置：

- `app/models/queued_message.rb`
- `app/models/concerns/has_locking.rb`
- `app/lib/worker/jobs/process_queued_messages_job.rb`
- `app/lib/message_dequeuer/outgoing_message_processor.rb`
- `lib/postal/message_db/delivery.rb`

### 3.3 EmailEngine：Gmail 发送适配

重点采用：

- 完整 MIME 在入队前持久化；
- 固定 queue ID 和 Message-ID；
- 延迟发送、最大尝试次数、指数退避与抖动；
- Gmail 小邮件使用 JSON `messages.send`；
- Gmail 大邮件使用 Upload API；
- 回复邮件传入 Gmail thread ID；
- Gmail API 返回结果标准化；
- Provider 插件不承担通用队列职责。

参考位置：

- `lib/email-client/base-client.js`
- `lib/email-client/gmail-client.js`

EmailEngine 的 Redis/BullMQ 不是 Zero 的权威存储实现。Zero 使用 PostgreSQL Spool，运行时
Queue 只能作为唤醒信号。

### 3.4 Nylas Sync Engine：稳定发送身份与本地合并

重点采用：

- 发送邮件在第一次尝试前生成稳定 Message-ID；
- 重试复用完全相同的 Message-ID 和 MIME；
- 自定义稳定标识辅助识别由本系统发送的邮件；
- 服务商副本再次出现时与本地 Email 合并，而不是创建第二封邮件；
- 发送成功后本地 Draft 转换为 Sent。

参考位置：

- `inbox/api/sending.py`
- `inbox/sendmail/message.py`
- `inbox/models/util.py`
- `inbox/mailsync/backends/imap/common.py`

Zero 不反向同步 Gmail Sent，因此只在发送结果不确定时使用远端查找，不将 Gmail Sent 作为
本地状态事实源。

## 4. 架构与依赖方向

```text
packages/mail-core
  EmailSubmission + 本地 Email 最终确认语义
          ^
          |
apps/server/src/modules/mail-outbound
  Spool + lease + retry + route + finalize
          |
          v
apps/server/src/mail-channel/contracts
          ^
          |
apps/server/src/mail-channel/gmail/outbound
```

依赖规则：

- Mail Core 不导入 Gmail、Nango、HTTP、Cloudflare Queue 或 mail-outbound；
- mail-outbound 只依赖 Mail Core 公共能力、通用 MailChannel 契约和自身 Repository；
- Gmail outbound 只实现通用适配器，不访问 PostgreSQL；
- Credential Resolver 属于 `modules/mail-accounts`，由运行时组合层注入；
- `runtime/mail` 负责组装 Repository、Mail Core、Credential Resolver、Registry 和 Worker；
- HTTP、tRPC、Queue 和 scheduled handler 只调用应用服务；
- 旧 `lib/mail-channel`、Driver 和 Pipeline 不得成为新链路依赖。

## 5. 目录结构

```text
apps/server/src/
├── modules/
│   ├── mail/
│   ├── mail-accounts/
│   ├── mail-sync/
│   └── mail-outbound/
│       ├── application/
│       │   ├── enqueue-submission.ts
│       │   ├── dispatch-due-deliveries.ts
│       │   ├── deliver.ts
│       │   ├── reconcile-uncertain.ts
│       │   ├── finalize-sent.ts
│       │   └── cancel-delivery.ts
│       ├── domain/
│       │   ├── delivery.ts
│       │   ├── state-machine.ts
│       │   ├── retry-policy.ts
│       │   ├── errors.ts
│       │   └── ports.ts
│       ├── postgres/
│       │   ├── schema.ts
│       │   └── repository.ts
│       └── runtime/
│           ├── create-mail-outbound.ts
│           └── worker.ts
├── mail-channel/
│   ├── contracts/
│   │   └── outbound.ts
│   ├── registry/
│   └── gmail/
│       ├── auth/
│       ├── shared/
│       ├── inbound/
│       └── outbound/
│           ├── adapter.ts
│           ├── mime-request.ts
│           ├── result-mapper.ts
│           ├── reconciliation.ts
│           └── errors.ts
└── runtime/mail/
    └── outbound.ts
```

不创建空目录。目录随着对应代码和测试进入仓库。

## 6. 领域边界

### 6.1 EmailSubmission

EmailSubmission 表达用户要求 Zero 发送某个已冻结 Draft 的业务事实：

- 关联本地 Email 和 Identity；
- 保留调用幂等键；
- 固定 Draft revision；
- 固定发送时间；
- 固定发送所使用的 Blob 集合；
- 暴露 queued、sent、failed、canceled 等用户可见结果；
- 记录服务商接受结果的安全摘要。

EmailSubmission 不负责：

- Worker 租约；
- 下次调度时间；
- Provider 路由执行；
- 网络重试；
- uncertain 对账。

### 6.2 Delivery Spool

Delivery Spool 是实际投递执行的权威事实：

- 一条活动记录唯一对应一个 Submission；
- 决定任务何时可领取；
- 保存租约所有者和到期时间；
- 保存尝试次数、重试时间和 uncertain 状态；
- 记录发送使用的路由快照引用；
- 保证同一时刻最多一个有效执行租约；
- 在进程崩溃后可以被其他 Worker 接管。

### 6.3 Send Attempt

Send Attempt 是不可覆盖的诊断记录：

- 每次外部发送或结果对账各有独立 attempt；
- 保存开始、结束时间；
- 保存结果分类；
- 保存经过清理的 Provider code 和安全响应；
- 成功时保存 remote message ID 和 remote thread ID；
- 不保存 access token、原始 MIME 或完整 Provider 错误正文。

### 6.4 MailChannel outbound adapter

适配器只负责：

- 接收已冻结的 MIME 和标准信封；
- 使用已解析的 Provider Credential；
- 调用 Provider 发送 API；
- 返回标准化接受结果；
- 分类 Provider 错误；
- 可选实现不确定结果查找。

适配器不负责：

- 修改 Submission；
- 修改本地 Email；
- 修改邮箱归属；
- 创建或领取 Spool；
- 计算通用重试时间；
- 直接访问数据库或运行时 Queue。

## 7. 通用 outbound 契约

核心契约语义：

```text
MailOutboundAdapter
├── send(message, credential) -> AcceptedResult
├── classifyError(error) -> OutboundError
└── reconciliation? 
    └── findAcceptedMessage(query, credential)
        -> found | not_found | inconclusive
```

标准发送输入包括：

- account 和 connection 的非敏感引用；
- envelope from、to、cc、bcc；
- 完整且已冻结的 RFC 5322 MIME；
- 稳定 RFC Message-ID；
- 可选的远端 thread reference；
- Submission ID 和 Delivery ID，仅作为日志关联字段，不要求 Provider 支持幂等键。

标准成功结果包括：

- `remoteMessageId`；
- 可选 `remoteThreadId`；
- Provider 接受时间；
- 经过白名单限制的 Provider code；
- 安全响应分类。

错误分类：

| 类型 | 处理 |
| --- | --- |
| `rate_limited` | 遵循合法 Retry-After，并加抖动 |
| `temporary_failure` | 有限重试 |
| `authentication_required` | 暂停任务并标记连接需要重新授权 |
| `quota_exceeded` | 延迟重试或按 Provider 语义终止 |
| `invalid_recipient` | 永久失败 |
| `policy_rejected` | 永久失败 |
| `payload_too_large` | 永久失败 |
| `uncertain` | 不直接重发，进入对账 |
| `permanent_failure` | 永久失败 |

## 8. PostgreSQL 数据模型

继续使用既有业务 Schema：

- `mail`：Email、Mailbox、Thread、Blob、Identity、EmailSubmission；
- `integration`：Provider Connection、远端映射、Delivery Spool、Send Attempt。

不增加 `gmail_*` 表，不增加新的 Provider 专属 Schema。

### 8.1 `mail.submission`

保留业务字段：

- `id`
- `mail_account_id`
- `email_id`
- `identity_id`
- `status`
- `send_at`
- `idempotency_key`
- `draft_revision`
- `provider_message_id`
- `last_error_code`
- `last_error_message`
- `created_at`
- `updated_at`
- `sent_at`

Worker 专属的尝试次数和下次执行时间由 Spool 管理，避免 Submission 和 Spool 同时成为调度
事实源。若为兼容当前 Mail Core 暂时保留镜像字段，它们只能由 mail-outbound 最终确认服务
更新，并在本阶段结束前收敛为单一事实源。

### 8.2 `mail.submission_blob`

继续保存发送快照引用：

- raw MIME；
- text/html 正文 Blob；
- inline/attachment Blob；
- SHA-256、大小、Content-Type 和 Object Key。

每次重试必须读取相同 raw MIME，不得重新渲染正文、边界、附件顺序或 Message-ID。

### 8.3 `integration.outbound_delivery`

主要字段：

| 字段 | 用途 |
| --- | --- |
| `id` | Delivery ID |
| `mail_account_id` | 账户租户边界 |
| `submission_id` | 唯一关联 Submission |
| `connection_id` | 创建任务时的路由引用 |
| `status` | scheduled、ready、leased、retry_wait、uncertain、completed、failed、canceled |
| `available_at` | 下次允许领取时间 |
| `lease_owner` | 当前 Worker |
| `lease_token` | 防止过期 Worker 提交结果 |
| `lease_expires_at` | 租约到期时间 |
| `attempt_count` | 实际发送尝试次数 |
| `reconciliation_count` | uncertain 对账次数 |
| `uncertain_since` | 首次进入不确定状态的时间 |
| `last_error_kind/code/message` | 安全诊断摘要 |
| `created_at/updated_at/completed_at` | 审计时间 |

约束：

- `submission_id` 唯一；
- Delivery、Submission、Email、Identity 必须属于同一 MailAccount；
- Connection 必须属于该 MailAccount 对应用户；
- 非 leased 状态不得保留有效 lease；
- leased 必须同时具有 owner、token 和 expires_at；
- completed、failed、canceled 不得再次领取；
- attempt 和 reconciliation 计数非负；
- 针对 `status + available_at` 和 `lease_expires_at` 建立部分索引。

### 8.4 `integration.send_attempt`

在现有表基础上补充：

- `delivery_id`
- `kind = send | reconcile`
- `outcome = sent | transient_failure | permanent_failure | uncertain | not_found`
- `remote_message_id`
- `remote_thread_id`
- `lease_token`

唯一约束：

- `(mail_account_id, delivery_id, attempt_number)`；
- 同一 Delivery 同时最多一个未结束的 send attempt；
- Provider remote ID 只作为外部映射，不作为本地主键。

### 8.5 `integration.remote_email`

Gmail 成功后复用既有远端映射表：

- `provider = gmail`
- `remote_email_id = Gmail message id`
- `remote_thread_id = Gmail thread id`
- `email_id = 原本的本地 Draft Email ID`

不创建第二个 Sent Email。原 Draft Email 在本地转换为 Sent。

## 9. Submission 与 Spool 的原子创建

创建 Submission 时，在同一个 PostgreSQL Unit of Work 中：

1. 锁定 MailAccount；
2. 校验 Email 是有效 Draft；
3. 校验 Identity、收件人和 Blob；
4. 冻结 raw MIME 和相关 Blob；
5. 确保 MIME 包含稳定且唯一的 Message-ID；
6. 创建 `mail.submission`；
7. 创建唯一的 `integration.outbound_delivery`；
8. 写入 Submission Change Log；
9. 提交事务；
10. 事务提交后发送非权威唤醒信号。

如果运行时 Queue 消息丢失，定时扫描仍能从 PostgreSQL 找到任务。如果 Queue 重复投递，
唯一约束和租约会吸收重复唤醒。

## 10. 领取与发送链路

1. Worker 查询 `scheduled/ready/retry_wait` 且 `available_at <= now` 的任务；
2. 使用 `FOR UPDATE SKIP LOCKED` 领取有限批次；
3. 写入新的 `lease_owner`、随机 `lease_token` 和 `lease_expires_at`；
4. 将状态改为 `leased` 并创建 send attempt；
5. 提交领取事务；
6. 读取冻结 raw MIME；
7. 通过 MailAccount -> Connection -> Channel Registry 解析 outbound adapter；
8. 通过统一 Credential Resolver 获取授权；
9. 在数据库事务之外调用 Provider；
10. 根据结果执行成功最终确认、retry、failed 或 uncertain。

长时间网络调用不持有 PostgreSQL 行锁或事务。

只有当前有效 `lease_token` 可以提交该次发送结果。租约过期的 Worker 即使稍后返回，也不能
覆盖新 Worker 已经完成的结果。

## 11. Gmail outbound

Gmail adapter 采用以下行为：

- 小于安全 JSON 阈值的 MIME 使用 base64url JSON `users.messages.send`；
- 大邮件使用 Gmail Upload API；
- 回复邮件在存在可信 remote thread reference 时携带 thread ID；
- 不调用 Gmail Label、Draft、Mailbox 或状态变更 API；
- 不读取 Gmail Draft；
- 不创建第二条 Gmail 相关本地业务链路；
- 返回 Gmail `id`、`threadId` 和接受结果；
- 所有 API 错误映射到通用 OutboundError。

发送使用的 remote thread ID 只是 Provider hint。Zero 本地 Thread ID 仍由本地 Mail Core
决定，Gmail thread ID 不得覆盖本地线程。

## 12. Gmail 成功后的本地最终确认

Gmail API 返回成功后，执行一个新的短 PostgreSQL 事务：

1. 锁定 MailAccount；
2. 锁定 Submission、Delivery、当前 Attempt 和 Email；
3. 验证 Delivery 仍由当前 lease token 持有；
4. 若已经 completed/sent，按幂等成功返回；
5. 将 Submission 标记为 `sent`；
6. 完成当前 Attempt，保存 Gmail message ID 和 thread ID；
7. 将 Delivery 标记为 `completed` 并清除租约；
8. 将同一个 Email 的 lifecycle 从 `draft` 改为 `sent`；
9. 设置 Email `sent_at`；
10. 移除 Drafts、Outbox 和 Scheduled 等临时系统邮箱归属；
11. 确保加入本地 Sent 邮箱；
12. 移除 `$draft`，确保本地 Sent 邮件为已读；
13. 保留不冲突的本地用户标签；
14. 写入或幂等更新 `integration.remote_email`；
15. 更新受影响 Mailbox 和 Thread 聚合；
16. 写 Email、EmailSubmission、Mailbox 和 Thread Change Log；
17. 提交事务。

任一步骤失败，整个本地最终确认事务回滚。Gmail 已经接受的事实不会回滚，此时任务进入
不确定恢复流程，而不是直接重发。

## 13. 不确定结果与崩溃恢复

存在无法完全消除的窗口：

```text
Gmail 已接受
    |
    v
进程在本地最终确认提交前崩溃
```

Stalwart、Postal 和传统 SMTP Spool 通过持久化队列与锁保证任务不会并发处理，但 SMTP 或
外部 API 均不能与本地数据库组成 exactly-once 分布式事务。Zero 明确采用以下恢复语义：

1. 每个 Submission 在首次入队前固定 Message-ID；
2. 所有重试使用完全相同的 MIME 和 Message-ID；
3. Worker 发现过期 leased 任务且上一次 attempt 没有可靠结果时，将其改为 `uncertain`；
4. Gmail reconciliation capability 在 Gmail Sent 中按稳定 Message-ID 查找；
5. 找到唯一匹配时，将 Gmail ID/thread ID 作为成功结果执行本地最终确认；
6. 查询失败或 Provider 暂不可用时继续对账，不立即重发；
7. 明确确认不存在后，按照有限策略重新进入 ready；
8. 找到多个匹配时保留诊断信息并选择最早可信结果，不再制造更多副本。

Gmail 入站同步所需授权已经包含读取能力，因此首期 Gmail 账户具备对账条件。未来仅有发送
权限的 Provider 或通用 SMTP 如果无法查询已发送结果，只能提供行业常见的 at-least-once
语义，插件必须在 capability 中明确声明。

## 14. 重试与失败

重试策略集中在 mail-outbound，不放在 Gmail adapter：

- 尊重安全范围内的 Provider Retry-After；
- 其他临时错误使用带抖动的指数退避；
- 设置最大实际发送尝试次数；
- reconciliation 次数与 send attempt 次数分开；
- 认证错误暂停发送并更新 Connection 状态；
- 永久失败保留 Submission、Delivery 和 Attempt 诊断记录；
- 永久失败不把 Draft 转换为 Sent；
- 失败 Draft 继续保留在本地 Drafts，允许用户修正后创建新的 Submission；
- canceled 只允许在 Provider 尚未接受之前发生；
- 已经进入 uncertain 的任务不能由普通取消操作伪装成“未发送”。

## 15. 幂等性

需要同时保证四层幂等：

1. API 幂等：`(mail_account_id, idempotency_key)` 唯一；
2. Submission/Spool 幂等：一个 Submission 只有一个 Delivery；
3. Worker 幂等：租约 token 和状态条件更新拒绝过期 Worker；
4. 本地最终确认幂等：重复执行只得到同一个 Sent Email 和同一个 remote mapping。

Gmail `messages.send` 本身不提供可依赖的业务幂等键。稳定 Message-ID 和 uncertain 对账降低
崩溃重发风险，但不对无法查询结果的 Provider 宣称绝对 exactly-once。

## 16. 安全和可观测性

- access token 和 refresh token 只通过 Credential Resolver 获取；
- Spool 和 Attempt 不保存明文凭据；
- 日志不输出 raw MIME、正文、附件、完整收件人列表或 token；
- Provider error 入库前限制长度并清理敏感内容；
- trace 字段使用 Delivery ID、Submission ID、Attempt ID 和安全 Provider code；
- 指标至少包括 queued、leased、sent、retry、uncertain、failed、lease expired；
- 监控最长排队时间、uncertain 停留时间和各 Provider 错误率；
- 所有查询以 MailAccount/Connection 用户边界限制。

## 17. 自动化测试

### 17.1 Mail Core

- Submission 与冻结 Blob 同时创建；
- 稳定 Message-ID 在重试中不变化；
- Draft revision 在提交后被冻结；
- 成功最终确认将同一个 Email 从 Draft 转为 Sent；
- Drafts/Outbox/Scheduled 移除并加入 Sent；
- 用户标签按规则保留；
- Mailbox、Thread、Change Log 和 state version 同时更新；
- 最终确认任一步骤失败时完整回滚；
- 重复最终确认幂等。

### 17.2 Spool

- Submission 与 Delivery 原子创建；
- 重复幂等键不创建第二个 Delivery；
- `SKIP LOCKED` 并发领取不会重复；
- lease token 拒绝过期 Worker；
- 租约到期可接管；
- scheduled 和 retry_wait 未到期不可领取；
- 临时失败正确退避；
- 最大尝试次数后永久失败；
- canceled/completed/failed 不可领取；
- 非权威 Queue 消息重复或丢失不影响正确性。

### 17.3 Gmail adapter

- 小 MIME 使用 JSON send；
- 大 MIME 使用 Upload API；
- base64url 编码正确；
- reply thread ID 正确传递；
- message ID/thread ID 正确映射；
- 认证、限流、临时错误、配额、收件人和永久错误正确分类；
- adapter 不访问数据库；
- adapter 不调用 Gmail Label、Draft 或 Mailbox API。

### 17.4 uncertain 恢复

- Gmail 成功后、本地提交前崩溃；
- 过期 lease 被转换为 uncertain；
- 按稳定 Message-ID 找到远端邮件后完成本地确认；
- 暂未找到时不立即重发；
- 对账 API 临时失败时退避；
- 多个匹配不再发送；
- 本地最终确认重复执行不创建第二个 Sent Email；
- 无 reconciliation capability 的插件明确退化为 at-least-once。

### 17.5 PostgreSQL 与回归

- 主键、组合外键、唯一约束、检查约束和部分索引有效；
- 跨账户 Submission、Delivery、Attempt 和 remote mapping 被拒绝；
- 数据库重建后 `db:push` 一次初始化全部表；
- mail-core 全量测试通过；
- server 邮件相关测试通过；
- server production build 通过；
- 现有前端和旧发送链路在本阶段不被切换。

## 18. 实施顺序

1. 先为 Mail Core 成功最终确认编写失败测试；
2. 实现 Draft -> Sent 原子领域操作；
3. 为 Spool Schema、Repository 和租约编写 PostgreSQL 集成测试；
4. 实现 `mail-outbound` 状态机和调度；
5. 定义 MailChannel outbound 契约并扩展 Registry；
6. 实现 Gmail outbound adapter；
7. 组装 Credential Resolver、Registry、Spool 和 Worker；
8. 实现 Gmail uncertain reconciliation；
9. 增加 Queue/scheduled 唤醒入口；
10. 完成并发、崩溃恢复和全量回归验证。

每一步先写失败测试，再写最小实现。

## 19. 验收标准

本阶段只有同时满足以下条件才算完成：

- 一个合法 Draft 可以创建唯一 EmailSubmission 和唯一 Delivery；
- PostgreSQL 是待发送任务唯一事实源；
- Gmail 是唯一首期 outbound adapter，通用层不出现 Gmail 条件分支；
- Gmail API 返回成功后，同一个本地 Email 原子转为 Sent；
- Gmail message ID/thread ID 被持久化并关联原 Email；
- 成功后 Drafts 移除、Sent 加入、计数和 Change Log 正确；
- 临时失败可重试，永久失败保留 Draft；
- 多 Worker 不会并发发送同一个有效租约任务；
- Worker 在任意数据库步骤崩溃后可恢复；
- Gmail 已接受但本地未提交时不会直接盲目重发；
- 所有发送重试复用相同 MIME 和 Message-ID；
- Outlook、Zoho、IMAP/SMTP 可以通过新增 outbound adapter 接入；
- 新链路不依赖旧 Driver、Pipeline、KV 或旧发送队列；
- 自动化测试、PostgreSQL 集成测试和生产构建通过。

