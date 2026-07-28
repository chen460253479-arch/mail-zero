# Gmail Channel Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Nango/Gmail integration controls with one globally configured Gmail channel, optional Watch and scheduled incremental-sync triggers, and a Gmail-owned Pub/Sub webhook.

**Architecture:** Add one provider-neutral `integration.channel_config` record whose Gmail-specific `provider_config` is parsed by the Gmail plugin. Keep Nango and Zero OAuth secrets in the existing encrypted integration store, route every mailbox connection through the selected global authorization source, and reuse the existing mail-sync generation/lease/checkpoint pipeline for push, scheduled, and manual triggers.

**Tech Stack:** TypeScript 5.8, PostgreSQL, Drizzle ORM, Zod 4, Hono, tRPC 11, React Router 7, React 19, TanStack Query, Vitest.

## Global Constraints

- Work directly on `codex/local-mail-core` in `D:\WorkSpace\Zero`; do not create a Git worktree.
- Do not install or upgrade dependencies.
- Do not start, rebuild, or restart Docker services automatically.
- Preserve the existing unrelated changes in `apps/mail/messages/en.json`, `apps/server/src/lib/auth.ts`, `apps/server/tests/architecture/nango-credential-boundary.test.ts`, `apps/server/tests/unit/lib/auth-session-persistence.test.ts`, `node-compile-cache/`, and `update-check/`.
- Gmail Inbox initial sync remains `none`; only changes after the established current `historyId` are imported.
- Zero never creates, updates, or deletes Google Cloud Pub/Sub resources.
- Nginx owns the public HTTPS mapping to `POST /api/mail/channels/gmail/push`.
- Gmail folders, labels, flags, and other local actions are not synchronized back to Gmail.
- Use the existing development schema template; do not leave a chronological `0001` migration.
- Add failing tests before implementation changes.

---

## File Structure

### New server files

- `apps/server/src/integrations/core/channel-config-repository.ts` — provider-neutral persistence for one active configuration per mail channel.
- `apps/server/src/integrations/gmail/channel-config-service.ts` — Gmail configuration read/save rules and authorization-source switch guard.
- `apps/server/src/mail-channel/gmail/config.ts` — Gmail channel settings schema and public safe types.
- `apps/server/src/mail-channel/gmail/inbound/webhook.ts` — complete Gmail Pub/Sub HTTP authentication and payload-to-signal adapter.
- `apps/server/tests/unit/integrations/core/channel-config-repository.test.ts` — repository contract tests with a mocked Drizzle boundary.
- `apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts` — global Gmail configuration rules.
- `apps/server/tests/unit/mail-channel/gmail/config.test.ts` — Gmail provider config parsing.
- `apps/server/tests/unit/mail-channel/gmail/inbound/webhook.test.ts` — Gmail-owned webhook request behavior.

### Modified server files

- `apps/server/src/db/schema.ts` — add `integration.channel_config`.
- `apps/server/src/db/migrations/0000_steady_silver_centurion.sql` and `apps/server/src/db/migrations/meta/0000_snapshot.json` — keep the single development template aligned.
- `apps/server/tests/helpers/mail-core/schema-contract.ts` and the generated schema snapshot — register the table and verify its constraints.
- `apps/server/src/integrations/core/repository.ts` — expose authorization binding counts needed by the channel service.
- `apps/server/src/trpc/routes/integrations.ts` — unified Gmail channel configuration API.
- `apps/server/src/trpc/routes/connections.ts` — route connection behavior through the global Gmail authorization source and narrow duplicate-error mapping.
- `apps/server/src/routes/integrations.ts` — reject Zero OAuth mailbox authorization when Zero OAuth is not the selected global source.
- `apps/server/src/modules/mail-accounts/application/gmail-connection-options.ts` — remove the `choice` mode.
- `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.ts` — return the verified identity so provisioning happens outside the binding repository.
- `apps/server/src/modules/mail-accounts/application/provision-mailbox.ts` — keep Watch failure non-fatal while retaining true checkpoint/auth failures.
- `apps/server/src/modules/mail-accounts/runtime/provision-gmail-mailbox.ts` — activate inbound sync from the global Gmail policy.
- `apps/server/src/modules/mail-sync/application/activate.ts` — support checkpoint-only activation and best-effort subscription.
- `apps/server/src/modules/mail-sync/postgres/sync-repository.ts` and types — persist an optional subscription warning while activating.
- `apps/server/src/modules/mail-sync/runtime/create-mail-sync.ts` — use the configured reconciliation interval.
- `apps/server/src/runtime/mail/gmail-inbound.ts` — read channel policy for activation, renewal, webhook acceptance, and scheduled dispatch.
- `apps/server/src/main.ts` — reduce the Gmail endpoint to a thin call into the Gmail plugin webhook.
- Existing unit and integration tests under `apps/server/tests/unit` and `apps/server/tests/integration` — update contracts and add regressions.

### New/modified frontend files

- `apps/mail/app/routes.ts` — add the nested `/settings/integrations/gmail` route.
- `apps/mail/app/(routes)/settings/integrations/layout.tsx` — admin guard, channel cards, and nested modal outlet.
- `apps/mail/app/(routes)/settings/integrations/page.tsx` — index content only.
- `apps/mail/app/(routes)/settings/integrations/gmail/page.tsx` — route-controlled Gmail dialog.
- `apps/mail/components/integrations/channel-card.tsx` — reusable provider card.
- `apps/mail/components/integrations/gmail-settings-dialog.tsx` — large responsive Gmail configuration surface.
- `apps/mail/components/integrations/nango-settings-card.tsx` and `gmail-oauth-settings-card.tsx` — convert to conditional sections or remove after their logic is moved.
- `apps/mail/components/connection/add.tsx` and `gmail-connect-dialog.tsx` — stop presenting an authorization-source choice.
- `apps/mail/modules/integrations/gmail-config.ts` and `gmail-config.test.ts` — pure form-state/default/visibility helpers covered by the frontend Vitest pattern.

---

### Task 1: Persist one global Gmail channel policy

**Files:**
- Create: `apps/server/src/mail-channel/gmail/config.ts`
- Create: `apps/server/src/integrations/core/channel-config-repository.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/tests/helpers/mail-core/schema-contract.ts`
- Test: `apps/server/tests/unit/mail-channel/gmail/config.test.ts`
- Test: `apps/server/tests/unit/integrations/core/channel-config-repository.test.ts`
- Test: `apps/server/tests/integration/mail-core/plugin-connection-schema.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export type GmailAuthSource = 'zero_oauth' | 'nango';

export type GmailChannelProviderConfig = {
  topicName?: string;
  subscriptionName?: string;
  pushAudience?: string;
  pushServiceAccount?: string;
};

export type GmailChannelConfig = {
  channelId: 'gmail';
  authSource: GmailAuthSource;
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  providerConfig: GmailChannelProviderConfig;
};

export const parseGmailChannelConfig: (value: unknown) => GmailChannelConfig;

export interface ChannelConfigRepository {
  get(channelId: MailChannelId): Promise<ChannelConfigRecord | null>;
  save(input: SaveChannelConfigInput): Promise<ChannelConfigRecord>;
}
```

- [ ] **Step 1: Write failing Gmail configuration parser tests**

```ts
it('accepts manual-only Gmail and the 10-minute scheduled default', () => {
  expect(parseGmailChannelConfig({
    channelId: 'gmail',
    authSource: 'nango',
    inboxWatchEnabled: false,
    scheduledSyncEnabled: true,
    syncIntervalMinutes: 10,
    providerConfig: {},
  })).toMatchObject({
    authSource: 'nango',
    inboxWatchEnabled: false,
    scheduledSyncEnabled: true,
  });
});

it('requires Pub/Sub values only when Watch is enabled', () => {
  expect(() => parseGmailChannelConfig({
    channelId: 'gmail',
    authSource: 'zero_oauth',
    inboxWatchEnabled: true,
    scheduledSyncEnabled: false,
    syncIntervalMinutes: 10,
    providerConfig: {},
  })).toThrow();
});
```

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/unit/mail-channel/gmail/config.test.ts
```

Expected: FAIL because `mail-channel/gmail/config.ts` does not exist.

- [ ] **Step 3: Define the Drizzle table and parser**

Add a `channelConfig` table with:

```ts
export const channelConfig = createIntegrationTable(
  'channel_config',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').$type<MailChannelId>().notNull().unique(),
    authSource: text('auth_source').$type<'zero_oauth' | 'nango' | 'manual'>().notNull(),
    inboxWatchEnabled: boolean('inbox_watch_enabled').notNull().default(false),
    scheduledSyncEnabled: boolean('scheduled_sync_enabled').notNull().default(true),
    syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(10),
    providerConfig: jsonb('provider_config').notNull().default({}),
    updatedBy: text('updated_by').notNull().references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('channel_config_auth_source_chk', sql`${t.authSource} IN ('zero_oauth', 'nango', 'manual')`),
    check('channel_config_sync_interval_chk', sql`${t.syncIntervalMinutes} BETWEEN 1 AND 1440`),
  ],
);
```

Implement `parseGmailChannelConfig` with a discriminated Watch schema: empty Pub/Sub values are valid while Watch is disabled; fully qualified Topic/Subscription, URL Audience, and IAM service-account email are required while enabled.

- [ ] **Step 4: Write repository and PostgreSQL constraint tests**

Verify:

```ts
await repository.save(first);
await repository.save({ ...first, scheduledSyncEnabled: false });
expect(await repository.get('gmail')).toMatchObject({ scheduledSyncEnabled: false });
```

Also assert one row per `channel_id`, interval bounds, and the `updated_by` foreign key.

- [ ] **Step 5: Run focused tests and update the structural snapshot**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/unit/mail-channel/gmail/config.test.ts tests/unit/integrations/core/channel-config-repository.test.ts tests/unit/mail-core/schema-structure-parity.test.ts --update
```

Expected: PASS and only the schema parity snapshot changes.

- [ ] **Step 6: Commit the data-model slice**

```powershell
git add apps/server/src/db/schema.ts apps/server/src/mail-channel/gmail/config.ts apps/server/src/integrations/core/channel-config-repository.ts apps/server/tests/helpers/mail-core/schema-contract.ts apps/server/tests/unit/mail-channel/gmail/config.test.ts apps/server/tests/unit/integrations/core/channel-config-repository.test.ts apps/server/tests/unit/mail-core/__snapshots__/schema-structure-parity.test.ts.snap
git commit -m "feat(mail): add global channel configuration"
```

### Task 2: Add Gmail configuration service and administrator API

**Files:**
- Create: `apps/server/src/integrations/gmail/channel-config-service.ts`
- Modify: `apps/server/src/integrations/core/repository.ts`
- Modify: `apps/server/src/trpc/routes/integrations.ts`
- Test: `apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts`
- Test: `apps/server/tests/unit/trpc/routes/integrations.test.ts`

**Interfaces:**
- Consumes: `ChannelConfigRepository`, `parseGmailChannelConfig`, existing system-integration repository.
- Produces:

```ts
export interface GmailChannelConfigService {
  get(): Promise<SafeGmailChannelConfig & { webhookUrl: string }>;
  save(input: SaveGmailChannelConfigInput & { updatedBy: string }): Promise<SafeGmailChannelConfig>;
}
```

- [ ] **Step 1: Write failing service tests**

Cover these exact rules:

```ts
it('rejects nango mode without an active Nango config and Gmail mapping');
it('rejects zero_oauth mode without an active Gmail OAuth config');
it('blocks changing authSource while any Gmail authorization binding exists');
it('allows changing only Watch and schedule settings while bindings exist');
it('returns manual-only when both automatic triggers are disabled');
```

- [ ] **Step 2: Run the tests and verify RED**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts
```

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement the minimal service**

Use stable domain errors:

```ts
type GmailChannelConfigErrorCode =
  | 'GMAIL_AUTH_SOURCE_NOT_CONFIGURED'
  | 'GMAIL_AUTH_SOURCE_IN_USE'
  | 'GMAIL_CHANNEL_CONFIG_INVALID';
```

Only compare the persisted and candidate `authSource` when deciding whether active bindings block a save. Watch/schedule changes remain allowed.

- [ ] **Step 4: Add unified tRPC procedures**

Add:

```ts
getChannels: adminProcedure.query(...)
getGmailConfig: adminProcedure.query(...)
saveGmailConfig: adminProcedure.input(saveGmailChannelConfigSchema).mutation(...)
```

Keep the existing Nango and Zero OAuth validation procedures as internal operations used by the Gmail dialog. Do not expose secrets in any response.
Return the read-only webhook URL derived from the configured public backend base URL plus
`/api/mail/channels/gmail/push`; do not accept an editable webhook URL from the browser.

- [ ] **Step 5: Run service/router tests**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/trpc/routes/integrations.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the configuration API slice**

```powershell
git add apps/server/src/integrations apps/server/src/trpc/routes/integrations.ts apps/server/tests/unit/integrations apps/server/tests/unit/trpc/routes/integrations.test.ts
git commit -m "feat(mail): expose Gmail channel configuration"
```

### Task 3: Make Watch optional and scheduled reconciliation configurable

**Files:**
- Modify: `apps/server/src/modules/mail-sync/application/activate.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/sync-repository.ts`
- Modify: `apps/server/src/modules/mail-sync/postgres/types.ts`
- Modify: `apps/server/src/modules/mail-sync/runtime/create-mail-sync.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `.env.example`
- Delete: `apps/server/src/runtime/mail/gmail-inbound-config.ts`
- Delete: `apps/server/tests/unit/runtime/mail/gmail-inbound-config.test.ts`
- Modify: `apps/server/src/modules/mail-accounts/runtime/provision-gmail-mailbox.ts`
- Test: `apps/server/tests/unit/modules/mail-sync/application/activate.test.ts`
- Test: `apps/server/tests/unit/modules/mail-sync/runtime/create-mail-sync.test.ts`
- Test: `apps/server/tests/integration/mail-sync/activation.integration.test.ts`
- Test: `apps/server/tests/integration/mail-sync/scheduler.integration.test.ts`

**Interfaces:**
- Changes activation input to:

```ts
type ActivateInboundSyncInput = {
  accountId: string;
  connectionId: string;
  provider: string;
  scopeKey: string;
  scope: IngressScope;
  subscriptionTarget: VersionedProviderState | null;
};
```

- Adds `reconcileAfterMs` to `createMailIngressRuntime` dependencies.

- [ ] **Step 1: Write failing activation tests**

```ts
it('activates with a checkpoint and null subscription expiration when Watch is disabled');
it('keeps the sync active and records a subscription warning when Gmail Watch fails');
it('still fails activation when establishing the Gmail checkpoint fails');
```

- [ ] **Step 2: Run activation tests and verify RED**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-sync/application/activate.test.ts
```

- [ ] **Step 3: Implement checkpoint-only and best-effort subscription activation**

Use this sequence:

```ts
const checkpoint = await ensureCheckpoint();
let subscriptionExpiresAt: Date | null = null;
let subscriptionWarning: { code: string; message: string } | null = null;

if (input.subscriptionTarget !== null) {
  try {
    subscriptionExpiresAt = (
      await adapter.subscribe!({
        scope: input.scope,
        checkpoint,
        target: input.subscriptionTarget,
      })
    ).expiresAt;
  } catch (error) {
    subscriptionWarning = safeSyncError(error);
  }
}

return repository.activate({ syncId, subscriptionExpiresAt, subscriptionWarning });
```

Do not call `markReconnectRequired` for `subscriptionWarning`; true checkpoint or credential failures still follow the existing failure path.

- [ ] **Step 4: Gate scheduled work with the Gmail policy**

In `enqueueDueMailIngressWork`, retain signal/manual generations regardless of policy and gate only time-based work:

```ts
const disabledCutoff = new Date(0);
reconcileBefore = config.scheduledSyncEnabled ? now : disabledCutoff;
renewalBefore = config.inboxWatchEnabled ? nowPlusOneDay : disabledCutoff;
```

Pass `config.syncIntervalMinutes * 60_000` as `reconcileAfterMs` to discovery completion.
Remove the old Gmail Pub/Sub environment-variable parser and its four Pub/Sub environment fields;
the Gmail plugin must read the single persisted channel policy instead.

- [ ] **Step 5: Run unit and PostgreSQL scheduler tests**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-sync/application/activate.test.ts tests/unit/modules/mail-sync/runtime/create-mail-sync.test.ts tests/integration/mail-sync/activation.integration.test.ts tests/integration/mail-sync/scheduler.integration.test.ts
```

Expected: PASS; requested generations still dispatch while scheduled reconciliation is disabled.

- [ ] **Step 6: Commit the trigger-policy slice**

```powershell
git add apps/server/src/modules/mail-sync apps/server/src/runtime/mail/gmail-inbound.ts apps/server/src/modules/mail-accounts/runtime/provision-gmail-mailbox.ts apps/server/tests/unit/modules/mail-sync apps/server/tests/integration/mail-sync
git commit -m "feat(mail): configure Gmail inbound triggers"
```

### Task 4: Move the Gmail Pub/Sub endpoint into the Gmail plugin

**Files:**
- Create: `apps/server/src/mail-channel/gmail/inbound/webhook.ts`
- Modify: `apps/server/src/mail-channel/gmail/inbound/handle-push.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Test: `apps/server/tests/unit/mail-channel/gmail/inbound/webhook.test.ts`
- Test: `apps/server/tests/unit/mail-channel/gmail/inbound/handle-push.test.ts`
- Test: `apps/server/tests/architecture/mail-architecture.test.ts`

**Interfaces:**
- Produces:

```ts
export const handleGmailWebhookRequest: (
  request: Request,
  dependencies: GmailWebhookDependencies,
) => Promise<Response>;
```

- [ ] **Step 1: Write failing webhook ownership tests**

Cover:

```ts
it('returns 401 when the authenticated Pub/Sub identity is invalid');
it('returns 200 without a sync signal when global Gmail Watch is disabled');
it('returns 200 and records one standard signal for a valid Pub/Sub envelope');
it('acknowledges and drops a malformed authenticated Pub/Sub payload');
```

Add an architecture assertion that `main.ts` does not import `authenticateGmailPush`,
`readGmailInboundConfig`, or `recordGmailPushSignal`.

- [ ] **Step 2: Run webhook tests and verify RED**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/mail-channel/gmail/inbound/webhook.test.ts tests/architecture/mail-architecture.test.ts
```

- [ ] **Step 3: Implement the Gmail-owned webhook**

The plugin handler must:

```ts
const config = await dependencies.getChannelConfig();
if (!config.inboxWatchEnabled) return new Response(null, { status: 200 });
if (!(await authenticateGmailPush(headers, config.providerConfig))) {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
const handled = await handleGmailPush(await request.json(), dependencies);
if (!handled.accepted) return new Response(null, { status: 204 });
return Response.json({ message: 'OK' }, { status: 200 });
```

The handler returns acknowledgement only after the signal is persisted and enqueue attempts are recorded. It must not import Hono types.
Authenticated malformed payloads are acknowledged and dropped so Google Pub/Sub does not retry
permanently invalid input. Authentication failures remain `401`.

- [ ] **Step 4: Reduce `main.ts` to route mounting**

Keep:

```ts
.post('/api/mail/channels/gmail/push', (c) =>
  handleGmailWebhookForEnvironment(c.req.raw, c.env),
)
```

All Gmail validation, parsing, and signal behavior must live below `mail-channel/gmail/inbound`.

- [ ] **Step 5: Run webhook and architecture tests**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/mail-channel/gmail/inbound tests/architecture/mail-architecture.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the plugin-boundary slice**

```powershell
git add apps/server/src/mail-channel/gmail/inbound apps/server/src/main.ts apps/server/src/runtime/mail/gmail-inbound.ts apps/server/tests/unit/mail-channel/gmail/inbound apps/server/tests/architecture/mail-architecture.test.ts
git commit -m "refactor(mail): move Gmail webhook into plugin"
```

### Task 5: Enforce the global authorization route and fix false duplicate errors

**Files:**
- Modify: `apps/server/src/modules/mail-accounts/application/gmail-connection-options.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/bind-nango-mailbox.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/routes/integrations.ts`
- Modify: `apps/server/src/modules/mail-accounts/application/provision-mailbox.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/application/gmail-connection-options.test.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/application/provision-mailbox.test.ts`
- Test: `apps/server/tests/unit/trpc/routes/connections.test.ts`

**Interfaces:**
- `GmailConnectMode` becomes:

```ts
export type GmailConnectMode = 'zero_oauth' | 'nango' | 'unavailable';
```

- `bindNangoMailbox` returns:

```ts
{ id: string; identity: { email: string; name: string } }
```

- [ ] **Step 1: Write failing routing and regression tests**

Cover:

```ts
it('returns only the persisted global Gmail auth source');
it('rejects listNangoGmailConnections and bindNango while zero_oauth is selected');
it('rejects the Zero OAuth start route while nango is selected');
it('does not map a provisioning or Watch error to NANGO_CONNECTION_ALREADY_BOUND');
it('still maps a true Nango reference conflict to NANGO_CONNECTION_ALREADY_BOUND');
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-accounts/application/gmail-connection-options.test.ts tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts tests/unit/trpc/routes/connections.test.ts
```

- [ ] **Step 3: Narrow the binding error boundary**

The Nango repository callback performs only:

```ts
return connectionRepository.saveBinding(...);
```

After `bindNangoMailbox` returns successfully, call `provisionGmailMailboxInDatabase` outside the duplicate-conflict catch. Query-based conflict translation remains only around the binding write.

- [ ] **Step 4: Enforce the selected source server-side**

Every source-specific endpoint loads `integration.channel_config`:

```ts
if (gmailConfig?.authSource !== 'nango') throw MAIL_CHANNEL_UNAVAILABLE;
if (gmailConfig?.authSource !== 'zero_oauth') throw GMAIL_OAUTH_NOT_CONFIGURED;
```

Client input never overrides the global source.
Update Zero OAuth validation redirects to `/settings/integrations/gmail?gmailValidation=...`
so the route-controlled Gmail dialog remains open when the popup reports its result.

- [ ] **Step 5: Run all mailbox-account unit tests**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/modules/mail-accounts tests/unit/trpc/routes/connections.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the connection slice**

```powershell
git add apps/server/src/modules/mail-accounts apps/server/src/trpc/routes/connections.ts apps/server/src/routes/integrations.ts apps/server/tests/unit/modules/mail-accounts apps/server/tests/unit/trpc/routes/connections.test.ts
git commit -m "fix(mail): enforce Gmail authorization policy"
```

### Task 6: Replace the Integration page with channel cards and a Gmail route modal

**Files:**
- Create: `apps/mail/app/(routes)/settings/integrations/layout.tsx`
- Create: `apps/mail/app/(routes)/settings/integrations/gmail/page.tsx`
- Create: `apps/mail/components/integrations/channel-card.tsx`
- Create: `apps/mail/components/integrations/gmail-settings-dialog.tsx`
- Create: `apps/mail/modules/integrations/gmail-config.ts`
- Create: `apps/mail/modules/integrations/gmail-config.test.ts`
- Modify: `apps/mail/app/routes.ts`
- Modify: `apps/mail/app/(routes)/settings/integrations/page.tsx`
- Modify: `apps/mail/components/connection/add.tsx`
- Modify: `apps/mail/components/connection/gmail-connect-dialog.tsx`
- Delete after migration: `apps/mail/components/integrations/nango-settings-card.tsx`
- Delete after migration: `apps/mail/components/integrations/gmail-oauth-settings-card.tsx`

**Interfaces:**
- Produces:

```ts
export type GmailConfigForm = {
  authSource: 'zero_oauth' | 'nango';
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  topicName: string;
  subscriptionName: string;
  pushAudience: string;
  pushServiceAccount: string;
};

export const defaultGmailConfigForm: GmailConfigForm;
export const isManualOnly: (form: GmailConfigForm) => boolean;
```

- [ ] **Step 1: Write failing pure frontend tests**

```ts
it('defaults to scheduled incremental sync every ten minutes');
it('reports manual-only only when Watch and schedule are both disabled');
it('requires Pub/Sub fields only while Watch is enabled');
```

- [ ] **Step 2: Run frontend tests and verify RED**

```powershell
pnpm --dir apps/mail test -- modules/integrations/gmail-config.test.ts
```

- [ ] **Step 3: Build the route-driven modal**

Configure:

```ts
route('/integrations', '(routes)/settings/integrations/layout.tsx', [
  index('(routes)/settings/integrations/page.tsx'),
  route('gmail', '(routes)/settings/integrations/gmail/page.tsx'),
])
```

The layout renders channel cards and an `<Outlet />`. The Gmail child route opens the large dialog and navigates back to `/settings/integrations` on close. The dialog uses a scrollable body, sticky header/footer, and full-screen mobile layout.

- [ ] **Step 4: Move Nango and Zero OAuth controls into conditional Gmail sections**

Render Nango configuration only when `authSource === 'nango'`; render Zero OAuth configuration only when `authSource === 'zero_oauth'`. Reuse the existing mutation and OAuth-popup logic. Remove the two top-level settings-card components after no imports remain.

- [ ] **Step 5: Remove authorization choice from Connect Email**

Behavior:

```ts
if (mode === 'zero_oauth') startZeroOAuth();
if (mode === 'nango') openNangoConnectionPicker();
```

The dialog must never render both source choices and must not display a Nango badge as a user choice.

- [ ] **Step 6: Run frontend tests, lint, and build**

```powershell
pnpm --dir apps/mail test -- modules/integrations/gmail-config.test.ts
pnpm --dir apps/mail exec eslint app/routes.ts "app/(routes)/settings/integrations" components/integrations components/connection/add.tsx components/connection/gmail-connect-dialog.tsx modules/integrations
pnpm --filter @zero/mail build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the frontend slice**

```powershell
git add apps/mail/app/routes.ts "apps/mail/app/(routes)/settings/integrations" apps/mail/components/integrations apps/mail/components/connection/add.tsx apps/mail/components/connection/gmail-connect-dialog.tsx apps/mail/modules/integrations
git commit -m "feat(mail): add Gmail channel configuration dialog"
```

### Task 7: Regenerate the single development template and run final verification

**Files:**
- Modify: `apps/server/src/db/migrations/0000_steady_silver_centurion.sql`
- Modify: `apps/server/src/db/migrations/meta/0000_snapshot.json`
- Verify: `apps/server/src/db/migrations/meta/_journal.json` still contains only `0000_steady_silver_centurion`
- Modify only if generated by formatting: affected source/test files from Tasks 1–6

**Interfaces:**
- Consumes the final Drizzle schema from Task 1.
- Produces one clean initialization template with no `0001` migration.

- [ ] **Step 1: Generate a temporary Drizzle delta**

Run:

```powershell
pnpm --dir apps/server db:generate
```

Expected: one temporary `0001` migration containing only `integration.channel_config`.

- [ ] **Step 2: Fold the delta into `0000`**

Use the generated SQL as the exact source for the new table, constraints, and foreign key. Insert it into `0000_steady_silver_centurion.sql`, replace the `0000` snapshot with the generated full snapshot while preserving a zero `prevId`, remove the temporary `0001` SQL/snapshot, and remove its journal entry. Perform these edits with `apply_patch`; do not leave incremental migration artifacts.

- [ ] **Step 3: Verify the template shape**

```powershell
git status --short apps/server/src/db/migrations
Select-String -Path apps/server/src/db/migrations/meta/_journal.json -Pattern '"tag"'
```

Expected: only the `0000` SQL/snapshot are modified and the journal contains one tag.

- [ ] **Step 4: Run focused server verification**

```powershell
pnpm --dir apps/server exec vitest run tests/unit/integrations tests/unit/mail-channel/gmail tests/unit/modules/mail-accounts tests/unit/modules/mail-sync tests/unit/trpc/routes/integrations.test.ts tests/unit/trpc/routes/connections.test.ts tests/architecture/mail-architecture.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run PostgreSQL integration verification**

Run only against the already configured development test database:

```powershell
pnpm --dir apps/server exec vitest run tests/integration/mail-core/plugin-connection-schema.integration.test.ts tests/integration/mail-sync
```

Expected: PASS. If no test database is available, report the command as blocked; do not start Docker.

- [ ] **Step 6: Run static verification**

```powershell
pnpm --dir apps/server exec eslint src tests
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/mail exec eslint app components modules
pnpm --filter @zero/mail build
```

Expected: changed files introduce no new failures. Record the two known pre-existing server type errors separately if they remain:

```text
src/lib/server-utils.ts: revokeSession request body
src/main.ts: OAuth discovery getMcpOAuthConfig typing
```

- [ ] **Step 7: Inspect the final diff for scope and secrets**

```powershell
git diff --check
git status --short
git diff --name-only
git grep -n -E "clientSecret|secretKey|refreshToken|accessToken" -- apps/mail apps/server/src/trpc
```

Confirm no secret value is returned to the browser or logged, and unrelated working-tree files remain untouched.

- [ ] **Step 8: Commit the template and final corrections**

```powershell
git add apps/server/src/db/migrations apps/server/src/db/schema.ts apps/server/tests
git commit -m "test(mail): verify Gmail channel integration"
```

Do not push until the user explicitly requests it.
