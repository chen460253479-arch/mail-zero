# Zero 通用邮件入站同步与 Gmail 增量收件设计

日期：2026-07-26

分支：`codex/local-mail-core`

## 1. 结论

Zero 新增一套服务商中立的邮件入站同步内核 `modules/mail-sync`，并以 Gmail
作为第一个进程内 TypeScript 插件实现。

首期范围严格限定为：

- Gmail 绑定成功后建立增量基线；
- 不同步绑定前的历史邮件；
- 只发现基线之后新增到 Gmail Inbox 的非草稿邮件；
- 获取原始 MIME 并导入 Zero 本地 Inbox；
- 导入后由 Zero 本地邮箱模型完全接管；
- 不同步 Gmail 已读、星标、标签、移动、归档或删除变化；
- 不向 Gmail 反向同步任何本地邮箱状态；
- 暂不切换现有前端。

通用同步内核只实现一次。Outlook、Zoho Mail 和通用 IMAP/SMTP 后续只实现各自的
入站适配器，不复制数据库表、状态机、锁、任务重试或本地导入逻辑。

## 2. 参照原则

本设计遵循：

> 学习成熟项目已经验证的机制，转换为适合 Zero 的 TypeScript + PostgreSQL +
> 进程内插件架构；不逐行翻译或复制参照项目源码。

### 2.1 Stalwart：首要模型参考

重点参照：

- `crates/email/src/message/ingest.rs` 的统一 `EmailIngest` 入口；
- 原始 MIME、Blob、邮件元数据、邮箱归属、线程和变更日志的统一入库；
- JMAP Email、Mailbox、Thread、Keyword、Blob 和 Changes 语义；
- 服务商或协议来源不进入本地邮件领域模型；
- Message-ID、References 和 In-Reply-To 驱动的本地线程语义。

Zero 不复制 Stalwart 的 Rust、自定义 Store、Document ID、Bitmap 或二进制序列化。
这些机制继续转换为 PostgreSQL 关系模型、外键、唯一约束和 TypeScript 领域服务。

### 2.2 Nylas sync-engine：同步状态机参考

重点参照：

- 每个账号只运行一个同步器；
- 同步状态持久化，以便进程重启后恢复；
- 状态处理器保持幂等；
- 按远端顺序建立安全检查点；
- 按远端消息 ID 去重；
- 分批提交，避免长事务和大批量失败回滚。

### 2.3 EmailEngine：服务商接入参考

重点参照：

- `BaseClient` 与 Gmail、IMAP 客户端的分层；
- Gmail History 分页；
- 同步期间合并最新通知；
- Gmail Watch 自动续期；
- Pub/Sub 丢失时的补偿轮询；
- OAuth、限流和服务商错误标准化。

### 2.4 Postal：持久任务参考

只参照：

- 持久化待处理消息；
- 有限重试和退避；
- 最大尝试次数；
- 可诊断的终止失败状态。

Postal 的 SMTP/MX 投递模型不进入本次 Gmail 入站同步设计。

## 3. 权威边界

### 3.1 服务商职责

服务商入站插件只负责：

- 建立增量检查点；
- 发现检查点之后的新邮件；
- 返回服务商消息 ID、服务商线程 ID、接收时间和原始 MIME；
- 管理服务商支持的实时通知能力；
- 将服务商错误分类为统一错误。

### 3.2 Zero 职责

邮件导入后，以下状态仅由 Zero 管理：

- Inbox 归属；
- 本地线程；
- 已读、星标和其他 Keyword；
- 文件夹与标签；
- 归档、垃圾箱、恢复和永久删除；
- 搜索、计数、Change Log 和状态版本；
- Blob 生命周期。

服务商消息 ID 只用于远端映射和幂等，不成为 Zero Email ID。
服务商线程 ID 只保存为远端参考，不决定 Zero 本地线程。

## 4. 总体架构

```text
Provider Signal
  Gmail Pub/Sub | Outlook Webhook | IMAP IDLE | Poll
                         |
                         v
              Provider Ingress Adapter
                         |
                         v
             modules/mail-sync orchestrator
               |                    |
               | discovery          | import
               v                    v
      integration.inbound_sync_*   MailCore.importEmail
                                      |
                                      v
                         mail.* + integration.remote_email
```

依赖方向：

```text
Provider plugin -> mail-sync contracts
mail-sync       -> mail-core public API
mail-core       -X-> Gmail / Outlook / IMAP / Cloudflare Workflow
```

## 5. 目录结构

```text
apps/server/src/
├─ lib/mail-channel/
│  ├─ types.ts
│  ├─ registry.ts
│  └─ gmail/
│     ├─ channel.ts
│     ├─ ingress-adapter.ts
│     ├─ gmail-api-client.ts
│     ├─ history-mapper.ts
│     └─ errors.ts
│
├─ modules/mail-sync/
│  ├─ domain/
│  │  ├─ ingress-adapter.ts
│  │  ├─ ingress-event.ts
│  │  ├─ sync-state.ts
│  │  └─ errors.ts
│  ├─ application/
│  │  ├─ activate.ts
│  │  ├─ receive-signal.ts
│  │  ├─ discover-incremental.ts
│  │  ├─ import-pending.ts
│  │  ├─ reconcile.ts
│  │  └─ renew-subscription.ts
│  ├─ postgres/
│  │  ├─ schema.ts
│  │  ├─ sync-repository.ts
│  │  └─ attempt-repository.ts
│  └─ runtime/
│     └─ create-mail-sync.ts
│
└─ modules/mail/
   └─ runtime/create-mail-core.ts
```

`modules/mail-sync` 不包含 Gmail、Outlook、Zoho 或 IMAP 条件分支。

## 6. 通用入站插件契约

通用适配器表达邮件入站语义，不暴露 Gmail History 或 IMAP UID 的具体类型。

核心能力：

```text
MailIngressAdapter
├─ establishCheckpoint()
├─ discoverChanges(checkpoint, pageCursor?)
├─ fetchRawMessage(remoteMessageId)
├─ classifyError(error)
└─ subscription?                  # 可选能力
   ├─ subscribe(scope)
   ├─ renew(subscription)
   ├─ unsubscribe(subscription)
   └─ parseSignal(payload)
```

约束：

- `checkpoint` 是带 `version` 的不透明 JSON 值；
- `pageCursor` 只在一次发现运行中使用，不作为长期业务状态；
- `discoverChanges` 返回标准化的 `messageAdded` 事件；
- 首期标准范围只有 `mailboxRole = inbox` 和 `initialSync = none`；
- 不支持实时通知的插件省略 `subscription`，由 `reconcile` 轮询；
- 通用编排器不解析检查点内容。

后续服务商映射：

| 渠道 | 检查点 | 实时能力 |
| --- | --- | --- |
| Gmail | History ID | Pub/Sub Watch |
| Outlook | Delta Link | Microsoft Graph Webhook |
| Zoho Mail | API 游标或 IMAP 状态 | Webhook、IDLE 或轮询 |
| 通用 IMAP | UIDVALIDITY、UIDNEXT、HIGHESTMODSEQ | IDLE 或轮询 |

## 7. PostgreSQL 数据模型

同步表归属 `integration` Schema；邮件本体继续归属 `mail` Schema。
不增加 `gmail_*` 表名或 `gmail_history_id` 等专属列。

### 7.1 `integration.inbound_sync`

每个本地 MailAccount 一条记录。

主要字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 同步实体 ID |
| `mail_account_id` | 唯一关联 `mail.account` |
| `mode` | 首期固定为 `incremental` |
| `scope` | 带版本的 JSON；首期为 Inbox、无历史同步 |
| `status` | activating、active、retry_wait、reauth_required、suspended、deleting |
| `checkpoint` | 已安全发现的服务商检查点 JSON；仅 activating 的早期阶段允许为空 |
| `pending_signal` | 已合并但尚未发现的最新通知 JSON |
| `subscription` | 可选的服务商订阅引用 JSON |
| `subscription_expires_at` | 订阅到期时间 |
| `lease_owner` | 当前执行者 |
| `lease_expires_at` | 租约到期时间 |
| `consecutive_failures` | 连续失败次数 |
| `retry_at` | 下一次允许执行时间 |
| `last_error_kind/code/message` | 可诊断错误 |
| `last_started_at` | 最近开始时间 |
| `last_succeeded_at` | 最近成功时间 |
| `created_at/updated_at` | 审计时间 |

约束：

- `mail_account_id` 唯一；
- 状态、失败次数和租约时间有检查约束；
- 渠道通过 `mail.account.connection_id` 关联的 `integration.connection.channel_id`
  唯一推导，不在同步表重复保存；
- `checkpoint` 为空时状态必须是 activating；
- `checkpoint`、`scope` 以及非空的 `subscription` 必须包含版本字段；
- 除主键外，增加 `(id, mail_account_id)` 唯一约束，供下游任务建立账号级组合外键；
- 为 `status + retry_at`、`subscription_expires_at` 和租约到期建立索引。

### 7.2 `integration.inbound_sync_item`

保存已经从服务商检查点中可靠发现、但尚未完成本地导入的邮件。

主要字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 待导入项 ID |
| `inbound_sync_id` | 所属同步实体 |
| `mail_account_id` | 账号租户边界 |
| `remote_message_id` | 服务商消息 ID |
| `remote_thread_id` | 可选服务商线程 ID |
| `discovered_checkpoint` | 发现该邮件的检查点 |
| `status` | pending、processing、retry_wait、imported、skipped、failed |
| `attempt_count` | 已尝试次数 |
| `retry_at` | 下一次重试时间 |
| `lease_owner/lease_expires_at` | 单项处理租约 |
| `email_id` | 成功导入后的 Zero Email ID |
| `last_error_kind/code/message` | 单项错误 |
| `created_at/updated_at/imported_at` | 审计时间 |

约束：

- `(inbound_sync_id, remote_message_id)` 唯一；
- `(inbound_sync_id, mail_account_id)` 组合外键指向所属同步实体；
- `(email_id, mail_account_id)` 组合外键确保成功结果属于同一 MailAccount；
- pending/retry 队列建立部分索引；
- 任务租约到期后允许其他执行者接管。

### 7.3 `integration.inbound_sync_attempt`

保存同步运行级诊断信息，不保存邮件正文。

主要内容：

- 操作类型：activation、discovery、import、renewal；
- 触发来源：push、reconcile、manual、activation；
- 运行状态；
- 起止检查点；
- 与操作对应的页数、发现数、导入数、重复数、跳过数和失败数；
- 错误分类和起止时间。

该表用于自动化测试断言、运维诊断和后续指标，不作为业务事实来源。

## 8. Gmail 激活链路

绑定完成后的激活顺序：

1. 解析 Connection 和 AuthorizationBinding。
2. 幂等创建 `mail.account`、默认 Identity 和系统邮箱。
3. 创建 `integration.inbound_sync`，状态为 `activating`。
4. 调用 Gmail Profile 获取当前 History ID，并立即持久化为初始检查点。
5. 创建只监听 `INBOX` 的 Gmail Watch。
6. 保存 Watch 响应、到期时间和最新 History ID。
7. 将同步状态切换为 `active`。
8. 立即触发一次发现，捕获步骤 4 至步骤 7 之间进入 Inbox 的邮件。

先持久化 Profile 检查点再创建 Watch，可以避免 OAuth 完成与 Watch 建立之间的竞态。
即使进程在 Watch API 成功后崩溃，恢复时仍可从已保存的 Profile 检查点补偿。

绑定前存在于 Inbox 的邮件不会被发现。

## 9. Gmail 增量发现链路

1. Pub/Sub 请求完成签名与路由验证。
2. Gmail 插件解析出邮箱标识和通知 History ID。
3. `receive-signal` 只更新 `pending_signal`，保留数值最大的 History ID。
4. 执行器取得账号级数据库租约。
5. Gmail 插件从已保存检查点分页调用 History API。
6. 只请求或保留 `messageAdded`。
7. 只保留事件发生时包含 `INBOX` 且不包含 `DRAFT` 的消息。
8. 每个标准化事件幂等插入 `inbound_sync_item`。
9. 一批事件可靠写入后，在同一 PostgreSQL 事务中推进 `inbound_sync.checkpoint`。
10. 下一页继续执行，直到追上本次目标检查点。
11. 释放租约并记录 attempt。

Gmail 的 `labelsAdded`、`labelsRemoved` 和 `messagesDeleted` 全部忽略。

## 10. 本地导入链路

1. 执行器通过 `FOR UPDATE SKIP LOCKED` 或等价租约领取待导入项。
2. Gmail 插件调用 `users.messages.get(format=raw)`。
3. 返回 remote message ID、remote thread ID、internalDate 和原始 MIME 字节。
4. 查找本地系统 Inbox ID。
5. 调用 `MailCore.importEmail`：
   - `provider = gmail`；
   - `remoteEmailId = Gmail message ID`；
   - `remoteThreadId` 只保存为远端参考；
   - `mailboxIds = [localInboxId]`；
   - `keywords = []`；
   - `receivedAt = Gmail internalDate`；
   - `raw = 原始 MIME`。
6. MailCore 完成 MIME、Blob、正文、附件、地址、线程、邮箱计数、搜索文档和 Change Log。
7. 更新 `inbound_sync_item` 为 imported，并保存本地 Email ID。

如果执行器在 MailCore 成功后、更新 item 前崩溃，任务会重新执行。
`integration.remote_email` 的唯一约束和 `MailCore.importEmail` 的幂等语义保证不会重复创建邮件。

## 11. 并发、检查点与一致性

- 同一 MailAccount 同时只允许一个 discovery 执行器；
- 不同账号可以并行；
- Push 只作为唤醒信号，不被当作完整变更内容；
- 多个 Push 合并到 `pending_signal`，不创建无限通知任务；
- 远端检查点只在标准化事件已写入 `inbound_sync_item` 后推进；
- 本地导入采用至少一次执行和幂等结果；
- 长时间网络请求不持有 PostgreSQL 行事务；
- 数据库租约有到期时间，可从执行器崩溃中恢复；
- page cursor 失效时从最近已持久化 checkpoint 重新发现；
- 重复发现由同步项唯一约束吸收。

## 12. 错误分类与恢复

统一错误类型：

| 类型 | 处理 |
| --- | --- |
| `rate_limited` | 遵循 Retry-After，并使用带抖动指数退避 |
| `temporary_provider_error` | 有限重试，进入 retry_wait |
| `authentication_required` | 同步状态改为 reauth_required，Connection 改为 reconnect_required |
| `checkpoint_expired` | 首期不自动执行历史全量同步；暂停并要求重新建立增量基线 |
| `remote_message_missing` | 将单项标记 skipped，避免永久阻塞队列 |
| `invalid_remote_message` | 有限重试后标记 failed，保留诊断信息 |
| `over_quota` | 暂停导入，不丢弃同步项 |
| `local_integrity_error` | 停止该账号同步并保留检查点与待处理项 |

最大尝试次数仅终止单项任务，不删除待处理记录或本地数据。
人工重新执行时复用同一同步项，不创建重复消息。

## 13. Watch 与补偿

- Gmail Watch 到期前进入续订窗口；
- 续订调用使用同一 Inbox 范围；
- 续订返回的新 History ID 只更新 pending signal，不直接覆盖安全检查点；
- 定时 reconcile 读取 Gmail Profile 的当前 History ID；
- 当前 ID 大于安全检查点时触发 discovery；
- reconcile 同时接管过期租约、到期重试和即将到期的订阅；
- Pub/Sub 丢失不会造成永久漏信。

## 14. 与现有 Zero 链路的关系

首期不删除旧代码：

- `apps/server/src/pipelines.ts`；
- 旧 Durable Object 邮件缓存；
- 旧线程同步 Workflow；
- 现有前端依赖的数据接口。

新 Gmail 本地入站链路不再使用：

- `gmail_history_id` KV 作为安全游标；
- 旧 `syncThread` 作为本地邮件入库入口；
- Gmail Thread 作为本地线程事实；
- Gmail 标签变化作为本地状态来源。

旧链路的停用和前端切换属于后续独立阶段。

## 15. 安全边界

- OAuth 凭据继续通过 AuthorizationBinding 和现有凭据解析器获取；
- 同步表不保存 access token 或 refresh token；
- `subscription` JSON 只保存非敏感服务商引用；Webhook 校验密钥必须加密或只保存哈希；
- Pub/Sub 请求必须验证来源、订阅路由和目标 Connection；
- 日志不得输出 token、原始 MIME 或完整邮件正文；
- provider error message 写库前进行长度限制和敏感信息清理；
- 所有查询都以 MailAccount 或 Connection 作为租户边界。

## 16. 自动化测试

### 16.1 领域与插件契约测试

- 不同 Provider checkpoint 可以作为不透明版本化 JSON 往返；
- 不支持 subscription 的插件仍可通过 reconcile 工作；
- Gmail History 分页和 `messageAdded` 映射；
- Inbox、Draft 和非 Inbox 过滤；
- Gmail 标签变化和删除事件被忽略；
- Gmail API 错误映射为统一错误。

### 16.2 同步编排测试

- 激活先保存 Profile checkpoint，再创建 Watch；
- 绑定前邮件不导入；
- Watch 建立期间到达的邮件不会丢失；
- 重复 Push 只合并目标检查点；
- 同账号串行、不同账号并行；
- 每批同步项持久化后才推进 checkpoint；
- page cursor 失效后从安全 checkpoint 重试；
- 执行器崩溃后租约可恢复；
- checkpoint 过期不会自动导入历史邮件。

### 16.3 本地导入测试

- Raw MIME 成功导入本地 Inbox；
- HTML、文本、内联资源和附件完整；
- Gmail message ID 重复不会创建重复邮件；
- Gmail thread ID 不覆盖本地线程算法；
- MailCore 成功但 item 更新前崩溃时可安全重试；
- Gmail 删除已导入邮件不会删除本地副本；
- 本地已读、标签、移动或删除不调用 Gmail API。

### 16.4 PostgreSQL 集成测试

- 所有主键、外键、唯一约束和检查约束有效；
- 跨账号引用被拒绝；
- `SKIP LOCKED` 或租约领取不会重复处理；
- retry、lease 和 subscription 索引被目标查询使用；
- discovery 事务回滚时 checkpoint 不推进；
- 重复事件由唯一约束吸收；
- 清空数据库后 `db:push` 可以一次初始化全部新表。

### 16.5 回归验证

- `packages/mail-core` 全量测试；
- server 邮件插件、凭据和数据库测试；
- PostgreSQL 集成测试；
- server build；
- 现有前端不切换且旧接口不被破坏。

## 17. 实施阶段

1. 通用入站契约和领域测试；
2. PostgreSQL 同步状态、待导入项和 attempt；
3. 通用 discovery/import 编排器；
4. Gmail 增量适配器；
5. 绑定激活和 MailAccount 幂等建档；
6. Pub/Sub 信号接入和 Watch 续订；
7. reconcile、租约恢复和错误分类；
8. PostgreSQL 集成测试与完整回归。

每一阶段均先写失败测试，再写最小实现。

## 18. 非目标

- Gmail 历史邮件同步；
- Sent、Archive、Junk、Trash 或 Drafts 同步；
- Gmail 用户标签同步；
- Gmail 已读、星标、移动或删除同步；
- Zero 本地状态回写 Gmail；
- Outlook、Zoho 或 IMAP/SMTP 的具体适配器；
- 前端绑定选项和本地邮箱 UI 切换；
- 删除旧邮件数据链路；
- JMAP HTTP 服务端。

## 19. 验收标准

首期完成必须同时满足：

- Gmail 绑定后不导入任何绑定前邮件；
- 绑定后新增到 Gmail Inbox 的非草稿邮件最终进入 Zero 本地 Inbox；
- Pub/Sub 重复、延迟或丢失不会造成重复邮件或永久漏信；
- 进程在任意 discovery/import 步骤崩溃后可以自动恢复；
- Gmail 标签、已读、移动和删除变化不改变 Zero 本地邮件；
- Gmail 删除远端邮件不会删除 Zero 本地副本；
- 同步游标和任务状态完全存放在 PostgreSQL；
- MailCore 和通用 mail-sync 不依赖 Gmail 类型；
- Gmail 插件可以被未来 Provider 适配器替换；
- 自动化测试、PostgreSQL 集成测试和构建全部通过。
