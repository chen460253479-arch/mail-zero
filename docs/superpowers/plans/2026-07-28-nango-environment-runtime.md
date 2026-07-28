# Nango 环境配置运行时实施计划

> **执行要求：** 按任务顺序使用 `superpowers:test-driven-development` 执行；每一步使用复选框记录状态。

**目标：** 将 Nango Base URL 和 Secret Key 固定为 Server 环境变量，在每个 Server
进程或 Worker isolate 启动后验证一次，并向前端只暴露安全的可用状态。

**架构：** `integrations/nango` 提供环境解析、固定 Client、一次性验证 Promise
和进程内状态；Server 的第一个运行事件通过 `ExecutionContext.waitUntil` 启动验证。Gmail
渠道继续通过 PostgreSQL 保存 Nango Integration 映射，但不再从数据库读取 Nango
服务地址或密钥。

**技术栈：** TypeScript、Cloudflare Workers、Hono、tRPC、PostgreSQL/Drizzle、React
Router、Vitest、Docker Compose

## 全局约束

- 只使用 `NANGO_BASE_URL` 和 `NANGO_SECRET_KEY` 配置 Nango 服务。
- 两个变量只传递给 Server，不进入 Mail 构建参数或浏览器响应。
- 验证失败只记录脱敏错误并设置 `unavailable`，不得阻止 Server 运行。
- 每个进程或 Worker isolate 最多验证一次，并发事件复用同一个 Promise。
- Gmail Nango Integration ID 继续保存在 `integration.channel_mapping`。
- 删除 Nango Base URL、Secret Key 的数据库存储、前端表单和修改 API。
- 本阶段不修改 Gmail 同步、发件、Watch、定时同步或 Nango Connection 归属。
- 实现代码保持未提交、未推送，等待用户明确要求。

---

### 任务 1：建立固定 Nango 运行时和一次性验证状态

**文件：**

- 修改：`apps/server/tests/unit/integrations/nango/client.test.ts`
- 重写：`apps/server/tests/unit/integrations/nango/service.test.ts`
- 修改：`apps/server/src/integrations/nango/client.ts`
- 修改：`apps/server/src/integrations/nango/service.ts`
- 新建：`apps/server/src/integrations/nango/runtime.ts`

**接口：**

- 输入：`{ NANGO_BASE_URL?: string; NANGO_SECRET_KEY?: string }`
- 输出：`NangoRuntimeStatus`
- 输出：`getNangoServiceForEnvironment(env)` 和
  `startNangoValidationForEnvironment(env, executionContext)`

- [x] **步骤 1：先写环境解析和状态转换失败测试**

测试必须覆盖：

```ts
[
  ['两个变量为空', 'unconfigured'],
  ['只存在一个变量', 'unavailable', 'NANGO_ENV_INCOMPLETE'],
  ['URL 非法或不是 HTTP(S)', 'unavailable', 'NANGO_ENV_INVALID'],
  ['验证成功', 'available'],
  ['Key 无效', 'unavailable', 'NANGO_API_KEY_INVALID'],
  ['连接失败', 'unavailable', 'NANGO_UNREACHABLE'],
];
```

并发调用 `initialize()` 两次时，`client.validateAccess()` 必须只执行一次。日志断言只能看到
`code`、`operation` 和 `status`，不得出现 Secret 或完整 Base URL。

- [x] **步骤 2：运行测试并确认 RED**

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/nango/client.test.ts tests/unit/integrations/nango/service.test.ts
```

预期：测试因新的运行状态、`validateAccess()` 和环境运行时不存在而失败。

- [x] **步骤 3：实现受限验证请求和环境运行服务**

`NangoClient.validateAccess()` 依次验证 Integrations 和一页 `limit=1` 的 Connections，
所有请求使用明确超时。

`NangoIntegrationService` 不再依赖 Repository 或 `CREDENTIAL_ENCRYPTION_KEY`，只接收：

```ts
{
  baseUrl?: string;
  secretKey?: string;
  createClient(config): NangoClientLike;
  now(): Date;
  logError(code, details): void;
}
```

`initialize()` 捕获全部错误并返回安全状态；`getClient()` 在验证完成后只允许
`available` 状态。

- [x] **步骤 4：实现每个 isolate 的单例适配器**

`runtime.ts` 保存一个模块级 Service，第一次事件通过 `waitUntil(service.initialize())`
启动验证。后续路由、队列和定时任务复用同一 Service。

- [x] **步骤 5：运行测试并确认 GREEN**

重复步骤 2，预期全部通过。

---

### 任务 2：将 Server、Gmail 渠道和凭证解析切换到环境运行时

**文件：**

- 修改：`apps/server/src/env.ts`
- 修改：`apps/server/src/main.ts`
- 修改：`apps/server/src/trpc/routes/integrations.ts`
- 修改：`apps/server/src/trpc/routes/connections.ts`
- 修改：`apps/server/src/integrations/gmail/channel-config-service.ts`
- 修改：`apps/server/src/modules/mail-accounts/runtime/nango.ts`
- 修改：`apps/server/src/runtime/mail/gmail-credential-context.ts`
- 修改：`apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts`
- 修改：`apps/server/tests/unit/trpc/routes/integrations.test.ts`
- 修改：`apps/server/tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts`
- 修改：`apps/server/tests/unit/modules/mail-accounts/application/list-nango-channels.test.ts`
- 修改：`apps/server/tests/unit/modules/mail-accounts/application/nango-channel-mapping.test.ts`
- 修改：`apps/server/tests/unit/modules/mail-accounts/credentials/nango.test.ts`

**接口：**

- Gmail 安全响应：

```ts
authorizationSources: {
  nango: {
    state: 'unconfigured' | 'validating' | 'available' | 'unavailable';
    checkedAt: Date | null;
    errorCode: string | null;
    gmailIntegrationId: string | null;
    bindingCount: number;
  }
}
```

- [x] **步骤 1：先更新 Gmail 渠道和路由失败测试**

测试必须证明：

- `available + mapping` 时允许保存 Nango 授权来源；
- `unconfigured`、`validating` 或 `unavailable` 时拒绝选择 Nango；
- tRPC 不再暴露 `validateAndSaveNango`、`deleteNango` 和旧 `getOverview`；
- Integration 查询和映射接口继续存在。

- [x] **步骤 2：运行聚焦测试并确认 RED**

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/trpc/routes/integrations.test.ts
```

- [x] **步骤 3：切换所有 Server 调用点**

`main.ts` 的 `fetch`、`queue` 和 `scheduled` 入口启动一次性验证。tRPC、Nango
邮箱绑定、入站和出站 Gmail 凭证解析全部通过同一个环境 Service 获取 Client。

`getGmailAuthorizationOptions` 使用安全运行状态和数据库映射共同判断 Nango 是否可选。

- [x] **步骤 4：删除 Nango 配置修改 API**

删除输入 Schema、保存、验证、删除和旧概览处理器。保留 Integration 查询、映射、
Connection 查询和绑定接口。

- [x] **步骤 5：运行相关 Server 单元测试并确认 GREEN**

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/nango tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts tests/unit/modules/mail-accounts/application/list-nango-channels.test.ts tests/unit/modules/mail-accounts/application/nango-channel-mapping.test.ts tests/unit/modules/mail-accounts/credentials/nango.test.ts tests/unit/trpc/routes/integrations.test.ts
```

---

### 任务 3：收敛数据库模板、环境配置和前端

**文件：**

- 修改：`.env.example`
- 修改：`apps/server/src/db/schema.ts`
- 修改：`apps/server/src/db/migrations/0000_steady_silver_centurion.sql`
- 修改：`apps/server/src/db/migrations/meta/0000_snapshot.json`
- 修改：`apps/server/src/integrations/core/schemas.ts`
- 修改：`apps/server/src/integrations/core/repository.ts`
- 修改：Repository 单元测试和测试替身
- 修改：`apps/mail/components/integrations/gmail-settings-dialog.tsx`
- 删除：`apps/mail/lib/nango-validation-error.ts`
- 修改或删除：对应 Nango 前端错误测试
- 修改：`apps/server/tests/architecture/nango-credential-boundary.test.ts`
- 修改：`apps/server/tests/architecture/integrations-ui-boundary.test.ts`
- 修改：`apps/server/tests/architecture/docker-mail-static-runtime.test.ts`

**接口：**

- `.env.example`：

```dotenv
NANGO_BASE_URL=https://api.nango.dev
NANGO_SECRET_KEY=
```

- [x] **步骤 1：先写数据库、环境和前端边界失败测试**

测试必须阻止以下内容重新出现：

- `integration.system_config` 接受 `nango`；
- 前端包含 Nango Base URL、Secret Key、Validate 或 Delete 控件；
- Mail Compose 构建参数或环境包含 Nango 私有变量；
- Server 类型缺少两个 Nango 环境变量。

- [x] **步骤 2：运行架构测试并确认 RED**

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/nango-credential-boundary.test.ts tests/architecture/integrations-ui-boundary.test.ts tests/architecture/docker-mail-static-runtime.test.ts
```

- [x] **步骤 3：更新唯一数据库模板**

将 `system_config.integration_key` 类型和约束收敛为 `gmail_zero_oauth`，删除 Nango
公共配置 Schema 和 Repository 保存/删除逻辑。保留 `channel_mapping`、
`authorization_binding` 及其 Nango 引用约束。

- [x] **步骤 4：更新 Gmail 配置界面**

删除 Nango 地址、密钥、验证、删除逻辑。按安全状态展示“验证中、可用、未配置、不可用”；
非 `available` 状态禁用 Nango 授权选项和 Integration 下拉框，已有映射 ID 仍显示。

- [x] **步骤 5：运行架构测试和 Mail 测试并确认 GREEN**

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/nango-credential-boundary.test.ts tests/architecture/integrations-ui-boundary.test.ts tests/architecture/docker-mail-static-runtime.test.ts
pnpm --filter @zero/mail test
```

---

### 任务 4：完整验证和工作区收尾

**文件：**

- 验证所有上述改动；不新增生产文件。

- [x] **步骤 1：运行 Nango/Gmail 聚焦回归**

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/nango tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts tests/unit/modules/mail-accounts/application/list-nango-channels.test.ts tests/unit/modules/mail-accounts/application/nango-channel-mapping.test.ts tests/unit/modules/mail-accounts/credentials/nango.test.ts tests/unit/trpc/routes/integrations.test.ts
```

- [x] **步骤 2：运行类型和格式检查**

```powershell
pnpm --filter @zero/server typecheck
pnpm --filter @zero/mail typecheck
pnpm exec prettier --check apps/server/src/env.ts apps/server/src/main.ts apps/server/src/integrations/nango apps/server/src/integrations/core apps/server/src/integrations/gmail/channel-config-service.ts apps/server/src/modules/mail-accounts/runtime/nango.ts apps/server/src/runtime/mail/gmail-credential-context.ts apps/server/src/trpc/routes/connections.ts apps/server/src/trpc/routes/integrations.ts apps/server/src/db/schema.ts apps/server/tests/unit/integrations apps/server/tests/unit/modules/mail-accounts apps/server/tests/unit/trpc/routes/integrations.test.ts apps/server/tests/architecture apps/mail/components/integrations/gmail-settings-dialog.tsx docs/superpowers/plans/2026-07-28-nango-environment-runtime.md
git diff --check
```

仓库没有 `typecheck` 脚本，因此实际使用 `pnpm --filter @zero/server exec tsc --noEmit`
检查 Server；Mail 的直接 `tsc` 仍受仓库既有的重复 Vite 类型实例影响，改用全量测试、
针对性 ESLint 和实际生产构建完成本次改动验证。

- [x] **步骤 3：验证 Compose 配置边界**

```powershell
docker compose config --format json
```

确认 Nango 私有变量只存在于 Server 的 `env_file` 运行边界，Mail 没有环境变量或
Nango 构建参数。

- [x] **步骤 4：报告数据库重建要求**

实现完成后不自动清空数据库。向用户明确说明需要通过交互式 `db:push`
选择清空重建，旧 Nango `system_config` 数据不会迁移。

- [x] **步骤 5：检查工作区**

清理测试生成的缓存目录，确认只保留计划内源码、测试和文档，保持未提交、未推送。

---

### 任务 5：对齐本地开发环境配置

**文件：**

- 修改（Git 忽略）：`.env`
- 参照：`.env.example`

**约束：**

- 保留 `.env` 中所有现有变量值原文，不打印任何值；
- 使用 `.env.example` 的变量顺序、注释和缺省值补齐缺失项；
- 不生成、猜测或覆盖 `NANGO_SECRET_KEY`；
- 不提交 `.env`。

- [x] **步骤 1：建立缺失变量 RED 基线**

只比较变量名称，确认 `.env` 比 `.env.example` 缺少 Docker、PostgreSQL 和 Nango
相关的 11 个变量，且没有重复键或模板之外的键。

- [x] **步骤 2：执行确定性模板合并**

按 `.env.example` 逐行生成 `.env`：已有键使用 `.env` 原始整行，缺失键使用模板整行，
注释和空行使用模板内容。

- [x] **步骤 3：验证结构和私有配置边界**

再次只比较变量名称，要求缺失键、额外键和重复键均为空；检查
`NANGO_BASE_URL`、`NANGO_SECRET_KEY` 均存在，并通过 `docker compose config`
确认 Nango 变量只进入 Server，不进入 Mail。
