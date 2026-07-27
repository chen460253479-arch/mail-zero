# Zero 邮件后端切换与资源退役清单

日期：2026-07-27
适用范围：`local`、`staging`、`production`

## 1. 执行边界

- 本清单只记录部署和验收动作，不授权自动修改 Cloudflare、GCP、Nango 或 Gmail 外部资源。
- 必须先部署只使用 Mail Core、Mail Accounts、Mail Sync、Mail Outbound 和新
  MailChannel 的版本，再退役旧资源。
- PostgreSQL 仍处于允许清空重建的开发阶段，数据库初始化继续使用当前唯一模板；
  本阶段不创建时间线增量 SQL。
- `THREADS_BUCKET` 已承载正式 Mail Core Blob，禁止因旧名称而删除。
- `ZERO_DB` 仍承载 Notes、Templates、Settings 等非邮件业务，禁止删除。
- 每个 GCP Project 只部署一组共享 Gmail Topic/Subscription；断开或删除单个邮箱账号
  不得删除共享资源。

## 2. 发布前检查

- [ ] 数据库已由当前模板清空重建，`mail`、`integration`、`app`、`auth` Schema 与代码一致。
- [ ] `MAIL_INGRESS_QUEUE`、`MAIL_OUTBOUND_QUEUE` 已创建且生产者、消费者均绑定。
- [ ] `THREADS_BUCKET` 和 `HYPERDRIVE` 仍指向当前环境的正式资源。
- [ ] Gmail Pub/Sub 四项配置已注入：
      `GMAIL_PUBSUB_TOPIC_NAME`、`GMAIL_PUBSUB_SUBSCRIPTION_NAME`、
      `GMAIL_PUBSUB_PUSH_AUDIENCE`、`GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT`。
- [ ] `CREDENTIAL_ENCRYPTION_KEY`、Gmail OAuth、Nango 等凭证由部署 Secret 提供，未写入仓库。
- [ ] Wrangler dry-run 在 local、staging、production 三个环境通过。
- [ ] PostgreSQL 集成测试、Mail Core 测试、服务端 TypeScript 检查和前端生产构建通过。

## 3. Gmail 共享 Pub/Sub 配置

每个 GCP Project 执行一次：

- [ ] Topic 名称与 `GMAIL_PUBSUB_TOPIC_NAME` 完全一致，格式为
      `projects/{project}/topics/{topic}`。
- [ ] Gmail 系统发布身份 `gmail-api-push@system.gserviceaccount.com` 对 Topic 具有
      `roles/pubsub.publisher`。
- [ ] Push Subscription 名称与 `GMAIL_PUBSUB_SUBSCRIPTION_NAME` 完全一致，格式为
      `projects/{project}/subscriptions/{subscription}`。
- [ ] Push URL 为
      `{VITE_PUBLIC_BACKEND_URL}/api/mail/channels/gmail/push`，且仅使用 HTTPS。
- [ ] Push Subscription 启用 OIDC；签发身份为
      `GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT`。
- [ ] OIDC Audience 与 `GMAIL_PUBSUB_PUSH_AUDIENCE` 完全一致。
- [ ] Pub/Sub 服务代理具备用指定服务账号签发 OIDC Token 所需权限。
- [ ] 推送请求包含正确的
      `x-goog-pubsub-subscription-name`，服务端会同时验证 Subscription、Issuer、
      Audience 和 Service Account。
- [ ] Topic/Subscription 由部署任务管理；普通账号绑定、断开和删除流程无创建、修改或
      删除共享资源的权限。

## 4. 环境级旧 Cloudflare 资源

先停止旧生产者并检查积压消息；只有确认新链路稳定且旧消息不再需要处理后，才删除外部资源。

### local

- [ ] 旧 Queue：`thread-queue`、`subscribe-queue`、`send-email-queue`。
- [ ] 旧 Workflow：`sync-threads-workflow`、`sync-threads-coordinator-workflow`。
- [ ] 旧 KV Binding/Namespace：
      `gmail_history_id` (`4e814c70e35d413d99c923029928efae`)、
      `gmail_processing_threads` (`b7db3a98a80f4e16a8b6edc5fa8c7b76`)、
      `subscribed_accounts` (`7e6eadacf19c4c56a9ec3c357adb584a`)、
      `connection_labels` (`4d3a28d3265a4388aae2e9e9b534d019`)、
      `prompts_storage` (`620e710aaea744e59df4788f9ec18ff9`)、
      `gmail_sub_age` (`c55e692bb71d4e5bae23dded092b09d5`)、
      `pending_emails_status` (`7f277903ebab4b4d89f5d59b1f531073`)、
      `pending_emails_payload` (`d5da698931524da9992fe398e095fc32`)、
      `scheduled_emails` (`444cad0e54114635b5199ffae9542bd5`)、
      `snoozed_emails` (`f3a30ed7198542d890db172536bade33`)。

### staging

- [ ] 旧 Queue：`thread-queue-staging`、`subscribe-queue-staging`、
      `send-email-queue-staging`。
- [ ] 旧 Workflow：`sync-threads-workflow-staging`、
      `sync-threads-coordinator-workflow-staging`。
- [ ] 历史配置与 local 共用了上列 KV Namespace ID；删除前必须确认 local 与 staging
      均已停止访问，不能按单一环境提前删除。

### production

- [ ] 旧 Queue：`thread-queue-prod`、`subscribe-queue-prod`、
      `send-email-queue-prod`。
- [ ] 旧 Workflow：`sync-threads-workflow-prod`、
      `sync-threads-coordinator-workflow-prod`。
- [ ] 旧 KV Binding/Namespace：
      `gmail_history_id` (`10005d74e84f4f18a17c9618d9e9cecf`)、
      `gmail_processing_threads` (`3348ff0976284269a8d8a5e6e4c04c56`)、
      `subscribed_accounts` (`5902b3b948ff4c4ba1aedbbbbe25503d`)、
      `connection_labels` (`9a13290a55ad4f62824c67005dd66f6f`)、
      `prompts_storage` (`2a4ebda553f3456085cfcf92cc0f570f`)、
      `gmail_sub_age` (`0591e91fffcc4675aaf00f909bee77d2`)、
      `pending_emails_status`（历史配置 ID：
      `e65f8f72441d4eadb9d5ae36269316c9`）、
      `pending_emails_payload`、`scheduled_emails`（历史配置使用派生占位 ID，删除前必须从
      Cloudflare 实际环境重新解析真实 Namespace ID）、
      `snoozed_emails` (`f0952e9c3b024cb499c4b9dfe8bb603e`)。

### 所有环境

- [ ] Agent/Chat/Brain 的 AI Binding 已从 Worker 配置移除。
- [ ] 不再使用的 Vectorize Index：
      local/staging 的 `threads-vector-staging`、`messages-vector-staging`，
      production 的 `threads-vector`、`messages-vector`；确认无其他应用共享后再删除。
- [ ] `ZeroAgent`、`ZeroMCP`、`ZeroDriver`、`ThinkingMCP`、`WorkflowRunner`、
      `ThreadSyncWorker`、`ShardRegistry` 已通过新增 `deleted_classes` migration 退役。
- [ ] 不改写 Wrangler 历史 migration；部署成功后再核对旧 DO 类实例已清理。

## 5. 发布顺序

1. [ ] 备份当前部署配置与 PostgreSQL（即使开发库允许重建，也保留问题定位依据）。
2. [ ] 创建/核对新 PostgreSQL Schema、共享 Gmail Pub/Sub 和两条新 Queue。
3. [ ] 部署包含 `deleted_classes`、新 Mail Sync/Outbound 和已移除旧绑定的 Worker。
4. [ ] 验证新 Worker 只产生和消费 `MAIL_INGRESS_QUEUE`、`MAIL_OUTBOUND_QUEUE`。
5. [ ] 完成第 6 节真实运行验收并观察错误率、Queue 积压、租约恢复和数据库状态。
6. [ ] 停止旧 Queue/Workflow 的生产者与消费者。
7. [ ] 检查并处理旧 Queue 剩余消息；记录丢弃理由与数量。
8. [ ] 移除旧 Binding 后再次部署，确认没有代码读取旧资源。
9. [ ] 按环境删除旧 Queue、Workflow、KV、Vectorize 等外部资源。
10. [ ] 保留 Wrangler migration 历史、`ZERO_DB`、`THREADS_BUCKET`、Hyperdrive 和两条新 Queue。

## 6. 真实运行验收

由用户启动现有 Docker/开发环境后执行；不额外安装 Playwright 或浏览器。

- [ ] PostgreSQL 集成测试全部通过，重点覆盖 Schema、账户生命周期、同步、
      认证恢复、调度租约、Outbound 最终确认。
- [ ] 新绑定 Gmail：只建立当前 History ID 基线，不导入绑定前历史。
- [ ] Gmail Push：通知先写入 PostgreSQL，再 ACK；Queue 发送失败后定时扫描可恢复。
- [ ] Push 与定时 reconcile 同时触发：同一 Sync 只有一个 Discovery Lease，
      新 Generation 不丢失。
- [ ] 收到 Inbox 新邮件：原始 MIME、本地 Email、Thread、Inbox Membership、
      Remote Mapping 和 Change Log 正确。
- [ ] Gmail 认证失效：同步项保持待重试，Sync 进入 `auth_error`；重新授权后使用新基线，
      原待重试邮件可以继续导入。
- [ ] Gmail History Gap：明确记录 `GMAIL_HISTORY_GAP`，不自动全量同步；重新授权后从
      当前 History ID 恢复未来增量。
- [ ] Gmail API 发件成功：同一事务内完成 Draft→Sent、Submission、Delivery、
      Attempt 和 Gmail messageId/threadId 映射。
- [ ] 不确定发送结果：先 reconciliation，不能直接盲目重发。
- [ ] 断开邮箱：停止本地新同步/新投递，best-effort 停止 Watch，保留本地数据时仍可浏览。
- [ ] 重新授权：复用 Connection、MailAccount、Mailbox、Identity 和本地邮件，
      不创建第二套本地邮箱。
- [ ] 删除邮箱数据：R2 对象删除失败时保持 `deleting` 可重试；成功后相关 PostgreSQL
      数据级联清理。
- [ ] 浏览器使用现有 Chrome 完成登录、账户切换、Inbox、Thread、Draft、发送、
      Sent、Trash、Archive、Snooze 和本地标签操作。

## 7. 回滚判据

- Gmail Push 大量返回 401/5xx；
- PostgreSQL 出现同一账号多条活动 Sync 或重复活动绑定；
- Queue 积压持续增长且调度扫描无法重新唤醒；
- Discovery/Delivery 租约持续无法释放或接管；
- Draft 已从本地消失但 Submission/Delivery 未形成最终状态；
- 旧资源退役前发现仍有正式调用流量。

触发任一条件时，停止外部资源删除；保留数据库权威状态和新 Queue 消息，回滚 Worker
版本或修复配置。不得恢复旧远端 Gmail 状态作为本地事实来源，也不得同时启用新旧两套
邮件消费者。
