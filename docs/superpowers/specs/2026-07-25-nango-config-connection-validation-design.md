# Nango 配置保存与邮箱 Connection 选择解耦设计

日期：2026-07-25

## 1. 结论

`Settings → Integrations → Nango` 只负责配置和验证 Zero 使用的全局 Nango 服务，不要求 Nango 中预先存在任何 Connection。

Nango Connection 属于用户连接邮箱时选择的授权资源，只能在 `Email Connections → Connect Email → Gmail → Nango` 流程中浏览、验证和绑定。

因此，首次配置 Nango 时，即使 `List Connections` 返回空数组，只要服务连通、API Key 有效且列表权限验证通过，Zero 就保存该配置。当前 `NANGO_TEST_CONNECTION_REQUIRED` 阻止保存的行为需要移除。

## 2. 方案比较

### 方案 A：分阶段验证（采用）

- 系统配置阶段验证 Nango 服务、Integration 列表权限和 Connection 列表权限。
- 邮箱绑定阶段验证被选择 Connection 的凭据读取权限、真实邮箱身份和唯一性。
- 已存在 Zero-Nango 邮箱绑定时，Secret Key 轮换仍必须读取全部已绑定 Connection 后才能保存。

优点是职责清晰，允许空 Nango 环境完成系统配置，同时不降低已有邮箱绑定的保护强度。

### 方案 B：配置阶段必须存在测试 Connection

这是当前行为。它可以提前验证凭据读取权限，但把系统配置与业务数据准备混在一起，并阻止没有 Connection 的合法 Nango 环境保存配置，因此不采用。

### 方案 C：只验证 Integration 列表

该方案最宽松，但可能保存一个无法列出 Connection 的 API Key，直到用户连接邮箱时才暴露问题，因此不采用。

## 3. 配置保存规则

### 3.1 首次保存或没有 Zero-Nango 绑定

服务端按以下顺序验证：

1. 使用候选 Base URL 和候选 Secret Key 调用 `List Integrations`。
2. 调用一次 `List Connections`，允许返回空数组。
3. 两个请求均成功后，加密保存 Secret Key，并保存 Base URL、状态和验证时间。

此阶段只验证：

- Nango Base URL 可访问；
- API Key 有效；
- `environment:integrations:list` 或对应的凭据列表权限；
- `environment:connections:list` 或对应的凭据列表权限。

此阶段不调用 `Get Connection & Credentials`，也不要求 `environment:connections:read_credentials` 已经可被实际 Connection 验证。

### 3.2 已存在 Zero-Nango 绑定时轮换 Secret Key

保持现有保护规则：

1. 禁止更换 Base URL。
2. 候选 Secret Key 必须成功调用 `List Integrations` 和 `List Connections`。
3. 候选 Secret Key 必须通过 `Get Connection & Credentials` 读取每一个现有 Authorization Binding 引用的 Nango Connection。
4. 任意一个引用不可访问、已删除、凭据无效或权限不足时，拒绝保存并保留旧 Secret。
5. 全部验证通过后才原子替换数据库中的加密 Secret。

这样可以避免 Secret 轮换后使已经运行的邮箱同步和发送能力失效。

## 4. Gmail Integration 与 Connection 选择

全局 Nango 配置保存后，管理员可以在 Settings 中选择一个启用的 Gmail Nango Integration。每个邮件渠道仍只允许一个启用中的 Nango Integration。

普通用户连接邮箱时执行：

1. 打开 `Connect Email`。
2. 选择 Gmail。
3. 在 Gmail 入口中选择带 Nango 标记的已有授权。
4. Zero 根据管理员启用的 Gmail Nango Integration 调用 `List Connections`。
5. 页面只显示安全的邮箱标识、显示名称、授权健康状态和 Connection 引用。
6. 用户选择一个 Connection。
7. 保存前调用 `Get Connection & Credentials`，验证凭据读取权限。
8. Gmail 渠道插件读取真实邮箱身份并执行邮箱地址去重。
9. 验证成功后保存 Mailbox Connection 和 Nango Authorization Binding。

Zero 不在该流程中发起 Nango 授权，也不创建或删除 Nango Connection。

## 5. 错误处理

- 配置阶段 Connection 数量为零不是错误。
- `List Integrations` 或 `List Connections` 返回 401、403、404、网络错误或不兼容响应时，拒绝保存并保留旧配置。
- 已有绑定的 Secret 轮换中，单个 Connection 的 404 返回“已有 Nango Connection 不存在”，不得解释为 Base URL 错误。
- 邮箱选择页面没有 Connection 时显示空状态，引导用户在 Nango 中完成授权，不提供 Zero 发起授权入口。
- 所有错误只包含白名单错误码、操作名和 HTTP 状态，不包含 Secret、Token、响应正文或凭据对象。

## 6. 代码边界

- `NangoIntegrationService.validateAndSave` 负责系统配置验证、已有绑定保护和保存。
- `NangoClient.listConnections` 支持列出全部 Connection，也支持按 Integration 过滤。
- Nango Connection 浏览接口负责返回安全列表字段。
- Nango 绑定服务负责所选 Connection 的凭据读取、邮箱身份校验和唯一性约束。
- 前端 Settings 页面不浏览或选择邮箱 Connection。
- Connect Email 页面不修改全局 Nango 配置或 Gmail Integration 映射。

## 7. 测试策略

### 服务配置

- 没有 Integration 且没有 Connection 时，只要两个列表请求成功，允许首次保存。
- 有 Integration 但没有 Connection 时允许首次保存。
- `List Connections` 权限不足时拒绝保存。
- 任何验证失败都不调用配置仓库的保存操作。

### Secret 轮换

- 存在绑定时禁止更换 Base URL。
- 新 Secret 必须读取所有已绑定 Connection。
- 任一绑定验证失败时保留旧配置。
- 全部绑定验证成功时允许保存。

### Connection 选择

- 空 Connection 列表显示空状态而不是系统配置错误。
- 选择 Connection 后才读取 Credentials。
- 缺少 `read_credentials` 权限时拒绝绑定。
- 邮箱地址或 Nango Connection 已绑定时拒绝重复保存。

### 回归与安全

- Nango Connection 分页从 `page=0` 开始。
- Worker `fetch` 不得被错误绑定 `this`。
- Secret、Token、响应正文和凭据字段不进入前端、错误消息或内部 Trace。

## 8. 验收标准

- 管理员可以在 Nango 没有 Connection 时保存有效的全局配置。
- Settings 页面不再显示 `Nango must contain at least one authorized connection that Zero can validate.`。
- 用户只能在 Connect Email 中手动选择已有 Nango Connection。
- 已有 Zero-Nango 邮箱绑定时，Secret 轮换继续验证所有绑定引用。
- 配置失败不覆盖旧配置。
- 现有 Nango 邮箱浏览、绑定、去重和安全边界无回归。

## 9. 对现有设计的修正

本设计替换 `2026-07-24-admin-integrations-design.md` 中“Nango 配置必须存在可读取 Credentials 的测试 Connection 才能标记为 Active”的要求。

其余关于单一全局 Nango 服务、数据库加密存储、管理员权限、Gmail Integration 映射、禁止直接更换授权来源和删除保护的设计继续有效。
