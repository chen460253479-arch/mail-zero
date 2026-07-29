# Gmail Watch 仅配置 Topic 的设计

## 目标

Zero 的 Gmail Inbox Watch 与 Nango `google-mail/actions/watch-mailbox.ts` 以及 Gmail
`users.watch` 接口保持一致：管理员开启 Watch 后只需要填写完整的 Google Cloud Pub/Sub
Topic 名称。

```text
projects/{project-id}/topics/{topic-name}
```

Zero 不增加 Subscription、OIDC Audience、Push Service Account 或其他部署配置。

## 范围

本次调整只收敛 Gmail Watch 的配置和 Webhook 接收边界：

- Gmail 配置界面只保留 `Topic name` 输入框。
- 固定的 Webhook endpoint 继续以只读方式展示，供管理员配置 Google Pub/Sub 推送订阅。
- Gmail 渠道配置的 `providerConfig` 只保存可选的 `topicName`。
- 开启 Inbox Watch 时，`topicName` 是唯一必填的 Provider 配置。
- Watch 的创建、续订和恢复继续复用现有 `topicName`。
- Webhook 继续进入现有幂等增量同步链路。

本次不包含：

- 由 Zero 创建、修改或删除 Google Cloud Pub/Sub Topic/Subscription。
- Gmail `labelIds` 或 `labelFilterBehavior` 的界面配置。
- 新增环境变量或数据库字段。
- 改变定时增量同步、手动同步或 Gmail 发件链路。

## 配置模型

调整后的 Gmail 渠道配置：

```ts
type GmailChannelProviderConfig = {
  topicName?: string;
};
```

配置验证规则：

- `inboxWatchEnabled=false` 时，`providerConfig` 可以为空。
- `inboxWatchEnabled=true` 时，`topicName` 必须匹配
  `projects/{project-id}/topics/{topic-name}`。
- `subscriptionName`、`pushAudience`、`pushServiceAccount` 从前端表单、tRPC 输入、
  渠道配置 Schema 和持久化 JSON 中移除。
- 现有数据库表结构不发生变化，因为 Provider 配置存储在现有 JSON 配置中。

## Webhook 数据流

Google Pub/Sub 的推送请求进入 Zero 的固定 Gmail Webhook：

1. 读取全局 Gmail 渠道配置。
2. 如果 Inbox Watch 已关闭，返回成功响应且不产生同步信号。
3. 解析标准 Pub/Sub Envelope 中经过 Base64 编码的 Gmail 通知。
4. 只接受包含合法 `emailAddress` 和数字 `historyId` 的消息。
5. 只为 Zero 中已存在、已绑定的 Gmail 邮箱记录同步信号。
6. 将匹配到的同步任务投递到现有 Discover/增量同步链路。
7. 无效消息返回 `204`，避免 Pub/Sub 对永久无效负载持续重试。

Webhook 不再依赖 Authorization Header、
`x-goog-pubsub-subscription-name`、OIDC Audience 或 Service Account。删除现有 Gmail
`push-auth` 模块及其专用测试。

这不会允许请求直接写入邮件数据。Webhook 只提供同步唤醒信号；实际邮件仍由 Zero 使用已绑定
Gmail 凭据调用 Gmail API 获取，并经过现有 Generation、Lease、去重和幂等入站链路落库。
未知邮箱不会匹配本地同步任务。

## 前端

Inbox Watch 开启后的界面只显示：

- `Topic name`：可编辑且必填。
- `Webhook endpoint`：只读，用于复制到 Google Pub/Sub Push Subscription。

删除以下表单字段、错误提示和序列化逻辑：

- `Subscription name`
- `OIDC audience`
- `Push service account`

定时增量同步开关和同步间隔保持不变。

授权方式遵循全局单一来源规则：

- Gmail 渠道首次保存后，数据库中的 `authSource` 成为该渠道的固定授权来源。
- 后续保存可以调整 Watch、Topic 和定时同步配置，但不得切换授权来源。
- 前端必须等待最新配置完成回填后再展示表单，并禁用已配置渠道的授权来源选择。
- 后续更换授权来源必须使用独立的渠道重置流程，本次不增加该流程。

保存交互：

- 渠道配置保存并刷新外层集成数据成功后，同步清除未保存标记，显示成功提示并关闭弹窗。
- 保存或刷新失败时保持弹窗打开，保留当前输入并显示错误提示。

## 错误处理

- Topic 格式错误：保存配置时返回现有的输入校验错误。
- Webhook JSON 或 Pub/Sub Envelope 无效：返回 `204`，不记录信号。
- `emailAddress` 或 `historyId` 无效：返回 `204`，不记录信号。
- 通知对应邮箱未绑定：返回成功响应，匹配数为零。
- 部分同步唤醒入队失败：保持现有 `Promise.allSettled` 行为，成功任务照常入队。

## 测试

自动化测试需要覆盖：

- 开启 Watch 时只要求 `topicName`。
- Gmail 渠道配置的解析结果不再保留三个已删除字段。
- 前端不再渲染或序列化三个已删除字段。
- Gmail 渠道保存并刷新成功后关闭弹窗，失败时不关闭。
- Gmail 渠道首次保存后授权来源锁定，API 与前端都不能直接切换。
- 表单只在最新 Gmail 配置完成回填后展示，已保存的 Nango 不得显示成默认 Zero OAuth。
- Gmail `watchInbox()` 仍只接收 `topicName`。
- Webhook 不要求 Authorization Header 或 Subscription Header。
- Watch 关闭时 Webhook 不记录同步信号。
- 合法 Pub/Sub 消息记录标准 Gmail 同步信号并触发 Discover。
- 无效、未知或畸形消息不写入邮件数据。
- 现有定时同步与 Watch 续订测试继续通过。

## 验收标准

- 管理员开启 Gmail Inbox Watch 后，只需要填写 Topic name。
- Zero 不新增任何 Gmail Pub/Sub 环境变量。
- Gmail 渠道配置中不再存在 Subscription、OIDC Audience、Push Service Account。
- 固定 Webhook endpoint 仍然可复制使用。
- 已配置为 Nango 的 Gmail 渠道重新打开后显示并锁定 Nango。
- Gmail Watch 创建、续订、Webhook 唤醒和增量同步链路测试全部通过。
