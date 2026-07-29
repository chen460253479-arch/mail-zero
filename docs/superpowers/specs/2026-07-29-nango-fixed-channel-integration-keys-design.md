# Nango 渠道固定 Integration Key 设计

日期：2026-07-29

状态：已确认

## 1. 结论

Zero 不允许管理员或邮箱用户为 Gmail、Outlook、Zoho Mail、IMAP/SMTP 手工选择
Nango Integration。每个邮件渠道只对应一个由 Server 环境变量固定配置的 Nango
`provider_config_key`，前端只负责选择渠道授权来源和具体邮箱 Connection。

本设计替代此前设计中“在渠道配置界面选择 Nango Integration，并把映射保存到
`integration.channel_mapping`”的部分。Nango Base URL、Secret Key 和各渠道
Integration Key 均属于部署配置，不属于业务数据。

## 2. 配置归属

Server 支持以下私有环境变量：

```dotenv
NANGO_BASE_URL=https://api.nango.dev
NANGO_SECRET_KEY=
NANGO_GMAIL_INTEGRATION_KEY=gmail
NANGO_OUTLOOK_INTEGRATION_KEY=outlook
NANGO_ZOHO_MAIL_INTEGRATION_KEY=zoho-mail
NANGO_IMAP_SMTP_INTEGRATION_KEY=imap-smtp
```

配置规则：

- Base URL 和 Secret Key 继续决定 Zero 连接哪套 Nango 服务。
- 每个 `NANGO_*_INTEGRATION_KEY` 唯一确定该邮件渠道使用的 Nango Integration。
- 环境变量只传给 Server，不进入 Mail 构建参数、浏览器、API 响应、数据库或日志。
- 某个渠道 Key 缺失时，只禁用该渠道的 Nango 授权来源，不影响其他渠道、Zero OAuth、
  手工 IMAP/SMTP 或本地邮箱功能。
- 修改任一 Nango 环境变量后必须重启 Server。

## 3. 渠道插件边界

渠道插件继续声明自己接受的 Nango Provider 类型：

```text
gmail      -> google-mail | google
outlook    -> Microsoft 邮件 Provider 集合
zoho_mail  -> Zoho Mail Provider 集合
imap_smtp  -> 通用邮件凭据 Provider 集合
```

运行时配置层根据 `channelId` 读取固定 Integration Key；渠道插件不直接读取环境变量。
启动验证必须从 Nango Integrations 列表中找到该 Key，并确认其 Provider 属于插件声明的
允许集合。固定 Key 存在但 Provider 不匹配时，该渠道必须标记为不可用，不能尝试绑定。

## 4. 启动验证与状态

Nango 全局验证继续检查服务连通性、Secret Key 权限和 Connections 读取权限。在此基础上，
为每个渠道计算派生状态：

```text
unconfigured  固定 Integration Key 未配置
available     Key 存在且 Provider 与渠道插件匹配
unavailable   Key 不存在、Provider 不匹配或 Nango 全局运行时不可用
```

错误只输出脱敏错误码，例如：

```text
NANGO_CHANNEL_KEY_MISSING
NANGO_INTEGRATION_NOT_FOUND
NANGO_PROVIDER_MISMATCH
NANGO_INTEGRATION_UNAVAILABLE
```

日志和 API 不得返回 Secret Key、Access Token、Refresh Token、Connection 凭据或完整的
Nango 原始响应。

## 5. API 与数据流

前端绑定请求只提交：

```ts
{
  channelId: 'gmail' | 'outlook' | 'zoho_mail' | 'imap_smtp';
  connectionId: string;
}
```

后端绑定链路：

```text
channelId
  -> Server 固定 Integration Key
  -> 校验渠道派生状态
  -> 使用固定 Key 查询 Nango Connection
  -> 校验 Connection.provider_config_key 等于固定 Key
  -> 校验 Connection.provider 属于渠道插件允许集合
  -> 创建本地邮箱与授权绑定
```

以下 API 职责删除：

- 按渠道列出可供管理员选择的 Nango Integrations。
- 设置、修改或删除渠道到 Nango Integration 的人工映射。
- 从浏览器接收 `integrationId` 并据此查询或绑定 Nango Connection。

Connections 列表接口可继续返回安全的邮箱连接摘要，但必须由后端使用渠道固定 Key 过滤。

## 6. 数据库调整

删除仅用于人工映射的 `integration.channel_mapping` 表，以及对应 Schema、Repository、
服务、约束、测试快照和唯一初始化模板内容。

每个邮箱授权绑定中已有的 `nango_provider_config_key` 必须保留。它记录邮箱实际绑定时使用的
固定 Key，用于：

- 唯一性和重复绑定检查；
- 后续从 Nango 获取或刷新凭据；
- 断开、重连和故障诊断；
- 防止环境配置变化后静默路由到另一个 Nango Integration。

如果部署方修改某渠道固定 Key，已有绑定不会自动迁移；必须先断开相关授权，再使用新 Key
重新绑定。当前仍处于开发数据库可清空重建阶段，因此只更新唯一初始化模板，不增加时间线式
增量 SQL。

## 7. 前端调整

渠道配置弹窗保留：

- `Zero OAuth` 与 `Nango` 全局授权来源选择；
- Nango 授权来源的可用/不可用状态；
- Watch、Webhook 和定时增量同步等渠道配置。

删除：

- `Gmail Nango Integration` 等 Integration 下拉框；
- Integration 列表加载状态；
- `setNangoMapping` Mutation；
- 映射保存成功或失败提示；
- 重复展示的 Nango Integration 状态区块。

当固定 Key 不可用时，Nango 授权来源卡片显示安全错误状态并禁止保存为当前授权来源。

## 8. 测试与验收

自动化测试必须证明：

- 每个渠道只能读取自己的固定 Integration Key。
- 前端和公开 API 均不能提交或修改 `integrationId`。
- Key 缺失、Key 不存在和 Provider 不匹配分别产生稳定的安全错误。
- Connections 列表和绑定始终使用后端固定 Key。
- 伪造的 Connection、错误 Provider 或错误 `provider_config_key` 被拒绝。
- 删除 `integration.channel_mapping` 后数据库结构、初始化模板和快照一致。
- 已绑定邮箱仍保存 `nango_provider_config_key`，凭据读取和刷新链路不回归。
- Gmail、Outlook、Zoho Mail、IMAP/SMTP 的 Zero OAuth、手工凭据、同步和发件逻辑不受影响。
- Mail 前端不包含 Nango Secret、Base URL 或固定 Integration Key。

## 9. 非目标

- 不修改 Nango 内部 Integration 的创建和管理方式。
- 不允许 Zero 在运行时自动创建、重命名或删除 Nango Integration。
- 不根据 Provider 自动选择“第一个匹配的 Integration”。
- 不改变邮件同步、Webhook、Watch、发送 Spool 或本地邮箱数据模型。
- 不自动迁移已经绑定到旧 Nango Integration Key 的邮箱。
