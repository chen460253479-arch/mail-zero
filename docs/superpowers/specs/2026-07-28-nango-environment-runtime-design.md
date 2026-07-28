# Nango 环境配置运行时设计

## 1. 目标

将 Nango 全局服务地址和密钥从“管理员通过前端配置并保存到数据库”调整为“Server
通过固定环境变量配置”。

Zero 继续将 Nango 作为 Gmail 的可选凭证来源。Gmail 与 Nango Integration
之间的映射仍属于 Gmail 渠道配置，由管理员在 Gmail 配置界面选择并保存到 PostgreSQL。

## 2. 配置归属

Server 只读取以下两个私有环境变量：

```dotenv
NANGO_BASE_URL=https://api.nango.dev
NANGO_SECRET_KEY=
```

这些变量仅限 Server 使用：

- Mail 构建参数和浏览器运行时配置不得包含它们；
- tRPC 和 HTTP 响应不得返回它们；
- PostgreSQL 不得保存它们；
- 日志和错误消息不得包含 Secret Key、凭证、Token 或完整 Base URL。

修改任一变量后必须重启 Server。Server 进程或 Cloudflare Worker isolate
生命周期内的运行配置不可变。

## 3. 运行状态

Nango 运行健康状态属于派生的运行状态，保存在进程内存中，不写入 PostgreSQL 或 Redis。

安全状态模型如下：

```ts
type NangoRuntimeStatus =
  | { state: 'unconfigured'; checkedAt: null; errorCode: null }
  | { state: 'validating'; checkedAt: null; errorCode: null }
  | { state: 'available'; checkedAt: Date; errorCode: null }
  | {
      state: 'unavailable';
      checkedAt: Date;
      errorCode:
        | 'NANGO_ENV_INCOMPLETE'
        | 'NANGO_ENV_INVALID'
        | 'NANGO_API_KEY_INVALID'
        | 'NANGO_ENDPOINT_NOT_FOUND'
        | 'NANGO_INSUFFICIENT_PERMISSIONS'
        | 'NANGO_INVALID_RESPONSE'
        | 'NANGO_REQUEST_FAILED'
        | 'NANGO_UNREACHABLE';
    };
```

状态中不得包含密钥、Token、凭证、Base URL、原始响应内容或异常消息。

状态转换规则：

- 两个变量均为空：`unconfigured`；
- 只配置了其中一个变量：输出经过脱敏的配置错误并设置为 `unavailable`；
- 两个变量均已配置：先设置为 `validating`，然后转换为 `available` 或 `unavailable`。

每次 Server 重启后重新计算状态，不从持久化存储恢复。

## 4. 启动验证

Cloudflare Worker isolate 没有传统的应用启动回调。因此，Zero 在每个进程或 isolate
收到第一个运行事件时启动一次验证。在 Docker 环境中，现有 `/health` 探针会在 Server
启动后立即提供第一个事件。

验证 Promise 注册到事件执行上下文中，因此 Nango 可用性不会导致 `/health`
或普通请求失败。同一时间到达的多个运行事件复用同一个 Promise；每个进程或 isolate
最多执行一次验证。

验证覆盖 Zero 实际需要的 Nango API 操作：

1. 获取 Integrations 列表；
2. 通过受限请求检查 Connections 列表权限。

每个请求都必须设置明确的超时时间。超时、连接失败、Key 无效、权限不足、端点不存在或响应格式不兼容时，
错误必须被捕获并转换为安全的运行错误码。

验证失败时：

- 只输出一条经过脱敏的 `console.error` 日志，其中可以包含错误码、操作类型和 HTTP 状态；
- 将状态记录为 `unavailable`；
- 不向 `/health` 抛出异常；
- 不阻止 Server 继续运行；
- 不影响 Zero OAuth 或本地邮箱功能。

## 5. Nango 运行时边界

`apps/server/src/integrations/nango` 负责：

- 解析和校验两个环境变量；
- 创建 Nango Client；
- 每个进程只执行一次启动验证；
- 保存进程内的安全状态快照；
- 映射安全的 Nango Client 错误。

Nango Service 不再接收 System Integration Repository 或凭证加密密钥。获取 Integrations、
获取 Connections 和解析 Nango Connection 等运行操作必须要求当前状态为 `available`；否则返回
`NANGO_NOT_CONFIGURED` 或 `NANGO_INTEGRATION_UNAVAILABLE`。

Nango Client 不得接收来自请求参数的 Base URL 或 Secret Key。

## 6. 数据库模型

以下数据继续保留：

- `integration.channel_mapping` 保存选定的 Gmail Nango Integration ID；
- Nango 授权绑定继续保存 Nango Connection 和 Provider Config 引用；
- Gmail 渠道配置继续保存全局授权来源。

以下 Nango 服务配置需要删除：

- Nango 对应的 `integration.system_config` 记录；
- 加密后的 Nango Secret 存储；
- Nango 公共 Base URL 存储；
- 保存或删除 Nango 服务配置的 Repository 操作。

`integration.system_config` 继续支持 Gmail Zero OAuth 配置。Zero 当前仍处于允许清空重建的开发数据库阶段，
因此直接调整唯一的数据库结构模板及其快照。实现完成后，已有开发数据库必须清空并通过 `db:push`
重新创建。

## 7. API 规范

删除以下管理员接口：

- `integrations.validateAndSaveNango`；
- `integrations.deleteNango`；
- 不再使用的旧 Nango 配置概览输出。

继续保留：

- 查询 Nango Gmail Integrations；
- 选择 Gmail Nango Integration 映射；
- 查询和绑定 Nango Gmail Connections。

Gmail 渠道配置响应只暴露：

```ts
{
  state: 'unconfigured' | 'validating' | 'available' | 'unavailable';
  checkedAt: Date | null;
  errorCode: string | null;
  gmailIntegrationId: string | null;
  bindingCount: number;
}
```

响应不得包含 `baseUrl`、`secretConfigured` 或其他凭证元数据。

只有 Nango 运行状态为 `available` 时，才能执行 Integration 查询、映射和邮箱绑定操作。
仅存在已保存的 Integration 映射不能代表 Nango 可用。

## 8. 前端行为

Gmail 配置弹窗删除：

- Base URL 输入框；
- Secret Key 输入框；
- Validate Nango 操作；
- Delete Nango Configuration 操作；
- 不再被使用的前端 Nango 配置验证错误翻译逻辑。

Nango 授权区域只显示安全状态：

- `available`：允许选择 Nango Gmail 和修改 Integration 映射；
- `validating`：显示正在验证并禁用 Nango 控件；
- `unconfigured`：说明需要配置 Server 环境变量并禁用控件；
- `unavailable`：显示安全错误类别，提示运维人员检查 Server 日志、修正环境变量并重启 Server。

Nango 不可用时，已有的 Gmail Nango Integration ID 仍然显示，但不能修改。前端不提供重新验证操作；
重启 Server 是配置生效和重新验证的唯一边界。

## 9. 安全与错误处理

- Mail Docker 构建参数和运行时环境中不得出现 Nango 环境变量；
- Server 配置只接受 HTTP 或 HTTPS Base URL；
- 请求必须使用有界超时；
- 日志不得包含 Authorization Header、Secret Key、Connection 凭证、原始响应内容或完整 Base URL；
- API 响应只返回安全错误码；
- 前端状态不能影响 Nango 请求目标地址，从而消除当前由管理员输入地址形成的 SSRF 攻击面。

## 10. 验证要求

自动化测试必须证明：

- 环境变量解析覆盖全部为空、部分配置、合法配置和格式错误；
- 并发运行事件只触发一次验证；
- 验证成功和每一种 Client 错误类型都会产生正确的安全状态；
- 验证失败只输出脱敏日志，不会从初始化器向外抛出；
- Nango 不可用时运行操作会被拒绝；
- Server 环境包含新的私有变量；
- Compose 只向 Server 传递这些变量；
- Mail 构建和运行表面不包含这些变量；
- 已删除的 tRPC Mutation 和前端凭证控件不会重新出现；
- Gmail Nango Integration 映射仍然可以查询和修改；
- 唯一数据库结构模板不再保存 Nango 服务凭证；
- 现有 Nango Connection 绑定、收件凭证解析和发件凭证解析继续通过统一 Gmail 渠道工作。

## 11. 非目标

- 将 Gmail Nango Integration ID 移入环境变量；
- 在不重启 Server 的情况下自动重试失败的验证；
- 新增 PostgreSQL 或 Redis 健康状态存储；
- 修改 Nango Connection 的归属关系或从 Nango 删除 Connection；
- 修改 Gmail 同步、发件、Watch 或定时同步行为；
- 在本次改造中移除 Server 当前的 Wrangler 运行时。
