# Zero 邮件手动标记 CRM 客户设计

## 背景

Zero 在接收入站邮件后，会通过可靠 Outbox 向 CRM 的 `POST /webhook/zero/mail` 投递
`eventId` 和 `messageId`。CRM 当前已经支持可选的 `createCustomerIfMissing`：普通自动事件保持
只匹配客户，人工事件可以在未匹配时通过统一 Customer Upsert 创建客户，并通过现有异步任务回调
Zero 的 customer-marker 接口。

本设计补齐 Zero 的人工入口、建客意图持久化、服务间认证和回调后的页面反馈。CRM 现有客户匹配、
统一建客、事件幂等和 customer-marker 业务链路继续复用。

## 目标

- 在邮件内容页顶部工具栏提供图标动作“标记为客户”。
- 仅允许对当前账号中尚无客户标记的入站邮件发起操作。
- 每次人工确认生成新的事件标识，并可靠投递 `createCustomerIfMissing=true`。
- CRM 匹配或创建客户后，通过现有回调写入 Zero 客户标记。
- 页面不乐观伪造客户标记；只有收到 CRM 回调后才展示真实客户入口。
- 为 Zero 到 CRM 的 Webhook 增加与现有双向集成一致的服务令牌认证。

## 非目标

- 不自动为所有未知发件人创建客户。
- 不批量导入同一发件人的历史邮件。
- 不新增人工操作审计表或 CRM 建客进度表。
- 不让浏览器直接访问 CRM Webhook。
- 不重写 CRM 已有邮件导入、Customer Upsert、负责人分配或 customer-marker 链路。

## 用户界面

### 显示条件

顶部动作仅在同时满足以下条件时显示：

- 当前会话没有任何 CRM customer marker；
- 当前会话至少有一封 `lifecycle=received` 的非草稿邮件；
- 当前邮箱账号处于可访问、活动状态。

一旦 CRM 回调成功并刷新出 customer marker，“标记为客户”动作消失，继续显示现有客户会话入口。

### 工具栏位置和样式

- 动作位于邮件内容页顶部工具栏的“标签”图标之后、“删除”图标之前。
- 使用 Lucide `UserRoundPlus` 图标，复用同一工具栏的尺寸、留白、圆角和 hover 样式。
- 默认采用中性色，不使用删除动作的红色强调；该动作会创建外部业务数据，但不是破坏性操作。
- Tooltip 和 `aria-label` 均使用“标记为客户”。
- 请求提交期间禁用重复点击，并将图标替换为旋转的 loading 图标。

### 目标邮件选择

页面顶部动作作用于当前会话中最新一封 `received` 邮件。确认框必须显示该邮件的发件人名称和邮箱，
使多参与者会话中的目标明确。若会话没有入站邮件，则不显示动作；不得退回到最新已发送邮件。

### 交互反馈

1. 用户点击图标后看到确认框：“将 `<发件人>` 标记为 CRM 客户？”
2. 用户确认后调用 Zero 的私有 API。
3. API 仅表示请求已可靠入队。页面提示“已提交 CRM，处理完成后将自动标记”。
4. 页面短时轮询当前会话详情；发现 customer marker 后停止轮询并展示真实客户入口。
5. 达到轮询上限仍未收到回调时，停止前台轮询并提示任务仍在后台处理，不宣称建客失败。

## Zero 服务端设计

### 私有 API

在 Mail API 下新增语义明确的 mutation，例如 `mail.crm.requestCustomerCreation`，输入：

```ts
{
  accountId: string;
  messageId: string;
}
```

该 mutation 必须复用 `mailAccountProcedure`，由服务端完成以下校验：

1. 会话用户有权访问 `accountId`，账号状态为 active；
2. `messageId` 属于该账号且邮件未删除；
3. 邮件 `lifecycle` 必须为 `received`；
4. 邮件或其会话已有 customer marker 时返回 `alreadyMarked`，不创建事件；
5. Webhook、URL 和集成令牌均已配置，否则返回明确的不可用错误；
6. 通过校验后生成新的 ULID，并将人工建客事件写入 Outbox。

成功响应返回 `accepted` 和 `eventId`。它只证明 Zero 已可靠接收操作，不代表 CRM 已创建客户。

### Outbox 契约

`mail.notification_outbox` 新增：

```sql
create_customer_if_missing boolean not null default false
```

- 现有自动入站和出站通知写入 `false`，保持兼容行为。
- 人工“标记为客户”事件写入 `true`。
- claimed event、Repository 映射和投递器必须携带该字段。
- 重试同一 Outbox 记录继续使用同一个 `eventId`。
- 用户再次明确触发人工操作时生成新的 `eventId`。

人工入队需要返回实际插入结果，不能沿用“功能关闭时静默忽略”的语义。账号归属和邮件生命周期必须在
服务端校验，不能相信浏览器输入。

### Webhook 请求

投递 JSON 为：

```json
{
  "eventId": "...",
  "messageId": "...",
  "createCustomerIfMissing": true
}
```

自动事件发送 `false`。HTTP 请求增加：

```text
Authorization: Bearer <INTEGRATION_API_TOKEN>
Content-Type: application/json
```

Zero 配置校验改为：`MAIL_WEBHOOK_ENABLED=true` 时，`MAIL_WEBHOOK_URL` 与
`INTEGRATION_API_TOKEN` 都是必填项。令牌不得进入日志、错误消息或测试快照。

## CRM 设计

### Webhook 认证

CRM Gateway 继续将 `/ads/webhook/zero/mail` 转发给 ADS。Controller 可以保留 `@SaIgnore` 以绕过
面向用户的登录认证，但在解析和持久化任务前必须验证 Bearer token。

校验使用已有 `ads.zero.api-token`，采用恒定时间比较：

- 缺失或错误令牌返回 `401`；
- 合法令牌且载荷错误返回 `400`；
- 任务持久化成功返回 `202`；
- 集成关闭或任务持久化失败返回 `503`。

### 业务链路

CRM 已有行为保持不变：

1. ADS 以 `eventId` 幂等接收 Zero 事件；
2. ADS 使用服务令牌从 Zero 拉取邮件摘要、内容和附件；
3. 仅 `lifecycle=received` 的邮件进入 Customer 导入；
4. `createCustomerIfMissing=true` 且没有活动客户匹配时，走统一 Email source Customer Upsert；
5. 已有客户直接复用，不覆盖其初始来源身份；
6. 当前邮件导入成功或判定为重复后，发布现有 customer-marker 任务；
7. ADS 使用服务令牌回调 Zero，写入真实 `customerId` 和 `customerName`。

## 幂等与并发

- Zero Webhook 传输重试：同一 Outbox 事件保持同一 `eventId`。
- CRM Webhook 入站：以 `eventId` 去重。
- CRM Customer 导入：人工事件的幂等键包含 `sourceEventId`，允许普通匹配事件之后重新执行人工建客。
- 重复人工点击：会形成不同事件，但 CRM 的 Email source 唯一身份和 Customer Upsert 必须收敛到同一客户。
- 前端在单页面请求期间禁用按钮，减少误触；不以客户端状态承担最终幂等责任。
- Zero customer-marker 写入保持 upsert 语义，重复回调不会创建重复标记。

## 失败处理

- Zero 私有 API 校验失败：不写 Outbox，页面显示可理解的原因。
- CRM 返回非 2xx、网络超时或连接失败：沿用 Zero Outbox 的指数退避和最多十次投递。
- CRM 已接受但下游异步处理尚未完成：Zero 不将其视为客户已创建，等待 customer-marker 回调。
- CRM 最终跳过无效发件人、自发邮件或非入站邮件：不得回调虚假客户标记。
- customer-marker 回调暂时失败：沿用 CRM service-drive 重试。
- 页面轮询超时：只停止前台等待，不取消已经提交的后台任务。

## 测试设计

### Zero

- 候选选择单元测试：只选择最新入站邮件，不选择草稿或已发送邮件。
- 工具栏测试：未标记时显示 `UserRoundPlus`，已标记或无入站邮件时隐藏。
- 交互测试：确认、pending 禁用、accepted 提示、回调后刷新和轮询超时。
- 私有 API 测试：账号归属、活动状态、邮件归属、received 限制、alreadyMarked 和配置缺失。
- Outbox 集成测试：人工标志落库、claim 映射、新事件 ID、同事件重试和 disabled 不得伪成功。
- 投递器单元测试：JSON 包含布尔字段，Authorization 正确，日志不包含令牌。
- 配置测试：启用 Webhook 时 URL 或 token 缺失均拒绝启动。

### CRM

- Controller 测试：缺失或错误 Bearer 返回 `401`，合法 Bearer 接受旧载荷和新载荷。
- 保留并运行已有默认 `false`、显式 `true`、事件幂等、建客、已有客户复用和 marker 回调测试。
- 验证无效发件人、自发邮件和 sent 邮件不创建客户。

### 联调验收

1. 未知发件人的最新入站邮件显示图标动作。
2. 确认后 Zero 写入新事件并携带 `createCustomerIfMissing=true`。
3. CRM 创建且只创建一个客户，只导入当前邮件。
4. CRM 回调后，Zero 页面自动出现客户标记和客户会话入口。
5. 已有客户场景不创建重复客户，但仍能补写 Zero 标记。
6. 普通自动 Webhook 不会为未知发件人创建客户。
7. 未认证的 CRM Webhook 请求不能创建任务或客户。

## 发布顺序

1. 先为生产 Zero 配置集成令牌，部署 Zero 数据库迁移和服务端 Outbox/投递变更；此时先不开放前端人工
   动作。CRM 尚未强制认证时会安全忽略新增的 Authorization 请求头。
2. 部署 CRM Webhook Bearer 校验，确认普通自动事件继续得到 `202`。
3. 部署 Zero 私有 API 和前端图标动作。
4. 通过真实测试租户验证建客、回调标记、重复触发和失败重试。

回滚前端和人工 API 不影响普通自动投递；数据库布尔列可保留。若回滚认证，需要同步评估外部暴露风险，
不得只回滚其中一端造成持续认证失败。
