# Pure Node.js Self-Hosted Zero Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Wrangler/workerd and every Cloudflare Binding with a single self-hosted Node.js Zero Server while keeping the frontend as an independent static image.

**Architecture:** A Node.js 22 process hosts the existing Hono application, a PostgreSQL-backed durable mail task queue, bounded ingress/outbound workers, a due-work scheduler, a local filesystem BlobStore, and in-process IMAP/SMTP protocol execution. PostgreSQL remains the source of truth for mail state and work leases; Docker keeps separate `zero-mail` and `zero-server` images.

**Tech Stack:** TypeScript 5.8, Node.js 22, Hono, `@hono/node-server`, PostgreSQL 17, Drizzle ORM, postgres.js, Vitest, Docker Compose, Nginx.

## Global Constraints

- Work directly on `codex/local-mail-core` in `D:\WorkSpace\Zero`; do not create a Git worktree.
- Keep `zero-mail` and `zero-server` as independent application images.
- Deploy one default `zero-server` container; do not create a Protocol Worker image or service.
- Do not retain a long-term compatibility path for Wrangler, workerd, Cloudflare Queue, Hyperdrive, R2, Durable Objects, or Protocol Worker HTTP.
- Keep all current public HTTP, tRPC, authentication, OAuth, Webhook, Mail API, synchronization, and outbound behavior unless this plan explicitly replaces its infrastructure.
- Preserve the existing Mail Core and channel-plugin boundaries.
- Do not put full message bodies or attachments in PostgreSQL.
- Do not add BullMQ, MinIO, S3, or a second queue system.
- Do not install or update dependencies automatically. After manifest edits, ask the user to run the exact frozen-lockfile update/install command.
- Use the single development database initialization template; do not add a historical incremental migration series.
- Preserve unrelated `node-compile-cache/` and `update-check/`.
- Follow strict red-green-refactor for production behavior changes.

---

### Task 1: Define Node Runtime Configuration and Shared Database Lifecycle

**Files:**

- Create: `apps/server/src/runtime/node/config.ts`
- Create: `apps/server/src/runtime/node/database.ts`
- Create: `apps/server/tests/unit/runtime/node/config.test.ts`
- Create: `apps/server/tests/unit/runtime/node/database.test.ts`
- Modify: `apps/server/src/db/index.ts`

**Interfaces:**

- Consumes: `NodeJS.ProcessEnv`, the existing Drizzle schema, and `postgres`.
- Produces:

```ts
export type RuntimeConfig = {
  nodeEnv: 'local' | 'development' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  mailBlobRoot: string;
  shutdownGraceMs: number;
  publicAppUrl: string;
  publicBackendUrl: string;
  baseUrl?: string;
  jwtSecret: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  cookieDomain: string;
  betterAuthTrustedOrigins: string[];
  credentialEncryptionKey: string;
  resendApiKey?: string;
  nango: {
    baseUrl?: string;
    secretKey?: string;
    gmailIntegrationKey: string;
    outlookIntegrationKey: string;
    zohoMailIntegrationKey: string;
    imapSmtpIntegrationKey: string;
  };
  redis: { url: string; token: string };
  admin: {
    autoProvision: boolean;
    name?: string;
    email?: string;
    password?: string;
    bootstrapSecret?: string;
  };
  github: { clientId?: string; clientSecret?: string };
  protocolAllowedHosts?: string;
};

export const parseRuntimeConfig: (source: NodeJS.ProcessEnv) => RuntimeConfig;

export type RuntimeDatabase = {
  db: DB;
  sql: Sql;
  close(): Promise<void>;
};

export const createRuntimeDatabase: (
  databaseUrl: string,
  options?: { max?: number },
) => RuntimeDatabase;
```

- [ ] **Step 1: Write failing configuration tests**

Add literal test cases proving that `parseRuntimeConfig`:

```ts
expect(
  parseRuntimeConfig({
    NODE_ENV: 'production',
    ZERO_SERVER_HOST: '127.0.0.1',
    ZERO_SERVER_PORT: '8787',
    DATABASE_URL: 'postgresql://postgres:postgres@db:5432/zero',
    MAIL_BLOB_ROOT: '/data/blobs',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'https://api.example.test',
    VITE_PUBLIC_APP_URL: 'https://mail.example.test',
    VITE_PUBLIC_BACKEND_URL: 'https://api.example.test',
    COOKIE_DOMAIN: 'example.test',
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  }),
).toMatchObject({
  nodeEnv: 'production',
  host: '127.0.0.1',
  port: 8787,
  databaseUrl: 'postgresql://postgres:postgres@db:5432/zero',
  mailBlobRoot: '/data/blobs',
});
```

Add separate cases rejecting a missing `DATABASE_URL`, port `0`, port `65536`, a relative Blob path, and short security keys.

- [ ] **Step 2: Run the configuration test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/node/config.test.ts --reporter=dot
```

Expected: FAIL because `runtime/node/config.ts` does not exist.

- [ ] **Step 3: Implement strict configuration parsing**

Use Zod to parse only named environment variables. Apply defaults:

```ts
ZERO_SERVER_HOST = '0.0.0.0';
ZERO_SERVER_PORT = 8787;
MAIL_BLOB_ROOT = '/var/lib/zero/mail-blobs';
ZERO_SHUTDOWN_GRACE_MS = 30000;
```

Keep optional provider settings optional, but require the database, authentication, public URL, cookie, and credential-encryption values needed by the current Server.

- [ ] **Step 4: Run configuration tests and verify GREEN**

Run the Task 1 configuration command again.

Expected: PASS.

- [ ] **Step 5: Write the failing shared-database lifecycle test**

Stub only `postgres()` and prove:

- one call creates one Drizzle instance over the returned SQL client;
- `close()` invokes `sql.end()` exactly once even if called twice;
- `max` is forwarded as a bounded pool option.

The production change this catches is creating a new pool per operation or closing the shared pool more than once.

- [ ] **Step 6: Run the database lifecycle test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/node/database.test.ts --reporter=dot
```

Expected: FAIL because `createRuntimeDatabase` does not exist.

- [ ] **Step 7: Implement the shared database lifecycle**

Make `createRuntimeDatabase()` call `postgres(databaseUrl, { max })` once, create Drizzle through `createDrizzle(sql)`, and guard `close()` with one stored promise.

- [ ] **Step 8: Run both Task 1 test files**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/node/config.test.ts tests/unit/runtime/node/database.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add apps/server/src/runtime/node apps/server/tests/unit/runtime/node apps/server/src/db/index.ts
git commit -m "feat(server): add node runtime foundations"
```

### Task 2: Replace the R2 BlobStore with Durable Local Files

**Files:**

- Create: `apps/server/src/modules/mail/blob/local-blob-store.ts`
- Create: `apps/server/tests/unit/mail-core/local-blob-store.test.ts`
- Modify: `apps/server/src/modules/mail/index.ts`
- Modify: `apps/server/tests/helpers/mail-core/harness.ts`

**Interfaces:**

- Consumes: the existing `BlobStore` contract and existing functions in `blob-key.ts`.
- Produces:

```ts
export class LocalBlobStore implements BlobStore {
  constructor(rootDirectory: string);
  initialize(): Promise<void>;
  putTemporary(
    input: Parameters<BlobStore['putTemporary']>[0],
  ): ReturnType<BlobStore['putTemporary']>;
  commitTemporary(input: Parameters<BlobStore['commitTemporary']>[0]): Promise<BlobCommitReceipt>;
  deleteTemporary(input: Parameters<BlobStore['deleteTemporary']>[0]): Promise<void>;
  get(input: Parameters<BlobStore['get']>[0]): Promise<Uint8Array>;
  getRange(input: Parameters<BlobStore['getRange']>[0]): Promise<Uint8Array>;
  delete(input: Parameters<BlobStore['delete']>[0]): Promise<void>;
  list(input: Parameters<BlobStore['list']>[0]): ReturnType<BlobStore['list']>;
}
```

- [ ] **Step 1: Write failing LocalBlobStore contract tests**

Use a real temporary directory created with `mkdtemp()` and the existing BlobStore contract harness. Add explicit cases for:

- persistence after constructing a second `LocalBlobStore` over the same directory;
- atomic idempotent commit of the same SHA-256 object;
- range reads;
- temporary cleanup;
- account-prefix isolation;
- rejection of invalid/path-traversal keys;
- a pre-existing object with different bytes returning `BLOB_INTEGRITY`.

- [ ] **Step 2: Run the LocalBlobStore test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-core/local-blob-store.test.ts --reporter=dot
```

Expected: FAIL because `LocalBlobStore` does not exist.

- [ ] **Step 3: Implement filesystem-safe object mapping**

Resolve every validated object key below the configured root. Reject any resolved path that is not a descendant of that root. Use:

- `mkdir({ recursive: true })`;
- exclusive temporary-file creation;
- `rename()` for atomic promotion on the same filesystem;
- SHA-256 verification before promotion;
- `open()` plus positional read for ranges;
- lexicographically sorted relative keys for pagination.

Map missing files to `BLOB_NOT_FOUND` and all unexpected filesystem failures to `BLOB_STORE_FAILURE`.

- [ ] **Step 4: Run LocalBlobStore tests and verify GREEN**

Run the Task 2 command again.

Expected: PASS.

- [ ] **Step 5: Run the existing BlobStore contract tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-core/r2-blob-store.test.ts tests/unit/mail-core/local-blob-store.test.ts --reporter=dot
```

Expected: both existing and local contract suites PASS before the R2 implementation is removed during cutover.

- [ ] **Step 6: Commit Task 2**

```powershell
git add apps/server/src/modules/mail/blob apps/server/src/modules/mail/index.ts apps/server/tests/unit/mail-core apps/server/tests/helpers/mail-core/harness.ts
git commit -m "feat(mail): add local durable blob storage"
```

### Task 3: Add the PostgreSQL Mail Task Model and Repository

**Files:**

- Create: `apps/server/src/modules/mail-tasks/domain/task.ts`
- Create: `apps/server/src/modules/mail-tasks/postgres/schema.ts`
- Create: `apps/server/src/modules/mail-tasks/postgres/repository.ts`
- Create: `apps/server/src/modules/mail-tasks/index.ts`
- Create: `apps/server/tests/integration/mail-tasks/repository.integration.test.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/db/migrations/0000_steady_silver_centurion.sql`
- Modify: `apps/server/src/db/migrations/meta/0000_snapshot.json`

**Interfaces:**

- Consumes: `MailIngressCommand`, `MailOutboundCommand`, the `mail` PostgreSQL Schema, and ULID identifiers.
- Produces:

```ts
export type MailTaskQueue = 'ingress' | 'outbound';
export type MailTaskStatus = 'ready' | 'running' | 'retry' | 'dead';

export type EnqueueMailTaskInput = {
  queue: MailTaskQueue;
  command: MailIngressCommand | MailOutboundCommand;
  dedupeKey: string;
  runAt?: Date;
  maxAttempts?: number;
};

export type ClaimedMailTask = {
  id: string;
  queue: MailTaskQueue;
  command: unknown;
  attempts: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
};

export interface MailTaskRepository {
  enqueue(input: EnqueueMailTaskInput): Promise<{ id: string; created: boolean }>;
  claim(input: {
    owner: string;
    queues: MailTaskQueue[];
    now: Date;
    limit: number;
    leaseForMs: number;
  }): Promise<ClaimedMailTask[]>;
  complete(input: { id: string; owner: string; now: Date }): Promise<boolean>;
  retry(input: {
    id: string;
    owner: string;
    now: Date;
    runAt: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<'retry' | 'dead' | 'lost'>;
  failPermanently(input: {
    id: string;
    owner: string;
    now: Date;
    errorCode: string;
    errorMessage: string;
  }): Promise<boolean>;
  recoverExpired(input: { now: Date; limit: number }): Promise<number>;
}
```

- [ ] **Step 1: Write failing repository integration tests**

Using `withMailTestDatabase()`, prove:

- enqueue persists a literal ingress command;
- enqueueing the same live dedupe key returns the existing task;
- different dedupe keys remain independent;
- two concurrent owners cannot claim the same task;
- `run_at` in the future is not claimable;
- `complete()` requires the current lease owner;
- retry increments attempts and applies `run_at`;
- exceeding `max_attempts` enters `dead`;
- expired running leases are recovered;
- payloads are parsed by the existing ingress/outbound command parsers before execution.

- [ ] **Step 2: Run repository integration tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/integration/mail-tasks/repository.integration.test.ts --reporter=dot
```

Expected: FAIL because the schema and repository do not exist.

- [ ] **Step 3: Define the mail task table**

Create `mail.task` with the fields and checks from the approved design. Add:

- a due-work index on `(queue, status, run_at, id)`;
- a lease-recovery index on `(lease_expires_at, id)` for running tasks;
- a partial unique index on `(queue, dedupe_key)` for `ready`, `running`, and `retry`;
- checks coupling `running` to non-null lease fields;
- checks requiring `attempts >= 0` and `max_attempts >= 1`.

Update the single generated development template and snapshot to exactly match the Drizzle schema.

- [ ] **Step 4: Implement atomic enqueue, claim, completion, retry and recovery**

Use SQL transactions and `FOR UPDATE SKIP LOCKED`. Do not read candidate task IDs and update them in separate transactions.

On completion, retain the row with `completed_at` only if the model includes a completed status; otherwise delete it. This plan uses deletion on success so the status check remains the four-state model above. Retain `dead` tasks for diagnostics.

- [ ] **Step 5: Run repository integration tests and verify GREEN**

Run the Task 3 integration command again.

Expected: PASS.

- [ ] **Step 6: Run database template and schema-contract tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/integration/mail-core/development-push.integration.test.ts tests/integration/mail-core/constraints.integration.test.ts tests/unit/mail-core/schema-contract.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add apps/server/src/modules/mail-tasks apps/server/tests/integration/mail-tasks apps/server/src/db/schema.ts apps/server/src/db/migrations
git commit -m "feat(mail): add postgres task queue"
```

### Task 4: Implement Bounded Task Workers and Due-Work Scheduler

**Files:**

- Create: `apps/server/src/modules/mail-tasks/runtime/worker.ts`
- Create: `apps/server/src/modules/mail-tasks/runtime/scheduler.ts`
- Create: `apps/server/tests/unit/modules/mail-tasks/worker.test.ts`
- Create: `apps/server/tests/unit/modules/mail-tasks/scheduler.test.ts`
- Modify: `apps/server/src/modules/mail-tasks/index.ts`

**Interfaces:**

- Consumes: `MailTaskRepository`, `runMailIngressCommand`, `runMailOutboundCommand`, `enqueueDueMailIngressWork`, `enqueueDueMailOutboundWork`, and `wakeDueMailSnoozes`.
- Produces:

```ts
export type MailTaskWorker = {
  start(): void;
  stop(): Promise<void>;
  notify(): void;
};

export const createMailTaskWorker: (dependencies: {
  repository: MailTaskRepository;
  processIngress(command: MailIngressCommand): Promise<void>;
  processOutbound(command: MailOutboundCommand): Promise<void>;
  concurrency: number;
  pollIntervalMs: number;
  leaseForMs: number;
  clock: { now(): Date };
  newOwner(): string;
}) => MailTaskWorker;

export type MailScheduler = {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
};
```

- [ ] **Step 1: Write failing worker behavior tests**

Use an in-memory fake repository that implements the real repository interface. Prove:

- concurrency never exceeds the configured limit;
- ingress and outbound commands reach the correct processor;
- successful work is completed;
- permanent `MailSyncError` and permanent `MailOutboundError` become terminal;
- retryable errors receive exponential backoff with a maximum bound;
- calling `notify()` wakes a sleeping worker;
- `stop()` prevents new claims and waits for active work;
- an exception in one task does not terminate the worker loop.

- [ ] **Step 2: Run worker tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/modules/mail-tasks/worker.test.ts --reporter=dot
```

Expected: FAIL because the worker runtime does not exist.

- [ ] **Step 3: Implement the bounded worker**

Use an abortable poll wait, a fixed number of asynchronous worker loops, and explicit start/stop state. Parse task payloads with the existing command parsers immediately before processing. Truncate stored error messages to a safe fixed length.

- [ ] **Step 4: Run worker tests and verify GREEN**

Run the Task 4 worker command again.

Expected: PASS.

- [ ] **Step 5: Write failing scheduler tests**

Use fake due-work functions and fake timers. Prove:

- a tick calls ingress scan, outbound scan, Snooze wakeup, and expired-task recovery once;
- overlapping ticks do not execute concurrently;
- one failing scan is logged but does not permanently stop later ticks;
- `stop()` clears the timer and waits for the current tick.

- [ ] **Step 6: Run scheduler tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/modules/mail-tasks/scheduler.test.ts --reporter=dot
```

Expected: FAIL because the scheduler does not exist.

- [ ] **Step 7: Implement the scheduler**

Use one fixed short tick interval. Due-work functions only enqueue durable tasks; they must not execute IMAP, SMTP, or provider API work inline.

- [ ] **Step 8: Run all Task 4 tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/modules/mail-tasks --reporter=dot
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```powershell
git add apps/server/src/modules/mail-tasks apps/server/tests/unit/modules/mail-tasks
git commit -m "feat(mail): add durable task workers"
```

### Task 5: Replace Protocol Worker HTTP with an In-Process Executor

**Files:**

- Create: `apps/server/src/mail-channel/imap-smtp/runtime/protocol-executor.ts`
- Create: `apps/server/tests/unit/mail-channel/imap-smtp/protocol-executor.test.ts`
- Modify: `apps/server/src/mail-channel/imap-smtp/shared/protocol-client.ts`
- Modify: `apps/server/src/runtime/mail/protocol-channel.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/trpc/routes/integrations.ts`

**Interfaces:**

- Consumes: current IMAP client functions, SMTP client functions, protocol contracts, and `MAIL_PROTOCOL_ALLOWED_HOSTS`.
- Produces:

```ts
export interface ImapSmtpProtocolExecutor {
  verify(input: ProtocolVerifyRequest): Promise<ProtocolVerifyResponse>;
  establishBaseline(input: ImapBaselineRequest): Promise<ImapBaselineResponse>;
  discover(input: ImapDiscoverRequest): Promise<ImapDiscoverResponse>;
  fetchRaw(input: ImapRawRequest): Promise<ImapRawResponse>;
  send(input: SmtpSendRequest): Promise<SmtpSendResponse>;
}

export const createImapSmtpProtocolExecutor: (input: {
  allowedHosts?: string;
}) => ImapSmtpProtocolExecutor;
```

- [ ] **Step 1: Write failing direct-executor tests**

Mock only the external IMAP/SMTP network clients. Prove that each executor method:

- parses the complete real request shape;
- forwards the configured allowed-host policy;
- returns the current response contract;
- preserves authentication, retryable, permanent and uncertain classifications;
- never performs an HTTP request.

- [ ] **Step 2: Run direct-executor tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/imap-smtp/protocol-executor.test.ts --reporter=dot
```

Expected: FAIL because the direct executor does not exist.

- [ ] **Step 3: Implement the in-process executor**

Move orchestration from `protocol-worker/server.ts` into the executor. Keep request validation, host policy, network timeouts and existing error classification. Do not move the HTTP Server or Bearer authentication.

- [ ] **Step 4: Change the channel adapter to consume the executor interface**

Replace URL-based `createMailProtocolClient()` with an injected `ImapSmtpProtocolExecutor`. Integration availability becomes a property of the installed channel plugin, not the presence of URL/Secret environment variables.

- [ ] **Step 5: Run direct-executor and existing IMAP/SMTP tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/imap-smtp tests/unit/protocol-worker --reporter=dot
```

Expected: the new direct tests PASS and existing protocol behavior tests remain PASS before old HTTP tests are deleted during cutover.

- [ ] **Step 6: Commit Task 5**

```powershell
git add apps/server/src/mail-channel/imap-smtp apps/server/src/runtime/mail/protocol-channel.ts apps/server/src/trpc/routes/connections.ts apps/server/src/trpc/routes/integrations.ts apps/server/tests/unit/mail-channel/imap-smtp
git commit -m "refactor(mail): run imap smtp protocols in process"
```

### Task 6: Replace Queue Bindings in Mail Runtime with the Durable Task Port

**Files:**

- Create: `apps/server/src/runtime/mail/task-queue.ts`
- Create: `apps/server/tests/unit/runtime/mail/task-queue.test.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/src/runtime/mail/outlook-inbound.ts`
- Modify: `apps/server/src/runtime/mail/zoho-inbound.ts`
- Modify: `apps/server/src/runtime/mail/inbound.ts`
- Modify: `apps/server/src/runtime/mail/outbound.ts`
- Modify: `apps/server/src/modules/mail-sync/runtime/create-mail-sync.ts`
- Modify: `apps/server/src/modules/mail-outbound/runtime/create-mail-outbound.ts`

**Interfaces:**

- Consumes: `MailTaskRepository`.
- Produces:

```ts
export type MailTaskQueuePort = {
  enqueueIngress(command: MailIngressCommand): Promise<void>;
  enqueueOutbound(command: MailOutboundCommand): Promise<void>;
  notify(): void;
};

export const createMailTaskQueuePort: (
  repository: MailTaskRepository,
  notify: () => void,
) => MailTaskQueuePort;
```

Stable dedupe keys:

```text
ingress:signal:{provider}:{externalAccount}:{cursorHint-or-empty}
ingress:{type}:{syncId}
outbound:dispatch
outbound:{type}:{deliveryId}
```

- [ ] **Step 1: Write failing queue-port tests**

Prove literal commands produce the literal dedupe keys above, repository persistence happens before notification, and a repository failure does not notify the worker.

- [ ] **Step 2: Run queue-port tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/mail/task-queue.test.ts --reporter=dot
```

Expected: FAIL because `createMailTaskQueuePort` does not exist.

- [ ] **Step 3: Implement the durable queue port**

Use one injected repository and notification callback. Do not expose PostgreSQL details to Mail Sync or Mail Outbound application code.

- [ ] **Step 4: Switch ingress and outbound runtime factories**

Replace every `runtimeEnv.MAIL_INGRESS_QUEUE.send()` and `runtimeEnv.MAIL_OUTBOUND_QUEUE.send()` with the injected queue port. Keep business command shapes and existing retry/lease behavior unchanged.

- [ ] **Step 5: Run affected unit and integration tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/mail tests/unit/modules/mail-sync tests/unit/modules/mail-outbound tests/integration/mail-sync --reporter=dot
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add apps/server/src/runtime/mail apps/server/src/modules/mail-sync apps/server/src/modules/mail-outbound apps/server/tests/unit/runtime/mail
git commit -m "refactor(mail): use postgres task wakeups"
```

### Task 7: Replace Durable Object RPC with a PostgreSQL User Workspace Service

**Files:**

- Create: `apps/server/src/modules/user-workspace/service.ts`
- Create: `apps/server/tests/unit/modules/user-workspace/service.test.ts`
- Modify: `apps/server/src/lib/server-utils.ts`
- Modify: `apps/server/src/trpc/routes/settings.ts`
- Modify: `apps/server/src/main.ts`
- Modify: existing mail-api router tests that mock `cloudflare:workers`

**Interfaces:**

- Consumes: shared `DB`, current user/note/settings/hotkey/email-template tables.
- Produces:

```ts
export type UserWorkspaceScope = {
  findUser(): Promise<User | undefined>;
  updateUser(data: Partial<UserInsert>): Promise<unknown>;
  findManyNotesByThreadId(connectionId: string, threadId: string): Promise<Note[]>;
  createNote(connectionId: string, payload: NoteCreate): Promise<Note[]>;
  updateNote(connectionId: string, noteId: string, payload: NoteUpdate): Promise<Note | undefined>;
  updateManyNotes(
    connectionId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean>;
  findManyNotesByIds(connectionId: string, noteIds: string[]): Promise<Note[]>;
  deleteNote(connectionId: string, noteId: string): Promise<unknown>;
  findNoteById(connectionId: string, noteId: string): Promise<Note | undefined>;
  findHighestNoteOrder(connectionId: string): Promise<{ order: number } | undefined>;
  deleteUser(): Promise<void>;
  findUserSettings(): Promise<UserSettings | undefined>;
  findUserHotkeys(): Promise<UserHotkeys[]>;
  insertUserHotkeys(shortcuts: UserHotkeysInsert[]): Promise<unknown>;
  insertUserSettings(settings: DefaultUserSettings): Promise<unknown>;
  updateUserSettings(settings: DefaultUserSettings): Promise<unknown>;
  listEmailTemplates(): Promise<EmailTemplate[]>;
  createEmailTemplate(payload: EmailTemplateCreate): Promise<EmailTemplate[]>;
  deleteEmailTemplate(templateId: string): Promise<unknown>;
  updateEmailTemplate(templateId: string, data: EmailTemplateUpdate): Promise<EmailTemplate[]>;
};

export const createUserWorkspaceService: (db: DB) => {
  forUser(userId: string): UserWorkspaceScope;
};
```

- [ ] **Step 1: Write failing user-scope behavior tests**

Use a repository fake below the service boundary and prove:

- the scope always applies its bound user ID;
- note and template operations cannot substitute another user ID;
- connection ID remains part of note ownership;
- settings upsert is awaited;
- account deletion invokes the current transaction sequence.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/modules/user-workspace/service.test.ts --reporter=dot
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Move `ZeroDB` behavior into the local service**

Remove inheritance from `DurableObject` and `RpcTarget`. Preserve all current ownership predicates and transaction boundaries. `forUser()` returns a local scope object rather than an RPC stub.

- [ ] **Step 4: Replace `getZeroDB()` and `waitUntil()`**

Resolve the shared user-workspace service from Hono runtime services. Change settings updates to explicit awaited writes. Do not create detached promises for database mutations.

- [ ] **Step 5: Remove Cloudflare mocks from affected behavior tests**

Run the tests against the real local service boundary. Keep external database/network fakes only where the existing test already requires them.

- [ ] **Step 6: Run affected tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/modules/user-workspace tests/unit/modules/mail-api tests/unit/trpc tests/architecture/mail-router-cutover.test.ts --reporter=dot
```

Expected: PASS with no `cloudflare:workers` mock.

- [ ] **Step 7: Commit Task 7**

```powershell
git add apps/server/src/modules/user-workspace apps/server/src/lib/server-utils.ts apps/server/src/trpc/routes/settings.ts apps/server/src/main.ts apps/server/tests
git commit -m "refactor(server): replace durable object rpc"
```

### Task 8: Create the Native Node HTTP Application and Lifecycle

**Files:**

- Create: `apps/server/src/runtime/node/services.ts`
- Create: `apps/server/src/runtime/node/application.ts`
- Create: `apps/server/src/runtime/node/main.ts`
- Create: `apps/server/tests/unit/runtime/node/application.test.ts`
- Create: `apps/server/tests/unit/runtime/node/lifecycle.test.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/ctx.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/integrations/nango/runtime.ts`
- Modify: `apps/server/src/lib/auth.ts`
- Modify: `apps/server/src/lib/admin-provisioning.ts`
- Modify: all remaining `HYPERDRIVE` and `THREADS_BUCKET` consumers
- Modify: `apps/server/package.json`

**Interfaces:**

- Consumes: Tasks 1–7 and `@hono/node-server`.
- Produces:

```ts
export type RuntimeServices = {
  config: RuntimeConfig;
  database: RuntimeDatabase;
  blobStore: LocalBlobStore;
  taskRepository: MailTaskRepository;
  taskWorker: MailTaskWorker;
  scheduler: MailScheduler;
  userWorkspace: ReturnType<typeof createUserWorkspaceService>;
  integrationHealth: IntegrationHealth;
};

export const createNodeApplication: (services: RuntimeServices) => Hono<HonoContext>;
export const startZeroServer: (source?: NodeJS.ProcessEnv) => Promise<{ close(): Promise<void> }>;
```

- [ ] **Step 1: Write failing application boundary tests**

Construct `RuntimeServices` with real in-memory/local components and prove:

- `/health` is 200 only after database/blob/worker/scheduler readiness;
- `/` redirects to the configured independent frontend URL;
- existing Gmail, Outlook and Zoho Webhook paths remain registered;
- Hono handlers receive `RuntimeServices` without Cloudflare Bindings;
- Nango unavailable status does not make `/health` fail.

- [ ] **Step 2: Run application tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/node/application.test.ts --reporter=dot
```

Expected: FAIL because the Node application factory does not exist.

- [ ] **Step 3: Extract the Hono application from the Worker entrypoint**

Keep route order, authentication middleware, CORS, tRPC error handling, blob routes and public URLs unchanged. Replace `c.env` Cloudflare Bindings with injected `RuntimeServices`.

- [ ] **Step 4: Write failing lifecycle tests**

Stub only the Node HTTP listener and external clients. Prove startup order and graceful shutdown order:

```text
config → database → blob → Nango validation → worker → scheduler → HTTP
HTTP close → scheduler stop → worker stop → external clients close → database close
```

Prove a fatal database/blob startup error closes already-created resources and rejects startup.

- [ ] **Step 5: Run lifecycle tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/node/lifecycle.test.ts --reporter=dot
```

Expected: FAIL because `startZeroServer` does not exist.

- [ ] **Step 6: Add `@hono/node-server` to the manifest**

Add it as a production dependency compatible with the installed Hono major version. Do not run `pnpm install`. Stop and ask the user to run:

```powershell
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

Continue only after the user confirms both commands succeed.

- [ ] **Step 7: Implement native Node startup and shutdown**

Use `serve()` from `@hono/node-server`. Register one idempotent shutdown path for `SIGTERM` and `SIGINT`. Ensure Server startup calls Nango validation once, not once per request.

- [ ] **Step 8: Replace Hyperdrive and R2 consumers**

Pass the shared `database.db` and `LocalBlobStore` to Mail Core, Mail API, lifecycle, inbound, outbound, auth and integrations. Remove per-operation connection creation where the caller now receives shared services.

- [ ] **Step 9: Run Node runtime tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/runtime/node tests/unit/lib/auth-session-persistence.test.ts tests/unit/integrations --reporter=dot
```

Expected: PASS.

- [ ] **Step 10: Commit Task 8**

```powershell
git add apps/server/src/runtime/node apps/server/src/main.ts apps/server/src/ctx.ts apps/server/src/env.ts apps/server/src/integrations apps/server/src/lib apps/server/package.json pnpm-lock.yaml apps/server/tests/unit/runtime/node
git commit -m "feat(server): run as native node service"
```

### Task 9: Switch Docker to the Pure Node Server and Remove Protocol Worker

**Files:**

- Modify: `docker/server/Dockerfile`
- Modify: `docker/server/entrypoint.sh`
- Delete: `docker/server/write-runtime-env.mjs`
- Delete: `docker/Dockerfile`
- Delete: `docker/entrypoint.sh`
- Modify: `compose.yaml`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `apps/server/tests/architecture/docker-server-immutable-runtime.test.ts`
- Modify: `apps/server/tests/architecture/docker-development-stack.test.ts`
- Modify: `apps/server/tests/architecture/docker-workspace-dependencies.test.ts`
- Modify: `apps/server/tests/architecture/docker-mail-static-runtime.test.ts`

**Interfaces:**

- Consumes: the Task 8 Node entrypoint and the independent Mail image.
- Produces: one static frontend container and one pure Node backend container.

- [ ] **Step 1: Rewrite architecture tests for observable Compose behavior**

Resolve `docker compose config --format json` and prove:

- services contain `mail` and `server`, but not `protocol-worker`;
- `mail.image === 'zero-mail-runtime'`;
- `server.image === 'zero-server'`;
- Server mounts only `/var/lib/zero/mail-blobs`;
- Server has no Wrangler state, source, or dependency mounts;
- Server does not declare Hyperdrive or Protocol Worker variables;
- Server starts independently of any Protocol Worker;
- the Blob named volume survives Server container replacement.

Add a Docker image inspection test script that asserts the runtime command is Node and the runtime filesystem contains no Wrangler/workerd binary or `apps/server/src`.

- [ ] **Step 2: Run Docker architecture tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-server-immutable-runtime.test.ts tests/architecture/docker-development-stack.test.ts tests/architecture/docker-workspace-dependencies.test.ts tests/architecture/docker-mail-static-runtime.test.ts --reporter=dot
```

Expected: FAIL because Compose still contains Wrangler and Protocol Worker.

- [ ] **Step 3: Build the native Node artifact**

Add a Server build script that targets Node.js 22 ESM and emits `/app/dist/main.js`. Bundle `@zero/mail-core` workspace source and keep runtime dependencies resolvable from production `node_modules`. Do not use Wrangler dry-run.

- [ ] **Step 4: Replace the Server Dockerfile and entrypoint**

Use a multi-stage build. Runtime must:

- contain the Node build artifact and production dependencies;
- run as a non-root user with write access only to `/var/lib/zero/mail-blobs`;
- execute `node /app/dist/main.js`;
- expose 8787;
- contain no source mount, pnpm install step, Wrangler, workerd, or TypeScript runtime compiler.

- [ ] **Step 5: Rewrite Compose and deployment command**

Delete the Protocol Worker service, development anchor, dependency volumes and Wrangler volume. Mount:

```yaml
zero-mail-blobs:/var/lib/zero/mail-blobs
```

Change `pnpm docker:deploy` to build and start immutable images without `install-dependencies`.

- [ ] **Step 6: Update environment and operator documentation**

Remove Hyperdrive, Wrangler and Protocol Worker variables. Document:

```powershell
pnpm docker:deploy
docker compose up --detach --build --no-deps server
docker compose up --detach --build --no-deps mail
```

State explicitly that frontend and backend remain independent.

- [ ] **Step 7: Run Docker architecture tests and Compose parsing**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/docker-server-immutable-runtime.test.ts tests/architecture/docker-development-stack.test.ts tests/architecture/docker-workspace-dependencies.test.ts tests/architecture/docker-mail-static-runtime.test.ts --reporter=dot
docker compose config --quiet
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9**

```powershell
git add docker compose.yaml package.json .env.example README.md apps/server/tests/architecture
git commit -m "build(server): deploy one native node backend"
```

### Task 10: Delete Cloudflare Runtime, R2 and Protocol HTTP Residue

**Files:**

- Delete: `apps/server/wrangler.jsonc`
- Delete: `apps/server/worker-configuration.d.ts`
- Delete: `apps/server/src/protocol-worker/**`
- Delete: `apps/server/src/modules/mail/blob/r2-blob-store.ts`
- Delete: `apps/server/tests/unit/protocol-worker/**`
- Delete: `apps/server/tests/unit/mail-core/r2-blob-store.test.ts`
- Delete: `apps/mail/wrangler.jsonc`
- Modify: `apps/server/package.json`
- Modify: `apps/mail/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/server/tsconfig.json`
- Modify: all tests that reference removed files or Cloudflare types

**Interfaces:**

- Consumes: completed Node, local Blob, durable queue and in-process protocol paths.
- Produces: a repository with no Wrangler/workerd or Cloudflare runtime path.

- [ ] **Step 1: Write/adjust the architecture boundary test**

The test must discover runtime imports through TypeScript AST/module resolution and fail if production code imports `cloudflare:workers` or references Cloudflare Binding types. It must inspect package manifests and resolved Compose config rather than only grep exact source lines.

It must also verify that both Mail and Server manifests have no Wrangler dependency or scripts.

- [ ] **Step 2: Run the boundary test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/mail-architecture.test.ts tests/architecture/docker-server-immutable-runtime.test.ts --reporter=dot
```

Expected: FAIL while old runtime files and manifests still exist.

- [ ] **Step 3: Delete old runtime implementations**

Delete R2, Worker entrypoint, Protocol HTTP Server, Wrangler configs and generated Cloudflare types only after all call sites use their replacements.

- [ ] **Step 4: Remove orphan dependencies and scripts**

Remove Wrangler from both applications and the Workspace catalog. Remove obsolete Mail `start`, `types`, and `deploy` scripts that target Cloudflare, while keeping its local React Router development and static build scripts.

Do not run dependency installation automatically. Ask the user to run:

```powershell
pnpm install --lockfile-only
pnpm install --frozen-lockfile
```

Continue after confirmation.

- [ ] **Step 5: Run boundary and affected tests**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture tests/unit/mail-core/local-blob-store.test.ts tests/unit/mail-channel/imap-smtp tests/unit/runtime/node --reporter=dot
```

Expected: PASS with no Cloudflare mocks or runtime imports.

- [ ] **Step 6: Commit Task 10**

```powershell
git add apps/server apps/mail/package.json apps/mail/wrangler.jsonc pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "refactor(server): remove cloudflare runtime"
```

### Task 11: Full Verification and Production Dry Run

**Files:**

- Modify only in-scope files above if verification exposes a defect, and add a failing regression test before each fix.

**Interfaces:**

- Consumes: the completed pure Node runtime.
- Produces: static, database, Docker and end-to-end evidence.

- [ ] **Step 1: Run formatting, lint and type checks**

Run:

```powershell
pnpm exec prettier --check apps/server apps/mail/package.json compose.yaml docker package.json pnpm-workspace.yaml
pnpm --filter @zero/server lint
pnpm --filter @zero/server exec tsc --noEmit --pretty false
pnpm --filter @zero/mail lint
```

Expected: PASS without warnings.

- [ ] **Step 2: Run Server unit and architecture suites**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit tests/architecture --reporter=dot
```

Expected: PASS.

- [ ] **Step 3: Run database-backed integration suites**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/integration/mail-core tests/integration/mail-sync tests/integration/mail-tasks tests/integration/modules --reporter=dot
```

Expected: PASS against isolated temporary PostgreSQL databases.

- [ ] **Step 4: Validate Compose and build both application images**

Run:

```powershell
docker compose config --quiet
docker compose build server mail
```

Expected: PASS.

- [ ] **Step 5: Inspect the Server image**

Run:

```powershell
docker run --rm --entrypoint sh zero-server -c "test -f /app/dist/main.js && test ! -d /app/apps/server/src && ! find /app -iname '*wrangler*' -o -iname '*workerd*'"
```

Expected: exit 0.

- [ ] **Step 6: Deploy and verify health**

Run:

```powershell
pnpm docker:deploy
docker compose ps
docker compose logs --since 5m server
```

Expected:

- Mail, Server, PostgreSQL, Valkey and Upstash Proxy are healthy;
- no Protocol Worker container exists;
- Server logs contain no Wrangler/workerd or runtime compilation;
- Nango retains success/unavailable startup status behavior.

- [ ] **Step 7: Verify persistent task recovery**

Create a controlled future mail task in an isolated test or supported diagnostic path, restart only Server, advance it to due, and prove exactly one execution occurs. Do not send a real external email for this test.

- [ ] **Step 8: Verify Blob persistence**

Store a controlled Blob through the real BlobStore/API, replace the Server container, then read the same Blob and verify its SHA-256.

- [ ] **Step 9: Verify public runtime paths**

Exercise:

- `/health`;
- session login;
- `connections.list`;
- mailbox/thread page;
- Gmail, Outlook and Zoho Webhook request validation;
- IMAP/SMTP connection verification with a controlled fake server or existing dry-run fixture;
- draft creation and a mocked provider delivery path through EmailSubmission/Spool.

- [ ] **Step 10: Final residue and worktree hygiene**

Run:

```powershell
git grep -n -I -E "cloudflare:workers|wrangler|workerd|HYPERDRIVE|THREADS_BUCKET|ZERO_DB|MAIL_INGRESS_QUEUE|MAIL_OUTBOUND_QUEUE|MAIL_PROTOCOL_WORKER_(URL|SECRET|PORT)" -- ':!docs/**' ':!pnpm-lock.yaml'
git status --short
```

Expected:

- no production/config matches;
- `pnpm-lock.yaml` contains no Wrangler/workerd package reachable from a workspace manifest;
- only intentional implementation files are modified;
- unrelated `node-compile-cache/` and `update-check/` remain untouched.

- [ ] **Step 11: Close verification defects through their owning task**

If verification exposes a defect, return to the task that owns that behavior, add a failing regression test, verify RED, implement the smallest correction, verify GREEN, and create a scoped `fix(server): complete node runtime verification` commit containing only that regression test and correction. If no defect is found, do not create an empty commit.
