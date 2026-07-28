# Gmail 渠道统一配置与入站触发设计

日期：2026-07-28

## 1. 结论

Zero 的 Integration 页面改为“渠道卡片 + 渠道配置弹窗”。第一阶段只启用 Gmail
渠道；Nango 是 Gmail 可选的授权基础设施，不作为独立邮件渠道展示。

Gmail 全局只能启用一种授权方式：

```text
zero_oauth | nango
```

Gmail Inbox Watch、定时增量同步和手动刷新只是三种同步触发方式。它们统一进入现有
`modules/mail-sync` 增量同步链路，不各自实现同步算法，也不增加独立状态机或协调服务。

Gmail Pub/Sub Webhook 是 Gmail 插件的入站能力。Zero 只提供固定接收接口；公网 HTTPS、
Nginx 反向代理以及 Google Cloud Pub/Sub Topic/Subscription 由部署方管理。

本设计替代以下历史设计中与当前结论冲突的部分：

- Integration 页面独立展示 Nango 卡片；
- 连接邮箱时由用户选择 Zero OAuth 或 Nango；
- Gmail 绑定必须同步完成 Watch 创建才算成功。

既有凭据加密、邮箱身份验证、授权绑定、同步幂等和本地邮箱数据模型继续有效。

## 2. 目标

- Integration 首页按邮件渠道展示，不暴露授权基础设施的内部组织方式。
- Gmail 使用独立的大型配置弹窗管理全局授权与自动同步设置。
- Gmail 全局只使用一种授权方式，新增邮箱自动使用该方式。
- Inbox Watch 与定时增量同步可独立启停。
- 两种自动同步都关闭时允许手动增量同步。
- Gmail Webhook 解析和验证完整归属 Gmail 插件。
- 修复 Watch 或同步初始化失败被误报为重复绑定的问题。
- 复用现有本地邮箱内核与 `modules/mail-sync`，不引入额外协调层。

## 3. 非目标

- 不实现 Outlook、Zoho Mail 或 IMAP/SMTP 渠道。
- 不让 Zero 创建、修改或删除 Google Cloud Pub/Sub 资源。
- 不让 Zero 管理公网域名、TLS 证书或 Nginx 配置。
- 不探测 Webhook 的公网可达性。
- 不进行 Gmail Inbox 历史全量同步；绑定后仅从当前 `historyId` 开始增量同步。
- 不把 Gmail 标签、文件夹或状态修改反向同步到 Gmail。
- 不新增授权、同步和 Watch 三套独立状态机。
- 不在本项目中处理 Nango Base URL 任意地址限制；该安全收敛留给后续专项。

## 4. 前端交互

### 4.1 Integration 首页

Integration 首页只展示渠道卡片：

```text
Gmail       已接入
Outlook     未接入
Zoho Mail   未接入
IMAP/SMTP   未接入
```

Nango 不显示为渠道卡片。未实现渠道不可进入配置流程。

### 4.2 Gmail 配置弹窗

点击 Gmail 卡片打开路由驱动的大型弹窗。弹窗使用独立路由，因此支持刷新恢复、浏览器
返回和直接访问；桌面端使用内部滚动与固定操作栏，移动端使用全屏。

弹窗分为三组：

1. **授权方式**
   - `Zero OAuth`
   - `Nango Gmail`
2. **Gmail Inbox Watch**
   - 全局开关
   - 开启时显示 Topic、Subscription、OIDC Audience、推送服务账号
   - 显示由公开后端地址与固定路径组成的只读 Webhook 地址
3. **定时增量同步**
   - 全局开关
   - 开启时显示同步周期

初次配置默认启用定时增量同步，周期为 10 分钟；Inbox Watch 默认关闭。管理员可以关闭
两种自动触发，此时界面提示 Gmail 处于“仅手动同步”模式。

选择 `Nango Gmail` 时，弹窗内显示 Nango Base URL、Secret 配置状态和 Gmail
Integration 选择。Nango 已配置时复用现有配置；未配置时必须先完成验证。选择
`Zero OAuth` 时显示 Client ID、Client Secret 配置状态、Redirect URL 和现有 OAuth
验证流程。

存在未保存修改时关闭弹窗需要确认。

## 5. 全局配置模型

新增 `integration.channel_config`，每个渠道最多一条记录：

```text
id
channel_id                 UNIQUE
auth_source
inbox_watch_enabled
scheduled_sync_enabled
sync_interval_minutes
provider_config            JSONB
updated_by
created_at
updated_at
```

Gmail 第一阶段约束：

```text
channel_id = gmail
auth_source IN (zero_oauth, nango)
sync_interval_minutes BETWEEN 1 AND 1440
```

`provider_config` 只保存 Gmail 非敏感配置，并由 Gmail 插件的 Zod Schema 解析：

```text
topic_name
subscription_name
push_audience
push_service_account
```

`updated_by` 引用当前 PostgreSQL `auth.user_account`。配置写入必须使用数据库会话确认的
当前用户，不使用 Redis 或 Cookie 中可能失效的旧用户 ID。

现有 `integration.system_config` 继续保存并加密：

- Nango Secret Key；
- Gmail Zero OAuth Client Secret。

现有 `integration.channel_mapping` 继续保存 Gmail 到 Nango Integration 的映射。
每邮箱的 `integration.authorization_binding` 继续保存实际授权来源；同步表继续保存
`historyId`、租约、待处理 generation、订阅过期时间和最后错误。

## 6. 授权方式规则

- Gmail 渠道只存在一个全局生效的 `auth_source`。
- Connect Email 不再展示授权来源选择。
- `zero_oauth` 自动发起 Zero 管理的 Gmail OAuth。
- `nango` 自动展示全局映射下可用的 Nango Gmail Connections。
- 仍存在 Gmail Authorization Binding 时禁止切换全局授权方式。
- 切换前需要断开相关邮箱授权；本地邮件可以保留。
- 切换后使用新方式重新授权相同邮箱，并复用保留的本地邮箱身份。
- 未选中的授权配置可以保留，但运行时不得使用。

升级时如果发现现有 Gmail Bindings 同时使用两种来源，不自动选择。管理接口返回明确
冲突，管理员必须先断开其中一类绑定，再保存全局授权方式。

## 7. Gmail Webhook 插件边界

固定公网路径为：

```text
POST /api/mail/channels/gmail/push
```

Nginx 将公网 HTTPS 请求代理到 Zero Server。Zero 不调用 Google Cloud Pub/Sub 管理 API。

目录职责：

```text
apps/server/src/mail-channel/gmail/inbound/
├── adapter.ts
├── webhook.ts
├── push-auth.ts
└── history-mapper.ts
```

- Server HTTP 入口只挂载路由并把请求交给 Gmail 入站 Webhook。
- `webhook.ts` 负责 Gmail Pub/Sub 请求的完整提供商语义。
- `push-auth.ts` 校验 OIDC Token、Audience、Subscription 和服务账号。
- Webhook 解析 Pub/Sub Envelope，得到 `emailAddress` 与 `historyId`。
- Gmail 插件输出公共入站信号，不直接实现本地邮件导入。
- `modules/mail-sync` 记录信号、合并请求并执行增量发现与导入。

未来 Outlook 可以实现自己的 `mail-channel/outlook/inbound/webhook.ts`，但转换后的公共
信号继续进入同一 `modules/mail-sync`。本阶段不建立动态路由注册框架。

Gmail `users.watch` 只接收共享 `topicName`。Pub/Sub Subscription 的 Push Endpoint、
OIDC 服务账号和 Audience 由部署方在 Google Cloud 中配置。

## 8. 同步触发与冲突处理

```text
Gmail Pub/Sub ─┐
定时调度器 ────┼─> requestSync ─> 现有 mail-sync ─> 本地 Inbox
手动刷新 ──────┘
```

- Pub/Sub 使用 `historyId` 作为 cursor hint。
- 定时任务按全局周期为已连接 Gmail 邮箱申请同步。
- 手动刷新始终允许申请一次增量同步。
- 全局开关只决定是否产生对应的自动触发，不改变同步算法。
- 多个触发同时发生时，复用现有 generation 与数据库租约合并请求。
- 同步执行期间到达更新时提升目标 generation，当前执行完成后继续处理。
- 邮件继续依靠服务商消息 ID 唯一约束幂等入库。
- `historyId` 只在增量页成功持久化后推进。
- 定时同步关闭时不领取 Gmail 定时任务。
- Watch 关闭时不创建或续订邮箱 Watch；不删除共享 Topic/Subscription。

绑定时无论自动触发是否开启，都建立当前 Gmail `historyId` 作为增量起点。两种自动
触发都关闭时仅保留手动同步入口。

## 9. 绑定与错误边界

绑定流程保持最小：

1. 按全局授权方式取得 Gmail 凭据并验证真实邮箱身份。
2. 在本地数据库事务中创建或恢复 Connection、Authorization Binding 和 Mail Account。
3. 建立当前 Gmail `historyId`。
4. Watch 开启时尽力调用 Gmail `users.watch`。
5. 定时同步开启时由现有调度查询纳入后续增量同步。

错误规则：

- Gmail 身份或凭据无效：绑定失败或标记 `reconnect_required`。
- 本地唯一约束发生真实冲突：返回邮箱或 Nango Connection 已绑定。
- Watch 创建失败：记录到现有同步错误字段，保留有效邮箱绑定。
- 定时同步开启时，Watch 失败不阻止定时增量同步。
- Watch 或同步初始化异常不得映射成 `NANGO_CONNECTION_ALREADY_BOUND`。
- 重复绑定判断只包围授权绑定写入，不包围 Watch 和增量同步调用。

该行为参照 EmailEngine：Watch 创建与续订失败记录 `watchFailure`，但不会将已验证的
邮箱账号误判为授权失败；Push、补偿轮询和手动同步复用同一 Gmail 增量处理路径。

## 10. API 边界

`integrations` 模块统一对外提供：

```text
integrations.getChannels
integrations.getGmailConfig
integrations.saveGmailConfig
integrations.startGmailValidation
integrations.getGmailValidationStatus
```

`saveGmailConfig` 组合调用既有 Nango、Gmail OAuth 配置服务，不复制 Secret
处理逻辑。它只在所选授权方式的必需配置有效后保存渠道配置。

`connections` 模块继续提供邮箱绑定、断开、重连和清理本地数据，但绑定入口不再接收
由前端决定的授权来源；服务端读取 Gmail 全局配置进行路由。

所有配置 API 仍为管理员权限。响应不得包含 Nango Secret、OAuth Client Secret、
Access Token、Refresh Token 或加密字段。

## 11. 测试与验收

### 数据与服务

- `channel_config` 唯一约束、授权来源检查和同步周期边界。
- Gmail `provider_config` Schema 拒绝无效 Topic、Subscription、Audience 和服务账号。
- `updated_by` 始终来自当前数据库会话用户。
- 存在 Gmail Bindings 时禁止切换授权方式。
- 无绑定时能够切换授权方式。

### Gmail 插件

- Webhook OIDC、Audience、Subscription 和服务账号校验。
- Pub/Sub Envelope 与 Base64URL Payload 解析。
- 无效 Payload 不产生同步任务。
- 有效 Payload 产生公共 Gmail 入站信号。
- Gmail 专属 Webhook 逻辑不残留在 `main.ts`。

### 同步

- Push、定时和手动触发复用相同 `requestSync`。
- 并发触发通过 generation 和 lease 合并。
- 重复通知不重复写入邮件。
- Watch 关闭时不调用 `users.watch`。
- 定时同步关闭时不派发定时 Gmail 同步。
- 两者关闭时手动增量同步仍可用。
- 初次绑定只建立当前 checkpoint，不导入历史 Inbox。

### 绑定回归

- Watch 配置缺失或 Gmail Watch 调用失败不会伪装成重复绑定。
- Watch 失败后本地邮箱与授权绑定仍可使用。
- 真正重复的 Nango Connection 仍返回 `NANGO_CONNECTION_ALREADY_BOUND`。
- 授权失败与 Watch 失败返回不同、安全且稳定的错误。

### 前端

- Integration 首页不显示 Nango 卡片。
- Gmail 卡片打开路由驱动的配置弹窗。
- 授权方式只显示一项生效状态。
- Nango 和 Zero OAuth 表单按选择条件展示。
- Watch 与定时同步字段按开关条件展示。
- 两种自动触发关闭时显示“仅手动同步”提示。
- 未保存修改关闭弹窗时要求确认。

## 12. 实施约束

- 先添加失败测试，再修改实现。
- 不改动本地邮箱核心表与 JMAP 风格邮件数据结构。
- 数据库仍维护一份开发初始化模板，不增加时间线式开发迁移。
- 不安装或升级依赖，除非实施证明现有依赖无法满足并由用户明确执行安装。
- 不自动启动、重建或重启 Docker 服务。
- 保留工作区中与本设计无关的现有修改，不纳入本设计提交。
