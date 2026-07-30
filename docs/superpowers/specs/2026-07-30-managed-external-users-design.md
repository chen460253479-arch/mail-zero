# Zero 外部托管用户与统一邮箱界面设计

## 1. 背景

现有外部邮件集成使用固定的系统用户 `zero-external-integration` 持有所有外部邮箱，
CRM 每次创建 Launch Grant 时提交 `allowedNangoConnectIds`，Zero 再据此限制当前浏览器
会话可以访问的邮箱。

该模型可以实现临时授权，但它把长期账号归属和每次 Launch 的授权范围混在了一起：

- CRM 必须重复提交邮箱白名单。
- 所有外部邮箱集中在同一个系统用户下，用户隔离依赖额外的 Grant Scope。
- 普通密码登录与 CRM Launch 无法自然共享同一套邮箱归属。
- 超管、普通用户和外部会话使用了不同的前端账号区域。

本设计改为“一个 CRM 用户对应一个 Zero 普通用户”。邮箱直接归属 Zero 用户，
`userId` 成为唯一的数据隔离边界，CRM Launch 不再提交邮箱白名单。

## 2. 目标

1. 继续关闭前端公开注册和用户创建入口。
2. 允许持有固定服务 Token 的外部系统通过 API 自动创建普通用户。
3. 使用 `externalUserId` 作为普通用户的 Zero 登录用户名。
4. 新用户的初始密码为 `externalUserId`，首次独立登录必须修改密码。
5. 普通用户密码登录和 CRM Launch 使用相同的 `userId` 邮箱范围与账号切换组件。
6. 普通用户只能访问自己名下的全部邮箱。
7. 超管可以查看和管理实例内全部邮箱。
8. 移除 CRM Launch 请求中的 `allowedNangoConnectIds`。
9. 保留一次性 Launch Code 和长期浏览器 Session，实现 CRM 到 Zero 的免登录跳转。
10. 保持现有 ID-only 邮件 Webhook 和邮件详情查询接口不变。

## 3. 非目标

- 不开放前端注册。
- 本阶段不重构普通用户的菜单、设置和连接管理等细粒度功能授权；后续单独收敛为受限模式。
- 不实现一个 Nango Connection 由多个用户共享。
- 不新增首次历史邮件同步流程。
- 不移除 CRM Launch；Launch 仍负责浏览器免登录和受限 Session 建立。
- 不将 `externalUserId` 或密码放入浏览器跳转 URL。

## 4. 身份与权限模型

Zero 本阶段保留以下已认证使用模式：

| 模式         | 认证方式                     | 邮箱范围               | 功能授权                                 |
| ------------ | ---------------------------- | ---------------------- | ---------------------------------------- |
| 超管完全模式 | 管理员邮箱和密码             | 实例内全部邮箱         | 完整管理                                 |
| 普通用户模式 | `externalUserId` 和密码      | 当前用户拥有的全部邮箱 | 暂时沿用现有登录用户能力，后续再细化     |
| CRM Launch   | 一次性 Launch Code 和 Cookie | 目标用户拥有的全部邮箱 | 沿用现有外部会话限制，隐藏设置和连接管理 |

匿名请求不属于邮件使用模式，只能进入登录流程。

普通用户密码登录和 CRM Launch 使用相同的 `userId` 数据边界和账号切换组件。本阶段不要求
二者的菜单及功能权限完全一致：CRM Launch 继续使用已经实现的外部受限界面，普通用户的
细粒度授权后续单独实施。

无论功能授权是否延后，服务端现有的 Connection、Mail Account、邮件、正文和附件
`userId` 所有权校验都必须保留，普通用户不得访问其他用户的数据。

## 5. 用户数据模型

### 5.1 用户角色

- 超管用户使用 `role = admin`。
- API 自动创建的普通用户使用 `role = user`。
- 现有用户角色默认值必须从隐式 `admin` 改为安全的 `user`；只有超管引导流程可以显式创建
  `admin`。

### 5.2 外部用户标识

普通用户保存唯一的 `externalUserId`，并将其配置为 Better Auth Username 登录名。

约束：

- `externalUserId` 在一个 Zero 实例内全局唯一。
- 外部调用方负责提供稳定、不复用的标识。
- Zero 对其执行长度、字符集和空白校验。
- 创建完成后不允许普通用户自行修改。

### 5.3 首次修改密码

普通用户增加 `mustChangePassword` 状态：

- API 创建用户时设置为 `true`。
- 初始密码为 `externalUserId`，只保存安全哈希。
- 普通用户通过用户名和密码登录后，如果该状态为 `true`，只能访问修改密码流程。
- 修改成功后原子地设置为 `false`，随后才允许访问邮件接口和邮件主页。
- CRM Launch 不依赖初始密码，因此不受 `mustChangePassword` 阻断。
- 超管账号不使用该状态。

初始密码是已明确接受的产品要求，但仍必须配合登录限流、失败审计和首次强制修改，
不得作为永久凭证。

### 5.4 超管引导约束

当前“数据库只能存在一个用户”的超管引导约束需要调整为：

- 一个 Zero 实例只能存在一个 `admin`。
- 可以存在多个 `user`。
- 创建或确认超管时只检查 `admin` 冲突，不得因为普通用户已经存在而拒绝超管引导。

## 6. 外部用户自动注册与邮箱绑定

### 6.1 接口

继续使用通用外部集成接口，不引入 CRM 专用命名：

```http
POST /api/integrations/nango/connections/bind
Authorization: Bearer <INTEGRATION_API_TOKEN>
Content-Type: application/json
```

```json
{
  "externalUserId": "user_200",
  "channelId": "gmail",
  "connectionId": "connect_gmail_01"
}
```

这三个字段都是必要数据：

- `externalUserId`：确定 Zero 用户和邮箱所有权。
- `channelId`：选择已配置的邮件渠道。
- `connectionId`：查找现有 Nango 授权。

### 6.2 处理流程

Zero 在一次应用服务调用中完成：

1. 校验固定服务 Token。
2. 校验渠道已配置为 Nango。
3. 根据 `externalUserId` 查找普通用户。
4. 用户不存在时自动创建：
   - `role = user`
   - Username 为 `externalUserId`
   - 初始密码为 `externalUserId`
   - `mustChangePassword = true`
5. 从 Nango 获取 `connectionId` 对应授权并验证邮箱身份。
6. 创建或恢复本地 Connection。
7. 将 Connection、Mail Account 和 Identity 归属该普通用户。
8. 激活现有邮件同步运行时。
9. 返回本地 Connection ID。

用户创建和邮箱绑定必须可安全重试。任何失败不得留下没有凭据、身份不完整或跨用户归属错误的
邮箱记录。

### 6.3 唯一归属

同一个 Nango Connection 永远只属于一个普通用户：

- 未绑定时可以绑定给请求中的用户。
- 已绑定给同一用户时返回已有结果或执行安全恢复。
- 已绑定给其他普通用户时返回 `NANGO_CONNECTION_ALREADY_BOUND`。
- 邮箱转移不是普通绑定行为，只能由未来明确的超管操作完成。

因此不需要邮箱共享表或每次 Launch 的邮箱 ACL。

## 7. CRM Launch

### 7.1 创建 Launch Grant

请求改为：

```http
POST /api/integrations/access-grants
Authorization: Bearer <INTEGRATION_API_TOKEN>
Content-Type: application/json
```

```json
{
  "externalUserId": "user_200"
}
```

Zero 必须：

1. 查找已存在的普通用户。
2. 验证用户至少存在一个可用邮箱连接。
3. 创建短期、一次性的 Launch Code。
4. 只返回 Launch Code，不返回邮箱列表、Session Token 或密码。

删除 `allowedNangoConnectIds` 输入及相关 Grant Scope 存储。

### 7.2 消费 Launch Code

浏览器通过表单消费 Launch Code：

1. Zero 校验并一次性消费 Launch Code。
2. 创建指向目标普通用户的外部浏览器 Session。
3. 初始活动邮箱使用该用户的默认邮箱；没有默认值时选择第一个可用邮箱。
4. 设置 HttpOnly Session Cookie。
5. 重定向到 `/mail/inbox`。

有效的外部 Session Cookie 必须优先于浏览器中已有的超管 Better Auth Cookie。这样 CRM
新窗口始终以目标普通用户的受限权限运行，不会因为浏览器曾登录超管而扩大权限。

外部 Session 失效或不存在时，才允许回退到普通 Better Auth Session。

## 8. Zero 独立登录

登录页面使用统一账号输入框：

- 输入管理员邮箱时使用邮箱密码登录。
- 输入普通用户 `externalUserId` 时使用 Better Auth Username 登录。
- 前端不提供注册链接。

普通用户首次密码登录成功后：

1. 服务端识别 `mustChangePassword = true`。
2. 前端跳转到专用的首次修改密码页面。
3. 除读取当前身份、退出登录和修改密码外，服务端拒绝该 Session 的邮件与业务接口。
4. 新密码必须满足现有密码强度要求，且不得与 `externalUserId` 或当前密码相同。
5. 修改成功后清除 `mustChangePassword`，跳转到 `/mail/inbox`。

CRM Launch 不创建或暴露密码，也不触发首次修改密码页面。

## 9. 统一前端邮箱界面

现有只在 External 模式渲染的 `ExternalAccountSwitcher` 改为通用账号切换组件。本阶段统一
邮箱选择能力，不同时重构普通用户的全部导航和功能权限。

### 9.1 账号列表

- 超管：服务端返回实例内全部有效 Connection。
- 普通用户密码登录：返回 `connection.userId = 当前用户` 的 Connection。
- CRM Launch：根据 Session 指向的普通用户返回相同范围。

前端不得自行使用 `allowedNangoConnectIds` 过滤。

### 9.2 活动邮箱

- 普通用户密码登录：保存用户默认邮箱。
- CRM Launch：保存当前外部 Session 的活动邮箱，避免不同 Launch 窗口互相修改选择。
- 超管：保存超管自己的活动邮箱选择，但不得改变邮箱所有权。

切换后统一刷新：

- Connection 列表
- 当前 Connection
- Mail Account
- 邮件线程和邮件列表
- 与 Connection 相关的查询缓存

### 9.3 导航权限

CRM Launch 继续沿用现有外部受限导航：

- 显示邮件主页、文件夹、搜索、写信和账号切换。
- 隐藏设置、新增、重新授权、断开和删除连接入口。
- 直接访问设置或连接管理路由时重定向到 `/mail/inbox`。

普通用户密码登录本阶段只新增登录、首次改密、`userId` 数据隔离和通用账号切换，不新增
细粒度页面授权。普通用户菜单和操作权限将在后续独立计划中调整。超管仍拥有实例级完整能力。

## 10. 邮件数据与 Webhook

邮件同步、收件和发件继续使用现有 Mail Account、Connection 和 Nango 运行时。

Webhook 契约保持：

```json
{
  "eventId": "evt_01",
  "messageId": "message_01"
}
```

- `eventId` 仅用于投递去重。
- `messageId` 是 CRM 回查邮件详情和状态的标识。
- Webhook 不增加用户、租户、正文、附件或签名字段。
- CRM 使用固定服务 Token 调用详情接口。
- Zero 详情接口必须根据 `messageId` 解析实际邮箱归属，不允许跨用户泄漏。

## 11. 现有数据迁移

当前开发实现可能已经存在由 `zero-external-integration` 持有的邮箱。

由于旧数据没有稳定的 `externalUserId`，不能仅依靠数据库自动判断目标普通用户。迁移策略为：

1. 新接口上线后，CRM 对每个现有 Nango Connection 使用对应 `externalUserId` 重新调用绑定接口。
2. 如果 Connection 仍归属旧的系统集成用户，Zero 可以在事务中将该 Connection、Mail Account
   及账号级邮件数据归属转移给目标普通用户，不重新拉取历史邮件。
3. 同一旧 Connection 只能被一个普通用户认领。
4. 已归属其他普通用户的 Connection 不允许通过该兼容逻辑转移。
5. 旧 Access Grant 和外部 Session 全部失效，CRM 重新创建基于 `externalUserId` 的 Launch。

`zero-external-integration` 可以继续作为渠道配置和服务操作的系统 Actor，但不再持有用户邮箱。

## 12. 错误契约

外部接口使用稳定的通用错误码：

- `INTEGRATION_UNAUTHORIZED`
- `INVALID_REQUEST`
- `EXTERNAL_USER_NOT_FOUND`
- `EXTERNAL_USER_INVALID`
- `MAIL_CHANNEL_UNAVAILABLE`
- `NANGO_CONNECTION_INVALID`
- `NANGO_CONNECTION_ALREADY_BOUND`
- `MAILBOX_ALREADY_CONNECTED`
- `EXTERNAL_USER_HAS_NO_MAILBOX`
- `LAUNCH_CODE_INVALID`
- `LAUNCH_CODE_EXPIRED`
- `PASSWORD_CHANGE_REQUIRED`

错误响应不得返回密码哈希、Nango 凭据、Session Token 或其他用户信息。

## 13. 测试策略

### 13.1 用户与认证

- API 可以自动创建普通用户，公开注册仍被禁用。
- `externalUserId` 唯一且只能创建 `role = user`。
- 初始密码可以登录，首次必须修改。
- 未修改密码的普通 Session 无法访问邮件接口。
- 修改后旧密码失效、新密码可用。
- CRM Launch 不受首次密码状态影响。
- 多个普通用户不影响唯一超管引导。

### 13.2 邮箱归属

- 首次绑定自动创建用户和邮箱。
- 同一用户重复绑定安全。
- 同一 Nango Connection 不能绑定给不同用户。
- 普通用户只能列出和访问自己的邮箱。
- 超管可以列出实例内全部邮箱。

### 13.3 Launch 与会话

- Grant 只接收 `externalUserId`。
- 生产代码不再包含 `allowedNangoConnectIds`。
- Launch Code 只能消费一次。
- CRM Launch 和密码登录返回相同的用户邮箱集合，CRM Launch 保留现有受限导航。
- 外部 Session 与超管 Cookie 同时存在时，外部 Session 优先。

### 13.4 前端

- 同一个账号切换组件覆盖超管、普通用户和 CRM Launch。
- CRM Launch 看不到设置及连接管理。
- 普通用户细粒度导航授权不属于本阶段回归范围。
- 超管可以看到完整管理入口。
- 多账号切换会刷新所有邮箱相关查询。
- 首次密码登录只能进入修改密码页面。

### 13.5 回归

- 现有邮件收发、同步、详情接口、附件读取和 ID-only Webhook 全部通过。
- PostgreSQL 端到端测试覆盖用户创建、绑定、双登录方式、邮箱切换和越权拒绝。
- Server、Mail 和 Mail Core 类型检查、测试及生产构建通过。

## 14. 验收标准

1. CRM 不再提交或保存 `allowedNangoConnectIds`。
2. 首次绑定可以通过 `externalUserId` 自动创建普通用户。
3. 普通用户可以使用 `externalUserId` 和初始同值密码独立登录。
4. 首次独立登录必须修改密码，修改前不能访问邮件。
5. CRM Launch 可以免密码进入同一普通用户的邮箱主页。
6. 两种普通用户登录方式显示相同邮箱集合并使用同一个账号切换组件。
7. 普通用户不能访问其他用户的邮箱和邮件数据。
8. 超管可以查看、切换和管理实例内全部邮箱。
9. 同一个 Nango Connection 不能属于两个普通用户。
10. CRM Launch 继续隐藏设置和连接管理。
11. Webhook 仍然只推送 `eventId` 和 `messageId`。
