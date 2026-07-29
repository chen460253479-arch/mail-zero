# Zero 邮件后端全新部署与验收清单

日期：2026-07-27
适用范围：`local`、`staging`、`production`

## 1. 执行边界

- 本清单只记录部署和验收动作，不授权自动修改 Cloudflare、GCP、Nango 或 Gmail 外部资源。
- 本清单只适用于全新创建或明确允许清空重建的 Cloudflare Worker；不得直接用于仍承载
  原 Zero Durable Object 历史的同名 Worker。
- Worker 只使用 Mail Core、Mail Accounts、Mail Sync、Mail Outbound 和新 MailChannel。
- PostgreSQL 仍处于允许清空重建的开发阶段，数据库初始化继续使用当前唯一模板；
  本阶段不创建时间线增量 SQL。
- Wrangler 的三个环境同样只维护当前初始化基线：`v1` 创建 SQLite `ZeroDB`。
- `THREADS_BUCKET` 已承载正式 Mail Core Blob，禁止因旧名称而删除。
- `ZERO_DB` 仍承载 Notes、Templates、Settings 等非邮件业务，禁止删除。
- 每个 GCP Project 只部署一组共享 Gmail Topic/Subscription；断开或删除单个邮箱账号
  不得删除共享资源。

## 2. 发布前检查

- [ ] 目标 Worker 尚未部署，或已经明确删除并允许重建；不存在需要保留的旧 Durable Object 数据。
- [ ] local、staging、production 均只有一个 `v1` migration，且仅声明
      `new_sqlite_classes: ["ZeroDB"]`。
- [ ] 数据库已由当前模板清空重建，`mail`、`integration`、`app`、`auth` Schema 与代码一致。
- [ ] `MAIL_INGRESS_QUEUE`、`MAIL_OUTBOUND_QUEUE` 已创建且生产者、消费者均绑定。
- [ ] `THREADS_BUCKET` 和 `HYPERDRIVE` 仍指向当前环境的正式资源。
- [ ] Gmail 渠道已启用 Inbox Watch，并在管理界面中保存完整的 Topic name。
- [ ] Nginx 已将管理界面只读展示的 Gmail Webhook URL 通过公网 HTTPS 暴露。
- [ ] `CREDENTIAL_ENCRYPTION_KEY`、Gmail OAuth、Nango 等凭证由部署 Secret 提供，未写入仓库。
- [ ] Wrangler dry-run 在 local、staging、production 三个环境通过。
- [ ] PostgreSQL 集成测试、Mail Core 测试、服务端 TypeScript 检查和前端生产构建通过。

## 3. Gmail 共享 Pub/Sub 配置

每个 GCP Project 执行一次：

- [ ] Gmail 渠道中配置的 Topic name 格式为 `projects/{project}/topics/{topic}`。
- [ ] Gmail 系统发布身份 `gmail-api-push@system.gserviceaccount.com` 对 Topic 具有
      `roles/pubsub.publisher`。
- [ ] 已创建一条指向 Zero Gmail Webhook URL 的 Push Subscription；Subscription 名称由
      GCP 部署侧自行管理，不写入 Zero。
- [ ] Push URL 与 Gmail 渠道界面只读展示的 Webhook endpoint 一致，且仅使用 HTTPS。
- [ ] Topic/Subscription 由部署任务管理；普通账号绑定、断开和删除流程无创建、修改或
      删除共享资源的权限。

## 4. Cloudflare Worker 当前基线

- [ ] 每个环境只绑定 `ZERO_DB` 一个 Durable Object 类，类名为 `ZeroDB`。
- [ ] `ZeroDB` 使用 SQLite Durable Object 初始化，不再创建 legacy KV Durable Object。
- [ ] Worker 配置只包含 `MAIL_INGRESS_QUEUE` 和 `MAIL_OUTBOUND_QUEUE` 两条邮件 Queue。
- [ ] Worker 配置不包含旧邮件 KV、Workflow、Vectorize、Agent、Chat、Brain 或 Driver 资源。
- [ ] `THREADS_BUCKET`、Hyperdrive、`ZERO_DB` 和两条新邮件 Queue 指向本项目当前环境资源。
- [ ] 如果 Cloudflare 账号中仍存在原 Zero 的外部资源，应先核对所有权和调用流量，再通过
      独立的基础设施退役任务处理；不得为了兼容这些资源把旧 migration 或绑定重新写回仓库。

## 5. 发布顺序

1. [ ] 备份当前部署配置与 PostgreSQL，保留问题定位依据。
2. [ ] 确认目标 Worker 是全新或可重建环境；如果同名 Worker 承载原 Zero 历史，停止部署并
       改用新 Worker 名称，或先由基础设施负责人明确删除旧 Worker。
3. [ ] 创建/核对当前 PostgreSQL Schema、共享 Gmail Pub/Sub 和两条新 Queue。
4. [ ] 使用单一 `ZeroDB` migration 部署新 Mail Sync/Outbound Worker。
5. [ ] 验证新 Worker 只产生和消费 `MAIL_INGRESS_QUEUE`、`MAIL_OUTBOUND_QUEUE`。
6. [ ] 完成第 6 节真实运行验收并观察错误率、Queue 积压、租约恢复和数据库状态。
7. [ ] 保留 `ZERO_DB`、`THREADS_BUCKET`、Hyperdrive 和两条新 Queue。

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
- 目标 Worker 并非全新环境，或发现仍需保留的原 Zero Durable Object 数据。

触发任一条件时，停止部署；保留数据库权威状态和新 Queue 消息，回滚 Worker
版本或修复配置。不得恢复旧远端 Gmail 状态作为本地事实来源，也不得同时启用新旧两套
邮件消费者。
