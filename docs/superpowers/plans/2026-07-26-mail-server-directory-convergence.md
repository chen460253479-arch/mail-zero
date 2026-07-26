# Zero Mail Server Directory Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Zero 新版邮件服务端代码收敛到清晰的账号、渠道、同步、外部集成和基础设施边界，并确保新 Gmail 入站链路完全不依赖旧 Driver、Pipeline、Workflow、Durable Object 邮件存储或 Gmail KV。

**Architecture:** `@zero/mail-core` 保持唯一邮件核心；`modules/mail-accounts` 管理连接和凭证，`mail-channel` 管理 Provider 插件，`modules/mail-sync` 管理 Provider 无关的入站编排，`integrations` 管理 Nango 等外部平台，`runtime/mail` 负责跨模块组合。旧前端邮件链路本阶段留在原位置，但新目录禁止导入旧代码。

**Tech Stack:** TypeScript、Vitest、PostgreSQL、Drizzle ORM、Cloudflare Workers/Queues、Google Gmail API、Nango、`@zero/mail-core`

## Global Constraints

- 直接在 `D:\WorkSpace\Zero` 当前 `codex/local-mail-core` 分支工作，不创建 Git worktree。
- 保留并忽略用户未跟踪的 `AGENTS.md`。
- 本阶段不改变 PostgreSQL Schema、表、约束、索引或模板初始化 SQL。
- 本阶段不实现 Gmail 发件，不创建空的 `mail-outbound` 或 `gmail/outbound`。
- 本阶段不切换现有前端 API 行为，不删除仍被旧前端调用的 Driver、Pipeline、Workflow、DO 或 KV。
- 新目录不得导入 `lib/driver`、`lib/factories`、`pipelines.ts`、`workflows/sync-threads-*` 或旧 DO 邮件存储。
- Zero OAuth 与 Nango 必须输出统一 `ResolvedCredential`，共用同一个 Gmail 入站插件。
- 文件迁移使用 `apply_patch`；只对明确目标文件进行暂存和提交。

---

### Task 1: 建立可执行的架构边界测试

**Files:**
- Create: `apps/server/src/mail-architecture.test.ts`

**Interfaces:**
- Consumes: Node `fs`、`path` 和 Vitest。
- Produces: `canonicalRoots`、`collectTypeScriptFiles()` 和禁止依赖规则的自动化验证。

- [ ] **Step 1: 写入目标目录存在性和依赖边界测试**

测试必须包含以下目标目录：

```ts
const canonicalRoots = [
  'modules/mail',
  'modules/mail-accounts',
  'modules/mail-sync',
  'mail-channel',
  'integrations',
  'infrastructure/security',
  'runtime/mail',
] as const;
```

测试扫描静态 `import`、`export ... from` 和动态 `import()`，并验证：

```ts
const forbiddenForCanonical = [
  '/lib/driver/',
  '/lib/factories/',
  '/pipelines',
  '/workflows/sync-threads-',
  '/lib/server-utils',
] as const;
```

另行验证：

- `mail-channel` 不导入 `/db/`、`/routes/`、`/trpc/`、`cloudflare:workers`；
- `modules/mail-sync/domain` 与 `modules/mail-sync/application` 不导入 `mail-channel/gmail`；
- `integrations/nango` 不导入 `mail-channel/gmail`；
- `routes` 和 `trpc` 不直接导入 `@googleapis/gmail` 或 `integrations/nango/client`。

- [ ] **Step 2: 运行测试并确认它因目标目录尚不存在而失败**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/mail-architecture.test.ts
```

Expected: FAIL，至少报告 `modules/mail-accounts`、`mail-channel`、`integrations`、`infrastructure/security`、`runtime/mail` 尚不存在。

- [ ] **Step 3: 提交失败测试**

```powershell
git add -- apps/server/src/mail-architecture.test.ts
git commit -m "test(mail): enforce server module boundaries"
```

### Task 2: 迁移安全基础设施和系统集成核心

**Files:**
- Move: `apps/server/src/lib/credentials/encryption.ts` → `apps/server/src/infrastructure/security/credential-encryption.ts`
- Move: `apps/server/src/lib/credentials/encryption.test.ts` → `apps/server/src/infrastructure/security/credential-encryption.test.ts`
- Move: `apps/server/src/lib/integrations/schemas.ts` → `apps/server/src/integrations/core/schemas.ts`
- Move: `apps/server/src/lib/integrations/repository.ts` → `apps/server/src/integrations/core/repository.ts`
- Move: `apps/server/src/lib/integrations/repository.test.ts` → `apps/server/src/integrations/core/repository.test.ts`
- Move: `apps/server/src/lib/integrations/permissions.ts` → `apps/server/src/integrations/core/permissions.ts`
- Move: `apps/server/src/lib/integrations/permissions.test.ts` → `apps/server/src/integrations/core/permissions.test.ts`
- Modify: all TypeScript imports of the moved encryption and integration-core modules.

**Interfaces:**
- Preserves: `encryptCredential()`, `decryptCredential()`, `SystemIntegrationRepository`, `createSystemIntegrationRepository()`, `assertAdministrator()`.
- Produces: stable canonical import paths under `infrastructure/security` and `integrations/core`.

- [ ] **Step 1: 使用 patch 移动文件，不改变导出签名**

只修改相对 import 路径：

- DB imports from `integrations/core` point to `../../db`;
- encryption consumers point to `infrastructure/security/credential-encryption`;
- integration schemas and repository remain colocated.

- [ ] **Step 2: 更新所有测试和运行时代码的 import**

使用只读搜索确认旧路径没有调用方：

```powershell
Get-ChildItem apps/server/src -Recurse -Filter *.ts |
  Select-String "lib/credentials/encryption|lib/integrations/(schemas|repository|permissions)"
```

Expected: no matches.

- [ ] **Step 3: 运行聚焦测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run `
  src/infrastructure/security/credential-encryption.test.ts `
  src/integrations/core/repository.test.ts `
  src/integrations/core/permissions.test.ts
```

Expected: PASS.

- [ ] **Step 4: 提交**

```powershell
git add -- apps/server/src/infrastructure apps/server/src/integrations apps/server/src
git commit -m "refactor(integrations): establish security and integration core"
```

暂存前检查不得包含 `AGENTS.md` 或无关文件。

### Task 3: 建立独立 Nango 集成模块

**Files:**
- Move: `apps/server/src/lib/nango/client.ts` → `apps/server/src/integrations/nango/client.ts`
- Move: `apps/server/src/lib/nango/client.test.ts` → `apps/server/src/integrations/nango/client.test.ts`
- Move: `apps/server/src/lib/nango/types.ts` → `apps/server/src/integrations/nango/schemas.ts`
- Create: `apps/server/src/integrations/nango/errors.ts`
- Move/Split: `apps/server/src/lib/integrations/nango-service.ts` → `apps/server/src/integrations/nango/service.ts`
- Move: `apps/server/src/lib/integrations/nango-service.test.ts` → `apps/server/src/integrations/nango/service.test.ts`
- Modify: Nango imports in routes、tRPC、credential runtime 和 tests.

**Interfaces:**
- Preserves: `NangoClient`, `NangoClientError`, `NangoIntegrationService`, `NangoIntegrationError`.
- Produces: Nango 模块不导入 Gmail 元数据或 MailChannel。

- [ ] **Step 1: 为 Nango 服务补充 Provider 无关测试**

修改服务测试，验证 `NangoIntegrationService` 只负责：

- 读取安全配置；
- 校验并保存 base URL 和 secret；
- 验证 `listIntegrations`、`listConnections` 和已有连接引用；
- 在仍有绑定时阻止危险配置变化或删除。

移除对 `listGmailIntegrations()` 和 `setGmailMapping()` 的测试；这些行为将在 Task 4 进入邮箱账号应用层。

- [ ] **Step 2: 运行测试并确认旧实现不满足新边界**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/integrations/nango/service.test.ts
```

Expected: FAIL，因为文件尚未移动或服务仍包含 Gmail 专属行为。

- [ ] **Step 3: 移动客户端、Schema 和错误类型**

`client.ts` 只依赖 `schemas.ts`；`errors.ts` 保存 Nango 客户端错误到应用错误的映射；任何文件不得导入 Gmail metadata。

- [ ] **Step 4: 拆分 Nango 服务**

保留以下方法：

```ts
getSafeConfig()
getRuntimeConfig()
validateAndSave()
delete()
```

删除 Gmail 专属方法：

```ts
listGmailIntegrations()
setGmailMapping()
```

通用服务仍可列出全部 Nango integration，供上层邮箱账号用例筛选：

```ts
listIntegrations(): Promise<NangoIntegration[]>
```

- [ ] **Step 5: 更新调用方并运行测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run `
  src/integrations/nango/client.test.ts `
  src/integrations/nango/service.test.ts
```

Expected: PASS.

- [ ] **Step 6: 提交**

```powershell
git add -- apps/server/src/integrations/nango apps/server/src
git commit -m "refactor(nango): isolate external integration infrastructure"
```

### Task 4: 收敛邮箱账号、授权绑定和凭证解析

**Files:**
- Move: `apps/server/src/lib/connection-lifecycle.ts` → `apps/server/src/modules/mail-accounts/application/disconnect-mailbox.ts`
- Move: `apps/server/src/lib/connection-lifecycle.test.ts` → `apps/server/src/modules/mail-accounts/application/disconnect-mailbox.test.ts`
- Move: `apps/server/src/lib/mail-channel/mailbox-identity.ts` → `apps/server/src/modules/mail-accounts/application/mailbox-identity.ts`
- Move: `apps/server/src/lib/mail-channel/mailbox-identity.test.ts` → `apps/server/src/modules/mail-accounts/application/mailbox-identity.test.ts`
- Move: `apps/server/src/lib/nango/bind.ts` → `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.ts`
- Move: `apps/server/src/lib/nango/bind.test.ts` → `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.test.ts`
- Move: `apps/server/src/lib/nango/channel-catalog.ts` → `apps/server/src/modules/mail-accounts/application/list-nango-channels.ts`
- Move: `apps/server/src/lib/nango/channel-catalog.test.ts` → `apps/server/src/modules/mail-accounts/application/list-nango-channels.test.ts`
- Move: `apps/server/src/lib/credentials/resolve.ts` → `apps/server/src/modules/mail-accounts/credentials/resolve.ts`
- Move: `apps/server/src/lib/credentials/resolve.test.ts` → `apps/server/src/modules/mail-accounts/credentials/resolve.test.ts`
- Move: `apps/server/src/lib/credentials/zero-oauth.ts` → `apps/server/src/modules/mail-accounts/credentials/zero-oauth.ts`
- Move: `apps/server/src/lib/credentials/zero-oauth.test.ts` → `apps/server/src/modules/mail-accounts/credentials/zero-oauth.test.ts`
- Move: `apps/server/src/lib/credentials/nango.ts` → `apps/server/src/modules/mail-accounts/credentials/nango.ts`
- Move: `apps/server/src/lib/credentials/nango.test.ts` → `apps/server/src/modules/mail-accounts/credentials/nango.test.ts`
- Move: `apps/server/src/lib/credentials/nango-retry.test.ts` → `apps/server/src/modules/mail-accounts/credentials/nango-retry.test.ts`
- Move: `apps/server/src/lib/credentials/retrying-client.ts` → `apps/server/src/modules/mail-accounts/credentials/retry.ts`
- Move: `apps/server/src/lib/credentials/nango-runtime.ts` → `apps/server/src/modules/mail-accounts/runtime/nango.ts`
- Create: `apps/server/src/modules/mail-accounts/index.ts`

**Interfaces:**
- Preserves: connection lifecycle、credential resolution 和绑定错误码。
- Produces: 邮箱账号模块依赖通用 MailChannel contract，而不是 Gmail 实现。

- [ ] **Step 1: 迁移凭证测试并确认失败**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-accounts
```

Expected: FAIL，目标文件尚未迁移。

- [ ] **Step 2: 移动凭证和生命周期代码**

统一使用：

```ts
export type ResolvedCredential =
  | {
      type: 'oauth2';
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date | null;
      scope: string;
    }
  | {
      type: 'basic';
      username: string;
      password: string;
      host: string;
      port: number;
      secure: boolean;
    };
```

该类型最终从 `mail-channel/contracts/credentials.ts` 导出；在 Task 5 完成前允许先由 mail-accounts 局部导出，Task 5 再统一引用。

- [ ] **Step 3: 将 Gmail/Nango 映射编排移入应用层**

`list-nango-channels.ts` 接收：

```ts
integrations: readonly NangoIntegration[]
channels: readonly MailChannelDescriptor[]
```

只根据插件声明的 `nangoProviders` 求交集。

`bind-nango-mailbox.ts` 负责读取 Nango Connection、解析凭证、调用渠道身份解析、验证重复绑定并保存 Connection/AuthorizationBinding。

- [ ] **Step 4: 更新 routes、tRPC、server-utils 和测试 import**

旧前端代码允许导入新的 mail-accounts 模块；反向依赖禁止。

- [ ] **Step 5: 运行 mail-accounts 全量测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/modules/mail-accounts
```

Expected: PASS.

- [ ] **Step 6: 提交**

```powershell
git add -- apps/server/src/modules/mail-accounts apps/server/src
git commit -m "refactor(mail-accounts): centralize mailbox credentials and lifecycle"
```

### Task 5: 建立正式 MailChannel 契约、注册表和 Gmail 目录

**Files:**
- Create: `apps/server/src/mail-channel/contracts/channel.ts`
- Create: `apps/server/src/mail-channel/contracts/credentials.ts`
- Create: `apps/server/src/mail-channel/contracts/index.ts`
- Create: `apps/server/src/mail-channel/registry/registry.ts`
- Create: `apps/server/src/mail-channel/registry/registry.test.ts`
- Create: `apps/server/src/mail-channel/registry/index.ts`
- Move: `apps/server/src/lib/mail-channel/gmail-metadata.ts` → `apps/server/src/mail-channel/gmail/metadata.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/gmail-api-client.ts` → `apps/server/src/mail-channel/gmail/shared/api-client.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/gmail-api-client.test.ts` → `apps/server/src/mail-channel/gmail/shared/api-client.test.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/driver-transport.ts` → `apps/server/src/mail-channel/gmail/shared/api-transport.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/driver-transport.test.ts` → `apps/server/src/mail-channel/gmail/shared/api-transport.test.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/errors.ts` → `apps/server/src/mail-channel/gmail/shared/errors.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/history-mapper.ts` → `apps/server/src/mail-channel/gmail/inbound/history-mapper.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/history-mapper.test.ts` → `apps/server/src/mail-channel/gmail/inbound/history-mapper.test.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/ingress-adapter.ts` → `apps/server/src/mail-channel/gmail/inbound/adapter.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/ingress-adapter.test.ts` → `apps/server/src/mail-channel/gmail/inbound/adapter.test.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/handle-push.ts` → `apps/server/src/mail-channel/gmail/inbound/handle-push.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/handle-push.test.ts` → `apps/server/src/mail-channel/gmail/inbound/handle-push.test.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/pubsub-policy.ts` → `apps/server/src/mail-channel/gmail/inbound/pubsub-policy.ts`
- Move: `apps/server/src/lib/mail-channel/gmail/pubsub-policy.test.ts` → `apps/server/src/mail-channel/gmail/inbound/pubsub-policy.test.ts`
- Split: `apps/server/src/lib/mail-channel/gmail/channel.ts` into shared client exports, inbound factory exports, and `plugin.ts`.
- Rewrite: `apps/server/src/lib/mail-channel/gmail.test.ts` → `apps/server/src/mail-channel/gmail/plugin.test.ts`
- Create: `apps/server/src/mail-channel/gmail/plugin.ts`
- Create: `apps/server/src/mail-channel/gmail/index.ts`

**Interfaces:**
- Produces: `MailChannelPlugin`, `MailChannelDescriptor`, `MailChannelRegistry`, `ResolvedCredential`.
- Consumes: `InboundMailAdapterFactory` only as a capability contract; no DB/Queue/runtime dependencies.

- [ ] **Step 1: 写注册表失败测试**

覆盖：

```ts
registry.list()
registry.find('gmail')
registry.get('gmail')
registry.get('unsupported') // throws
registry.getInbound('gmail')
registry.getInbound('outlook') // capability error
```

同时验证 Gmail plugin：

- `id === 'gmail'`；
- `credentialTypes` 只包含 `oauth2`；
- 声明 Gmail/Nango provider metadata；
- 注册唯一 inbound factory；
- 不暴露旧 `createClient`、`sync` 或 legacy provider mapping。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/mail-channel/registry/registry.test.ts
```

Expected: FAIL，因为正式 registry 尚不存在。

- [ ] **Step 3: 创建通用契约**

核心定义：

```ts
export interface MailChannelPlugin {
  readonly id: MailChannelId;
  readonly providerKey: string;
  readonly displayName: string;
  readonly credentialTypes: ReadonlySet<MailCredentialType>;
  readonly capabilities: ReadonlySet<MailCapability>;
  readonly nangoProviders?: readonly string[];
  resolveIdentity(input: {
    credential: ResolvedCredential;
  }): Promise<{ email: string; name: string; picture: string }>;
  readonly inbound?: {
    createAdapter(input: {
      connectionId: string;
      credential: ResolvedCredential;
    }): Promise<InboundMailAdapter>;
  };
}
```

Provider 插件不能接收 DB、Queue 或 Nango client。

- [ ] **Step 4: 重组 Gmail 文件**

```text
mail-channel/gmail/
├── plugin.ts
├── metadata.ts
├── index.ts
├── shared/
│   ├── api-client.ts
│   ├── api-client.test.ts
│   ├── api-transport.ts
│   ├── api-transport.test.ts
│   └── errors.ts
├── auth/
│   └── google-oauth-gateway.ts
└── inbound/
    ├── adapter.ts
    ├── adapter.test.ts
    ├── handle-push.ts
    ├── handle-push.test.ts
    ├── history-mapper.ts
    ├── history-mapper.test.ts
    ├── pubsub-policy.ts
    └── pubsub-policy.test.ts
```

`api-transport.ts` 接收一个无状态 `GmailApiExecutor`，不读取凭证或环境。

- [ ] **Step 5: 迁移 Google OAuth gateway**

Move:

```text
lib/integrations/google-gmail-oauth.ts
→ mail-channel/gmail/auth/google-oauth-gateway.ts
```

Gateway 只处理 Google OAuth HTTP 协议和身份 API，不访问数据库。

- [ ] **Step 6: 更新 mail-accounts 对正式 contracts/registry 的依赖**

删除 Task 4 的局部凭证类型，统一从 `mail-channel/contracts` 引用。

- [ ] **Step 7: 运行插件、mail-accounts 和 mail-sync 契约测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run `
  src/mail-channel `
  src/modules/mail-accounts `
  src/modules/mail-sync/domain
```

Expected: PASS.

- [ ] **Step 8: 提交**

```powershell
git add -- apps/server/src/mail-channel apps/server/src/modules/mail-accounts apps/server/src
git commit -m "refactor(mail-channel): establish provider plugin boundaries"
```

### Task 6: 建立跨模块运行时并解除 Gmail 入站对旧 Driver 的依赖

**Files:**
- Create: `apps/server/src/runtime/mail/gmail-api-executor.ts`
- Create: `apps/server/src/runtime/mail/gmail-api-executor.test.ts`
- Move/Split: `apps/server/src/lib/mail-channel/gmail/ingress-runtime.ts` → `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/src/modules/mail-sync/runtime/create-mail-sync.ts`
- Modify: `apps/server/src/main.ts`
- Modify: Queue/scheduled handler imports that call `runMailIngressCommand()`、`enqueueDueMailIngressWork()`、`activateGmailInboundForConnection()`.

**Interfaces:**
- Produces: runtime composition that connects DB、mail-accounts credential resolution、MailChannelRegistry、mail-sync、Mail Core and Queue.
- Removes: new ingress dependency on `connectionToDriver()` and `GoogleMailManager`.

- [ ] **Step 1: 写 Gmail executor 失败测试**

覆盖：

- Zero OAuth access token 创建 Gmail SDK executor；
- Nango token 使用相同 executor；
- 第一次 401 时失效并强制刷新凭证，只重试一次；
- 第二次 401 时标记连接 `reconnect_required`；
- 非 401 错误不刷新；
- executor 不把 token 写入错误消息。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/runtime/mail/gmail-api-executor.test.ts
```

Expected: FAIL，因为 runtime 尚未实现。

- [ ] **Step 3: 实现凭证驱动的 Gmail API executor**

运行时接收依赖：

```ts
type GmailCredentialExecutorDependencies = {
  resolveCredential(forceRefresh: boolean): Promise<ResolvedCredential>;
  createClient(credential: OAuth2Credential): GmailApiExecutor;
  invalidateCredential(): Promise<void>;
  markReconnectRequired(): Promise<void>;
  isUnauthorized(error: unknown): boolean;
};
```

算法：

1. 正常解析凭证并创建 executor；
2. 调用失败且不是 401，原样抛出；
3. 第一次 401 时失效凭证并强制刷新；
4. 使用新 token 重建 executor并重试一次；
5. 第二次 401 时标记重连并抛出；
6. Basic credential 对 Gmail 返回明确的不支持错误。

- [ ] **Step 4: 重写 Gmail 入站组合**

`runtime/mail/gmail-inbound.ts`：

- 查询 Connection/AuthorizationBinding；
- 通过 mail-accounts 解析凭证；
- 从 MailChannelRegistry 取得 Gmail inbound capability；
- 构造 adapter factory；
- 装配 PostgreSQL mail-sync repository、Mail Core 和 Queue；
- 保留现有 Inbox-only、incremental-only 行为；
- 不导入 `lib/server-utils`、`lib/driver`、旧 pipelines 或 workflows。

- [ ] **Step 5: 将 mail-sync runtime 的 Provider 路由改为注册表能力查找**

删除：

```ts
if (provider !== 'gmail') {
  throw new Error(...)
}
```

改为由组合运行时注入：

```ts
getAdapterFactory(provider: string): InboundMailAdapterFactory
```

实现通过 registry 查找插件能力，mail-sync 本身不导入 Gmail。

- [ ] **Step 6: 运行入站测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run `
  src/runtime/mail `
  src/mail-channel/gmail `
  src/modules/mail-sync
```

Expected: PASS.

- [ ] **Step 7: 静态搜索旧依赖**

Run:

```powershell
Get-ChildItem `
  apps/server/src/mail-channel,`
  apps/server/src/modules/mail-accounts,`
  apps/server/src/modules/mail-sync,`
  apps/server/src/integrations,`
  apps/server/src/runtime/mail `
  -Recurse -Filter *.ts |
  Select-String "lib/driver|lib/factories|pipelines|sync-threads|lib/server-utils"
```

Expected: no matches.

- [ ] **Step 8: 提交**

```powershell
git add -- apps/server/src/runtime/mail apps/server/src/modules/mail-sync apps/server/src/mail-channel apps/server/src/main.ts
git commit -m "refactor(mail-sync): compose gmail ingress through plugin registry"
```

### Task 7: 收敛 Gmail OAuth 和系统集成应用装配

**Files:**
- Move/Split: `apps/server/src/lib/integrations/gmail-oauth-service.ts`
- Move: `apps/server/src/lib/integrations/gmail-oauth-service.test.ts`
- Move/Split: `apps/server/src/lib/integrations/gmail-oauth-runtime.ts`
- Move: `apps/server/src/lib/integrations/gmail-connection-options.ts`
- Move: `apps/server/src/lib/integrations/gmail-connection-options.test.ts`
- Modify: `apps/server/src/routes/integrations.ts`
- Modify: `apps/server/src/trpc/routes/integrations.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/trpc/routes/integration-errors.ts`
- Modify: `apps/server/src/trpc/trpc.ts`

**Interfaces:**
- Produces: `modules/mail-accounts/application/connect-gmail-oauth.ts`、系统集成 runtime 和安全 route adapters.
- Preserves: 当前 HTTP callback、tRPC procedure、错误码和安全响应。

- [ ] **Step 1: 迁移测试到 mail-accounts**

测试继续覆盖：

- Gmail OAuth 配置验证；
- OAuth session state 哈希和一次性消费；
- mailbox identity；
- refresh token 必须存在；
- 重复绑定和 integration-in-use；
- 响应不泄露 secret/token。

- [ ] **Step 2: 拆分 Gmail OAuth 用例和 Gateway**

应用服务进入：

```text
modules/mail-accounts/application/connect-gmail-oauth.ts
```

跨模块数据库和环境装配进入：

```text
runtime/mail/gmail-oauth.ts
```

Google HTTP gateway 已在 Task 5 位于：

```text
mail-channel/gmail/auth/google-oauth-gateway.ts
```

- [ ] **Step 3: 更新 routes/tRPC**

routes/tRPC 只能导入 application/runtime，不直接导入 Gmail SDK 或 Nango client。

- [ ] **Step 4: 运行集成管理测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run `
  src/modules/mail-accounts `
  src/integrations `
  src/trpc/routes/integrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: 提交**

```powershell
git add -- apps/server/src/modules/mail-accounts apps/server/src/integrations apps/server/src/runtime/mail apps/server/src/routes apps/server/src/trpc
git commit -m "refactor(mail-accounts): separate oauth application and transport"
```

### Task 8: 删除已迁移的新版本旧入口并通过架构测试

**Files:**
- Delete migrated files under:
  - `apps/server/src/lib/credentials`
  - `apps/server/src/lib/integrations`
  - `apps/server/src/lib/nango`
  - `apps/server/src/lib/mail-channel/gmail/` new-ingress files
- Preserve:
  - `apps/server/src/lib/driver`
  - `apps/server/src/lib/factories`
  - `apps/server/src/pipelines.ts`
  - `apps/server/src/workflows/sync-threads-*`
  - old frontend-facing remote-mail code still required in this phase
- Modify: residual imports in server source and tests.

**Interfaces:**
- Produces: one canonical path for every new-version module.
- Preserves: old frontend behavior until the later API cutover.

- [ ] **Step 1: 列出 residual imports**

Run:

```powershell
Get-ChildItem apps/server/src -Recurse -Filter *.ts |
  Select-String "lib/(credentials|integrations|nango)|lib/mail-channel/gmail/"
```

逐项修改为 canonical path；不得通过 re-export shim 掩盖遗漏。

- [ ] **Step 2: 删除已迁移文件**

只删除已经有 canonical replacement 且所有调用方已迁移的文件。不得删除旧 Driver、Pipeline、Workflow 或当前前端依赖。

- [ ] **Step 3: 运行架构测试**

Run:

```powershell
pnpm --dir apps/server exec vitest run src/mail-architecture.test.ts
```

Expected: PASS.

- [ ] **Step 4: 运行重复入口扫描**

Run:

```powershell
Get-ChildItem apps/server/src/lib -Recurse -Filter *.ts |
  Select-String "NangoClient|resolveConnectionCredential|createSystemIntegrationRepository|createGmailIngressAdapter"
```

Expected: 仅允许旧前端代码引用 canonical implementation，不允许存在重复定义。

- [ ] **Step 5: 提交**

```powershell
git add -- apps/server/src
git commit -m "refactor(server): remove migrated mail module entrypoints"
```

### Task 9: 完整验证和 Gmail 发件前置审查

**Files:**
- Modify only if verification exposes a directory-migration regression.
- Update: `docs/superpowers/plans/2026-07-26-mail-server-directory-convergence.md` checkboxes.

**Interfaces:**
- Produces: verified directory convergence and a concrete outbound readiness result.

- [ ] **Step 1: 运行格式检查**

Run:

```powershell
pnpm exec prettier --check `
  apps/server/src/mail-channel `
  apps/server/src/modules/mail-accounts `
  apps/server/src/modules/mail-sync `
  apps/server/src/integrations `
  apps/server/src/infrastructure `
  apps/server/src/runtime/mail
```

Expected: PASS.

- [ ] **Step 2: 运行 Mail Core 和 server 邮件测试**

Run:

```powershell
pnpm test:mail-core
```

Expected: PASS.

- [ ] **Step 3: 运行所有受影响 server tests**

Run:

```powershell
pnpm --dir apps/server exec vitest run `
  src/mail-architecture.test.ts `
  src/mail-channel `
  src/modules/mail `
  src/modules/mail-accounts `
  src/modules/mail-sync `
  src/integrations `
  src/infrastructure/security `
  src/runtime/mail `
  src/trpc/routes/integrations.test.ts
```

Expected: PASS.

- [ ] **Step 4: 运行 TypeScript 类型检查**

Run:

```powershell
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: 运行 server lint**

Run:

```powershell
pnpm --dir apps/server lint
```

Expected: PASS，或只报告已确认与本次改动无关的历史问题；任何本次引入问题必须修复。

- [ ] **Step 6: 运行构建**

Run:

```powershell
pnpm build
```

Expected: PASS.

- [ ] **Step 7: 审查 Gmail outbound 前置条件**

确认：

- `MailChannelPlugin` 可增加 `outbound` capability；
- `ResolvedCredential` 不区分 Zero OAuth 和 Nango；
- Gmail shared transport 可供 inbound/outbound 复用；
- `EmailSubmission` 已由 `@zero/mail-core` 导出；
- 新模块没有旧 Driver 依赖；
- PostgreSQL Schema 本次未变化；
- 下一阶段可以独立增加 `modules/mail-outbound` 和 `mail-channel/gmail/outbound`。

- [ ] **Step 8: 提交计划状态和必要的最终修复**

```powershell
git add -- docs/superpowers/plans/2026-07-26-mail-server-directory-convergence.md apps/server/src
git commit -m "test(mail): verify server directory convergence"
```
