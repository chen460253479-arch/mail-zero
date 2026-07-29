# 外部邮件集成实施计划

> **供代理执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项实施本计划。所有步骤使用复选框（`- [ ]`）跟踪。

**目标：** 让外部系统把已经存在的 Nango 邮箱授权绑定到 Zero，在 Zero 出现新收件或新发件时接收只包含 ID 的通知，按需查询邮件数据，并通过免登录的新窗口访问限定邮箱范围的 Zero 邮件主页。

**架构：** 在现有 Nango 绑定和本地 Mail API 外增加通用的 `external-integration` 边界。服务端之间使用固定 Token 鉴权；浏览器使用一次性 Launch Code 建立独立、受限的长期 Session。新收件和成功发送的新邮件在邮件事务内写入通知 Outbox，再由后台 Worker 投递严格固定的 `{ eventId, messageId }` Payload。普通 Zero 用户的登录、邮箱和权限行为保持不变。

**技术栈：** TypeScript、Hono、tRPC、Zod、Drizzle ORM、PostgreSQL、Vitest、React Router、TanStack Query、`@zero/mail-core`。

## 全局约束

- 直接在 `D:\WorkSpace\Zero` 的 `codex/local-mail-core` 分支工作，不创建 Git worktree。
- 保留用户已有改动，忽略未跟踪的 `node-compile-cache/` 和 `update-check/` 缓存目录。
- 生产代码、数据库表、路由和环境变量使用通用命名，不得包含 `CRM`。
- 服务端 API Token 只通过 `INTEGRATION_API_TOKEN` 配置，绝不返回或传递给浏览器。
- Nango 绑定接口请求体严格为 `{ channelId, connectionId }`，返回 `{ id }`，并复用现有 `bindNango` 业务逻辑。
- Access Grant 请求体严格为 `{ allowedNangoConnectIds }`，不接收租户、用户、默认账号、模式或返回地址。
- 浏览器只接收短期、一次性的 Launch Code；长期凭证是不可由 JavaScript 读取的 HttpOnly Session Cookie。
- Launch Code 有效期为 5 分钟且只能消费一次。
- 外部浏览器 Session 有效期为 30 天，每 3 天进行一次滑动续期。
- Webhook 请求体严格为 `{ eventId, messageId }`。
- Webhook 不包含事件类型、时间、邮箱信息、邮件摘要、正文、附件、签名或自定义 Zero Header。
- Webhook 中的 `messageId` 指本地 `mail.email.id`，不是 RFC `Message-ID`、`message_id_header` 或服务商邮件 ID。
- 只在新收件保存成功或新发件发送成功后生成通知。
- 不因状态变化、已读、归档、标签变化、草稿保存、发送失败或发送重试单独生成通知。
- 不实现首次历史邮件同步、历史邮件列表接口、同步完成通知或历史轮询流程。
- 外部系统使用本地 `messageId` 幂等保存邮件摘要；`eventId` 只用于 Webhook 投递去重。
- Webhook 不使用签名或 Secret；所有邮件查询接口继续使用 `INTEGRATION_API_TOKEN`。
- 外部浏览器 Session 只能使用邮件主页，并只能切换 Grant 中允许的邮箱。
- 外部浏览器 Session 不能访问设置、绑定邮箱、解绑邮箱、删除保留数据或管理渠道集成。
- 隐藏前端入口不是权限控制；后端 API 必须独立执行相同的范围校验。
- 普通 Better Auth 用户和管理员保持当前行为。
- 所有生产代码必须先写失败测试、确认失败原因，再添加最小实现。

## 已定版接口

### 绑定已有 Nango 连接

```http
POST /api/integrations/nango/connections/bind
Authorization: Bearer <INTEGRATION_API_TOKEN>
Content-Type: application/json
```

```json
{
  "channelId": "gmail",
  "connectionId": "connect_gmail_01"
}
```

```json
{
  "id": "zero_connection_id"
}
```

### 新收件或新发件通知

```http
POST <MAIL_WEBHOOK_URL>
Content-Type: application/json
```

```json
{
  "eventId": "evt_01",
  "messageId": "zero_email_01"
}
```

### 创建浏览器 Access Grant

```http
POST /api/integrations/access-grants
Authorization: Bearer <INTEGRATION_API_TOKEN>
Content-Type: application/json
```

```json
{
  "allowedNangoConnectIds": ["connect_gmail_01", "connect_outlook_02"]
}
```

```json
{
  "launchCode": "one_time_code"
}
```

### 消费 Launch Code

```http
POST /api/integrations/launch
Content-Type: application/x-www-form-urlencoded
```

```text
launchCode=one_time_code
```

成功后，Zero 设置受限的 HttpOnly Cookie，并重定向到配置的 Zero 前端 `/mail/inbox`。

## 文件边界

```text
apps/server/src/modules/
├── external-integration/
│   ├── application/
│   │   ├── create-access-grant.ts
│   │   ├── consume-launch-code.ts
│   │   ├── list-scoped-connections.ts
│   │   └── read-message.ts
│   ├── contracts/
│   │   ├── access.ts
│   │   ├── bind.ts
│   │   └── message.ts
│   ├── http/
│   │   ├── launch.ts
│   │   ├── mail.ts
│   │   └── router.ts
│   ├── postgres/
│   │   ├── repository.ts
│   │   └── schema.ts
│   ├── session/
│   │   ├── cookie.ts
│   │   └── resolve.ts
│   ├── principal.ts
│   ├── service-auth.ts
│   └── index.ts
├── mail-accounts/application/
│   └── connect-nango-mailbox.ts
└── mail-notifications/
    ├── application/deliver-pending.ts
    ├── domain/event.ts
    ├── postgres/repository.ts
    ├── postgres/schema.ts
    ├── runtime/worker.ts
    └── index.ts

apps/mail/
├── modules/external-access/
│   ├── access-context.tsx
│   └── access-context.test.tsx
└── components/ui/
    └── external-account-switcher.tsx
```

`external-integration` 负责服务端鉴权、外部查询、Access Grant 和受限浏览器 Session。`mail-notifications` 负责可靠的 ID 通知投递。浏览器继续使用现有 Mail API，不增加第二套邮件前端 API。

---

### 任务 1：运行时配置、服务鉴权与内部集成主体

**文件：**

- 修改：`.env.example`
- 修改：`apps/server/src/env.ts`
- 修改：`apps/server/src/runtime/node/config.ts`
- 修改：`apps/server/src/runtime/node/services.ts`
- 新建：`apps/server/src/modules/external-integration/service-auth.ts`
- 新建：`apps/server/src/modules/external-integration/principal.ts`
- 测试：`apps/server/tests/unit/runtime/node/config.test.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/service-auth.test.ts`
- 测试：`apps/server/tests/integration/modules/external-integration/principal.integration.test.ts`

**接口：**

```ts
type ExternalIntegrationConfig = {
  apiToken?: string;
  webhook: {
    enabled: boolean;
    url?: string;
  };
};

type IntegrationPrincipal = {
  userId: 'zero-external-integration';
};

function requireIntegrationServiceToken(
  configuredToken: string | undefined,
  authorizationHeader: string | undefined,
): void;
```

当前 `connection.userId` 和 `mailAccount.userId` 都是非空外键，因此 Zero 内部必须为固定 Token 解析一个专用主体。该主体使用固定 ID `zero-external-integration`、邮箱 `external-integration@zero.invalid`、角色 `user`，不创建密码账号，也不能登录。

- [x] **步骤 1：编写失败的环境变量测试**

```ts
it('解析通用外部集成配置', () => {
  const config = parseRuntimeConfig({
    ...validEnvironment,
    INTEGRATION_API_TOKEN: 'integration-secret',
    MAIL_WEBHOOK_ENABLED: 'true',
    MAIL_WEBHOOK_URL: 'https://external.example.test/mail-events',
  });

  expect(config.externalIntegration).toEqual({
    apiToken: 'integration-secret',
    webhook: {
      enabled: true,
      url: 'https://external.example.test/mail-events',
    },
  });
});

it('启用 Webhook 时必须配置 URL', () => {
  expect(() =>
    parseRuntimeConfig({
      ...validEnvironment,
      MAIL_WEBHOOK_ENABLED: 'true',
      MAIL_WEBHOOK_URL: '',
    }),
  ).toThrow(/MAIL_WEBHOOK_URL/);
});
```

- [x] **步骤 2：运行测试并确认因配置不存在而失败**

```bash
pnpm --dir apps/server exec vitest run tests/unit/runtime/node/config.test.ts
```

预期：失败原因是尚未定义三个集成环境变量和 `externalIntegration` 配置。

- [x] **步骤 3：实现配置解析**

在 `.env.example` 增加：

```env
INTEGRATION_API_TOKEN=
MAIL_WEBHOOK_ENABLED=false
MAIL_WEBHOOK_URL=
```

仅当 `MAIL_WEBHOOK_ENABLED=false` 时允许不配置 `MAIL_WEBHOOK_URL`。不得增加 `MAIL_WEBHOOK_SECRET`。

- [x] **步骤 4：编写失败的 Token 和主体测试**

```ts
it('接受配置的 Bearer Token', () => {
  expect(() => requireIntegrationServiceToken('fixed-token', 'Bearer fixed-token')).not.toThrow();
});

it.each([undefined, '', 'Basic fixed-token', 'Bearer wrong-token'])(
  '拒绝无效 Authorization Header',
  (header) => {
    expect(() => requireIntegrationServiceToken('fixed-token', header)).toThrow(
      'INTEGRATION_UNAUTHORIZED',
    );
  },
);

it('只创建一个稳定且不可登录的集成主体', async () => {
  const first = await ensureExternalIntegrationPrincipal(db);
  const second = await ensureExternalIntegrationPrincipal(db);
  expect(second).toEqual(first);
  expect(
    await db.query.account.findMany({
      where: eq(account.userId, first.userId),
    }),
  ).toEqual([]);
});
```

- [x] **步骤 5：运行测试并确认缺少实现**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/service-auth.test.ts tests/integration/modules/external-integration/principal.integration.test.ts
```

预期：失败原因是 Token Guard 和集成主体尚不存在。

- [x] **步骤 6：实现恒定时间 Token 校验与主体创建**

```ts
const digest = (value: string) => createHash('sha256').update(value).digest();

export function requireIntegrationServiceToken(
  configuredToken: string | undefined,
  authorizationHeader: string | undefined,
): void {
  const supplied = authorizationHeader?.match(/^Bearer (.+)$/u)?.[1];
  if (
    configuredToken === undefined ||
    supplied === undefined ||
    !timingSafeEqual(digest(configuredToken), digest(supplied))
  ) {
    throw new ExternalIntegrationError('INTEGRATION_UNAUTHORIZED');
  }
}
```

通过带 `ON CONFLICT` 的事务创建主体。不得创建 Better Auth Session 或密码账号。

- [x] **步骤 7：验证任务 1**

```bash
pnpm --dir apps/server exec vitest run tests/unit/runtime/node/config.test.ts tests/unit/modules/external-integration/service-auth.test.ts tests/integration/modules/external-integration/principal.integration.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

预期：全部通过。

- [x] **步骤 8：提交任务 1**

```bash
git add .env.example apps/server/src/env.ts apps/server/src/runtime/node/config.ts apps/server/src/runtime/node/services.ts apps/server/src/modules/external-integration apps/server/tests
git commit -m "feat(integration): add external service configuration"
```

---

### 任务 2：复用 Nango 绑定逻辑并提供外部 HTTP 接口

**文件：**

- 新建：`apps/server/src/modules/mail-accounts/application/connect-nango-mailbox.ts`
- 修改：`apps/server/src/trpc/routes/connections.ts`
- 新建：`apps/server/src/modules/external-integration/contracts/bind.ts`
- 新建：`apps/server/src/modules/external-integration/http/router.ts`
- 新建：`apps/server/src/modules/external-integration/index.ts`
- 修改：`apps/server/src/runtime/node/application.ts`
- 测试：`apps/server/tests/unit/modules/mail-accounts/application/connect-nango-mailbox.test.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/http/bind.test.ts`
- 测试：`apps/server/tests/architecture/nango-credential-boundary.test.ts`

**接口：**

```ts
type ConnectNangoMailboxInput = {
  userId: string;
  channelId: MailChannelId;
  connectionId: string;
};

async function connectNangoMailbox(
  input: ConnectNangoMailboxInput,
  services: RuntimeServices,
): Promise<{ id: string }>;

const externalBindInputSchema = z
  .object({
    channelId: z.enum(mailChannelIds),
    connectionId: z.string().trim().min(1),
  })
  .strict();
```

- [x] **步骤 1：编写失败的共享应用服务测试**

```ts
it('通过同一应用服务完成绑定和邮箱创建', async () => {
  const result = await connectNangoMailbox(
    {
      userId: 'owner-1',
      channelId: 'gmail',
      connectionId: 'connect-gmail-1',
    },
    services,
  );

  expect(result).toEqual({ id: 'zero-connection-1' });
  expect(bindNangoMailbox).toHaveBeenCalledOnce();
  expect(provisionChannelMailbox).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'owner-1',
      connectionId: 'zero-connection-1',
      channelId: 'gmail',
    }),
  );
});
```

- [x] **步骤 2：运行测试并确认共享服务不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-accounts/application/connect-nango-mailbox.test.ts
```

- [x] **步骤 3：从 tRPC 路由提取绑定编排**

把渠道模式检查、Nango integration key 解析、Repository 适配、`bindNangoMailbox` 调用和 `provisionChannelMailboxInDatabase` 调用移入 `connectNangoMailbox`。

现有 `connections.bindNango` 改为：

```ts
return await connectNangoMailbox(
  {
    userId: ctx.sessionUser.id,
    channelId: input.channelId,
    connectionId: input.connectionId,
  },
  ctx.c.var.services!,
);
```

保留现有 tRPC 冲突和前置条件错误语义。

- [x] **步骤 4：编写失败的外部 HTTP 契约测试**

```ts
it('只接收 channelId 和 connectionId', async () => {
  const response = await requestBind({
    token: 'fixed-token',
    body: {
      channelId: 'gmail',
      connectionId: 'connect-gmail-1',
    },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    id: 'zero-connection-1',
  });
});

it('拒绝额外的外部身份字段', async () => {
  const response = await requestBind({
    token: 'fixed-token',
    body: {
      channelId: 'gmail',
      connectionId: 'connect-gmail-1',
      externalUserId: 'not-accepted',
    },
  });

  expect(response.status).toBe(400);
});

it('不能使用普通浏览器 Session 代替固定 Token', async () => {
  const response = await requestBind({
    sessionCookie: validUserSession,
    body: {
      channelId: 'gmail',
      connectionId: 'connect-gmail-1',
    },
  });

  expect(response.status).toBe(401);
});
```

- [x] **步骤 5：运行 HTTP 测试并确认路由不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/http/bind.test.ts
```

- [x] **步骤 6：实现并挂载外部绑定路由**

使用 `INTEGRATION_API_TOKEN` 鉴权，解析内部集成主体，然后调用 `connectNangoMailbox`。

错误映射：

- 请求体错误：`400`
- Token 错误：`401`
- 重复邮箱或 Nango 连接：`409`
- Nango 连接无效或渠道不可用：`412`

HTTP 路由不得调用 tRPC，也不得复制绑定业务逻辑。

- [x] **步骤 7：验证任务 2**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-accounts/application/connect-nango-mailbox.test.ts tests/unit/modules/external-integration/http/bind.test.ts tests/architecture/nango-credential-boundary.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

预期：全部通过。

- [x] **步骤 8：提交任务 2**

```bash
git add apps/server/src/modules/mail-accounts/application/connect-nango-mailbox.ts apps/server/src/modules/external-integration apps/server/src/trpc/routes/connections.ts apps/server/src/runtime/node/application.ts apps/server/tests
git commit -m "feat(integration): bind existing Nango connections"
```

---

### 任务 3：提供邮件摘要、正文和附件查询接口

**文件：**

- 新建：`apps/server/src/modules/external-integration/contracts/message.ts`
- 新建：`apps/server/src/modules/external-integration/application/read-message.ts`
- 新建：`apps/server/src/modules/external-integration/postgres/repository.ts`
- 新建：`apps/server/src/modules/external-integration/http/mail.ts`
- 修改：`apps/server/src/modules/external-integration/http/router.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/application/read-message.test.ts`
- 测试：`apps/server/tests/integration/modules/external-integration/message-read.integration.test.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/http/mail.test.ts`

**接口：**

```ts
type ExternalMessageSummary = {
  messageId: string;
  internetMessageId: string | null;
  threadId: string;
  mailAccountId: string;
  nangoConnectionId: string;
  channelId: MailChannelId;
  lifecycle: 'draft' | 'received' | 'sent';
  mailboxIds: string[];
  keywords: string[];
  subject: string;
  preview: string;
  sender: MailAddress[];
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  sentAt: string | null;
  receivedAt: string;
  hasAttachment: boolean;
  attachmentCount: number;
};

type ExternalMessageContent = {
  messageId: string;
  textBody: string | null;
  htmlBody: string | null;
};

type ExternalAttachment = {
  attachmentId: string;
  filename: string | null;
  contentType: string;
  disposition: 'inline' | 'attachment' | null;
  size: string;
};
```

路由：

```text
GET /api/integrations/mail/messages/:messageId/summary
GET /api/integrations/mail/messages/:messageId/content
GET /api/integrations/mail/messages/:messageId/attachments
GET /api/integrations/mail/attachments/:attachmentId/content
```

所有路由必须使用 `INTEGRATION_API_TOKEN`。查询必须验证邮件所属 `mailAccount.userId` 是内部集成主体。

- [x] **步骤 1：编写失败的 DTO 和投影测试**

```ts
it('使用本地 email.id 作为外部 messageId', async () => {
  const summary = await service.getSummary('local-email-1');
  expect(summary.messageId).toBe('local-email-1');
  expect(summary.internetMessageId).toBe('<rfc-message-id@example.test>');
});

it('摘要不包含正文、Blob、凭证或原始 MIME', async () => {
  const summary = await service.getSummary('local-email-1');
  expect(Object.keys(summary)).not.toEqual(
    expect.arrayContaining(['textBody', 'htmlBody', 'blobId', 'credentials', 'raw']),
  );
});

it('附件列表只返回附件元数据', async () => {
  expect(await service.listAttachments('local-email-1')).toEqual([
    {
      attachmentId: 'part-1',
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      disposition: 'attachment',
      size: '1024',
    },
  ]);
});
```

- [x] **步骤 2：运行测试并确认查询服务不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/read-message.test.ts
```

- [x] **步骤 3：实现受限查询 Repository 和应用服务**

先通过本地 `messageId` 解析邮件范围：

```ts
const scope = await repository.findMessageScope({
  messageId,
  ownerUserId: principal.userId,
});

if (scope === null) {
  throw new ExternalIntegrationError('MESSAGE_NOT_FOUND');
}

const email = await core.getEmail({
  accountId: scope.mailAccountId as MailAccountId,
  emailId: messageId as EmailId,
});
```

摘要只读取邮件记录。`getContent` 才读取正文 Blob。附件内容接口必须先验证附件 Part 属于该集成主体的邮件，再流式返回 Blob。

- [x] **步骤 4：编写失败的 HTTP 鉴权和隔离测试**

```ts
it('返回集成主体邮件摘要', async () => {
  const response = await requestSummary('local-email-1', 'fixed-token');
  expect(response.status).toBe(200);
  expect((await response.json()).messageId).toBe('local-email-1');
});

it('不能读取普通 Zero 用户邮件', async () => {
  const response = await requestSummary('normal-user-email', 'fixed-token');
  expect(response.status).toBe(404);
});

it('附件内容接口必须使用固定 Token', async () => {
  const response = await requestAttachment('part-1', undefined);
  expect(response.status).toBe(401);
});
```

- [x] **步骤 5：运行测试并确认外部查询路由不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/http/mail.test.ts tests/integration/modules/external-integration/message-read.integration.test.ts
```

- [x] **步骤 6：挂载邮件查询路由**

复用任务 1 的 Token Guard。以下情况统一返回 `404`：

- 邮件不存在
- 邮件不属于集成主体
- 邮件已销毁
- 附件和邮件不匹配

不得增加历史邮件列表接口。

- [x] **步骤 7：验证任务 3**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration tests/integration/modules/external-integration/message-read.integration.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

预期：全部通过。

- [x] **步骤 8：提交任务 3**

```bash
git add apps/server/src/modules/external-integration apps/server/tests/unit/modules/external-integration apps/server/tests/integration/modules/external-integration
git commit -m "feat(integration): expose scoped mail reads"
```

---

### 任务 4：实现只包含 ID 的可靠 Webhook Outbox

**文件：**

- 新建：`packages/mail-core/src/notifications/types.ts`
- 新建：`packages/mail-core/src/notifications/index.ts`
- 修改：`packages/mail-core/src/store/unit-of-work.ts`
- 修改：`packages/mail-core/src/index.ts`
- 修改：`packages/mail-core/src/message/import-email.ts`
- 修改：`packages/mail-core/src/submission/finalize-submission-sent.ts`
- 修改：`packages/mail-core/src/testing/memory-mail-store.ts`
- 新建：`apps/server/src/modules/mail-notifications/domain/event.ts`
- 新建：`apps/server/src/modules/mail-notifications/postgres/schema.ts`
- 新建：`apps/server/src/modules/mail-notifications/postgres/repository.ts`
- 新建：`apps/server/src/modules/mail-notifications/application/deliver-pending.ts`
- 新建：`apps/server/src/modules/mail-notifications/runtime/worker.ts`
- 新建：`apps/server/src/modules/mail-notifications/index.ts`
- 修改：`apps/server/src/db/schema.ts`
- 修改：`apps/server/src/modules/mail/postgres/postgres-unit-of-work.ts`
- 修改：`apps/server/src/modules/mail-outbound/postgres/unit-of-work.ts`
- 修改：`apps/server/src/runtime/mail/core.ts`
- 修改：`apps/server/src/runtime/mail/outbound.ts`
- 修改：`apps/server/src/runtime/node/services.ts`
- 修改：`apps/server/src/runtime/node/main.ts`
- 生成：`apps/server/src/db/migrations/` 下一个 Drizzle Migration
- 测试：`packages/mail-core/tests/notifications/email-notifications.test.ts`
- 测试：`apps/server/tests/integration/modules/mail-notifications/outbox.integration.test.ts`
- 测试：`apps/server/tests/unit/modules/mail-notifications/deliver-pending.test.ts`
- 测试：`apps/server/tests/unit/modules/mail-notifications/worker.test.ts`

**接口：**

```ts
type MailNotificationKind = 'received' | 'sent';

type EnqueueMailNotification = {
  eventId: string;
  messageId: EmailId;
  accountId: MailAccountId;
  kind: MailNotificationKind;
  createdAt: Date;
};

interface MailNotificationRepository {
  enqueue(input: EnqueueMailNotification): Promise<void>;
}
```

内部 Outbox 可以保存 `kind` 用于运行时处理，但 HTTP 投递只能序列化：

```ts
JSON.stringify({
  eventId: event.id,
  messageId: event.messageId,
});
```

- [x] **步骤 1：编写失败的 Mail Core 通知测试**

```ts
it('新收件提交时记录一条 received 通知', async () => {
  const result = await core.importEmail(importInput);
  expect(result.created).toBe(true);
  expect(store.notifications.list()).toEqual([
    expect.objectContaining({
      messageId: result.emailId,
      kind: 'received',
    }),
  ]);
});

it('重复导入同一远程邮件不重复通知', async () => {
  await core.importEmail(importInput);
  const duplicate = await core.importEmail(importInput);
  expect(duplicate.created).toBe(false);
  expect(store.notifications.list()).toHaveLength(1);
});

it('发件成功事务记录一条 sent 通知', async () => {
  await core.finalizeSubmissionSent(finalizeInput);
  expect(store.notifications.list()).toEqual([
    expect.objectContaining({
      messageId: draftEmailId,
      kind: 'sent',
    }),
  ]);
});

it('普通邮件状态修改不产生通知', async () => {
  await core.updateEmail(updateInput);
  expect(store.notifications.list()).toEqual([]);
});
```

- [x] **步骤 2：运行测试并确认事务通知端口不存在**

```bash
pnpm --filter @zero/mail-core exec vitest run tests/notifications/email-notifications.test.ts
```

- [x] **步骤 3：增加事务通知端口**

给 `MailTransaction` 增加 `notifications: MailNotificationRepository`。

- 只在 `importEmail` 确实创建新本地邮件的分支写入 `received`。
- 只在 `finalizeSubmissionSentInTransaction` 完成发送的事务中写入 `sent`。
- 内存 Store 记录通知供单元测试断言。
- PostgreSQL 使用 `INSERT ... SELECT`，仅允许内部集成主体拥有的 Mail Account 写入 Outbox。
- 普通 Zero 用户邮件不得进入外部通知 Outbox。

- [x] **步骤 4：编写失败的 Payload 和重试测试**

```ts
it('只投递 eventId 和 messageId', async () => {
  await deliverPendingEvent(event, dependencies);

  expect(fetch).toHaveBeenCalledWith('https://external.example.test/mail-events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      eventId: 'evt-1',
      messageId: 'email-1',
    }),
  });
});

it('非 2xx 重试继续使用相同 eventId', async () => {
  fetch.mockResolvedValueOnce(
    new Response(null, {
      status: 503,
    }),
  );

  await expect(deliverPendingEvent(event, dependencies)).rejects.toThrow();

  expect(repository.scheduleRetry).toHaveBeenCalledWith(
    expect.objectContaining({
      eventId: 'evt-1',
    }),
  );
});

it('不添加签名或自定义 Zero Header', async () => {
  await deliverPendingEvent(event, dependencies);
  const headers = fetch.mock.calls[0]![1]!.headers;
  expect(headers).toEqual({
    'Content-Type': 'application/json',
  });
});
```

- [x] **步骤 5：运行测试并确认 Outbox 和 Worker 不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-notifications/deliver-pending.test.ts tests/unit/modules/mail-notifications/worker.test.ts tests/integration/modules/mail-notifications/outbox.integration.test.ts
```

- [x] **步骤 6：实现 Outbox Repository 和 Worker**

- 使用 `FOR UPDATE SKIP LOCKED` 领取待投递记录。
- 所有 `2xx` 响应视为成功。
- 网络错误和非 `2xx` 响应使用原 Outbox 记录重试。
- 重试保持相同 `eventId` 和 `messageId`。
- 首次重试延迟 1 秒，指数退避上限 15 分钟。
- 最多投递 10 次。
- `MAIL_WEBHOOK_ENABLED=false` 时事务通知 Repository 为 No-op，不创建 Outbox 记录。

- [x] **步骤 7：生成并检查数据库 Migration**

```bash
pnpm db:generate
```

预期：只增加通知 Outbox 表和领取、到期、重试相关索引，不修改无关表。

- [x] **步骤 8：验证任务 4**

```bash
pnpm --filter @zero/mail-core exec vitest run tests/notifications/email-notifications.test.ts
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-notifications tests/integration/modules/mail-notifications/outbox.integration.test.ts
pnpm --filter @zero/mail-core typecheck
pnpm --dir apps/server exec tsc --noEmit
```

预期：全部通过。

- [x] **步骤 9：提交任务 4**

```bash
git add packages/mail-core apps/server/src/modules/mail-notifications apps/server/src/modules/mail apps/server/src/modules/mail-outbound apps/server/src/runtime apps/server/src/db apps/server/tests
git commit -m "feat(mail): deliver ID-only integration notifications"
```

---

### 任务 5：Access Grant、一次性 Launch Code 和长期浏览器 Session

**文件：**

- 新建：`apps/server/src/modules/external-integration/contracts/access.ts`
- 新建：`apps/server/src/modules/external-integration/postgres/schema.ts`
- 修改：`apps/server/src/db/schema.ts`
- 新建：`apps/server/src/modules/external-integration/postgres/repository.ts`
- 新建：`apps/server/src/modules/external-integration/application/create-access-grant.ts`
- 新建：`apps/server/src/modules/external-integration/application/consume-launch-code.ts`
- 新建：`apps/server/src/modules/external-integration/session/cookie.ts`
- 新建：`apps/server/src/modules/external-integration/session/resolve.ts`
- 新建：`apps/server/src/modules/external-integration/http/launch.ts`
- 修改：`apps/server/src/modules/external-integration/http/router.ts`
- 生成：`apps/server/src/db/migrations/` 下一个 Drizzle Migration
- 测试：`apps/server/tests/unit/modules/external-integration/application/create-access-grant.test.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/application/consume-launch-code.test.ts`
- 测试：`apps/server/tests/integration/modules/external-integration/access-session.integration.test.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/http/launch.test.ts`

**接口：**

```ts
type GrantedMailboxScope = {
  nangoConnectionId: string;
  connectionId: string;
  mailAccountId: string;
};

type ExternalBrowserSession = {
  id: string;
  ownerUserId: 'zero-external-integration';
  scopes: GrantedMailboxScope[];
  activeConnectionId: string;
  expiresAt: Date;
  updatedAt: Date;
};
```

安全规则：

- Launch Code 使用 32 字节随机数并编码为 base64url。
- 数据库只保存 Launch Code 的 SHA-256 Digest。
- Session Token 使用独立的 32 字节随机数。
- 数据库只保存 Session Token 的 SHA-256 Digest。
- Cookie 名称为 `zero-external-session`。
- Cookie 属性为 `HttpOnly`、`Path=/`、`SameSite=Lax`。
- 非本地环境必须启用 `Secure`。
- Cookie Domain 使用 Zero 已配置的跨子域 Domain。

- [x] **步骤 1：编写失败的 Access Grant 契约测试**

```ts
it('只接收 allowedNangoConnectIds', () => {
  expect(
    accessGrantInputSchema.parse({
      allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
    }),
  ).toEqual({
    allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
  });
});

it('拒绝默认账号、用户、租户、模式和返回地址', () => {
  expect(() =>
    accessGrantInputSchema.parse({
      allowedNangoConnectIds: ['connect-gmail-1'],
      selectedNangoConnectId: 'connect-gmail-1',
    }),
  ).toThrow();
});
```

- [x] **步骤 2：编写失败的允许范围解析测试**

```ts
it('把每个 Nango ID 解析为一个有效邮箱', async () => {
  const result = await createAccessGrant(
    {
      allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
    },
    dependencies,
  );

  expect(result).toEqual({
    launchCode: expect.any(String),
  });

  expect(repository.createGrant).toHaveBeenCalledWith(
    expect.objectContaining({
      scopes: [
        expect.objectContaining({
          nangoConnectionId: 'connect-gmail-1',
        }),
        expect.objectContaining({
          nangoConnectionId: 'connect-outlook-1',
        }),
      ],
    }),
  );
});

it('拒绝未绑定或存在歧义的 Nango ID', async () => {
  await expect(
    createAccessGrant(
      {
        allowedNangoConnectIds: ['missing'],
      },
      dependencies,
    ),
  ).rejects.toMatchObject({
    code: 'NANGO_CONNECTION_NOT_BOUND',
  });
});
```

- [x] **步骤 3：运行测试并确认 Grant 服务不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/create-access-grant.test.ts
```

- [x] **步骤 4：实现 Grant 持久化和服务端接口**

服务端保存：

- 已解析的邮箱范围
- Launch Code Digest
- 创建时间
- 过期时间
- 消费时间

HTTP 请求体保持严格的 `{ allowedNangoConnectIds }`，响应保持严格的 `{ launchCode }`。

- [x] **步骤 5：编写失败的一次性消费测试**

```ts
it('Launch Code 只能消费一次', async () => {
  const first = await consumeLaunchCode(
    {
      launchCode,
    },
    dependencies,
  );

  expect(first.session.scopes).toEqual(grant.scopes);

  await expect(
    consumeLaunchCode(
      {
        launchCode,
      },
      dependencies,
    ),
  ).rejects.toMatchObject({
    code: 'LAUNCH_CODE_INVALID',
  });
});

it('拒绝过期 Launch Code', async () => {
  clock.advanceBy(5 * 60_000 + 1);

  await expect(
    consumeLaunchCode(
      {
        launchCode,
      },
      dependencies,
    ),
  ).rejects.toMatchObject({
    code: 'LAUNCH_CODE_INVALID',
  });
});

it('数据库不保存原始 Launch Code 或 Session Token', async () => {
  await consumeLaunchCode(
    {
      launchCode,
    },
    dependencies,
  );

  expect(await repository.dumpRawSecrets()).toEqual([]);
});
```

- [x] **步骤 6：运行测试并确认 Session 尚未实现**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/application/consume-launch-code.test.ts tests/integration/modules/external-integration/access-session.integration.test.ts tests/unit/modules/external-integration/http/launch.test.ts
```

- [x] **步骤 7：实现 Launch POST 和 Session 续期**

使用单条原子更新消费 Code：

```sql
UPDATE integration.external_access_grant
SET consumed_at = now()
WHERE code_digest = $1
  AND consumed_at IS NULL
  AND expires_at > now()
RETURNING *
```

在同一事务中创建 Session。成功后设置 Cookie，并重定向到：

```ts
new URL('/mail/inbox', services.config.publicAppUrl).toString();
```

Launch 接口不得接收 `returnUrl`，不得创建 Better Auth Session，也不得把 Launch Code 放入 URL。

- [x] **步骤 8：生成并检查数据库 Migration**

```bash
pnpm db:generate
```

预期：增加 Access Grant 和外部浏览器 Session 表、Digest 唯一约束与过期索引，不出现 CRM 专用字段。

- [x] **步骤 9：验证任务 5**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration tests/integration/modules/external-integration/access-session.integration.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

预期：全部通过。

- [x] **步骤 10：提交任务 5**

```bash
git add apps/server/src/modules/external-integration apps/server/src/db apps/server/tests
git commit -m "feat(integration): add scoped launch sessions"
```

---

### 任务 6：后端邮件权限和多账号切换范围控制

**文件：**

- 修改：`apps/server/src/ctx.ts`
- 修改：`apps/server/src/runtime/node/application.ts`
- 修改：`apps/server/src/trpc/trpc.ts`
- 修改：`apps/server/src/trpc/index.ts`
- 新建：`apps/server/src/modules/external-integration/application/list-scoped-connections.ts`
- 新建：`apps/server/src/modules/external-integration/trpc/router.ts`
- 修改：`apps/server/src/modules/mail-api/procedures/mail-account-procedure.ts`
- 修改：`apps/server/src/modules/mail-api/routers/account.ts`
- 修改：`apps/server/src/modules/mail-api/http/authorize-mail-account.ts`
- 修改：`apps/server/src/trpc/routes/connections.ts`
- 测试：`apps/server/tests/unit/modules/mail-api/procedures/mail-account-procedure.test.ts`
- 测试：`apps/server/tests/unit/modules/external-integration/trpc/router.test.ts`
- 测试：`apps/server/tests/integration/modules/external-integration/scoped-mail-access.integration.test.ts`
- 测试：`apps/server/tests/architecture/external-session-permissions.test.ts`

**接口：**

```ts
type MailAccessSubject =
  | {
      kind: 'user';
      userId: string;
    }
  | {
      kind: 'external';
      sessionId: string;
      ownerUserId: 'zero-external-integration';
      scopes: GrantedMailboxScope[];
      activeConnectionId: string;
    };
```

权限边界：

- `privateProcedure` 继续只接受 Better Auth 用户。
- `mailSessionProcedure` 接受普通用户或有效外部 Session。
- 普通用户继续使用 User Ownership 校验。
- 外部 Session 必须校验 `mailAccountId` 在 Grant Scope 中。
- 只有 `connections.list`、`connections.getDefault` 和 `connections.setDefault` 接受外部 Session。
- 绑定、解绑、删除和集成管理接口继续使用 `privateProcedure`。

- [x] **步骤 1：编写失败的 Mail Account 权限测试**

```ts
it('允许外部 Session 打开 Grant 中的 Mail Account', async () => {
  const result = await callMailAccountProcedure({
    externalSession,
    input: {
      accountId: 'allowed-account',
    },
  });

  expect(result.mailAccess.kind).toBe('external');
});

it('拒绝 Grant 之外的 Mail Account', async () => {
  await expect(
    callMailAccountProcedure({
      externalSession,
      input: {
        accountId: 'other-account',
      },
    }),
  ).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});

it('保留普通用户原有 Ownership 校验', async () => {
  await expect(
    callMailAccountProcedure({
      sessionUser,
      input: {
        accountId: 'other-users-account',
      },
    }),
  ).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
});
```

- [x] **步骤 2：运行测试并确认现有 Mail API 只支持用户 Session**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-api/procedures/mail-account-procedure.test.ts
```

- [x] **步骤 3：把外部 Session 解析到 Hono Context**

读取 `zero-external-session` Cookie，计算 Digest，查询有效 Session，并在达到 3 天更新时间时执行滑动续期。

设置 `ctx.externalSession`，但绝不能把外部 Session 伪装成 `ctx.sessionUser`。

当 Better Auth Session 和外部 Session 同时存在时，优先使用真实 Better Auth 用户。

- [x] **步骤 4：调整 Mail API 和 Blob HTTP 权限**

- `mail.account.list` 对普通用户按 `userId` 查询。
- `mail.account.list` 对外部 Session 只返回 Grant Scope 中的 Account。
- Mail Account Procedure 必须校验外部 Scope。
- Blob、附件和 Raw Email HTTP 路由必须执行相同 Scope 校验。

- [x] **步骤 5：编写失败的多账号范围测试**

```ts
it('只列出 Grant 允许的连接', async () => {
  const result = await caller.connections.list();
  expect(result.connections.map(({ id }) => id)).toEqual([
    'zero-connection-1',
    'zero-connection-2',
  ]);
});

it('只能切换到 Grant 中的连接', async () => {
  await caller.connections.setDefault({
    connectionId: 'zero-connection-2',
  });

  expect(await caller.connections.getDefault()).toMatchObject({
    id: 'zero-connection-2',
  });
});

it('外部 Session 不能调用绑定和解绑接口', async () => {
  await expect(
    caller.connections.bindNango({
      channelId: 'gmail',
      connectionId: 'connect-3',
    }),
  ).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });

  await expect(
    caller.connections.disconnect({
      connectionId: 'zero-connection-1',
      deleteLocalData: false,
    }),
  ).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
});
```

- [x] **步骤 6：运行测试并确认受限连接目录不存在**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration/trpc/router.test.ts tests/integration/modules/external-integration/scoped-mail-access.integration.test.ts tests/architecture/external-session-permissions.test.ts
```

- [x] **步骤 7：实现连接列表和当前账号存储**

外部 Session 使用服务端保存的 Scope。

- `setDefault` 只更新外部 Session 的 `active_connection_id`。
- 不修改 `user.defaultConnectionId`。
- Grant 外的连接统一返回 `NOT_FOUND`。

增加只返回以下内容的 `externalAccess.current`：

```ts
{
  mode: 'external',
  sessionId,
}
```

不得返回 `allowedNangoConnectIds` 或原始 Session Token。

- [x] **步骤 8：验证任务 6**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-api/procedures/mail-account-procedure.test.ts tests/unit/modules/external-integration tests/integration/modules/external-integration tests/architecture/external-session-permissions.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

预期：全部通过。

- [x] **步骤 9：提交任务 6**

```bash
git add apps/server/src/ctx.ts apps/server/src/runtime/node/application.ts apps/server/src/trpc apps/server/src/modules/mail-api apps/server/src/modules/external-integration apps/server/tests
git commit -m "feat(integration): scope browser mail access"
```

---

### 任务 7：外部邮件窗口和多账号前端

**文件：**

- 新建：`apps/mail/modules/external-access/access-context.tsx`
- 新建：`apps/mail/modules/external-access/access-context.test.tsx`
- 新建：`apps/mail/components/ui/external-account-switcher.tsx`
- 修改：`apps/mail/app/root.tsx`
- 修改：`apps/mail/app/page.tsx`
- 修改：`apps/mail/app/(routes)/mail/layout.tsx`
- 修改：`apps/mail/app/(routes)/settings/layout.tsx`
- 修改：`apps/mail/components/mail/mail.tsx`
- 修改：`apps/mail/components/ui/app-sidebar.tsx`
- 修改：`apps/mail/components/ui/nav-user.tsx`
- 修改：`apps/mail/providers/server-providers.tsx`
- 修改：`apps/mail/providers/query-provider.tsx`
- 修改：`apps/mail/modules/mail/queries/use-mail-account.tsx`
- 测试：`apps/mail/modules/external-access/access-context.test.tsx`
- 测试：`apps/mail/components/ui/external-account-switcher.test.tsx`
- 测试：`apps/mail/modules/mail/providers/mail-account-selection.test.ts`
- 测试：`apps/server/tests/architecture/external-mail-frontend-boundary.test.ts`

**接口：**

```ts
type AppAccessContext =
  | {
      mode: 'anonymous';
      cacheSubject: null;
    }
  | {
      mode: 'user';
      cacheSubject: `user:${string}`;
    }
  | {
      mode: 'external';
      cacheSubject: `external:${string}`;
    };
```

Root Loader 先检查 Better Auth，再检查 `externalAccess.current`。查询缓存使用 `cacheSubject` 隔离普通用户和外部 Session。

- [x] **步骤 1：编写失败的访问模式和缓存隔离测试**

```tsx
it('没有 Better Auth 用户时识别外部 Session', () => {
  expect(
    resolveAppAccess({
      userId: null,
      externalSessionId: 'external-session-1',
    }),
  ).toEqual({
    mode: 'external',
    cacheSubject: 'external:external-session-1',
  });
});

it('普通用户与外部 Session 使用不同缓存 Key', () => {
  expect(getQueryCacheStorageKey('user:user-1')).not.toBe(
    getQueryCacheStorageKey('external:session-1'),
  );
});
```

- [x] **步骤 2：运行测试并确认 Access Context 不存在**

```bash
pnpm --dir apps/mail exec vitest run modules/external-access/access-context.test.tsx
```

- [x] **步骤 3：实现 Root Access Context**

- 通过 `ServerProviders` 暴露 `AppAccessContext`。
- 有效外部 Session 可以访问 `/mail/*`。
- 只有 `anonymous` 模式才重定向 `/login`。
- 根路径 `/` 对普通用户和外部 Session 都重定向 `/mail/inbox`。
- Query Persistence 使用 `cacheSubject`，避免不同主体共享 IndexedDB 查询缓存。

- [x] **步骤 4：编写失败的账号切换和隐藏入口测试**

```tsx
it('展示 Grant 中全部邮箱并调用 setDefault 切换', async () => {
  render(<ExternalAccountSwitcher />);

  expect(screen.getByText('gmail@example.test')).toBeVisible();
  expect(screen.getByText('outlook@example.test')).toBeVisible();

  await user.click(screen.getByText('outlook@example.test'));

  expect(setDefault).toHaveBeenCalledWith({
    connectionId: 'zero-connection-2',
  });
});

it('不显示设置、添加账号和连接管理入口', () => {
  renderExternalMailSidebar();

  expect(screen.queryByText(/settings/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/add account/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/manage connections/i)).not.toBeInTheDocument();
});
```

- [x] **步骤 5：运行测试并确认当前 Sidebar 依赖 Better Auth**

```bash
pnpm --dir apps/mail exec vitest run components/ui/external-account-switcher.test.tsx modules/external-access/access-context.test.tsx modules/mail/providers/mail-account-selection.test.ts
```

- [x] **步骤 6：实现外部模式邮件导航**

当 `mode === 'external'`：

- 在 `NavUser` 区域渲染外部账号切换器。
- 保留写邮件、邮箱导航、邮件列表、会话详情、回复和附件访问。
- 隐藏 Settings、Add Connection、Disconnect、连接调试工具和普通用户退出入口。
- 直接访问 `/settings/*` 时重定向 `/mail/inbox`。
- 没有可用账号时显示中性提示，不显示 “Manage connections”。

后端仍是最终权限边界。

- [x] **步骤 7：验证前端**

```bash
pnpm --dir apps/mail exec vitest run modules/external-access components/ui/external-account-switcher.test.tsx modules/mail/providers/mail-account-selection.test.ts
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
```

预期：全部通过。

- [x] **步骤 8：验证前端边界**

```bash
pnpm --dir apps/server exec vitest run tests/architecture/external-mail-frontend-boundary.test.ts
```

预期：

- 浏览器源码不引用 `INTEGRATION_API_TOKEN`
- 浏览器不持久化 Launch Code
- 外部模式不显示设置和连接管理入口

- [x] **步骤 9：提交任务 7**

```bash
git add apps/mail apps/server/tests/architecture/external-mail-frontend-boundary.test.ts
git commit -m "feat(mail): add scoped external mail window"
```

---

### 任务 8：端到端契约与回归验证

**文件：**

- 新建：`apps/server/tests/architecture/external-integration-contract.test.ts`
- 新建：`apps/server/tests/integration/external-integration-flow.integration.test.ts`
- 仅在验证失败时修改与本功能直接相关的文件

**完整 Zero 侧流程：**

```text
固定服务 Token
→ 绑定 { channelId, connectionId }
→ 创建本地 Nango Connection 和 Mail Account
→ 新收件或成功的新发件
→ Webhook { eventId, messageId }
→ Token 鉴权的摘要、正文和附件查询
→ Access Grant { allowedNangoConnectIds }
→ 一次性 Launch Code
→ 受限的长期浏览器 Session
→ 允许范围内的多账号 Zero 邮件主页
```

- [x] **步骤 1：增加静态契约守卫**

```ts
it('Webhook Payload 字段保持精确', () => {
  expect(notificationContractShape).toEqual(['eventId', 'messageId']);
});

it('生产代码不包含 CRM 专用命名', () => {
  expect(readProductionSources()).not.toMatch(/\bcrm\b/iu);
});

it('不存在 Webhook 签名契约', () => {
  expect(readProductionSources()).not.toMatch(/MAIL_WEBHOOK_SECRET|X-Zero-Webhook-Signature/iu);
});

it('不存在历史同步路由或事件', () => {
  expect(readProductionSources()).not.toMatch(
    /mailbox\.sync\.completed|initial-history|history-sync/iu,
  );
});
```

- [x] **步骤 2：增加端到端 Happy Path 测试**

测试必须完成以下真实流程：

1. 配置一个 Nango 邮件渠道。
2. 使用固定 Token 调用绑定 HTTP 接口。
3. 验证本地 Connection 和 Mail Account 已创建。
4. 导入一封新收件。
5. 验证 Webhook Body 只有 `eventId` 和 `messageId`。
6. 使用固定 Token 查询摘要、正文和附件。
7. 使用该 Nango ID 创建 Access Grant。
8. 消费 Launch Code 一次。
9. 使用返回的 Cookie 查询允许的邮箱。
10. 验证该 Cookie 无法访问设置和绑定接口。

- [x] **步骤 3：运行服务端专项验证**

```bash
pnpm --dir apps/server exec vitest run tests/unit/modules/external-integration tests/unit/modules/mail-notifications tests/integration/modules/external-integration tests/integration/modules/mail-notifications tests/architecture/external-integration-contract.test.ts tests/architecture/external-session-permissions.test.ts tests/integration/external-integration-flow.integration.test.ts
```

预期：全部通过。

- [x] **步骤 4：运行 Mail Core 回归验证**

```bash
pnpm --filter @zero/mail-core test
pnpm --filter @zero/mail-core typecheck
pnpm --dir apps/server run test:mail-core
```

预期：全部通过。

- [x] **步骤 5：运行应用构建验证**

```bash
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/server build
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
pnpm check:format
```

预期：全部通过，且不修改无关文件。

执行说明：Server 与 Mail 的类型检查和生产构建通过。本仓库全量
`pnpm check:format` 会被 852 个既有或生成文件的格式基线阻塞；本计划从
`cb0f5c7` 之后新增和修改的所有 Prettier 支持文件已单独检查并通过，没有批量改写无关文件。

- [x] **步骤 6：检查最终工作区**

```bash
git status --short
git diff --check
```

预期：只包含外部集成、邮件通知、受限邮件权限、前端、Migration、测试和文档改动；`git diff --check` 无输出。

- [x] **步骤 7：提交端到端守卫**

```bash
git add apps/server/tests
git commit -m "test(integration): verify external mail flow"
```

---

### 审查修正：外部会话路由与 Webhook Worker 生命周期

- [x] 移除 `/mail/[folder]`、`/mail/compose`、`/mail/create` 的 Better Auth 二次校验，由支持外部会话的父级邮件访问边界统一鉴权。
- [x] 增加携带 `zero-external-session` Cookie 访问 `/mail/inbox` 的 Loader 回归测试。
- [x] 将通知 Worker 的中止信号传入 Webhook 投递，并增加小于租约和关闭宽限期的投递超时。
- [x] 将超时和关闭中止视为可重试投递失败，保留原 `eventId` 并由 Outbox 仓储重新调度。
- [x] 端到端测试改为使用生产绑定服务、受控 Nango 客户端、生产账号编排和实际通知 Worker。
