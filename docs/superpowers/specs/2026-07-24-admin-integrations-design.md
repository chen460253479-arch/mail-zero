# Zero 管理员集成配置与 Gmail 授权入口设计

日期：2026-07-24

## 1. 结论

Zero 增加仅管理员可访问的 `Settings → Integrations` 页面，集中管理系统级集成配置。第一阶段只包含：

```text
Settings → Integrations
├── Nango
│   ├── Base URL
│   ├── Secret Key 配置状态
│   ├── 连通性与权限验证
│   └── Gmail Nango Integration
└── Gmail
    └── Zero 自有 OAuth
        ├── Client ID
        ├── Client Secret 配置状态
        ├── Redirect URL
        └── 测试并启用
```

用户侧只按邮件渠道展示入口：

```text
Email Connections → Connect Email
└── Gmail
    ├── Zero OAuth 新授权
    └── Nango 已授权邮箱列表（带 Nango 标记）
```

领域模型保持两个独立维度：

```text
channel = gmail
auth_source = zero_oauth | nango
```

Nango 是系统集成和授权来源，不是新的邮件渠道；Zero OAuth 和 Nango 共享同一个 Gmail 渠道插件。

本设计替代 `2026-07-24-mail-channel-plugins-nango-auth-design.md` 中独立展示 Nango 卡片及通过环境变量读取 Nango/Gmail 邮箱授权配置的部分，其余邮箱身份、授权绑定、Token 缓存、去重和数据生命周期设计继续有效。

## 2. 目标

- 管理员可以在页面中配置、验证、更新和删除全局 Nango 配置。
- 管理员可以在页面中配置 Zero 自己发起 Gmail 邮箱 OAuth 所需的 Client ID 和 Client Secret。
- Nango、Gmail 邮箱 OAuth 配置只存数据库，不使用环境变量作为配置源或回退源。
- 敏感配置使用 `CREDENTIAL_ENCRYPTION_KEY` 加密后存储，客户端永远无法读取原值。
- 移除 Google 用户社交登录；Google OAuth 只用于 Gmail 邮箱连接。
- Connect Email 只显示一个 Gmail 渠道入口，并根据已启用的授权来源自动分流。
- 已有邮箱绑定不能因管理员误改或删除集成配置而失效。

## 3. 非目标

- 本阶段不实现 Outlook、Zoho Mail 或 IMAP/SMTP 插件和配置页面。
- 本阶段不通过 Zero 发起 Nango 授权，只选择 Nango 已有 Connection。
- 不允许普通用户读取或修改系统集成配置。
- 不在页面中配置或轮换 `CREDENTIAL_ENCRYPTION_KEY`。
- 不回显、截断显示或提供复制已保存 Secret 的能力。
- 不保留 Nango 或 Gmail 邮箱 OAuth 环境变量作为隐藏回退路径。

## 4. 配置边界

### 4.1 根加密密钥

`CREDENTIAL_ENCRYPTION_KEY` 是唯一继续由服务器环境提供的集成密钥。它用于加密：

- Nango Secret Key；
- Gmail Client Secret；
- Gmail OAuth 测试候选配置；
- 邮箱授权凭证快照。

该密钥不得进入数据库、浏览器响应、日志或遥测。丢失该密钥意味着现有敏感配置无法解密，必须重新配置。

### 4.2 Nango

Nango 只有一套全局配置：

```text
base_url
encrypted_secret_key
status
validated_at
updated_by
created_at
updated_at
```

`base_url` 可明文存储；Secret Key 必须加密存储。读取接口只返回：

```text
configured
base_url
secret_configured
status
validated_at
```

Secret 输入框留空表示继续使用现有值；输入新值表示轮换。保存使用候选 Base URL 与候选或已有 Secret 调用 Nango，必须确认能够：

1. 列出 Integrations；
2. 列出 Connections；
3. 读取指定 Connection 的 Credentials。

只有全部验证成功才在事务中替换当前配置。验证失败时旧配置保持不变。若 Nango 中没有可用于验证 Credentials 权限的 Connection，配置不能被标记为 Active，页面需说明需要先在 Nango 中准备一个测试 Connection。

存在 Nango Authorization Binding 时：

- 禁止修改 Base URL，因为这等同于切换整套 Nango 实例；
- 允许轮换 Secret Key，但候选 Secret 必须成功读取所有现有绑定引用的 Connection 和 Credentials 后才能保存；
- 验证现有绑定时采用有上限的并发读取，任意一个绑定无法访问都拒绝轮换并保留旧 Secret。

Nango 配置不从 `NANGO_BASE_URL` 或 `NANGO_SECRET_KEY` 环境变量读取。

### 4.3 Gmail Zero OAuth

Gmail 自有 OAuth 配置包含：

```text
client_id
encrypted_client_secret
status
validated_at
updated_by
created_at
updated_at
```

Client ID 可明文存储；Client Secret 必须加密存储。读取接口只返回 Client ID、Secret 已配置状态、状态、验证时间和系统生成的 Redirect URL。

Google 无法仅凭 Client ID/Secret 提供无用户交互的有效性检查，因此采用“测试并保存”：

1. 管理员提交候选 Client ID 和 Client Secret；
2. 服务端加密保存一个短期验证会话；
3. 服务端生成带高熵 state 的 Google OAuth 测试 URL；
4. 管理员完成 Google OAuth；
5. 回调校验 state、过期时间、发起管理员和候选配置；
6. 使用授权码换取 Token，并调用 Gmail Profile 验证 Gmail 权限；
7. 立即尽力撤销测试 Token，不创建 Mailbox Connection 或 Authorization Binding；
8. 验证成功后在事务中启用候选配置并删除验证会话；
9. 验证失败或会话过期时删除候选配置，保留旧配置。

验证会话只保存 state 的哈希，默认十分钟过期且只能使用一次。Redirect URL 固定由服务器生成，管理员不能自定义。

## 5. Nango Gmail Integration 映射

系统只显示当前已实现的 Gmail 渠道。管理员在 Nango 配置验证成功后，从 Nango 返回的 Gmail Integrations 中选择一个作为当前启用项：

```text
channel_id = gmail
nango_provider_config_key = <integration unique key>
```

每个邮件渠道只能有一个启用中的 Nango Integration，但一个 Integration 可以包含任意多个 Nango Connections。

只要仍存在引用当前 `nango_provider_config_key` 的 Authorization Binding，就禁止：

- 更换 Gmail 对应的 Nango Integration；
- 停用该映射；
- 删除全局 Nango 配置。

页面必须显示当前占用邮箱数量，并引导管理员先在 Email Connections 中断开这些 Nango 授权。已经断开且仅保留本地邮件数据的邮箱没有 Authorization Binding，不计入占用。

## 6. Gmail 自有 OAuth 配置生命周期

只要仍存在 `channel = gmail` 且 `auth_source = zero_oauth` 的 Authorization Binding，就禁止删除或停用 Gmail 自有 OAuth 配置。更新 Client ID/Secret 同样禁止直接覆盖，因为旧 Refresh Token 可能绑定旧 OAuth Client。

管理员必须先断开相关邮箱授权，再测试并启用新的 Gmail OAuth 配置。这与“不允许原地更换授权来源或授权配置”的既有规则保持一致。

## 7. Google 用户登录移除

Google 社交登录从 Better Auth 配置中移除：

- 删除 Google social provider 注册；
- 登录页面不再显示 Google 登录入口；
- `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 不再作为登录或邮箱配置环境变量；
- Gmail Driver 不再直接读取全局 `env`，创建时由 Gmail 渠道运行时注入数据库中的 Client ID/Secret；
- Connect Email 不再调用 Better Auth `linkSocial` 发起邮箱授权，改用独立的 Gmail 邮箱 OAuth 路由；
- 既有用户、邮箱、本地邮件和 Better Auth account 历史记录不因移除登录入口而自动删除。

当前已停用的 Microsoft social provider 配置和未使用的 `MICROSOFT_CLIENT_ID`、`MICROSOFT_CLIENT_SECRET` 环境类型一并移除。未来 Outlook 插件使用数据库集成配置，不恢复邮箱渠道环境变量。

## 8. 数据模型

新增三类系统级数据。

### 8.1 System Integration Config

单表保存当前有效配置，使用受限的 Integration Key：

```text
id
integration_key = nango | gmail_zero_oauth
public_config
encrypted_secret
status = active | error
validated_at
updated_by
created_at
updated_at
```

`public_config` 在领域服务中由按 `integration_key` 区分的 Zod Schema 解析，路由和业务代码不得直接展开未知 JSON。`encrypted_secret` 使用现有带认证加密工具，并包含密钥版本。

### 8.2 Channel Integration Mapping

```text
id
channel_id
auth_source
external_integration_id
created_at
updated_at
```

约束：

```text
UNIQUE(channel_id, auth_source)
```

第一阶段只创建 `gmail + nango` 映射。

### 8.3 Integration OAuth Session

```text
id
integration_key
purpose = validate_config | connect_mailbox
encrypted_payload
state_hash
created_by
expires_at
consumed_at
created_at
```

该表用于需要跨请求完成的 Gmail OAuth 配置测试和邮箱连接。`validate_config` 的加密 payload 保存候选配置；`connect_mailbox` 的加密 payload 保存邮箱连接意图。两种会话都绑定发起用户、十分钟过期且只能消费一次。过期会话按请求惰性清理，并提供定时清理任务；成功或失败后立即删除敏感 payload。

## 9. 服务端组件

按职责拆分：

```text
integrations/
├── repository.ts
├── service.ts
├── permissions.ts
├── schemas.ts
├── nango-validator.ts
└── gmail-oauth-validator.ts
```

- Repository 只负责数据库读写。
- Service 负责状态机、占用检查、验证后原子保存和删除。
- Permissions 统一执行管理员检查。
- Validator 只验证候选配置，不直接写入正式配置。
- Nango Client 和 Gmail Channel 通过显式运行时依赖获取配置，不读取模块级环境变量。

管理员检查必须同时存在于页面路由和所有服务端查询、修改、OAuth 启动及回调端点。服务端以会话用户的 `role === admin` 为准，不能信任客户端传入的角色。

## 10. 管理员界面

新增 `Settings → Integrations` 导航项，仅管理员可见。

### 10.1 Nango 卡片

显示：

- 未配置、验证中、Active、Error 状态；
- Base URL；
- “Secret Key 已配置”；
- 最近验证时间；
- Gmail Integration；
- 使用当前映射的邮箱数量。

操作：

- 配置或更新；
- 验证并保存；
- 选择 Gmail Integration；
- 删除配置。

所有危险操作使用确认弹窗。存在绑定时按钮禁用并显示具体阻塞原因。

### 10.2 Gmail 卡片

显示：

- Zero OAuth 未配置或 Active；
- Client ID；
- “Client Secret 已配置”；
- 固定 Redirect URL；
- 最近验证时间；
- 使用该配置的邮箱数量。

操作：

- 输入候选配置；
- 测试并保存；
- 删除配置。

测试 OAuth 使用弹窗或新窗口，主页面轮询一次性验证会话状态；用户关闭窗口、超时或拒绝授权时恢复可重试状态。

## 11. Connect Email

Connect Email 只显示 Gmail 卡片。点击后先由服务端返回可用授权来源：

```text
zero_oauth_available
nango_available
```

分流规则：

- 两者都可用：显示 Zero OAuth 操作和 Nango 已授权邮箱列表；
- 仅 Zero OAuth：直接发起 Gmail OAuth；
- 仅 Nango：直接显示已有 Nango Connections；
- 两者都不可用：显示“管理员尚未配置 Gmail 集成”，禁止继续。

Nango 邮箱行使用小型 Nango 图标或 Badge 标识；Zero OAuth 是“授权新的 Gmail 邮箱”操作，不伪装成已有连接。

最终保存仍执行服务端邮箱身份验证、标准化、重复邮箱检查和 Authorization Binding 唯一约束。

## 12. API 与安全响应

管理员 API：

```text
integrations.getOverview
integrations.validateAndSaveNango
integrations.deleteNango
integrations.listNangoGmailIntegrations
integrations.setNangoGmailIntegration
integrations.startGmailValidation
integrations.getGmailValidationStatus
integrations.deleteGmailZeroOAuth
```

用户连接 API：

```text
connections.getGmailAuthorizationOptions
connections.startGmailOAuth
connections.listNangoGmailConnections
connections.bindNango
```

任何响应都不得包含：

- Nango Secret Key；
- Gmail Client Secret；
- OAuth 测试候选配置；
- Access Token 或 Refresh Token；
- state 原值；
- 加密字段或密钥版本内部结构。

错误使用稳定的领域错误码，不转发 Nango、Google 或数据库原始响应正文。

## 13. 删除与故障行为

- 删除 Nango 配置前检查所有 Nango Authorization Bindings；存在任意绑定即拒绝。
- 存在 Nango 绑定时禁止修改 Base URL；Secret 轮换必须验证所有现有 Connection 引用。
- 删除 Gmail Zero OAuth 配置前检查所有 Gmail Zero OAuth Bindings；存在任意绑定即拒绝。
- Nango 更新验证失败时保留当前配置和映射。
- Gmail 测试失败时保留当前配置。
- 当前 Active 配置解密失败时标记 Error，停止新的授权；既有本地邮件仍可读取。
- Nango 临时不可用时沿用既有 Token 缓存策略，不自动删除系统配置或邮箱绑定。
- 配置删除后 Connect Email 立即停止展示对应授权来源。

## 14. 迁移

数据库迁移创建系统集成配置、渠道映射和验证会话表。

配置来源迁移遵循“数据库唯一来源”：

- 不从现有 Nango 或 Google/Microsoft 环境变量自动导入；
- 不保留运行时环境变量回退；
- 部署后管理员必须在 Integrations 页面重新配置并验证；
- 在新配置 Active 前，相关新授权入口保持禁用；
- `CREDENTIAL_ENCRYPTION_KEY` 必须在迁移和服务启动前存在。

移除 `.env.example`、Env 类型和部署配置中的：

```text
NANGO_BASE_URL
NANGO_SECRET_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
```

如果部署环境中已经存在 Nango 邮箱绑定，应先在新版本上线后立即配置相同 Nango 服务和 Gmail Integration；正式发布流程需把这一步作为阻断检查，避免 Token 刷新窗口内出现中断。

## 15. 测试策略

### 15.1 权限

- 普通用户不能访问页面或任何管理员 Integration API；
- 伪造前端角色不能绕过服务端检查；
- Gmail OAuth 测试回调必须属于发起验证的管理员。

### 15.2 Secret

- Nango 和 Gmail Secret 加密往返；
- 查询、错误、日志和遥测不泄露 Secret；
- 空 Secret 更新复用现有密文；
- 新 Secret 只有验证成功才替换旧值；
- 解密失败产生安全错误，不回显密文或原始异常。

### 15.3 配置状态

- Nango 三项权限全部通过后才保存；
- Nango 验证失败保持旧配置；
- Gmail OAuth state、过期、一次性消费和发起人校验；
- Gmail 测试成功撤销 Token 且不创建邮箱；
- 存在 Authorization Binding 时禁止更新、停用或删除相关配置；
- 无绑定时删除配置并隐藏对应用户入口。

### 15.4 Connect Email

- 四种授权来源组合正确分流；
- Nango Connection 显示 Nango 标记；
- Zero OAuth 与 Nango 绑定都写入同一个 Gmail 渠道；
- 重复邮箱和重复 Nango Connection 继续被拒绝；
- 未配置时不发起授权。

### 15.5 回归

- Gmail 邮件读取、同步、发送不依赖模块级 Google Client 环境变量；
- Google 登录入口、Provider 和环境变量被移除；
- 既有本地邮箱数据和断开后永久保留行为不变；
- Nango Token 缓存、临近过期刷新和 401 单次重试行为不变。

## 16. 验收标准

- 只有管理员能看到和使用 `Settings → Integrations`。
- Nango 与 Gmail Zero OAuth 配置都以数据库为唯一来源。
- 所有 Secret 加密存储且永不返回浏览器。
- Nango 配置必须验证 Integrations、Connections、Credentials 权限后才能保存。
- Gmail Zero OAuth 必须完成测试授权后才能保存。
- 每个渠道最多启用一个 Nango Integration。
- 存在 Nango 绑定时不能切换 Base URL，Secret 轮换必须验证所有绑定。
- 存在相关邮箱绑定时不能更新、停用或删除配置。
- Connect Email 只显示 Gmail，并按可用来源自动分流。
- Nango 已授权邮箱使用小图标或 Badge 标记。
- Google 用户登录及其环境配置完全移除。
- 当前阶段不显示 Outlook、Zoho 或 IMAP/SMTP 配置。
- 配置变更不会原地修改已有邮箱的 `auth_source`。
- 相关单元、集成、安全边界和 UI 测试通过。
