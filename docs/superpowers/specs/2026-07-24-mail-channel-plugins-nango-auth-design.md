# Zero 邮件渠道插件化与 Nango 凭据接入设计

日期：2026-07-24

## 1. 结论

本次架构调整由两个主项目组成：

1. **邮件服务渠道插件化**：把 Gmail、Outlook、Zoho Mail、IMAP/SMTP 建模为独立邮件渠道插件，移除当前同步、订阅、界面和存储中的 Gmail 硬编码。
2. **Nango 凭据来源接入**：在保留 Zero 自管授权的同时，把 Nango 作为新的凭据来源。用户只能选择 Nango 中已经授权的邮箱连接，Zero 不在本项目中通过 Nango 发起授权。

邮件渠道与凭据来源是两个独立维度：

```text
channel = gmail | outlook | zoho_mail | imap_smtp
auth_source = zero_oauth | nango | manual
```

同一个 Gmail 渠道可以使用 Zero 自管 Google OAuth，也可以使用 Nango 中已有的 Gmail 授权。两种授权来源共享同一个 Gmail 邮件插件和同一套本地数据模型。

## 2. 背景与现状

当前代码具有初步的 Driver 和 Factory 抽象，但尚未形成完整的渠道插件体系：

- `GoogleMailManager` 和 `OutlookMailManager` 已拆分为独立 Driver。
- Driver 注册表包含 Google 和 Microsoft。
- Provider 枚举和连接表类型只允许 Google/Microsoft。
- Outlook 授权配置和前端入口处于禁用状态。
- 主同步 Pipeline 直接判断 Google Provider，并直接使用 Gmail `historyId` 和 Gmail API 类型。
- KV、同步锁和订阅状态使用 `gmail_*` 命名。
- 前端存在多处 `providerId === 'google'` 或 `providerId === 'microsoft'` 分支。
- IMAP/SMTP 没有协议客户端、同步实现或发送实现。
- Zoho Mail 没有 Driver。
- OAuth、Token 撤销、邮件操作和 Provider 特定能力混合在当前 `MailManager` 接口中。

因此，Gmail 当前是一个独立文件模块，但不是一个可以独立注册、替换和测试的完整邮件渠道插件。

## 3. 目标

### 3.1 邮件渠道插件化

- 每个邮件渠道独立实现身份解析、邮件读取、增量同步、发送、草稿、附件和状态写操作。
- Zero 产品层只依赖统一邮件能力，不直接判断 Gmail、Outlook 等 Provider。
- Provider 特定能力通过 capability 声明，不强迫所有渠道模拟 Gmail Label、Thread 或 History 语义。
- 新渠道通过注册插件接入，不修改核心流程中的 Provider 条件分支。

### 3.2 多凭据来源

- Gmail、Outlook 等渠道可以继续使用 Zero 自管 OAuth。
- 同一渠道可以选择 Nango 中已有的授权连接。
- IMAP/SMTP 可以使用 Zero 手工配置，也可以读取 Nango 已有凭据。
- Nango 负责其连接中的凭据保存和 OAuth Refresh Token 生命周期。
- Zero 直接调用邮箱平台 API 或 IMAP/SMTP 协议，不使用 Nango Sync、Actions 作为邮件业务执行层。

### 3.3 Zero 独立性

- 邮件原始数据、规范化数据、同步游标、搜索、AI 和产品逻辑存储在 Zero。
- 邮件渠道插件由 Zero 实现和运行。
- Nango 只影响 `auth_source = nango` 的连接。
- 移除 Nango 不要求迁移 Zero 邮件数据，但 Nango 授权连接需要重新授权或迁移凭据。

## 4. 非目标

- 不通过 Zero 发起新的 Nango 授权流程。
- 不在本项目中使用 Nango Sync、Records 或 Actions 处理邮件。
- 不把 Nango 建模成新的邮件 Provider。
- 不允许同一个邮箱重复绑定。
- 不允许在一个仍存在的授权绑定上直接修改授权来源。
- 不保证完成插件框架后自动获得 Zoho 或 IMAP/SMTP 邮件能力；每个新渠道仍需要自己的协议/API 插件实现。

## 5. 总体架构

```text
Connect Email
├── Gmail                  -> Zero OAuth Credential Provider
├── Outlook                -> Zero OAuth Credential Provider
├── IMAP/SMTP              -> Manual Credential Provider
└── Nango
    ├── Gmail              -> Nango Credential Provider
    ├── Outlook            -> Nango Credential Provider
    ├── Zoho Mail          -> Nango Credential Provider
    └── IMAP/SMTP          -> Nango Credential Provider

Credential Provider
        |
        v
Mail Channel Registry
├── Gmail Plugin
├── Outlook Plugin
├── Zoho Mail Plugin
└── IMAP/SMTP Plugin
        |
        v
Zero 统一邮件模型、存储和产品功能
```

Nango 渠道弹窗只展示以下集合的交集：

```text
Nango 当前已配置的邮件 Integration
∩
Zero 当前已注册且处于可用状态的渠道插件
```

这保证用户不会选择一个 Nango 已授权、但 Zero 尚无能力处理的渠道。

## 6. 邮件渠道插件

### 6.1 插件职责

每个 `MailChannelPlugin` 提供：

- 插件标识、名称、图标和支持的凭据类型；
- capability 声明；
- 根据凭据解析并验证真实邮箱身份；
- 创建 Provider API 或协议客户端；
- 初次同步和增量同步策略；
- 可选的 Push、Webhook、IDLE 或轮询订阅策略；
- 邮件读取、发送、草稿、附件和状态写操作；
- Provider 数据到 Zero 规范模型的转换；
- Provider 错误到 Zero 标准错误的转换。

### 6.2 Capability 示例

```text
read_messages
send_messages
drafts
attachments
folders
labels
threads
mark_read
move
delete
push_sync
poll_sync
```

产品层根据 capability 决定是否显示功能，不再根据 Provider ID 写条件分支。

### 6.3 各渠道的特定语义

- Gmail 使用 Label、Thread、History ID 和 Google Push。
- Outlook 使用 Folder、Conversation、Delta Token 和 Graph Subscription。
- Zoho Mail 使用 Zoho Mail API 的账户、文件夹和消息模型。
- IMAP 使用 Folder、UID、UIDVALIDITY、可选 MODSEQ/CONDSTORE、IDLE 或轮询。
- SMTP 只负责发送；发送后是否需要通过 IMAP `APPEND` 写入 Sent 文件夹，由 IMAP/SMTP 插件根据服务器行为决定。

## 7. 凭据来源

### 7.1 Credential Provider 职责

Credential Provider 只负责：

- 创建、删除或读取授权绑定；
- 返回渠道插件可使用的当前凭据；
- 缓存和刷新凭据；
- 报告凭据失效和重新授权状态；
- 清除敏感数据。

它不读取、同步或发送邮件。

### 7.2 支持的来源

#### Zero OAuth

- Zero 发起 Google/Microsoft OAuth。
- Zero 管理 Refresh Token、Access Token 和撤销流程。
- 现有 Gmail 授权迁移到此来源。

#### Nango

- 用户只选择 Nango 中已经存在的 Connection。
- Zero 保存 Nango Connection 引用和加密的凭据快照。
- Nango 管理 OAuth Refresh Token 和刷新。
- Zero 不请求或保存 Nango 管理的 OAuth Refresh Token。

#### Manual

- 用于 Zero 原生 IMAP/SMTP 配置。
- 凭据必须进入独立加密 Secret 存储或等价的加密字段。

## 8. 数据模型

为支持“删除授权但保留邮箱数据”，邮箱身份和授权绑定必须分离。

### 8.1 Mailbox Connection

稳定表示一个 Zero 邮箱：

```text
id
user_id
channel_id
email
normalized_email
display_name
picture
status
created_at
updated_at
disconnected_at
```

状态至少包括：

```text
connected
disconnected
reconnect_required
deleting
```

唯一约束：

```text
UNIQUE(user_id, normalized_email)
```

邮箱地址由渠道插件通过 Provider Profile、账户 API 或协议验证得到。用户输入和 Nango 列表展示字段不能直接作为最终身份。

规范化至少执行：

```text
trim
lowercase
```

不对 Gmail 点号、加号别名等执行猜测性合并。

### 8.2 Authorization Binding

一个已连接邮箱最多存在一个授权绑定：

```text
id
connection_id
auth_source
credential_type
nango_connection_id
nango_provider_config_key
encrypted_credential_snapshot
access_token_expires_at
credential_fetched_at
created_at
updated_at
```

约束：

```text
UNIQUE(connection_id)
UNIQUE(nango_provider_config_key, nango_connection_id)
```

`auth_source` 在授权绑定存在期间不可更新。来源变化必须先删除授权绑定，再执行新的授权或绑定流程。

敏感凭据使用带认证的加密算法保存，并记录密钥版本以支持轮换。Token、密码和 Nango API Key 不得进入日志、客户端响应或遥测属性。

## 9. Nango 选择流程

### 9.1 用户流程

1. 用户在 Connect Email 点击 Nango 卡片。
2. Zero 后端读取 Nango 当前配置的 Integrations。
3. Zero 将 Integration 映射到已注册邮件渠道插件。
4. 弹窗只显示可用渠道，如 Gmail、Outlook、Zoho Mail、IMAP/SMTP。
5. 用户点击具体渠道。
6. Zero 后端按 Integration 查询已有 Nango Connections。
7. 前端只显示邮箱地址、显示名称和授权健康状态。
8. 用户选择一个连接并保存。
9. Zero 后端读取凭据、验证 Scope、调用渠道插件解析真实邮箱身份，并检查重复绑定。
10. Zero 在同一业务事务中创建或恢复 Mailbox Connection，并创建 Authorization Binding。

### 9.2 前端安全响应

前端不得收到：

- Nango API Key；
- Access Token；
- Refresh Token；
- IMAP/SMTP 密码；
- Nango 原始凭据对象。

连接选择响应只包含：

```text
connection_id
provider_config_key
channel_id
email
display_name
authorization_status
```

邮箱展示信息优先来自可信且已验证的 Zero 缓存；没有缓存时可以使用 Nango tags/metadata 临时展示，但保存前必须由渠道插件再次验证。

### 9.3 Nango API 权限

Nango API Key 只存在于 Zero 服务端，并采用最小权限。所需权限包括：

- 列出 Integrations；
- 列出 Connections，不包含凭据；
- 读取一个指定 Connection 的凭据。

生产服务不使用可枚举和修改无关资源的全权限 Key。

## 10. Token 与凭据缓存

### 10.1 OAuth2

Zero 可以持久化加密的 Access Token 和 `expires_at`，减少每次邮件请求对 Nango 的依赖。该值是缓存快照，不是凭据事实源。

调用算法：

1. 没有缓存 Token，或 Token 距离过期不足 15 分钟时，从 Nango 获取连接凭据。
2. Nango 返回最新 Access Token 和过期时间。
3. Zero 在锁内原子更新加密 Token、过期时间和获取时间。
4. 渠道插件使用 Token 直接调用邮箱平台 API。
5. 如果平台返回 401，Zero 立即使本地 Token 失效，向 Nango 请求一次强制刷新，更新缓存后只重试原操作一次。
6. 再次失败则标记连接为 `reconnect_required`，停止自动重试风暴。

同一授权绑定只能有一个并发刷新任务。其他请求等待该任务，避免重复刷新和旧 Token 覆盖新 Token。

Zero 不向 Nango 请求 Refresh Token，也不保存 Nango Refresh Token。

### 10.2 Basic 与 Custom 凭据

IMAP/SMTP 可能使用 Basic 或 Custom 凭据，不一定存在过期时间：

- 凭据按类型解析，不强制转换成 Access Token。
- 长期密码必须加密存储。
- 建立协议连接失败时，从 Nango重新读取一次凭据并重试一次。
- 再次失败则标记为 `reconnect_required`。
- 频道插件负责验证 Host、Port、TLS 和邮箱身份。

## 11. 重复绑定与重新授权

### 11.1 禁止重复

同一个 Zero 用户的同一个规范化邮箱地址只能存在一个 Mailbox Connection，不因渠道或授权来源不同而允许重复。

服务端在身份验证后、事务内检查唯一性；数据库唯一约束处理并发竞争。

错误码：

```text
MAILBOX_ALREADY_CONNECTED
NANGO_CONNECTION_ALREADY_BOUND
```

### 11.2 禁止直接更换来源

系统不提供“更换授权来源”操作：

- 不允许将现有 `zero_oauth` 更新为 `nango`；
- 不允许将现有 `nango` 更新为 `zero_oauth`；
- 不允许自动覆盖现有凭据。

用户必须先删除授权，再重新授权。

### 11.3 重新授权

删除授权但保留数据后，Mailbox Connection 保持 `disconnected`。用户重新授权时：

- Zero 验证新授权的真实邮箱地址；
- 邮箱地址必须与保留的 Mailbox Connection 一致；
- 渠道必须与保留的 Mailbox Connection 一致；
- 创建新的 Authorization Binding；
- 复用原 Connection ID 和本地数据；
- 执行增量校验；同步游标失效时执行安全的重新同步。

如果用户希望从 Gmail API 渠道改成 IMAP/SMTP 渠道，即使邮箱地址相同，也必须完整删除原 Mailbox Connection 及其本地数据后重新添加。不同渠道的远程 ID、线程语义和同步游标不能安全复用。

## 12. 删除授权与数据生命周期

### 12.1 删除授权弹窗

弹窗标题：

```text
断开邮箱授权
```

说明：

```text
断开后，Zero 将停止同步和发送邮件。
你可以选择是否同时删除保存在 Zero 中的本地数据。
```

选项默认不勾选：

```text
[ ] 同时删除 Zero 中已保存的本地邮件数据
    包括邮件、附件、摘要、同步状态和个性化数据。此操作不可恢复。
```

按钮：

- 未勾选：`断开并保留数据`
- 已勾选：`断开并删除数据`
- `取消`

### 12.2 保留数据

- 停止订阅、同步、发送和所有远程写操作；
- Zero OAuth 来源先尽力撤销 Provider 授权，再删除本地 Token；
- Nango 来源只删除 Zero 本地绑定和凭据快照，不删除 Nango Connection；
- Manual 来源删除 Zero 保存的协议凭据；
- 删除 Authorization Binding 和本地敏感凭据；
- 状态变为 `disconnected`；
- 保留 Mailbox Connection、邮件数据、摘要、附件和产品数据；
- 本地数据永久保留，不自动过期；

### 12.3 同时删除数据

- 状态先变为 `deleting`；
- 停止所有任务和订阅；
- 删除 Authorization Binding；
- 以可重试、幂等方式清理数据库、对象/附件存储、Durable Object、KV、缓存、摘要和同步状态；
- 清理完成后删除 Mailbox Connection；
- 释放邮箱和 Nango Connection 唯一约束；
- 不删除邮箱服务器中的邮件；
- 不删除 Nango 中原有的 Connection。

### 12.4 手动清理入口

保留的数据只在 `disconnected` 邮箱上提供手动清理入口：

```text
Settings
└── Connections
    └── Disconnected mailbox
        ├── Re-authorize
        └── Delete retained local data
```

手动清理执行完整数据删除并最终删除 Mailbox Connection。已连接邮箱不显示该入口；已连接邮箱的数据重建应使用另一个语义明确的“重置并重新同步”功能，该功能不属于本项目。

## 13. 错误处理

### 13.1 Nango 浏览与选择

- Nango 不可用：显示可重试错误，不创建任何本地记录。
- 渠道无连接：显示空状态，不显示授权发起入口。
- 渠道尚未安装插件：不展示。
- Connection 授权错误：显示为不可选或提示需在 Nango 中修复。
- Scope 不足：拒绝绑定并列出缺失能力。
- 无法解析邮箱身份：拒绝绑定。

### 13.2 运行期

- 临时网络错误：使用有上限的退避重试。
- 401：使缓存失效，从凭据来源刷新一次，再重试一次。
- 403/Scope 不足：标记 `reconnect_required`，不循环刷新。
- Nango 不可用但缓存 Token 有效：继续使用缓存。
- Nango 不可用且 Token 即将过期：暂停需要远程访问的任务，保留本地产品能力。
- 删除中：拒绝新的同步、发送和授权操作。

标准错误必须包含安全的错误类型、连接 ID 和渠道 ID，不包含凭据或原始邮件内容。

## 14. 实施分解

这是两个主项目，但需要按依赖拆成可独立交付的子项目。

### 项目 A：邮件渠道插件化

1. 引入 Mailbox Connection 与 Authorization Binding 的分离模型。
2. 建立 Channel Registry、Capability 模型和 Credential Provider 接口。
3. 将现有 Gmail Driver、同步、订阅和转换逻辑迁移到 Gmail Plugin。
4. 移除核心 Pipeline、UI 和存储中的 Gmail Provider 分支与命名。
5. 迁移现有 Gmail 连接，保持用户行为不变。

### 项目 B：Nango 凭据来源接入

1. 增加服务端 Nango Client 和最小权限配置。
2. 增加 Nango Integration/Connection 浏览接口。
3. 增加 Connect Email 的 Nango 渠道与连接选择界面。
4. 增加 Nango Credential Provider。
5. 增加加密凭据快照、过期刷新、并发锁和 401 恢复。
6. 增加解绑、永久保留和手动清理流程。

### 后续渠道子项目

- 完成并启用 Outlook Plugin。
- 实现 Zoho Mail Plugin。
- 实现 IMAP/SMTP Plugin。

Nango 项目本身不自动实现这些渠道的邮件协议/API。Nango 弹窗只在对应渠道插件完成并注册后显示它们。第一条可端到端交付路径应是：

```text
Gmail Plugin
+ Zero OAuth
+ Nango 已有 Gmail Connection
```

## 15. 测试策略

### 15.1 插件契约测试

每个渠道插件运行同一组契约测试：

- 身份解析；
- 邮件列表和读取；
- 增量同步；
- 发送与草稿；
- 附件；
- capability 与行为一致；
- 标准错误转换。

### 15.2 Credential Provider 测试

- 有效缓存直接复用；
- 临近过期向 Nango 刷新；
- 多并发只执行一次刷新；
- 401 强制刷新并只重试一次；
- Refresh Token 不被请求、保存或记录；
- Basic/Custom 凭据加密；
- Nango 不可用时的降级行为。

### 15.3 数据与生命周期测试

- 规范化邮箱唯一约束；
- 并发重复绑定只成功一个；
- 同一个 Nango Connection 不能重复绑定；
- 删除授权后本地数据永久保留；
- 重新授权相同邮箱复用 Connection ID；
- 重新授权不同邮箱被拒绝；
- 完整删除覆盖所有存储且可幂等重试；
- 删除 Zero 绑定不删除 Nango Connection。

### 15.4 UI/E2E

- Nango 卡片和渠道弹窗；
- 只展示已注册渠道与 Nango Integration 的交集；
- 连接列表只显示安全字段；
- 已绑定邮箱过滤和服务端拒绝；
- 删除弹窗默认保留数据；
- 危险删除确认；
- Disconnected 邮箱的重新授权和手动清理入口。

### 15.5 安全测试

- Nango API Key 不进入浏览器；
- Token 不进入日志、错误和遥测；
- 数据库敏感字段不是明文；
- 用户不能列出或绑定不属于其范围的 Nango Connection；
- 删除和绑定接口进行用户归属检查。

## 16. 验收标准

- 现有 Gmail 用户迁移后行为无回归。
- Gmail 邮件处理不依赖授权来源判断。
- 核心邮件流程不直接导入 Gmail API 类型。
- Connect Email 同时支持 Zero Gmail OAuth 和 Nango 已有 Gmail 连接。
- Nango 流程不会发起新授权。
- Zero 保存 Nango Connection 引用、加密 Access Token 快照和过期时间。
- Token 临近过期或 401 时按设计刷新。
- 同一个邮箱和同一个 Nango Connection 均无法重复绑定。
- 授权来源不能直接更换。
- 删除授权时用户可以选择永久保留或完整删除本地数据。
- 保留的数据提供手动清理入口。
- 删除 Zero 绑定不会删除 Nango Connection。
- 未实现的渠道不会出现在 Nango 选择器中。

## 17. 参考

- Nango List Integrations: https://nango.dev/docs/reference/backend/http-api/integration/list
- Nango List Connections: https://nango.dev/docs/reference/backend/http-api/connections/list
- Nango Get Connection & Credentials: https://nango.dev/docs/reference/backend/http-api/connections/get
- Nango Token Refreshing: https://nango.dev/docs/guides/auth/token-refreshing
- Nango API Key Scopes: https://nango.dev/docs/reference/backend/http-api/api-keys
- Nango Zoho Mail: https://nango.dev/docs/integrations/all/zoho-mail
