# Nango Fixed Channel Integration Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace administrator-selected Nango Integration mappings with one server-owned Integration Key per mail channel.

**Architecture:** A process-local Nango channel integration service reads fixed per-channel keys from `ZeroEnv`, validates them once against the Nango Integration list and the registered channel plugin's accepted providers, and exposes a safe per-channel status plus an internal `requireIntegrationKey()` operation. Configuration, connection listing and binding consume this service; the browser and PostgreSQL no longer choose or persist channel mappings.

**Tech Stack:** TypeScript 5.8, Cloudflare Workers/Wrangler, tRPC 11, React 19, Zod 4, Drizzle ORM/PostgreSQL, Vitest 3.

## Global Constraints

- Do not install or update dependencies.
- Do not start, rebuild or restart Docker services.
- Do not expose Nango Base URL, Secret Key, fixed Integration Keys or credentials to the browser or logs.
- Keep mailbox-level `authorization_binding.nango_provider_config_key`.
- Remove the development-template `integration.channel_mapping` table without adding a timeline migration.
- Preserve unrelated untracked `node-compile-cache/` and `update-check/` directories.
- Write failing tests before each production behavior change.

---

### Task 1: Fixed-Key Nango Channel Runtime

**Files:**

- Create: `apps/server/src/integrations/nango/channels.ts`
- Modify: `apps/server/src/integrations/nango/client.ts`
- Modify: `apps/server/src/integrations/nango/errors.ts`
- Modify: `apps/server/src/integrations/nango/runtime.ts`
- Modify: `apps/server/src/integrations/nango/service.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Test: `apps/server/tests/unit/integrations/nango/channels.test.ts`
- Test: `apps/server/tests/unit/integrations/nango/client.test.ts`
- Test: `apps/server/tests/unit/integrations/nango/service.test.ts`
- Test: `apps/server/tests/architecture/no-mail-provider-env.test.ts`
- Test: `apps/server/tests/architecture/nango-credential-boundary.test.ts`

**Interfaces:**

- Produces:

```ts
export type NangoChannelRuntimeStatus =
  | { state: 'unconfigured'; checkedAt: Date; errorCode: 'NANGO_CHANNEL_KEY_MISSING' }
  | { state: 'available'; checkedAt: Date; errorCode: null }
  | {
      state: 'unavailable';
      checkedAt: Date;
      errorCode:
        | NangoRuntimeErrorCode
        | 'NANGO_INTEGRATION_NOT_FOUND'
        | 'NANGO_PROVIDER_MISMATCH';
    };

export interface NangoChannelIntegrationService {
  initialize(): Promise<void>;
  getStatus(channelId: MailChannelId): Promise<NangoChannelRuntimeStatus>;
  requireIntegrationKey(channelId: MailChannelId): Promise<string>;
}

export const getNangoChannelServiceForEnvironment = (
  environment: NangoEnvironment,
): NangoChannelIntegrationService;
```

- `NangoClient.validateAccess()` returns the validated `NangoIntegration[]`.
- `NangoIntegrationService` caches the startup Integration list and returns a defensive copy from `listIntegrations()`.

- [ ] **Step 1: Write fixed-key resolver tests**

Cover all four environment-variable mappings, missing/blank keys, exact key lookup, Provider mismatch, unavailable global runtime, one-time initialization and `requireIntegrationKey()` rejection.

- [ ] **Step 2: Run resolver tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/nango/channels.test.ts
```

Expected: FAIL because `integrations/nango/channels.ts` does not exist.

- [ ] **Step 3: Write Nango client/service cache tests**

Assert `validateAccess()` returns the Integration list and `NangoIntegrationService.listIntegrations()` reuses the startup result without a second client request.

- [ ] **Step 4: Run client/service tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/nango/client.test.ts tests/unit/integrations/nango/service.test.ts
```

Expected: FAIL because `validateAccess()` currently returns `void` and the service does not cache Integrations.

- [ ] **Step 5: Implement the fixed-key runtime**

Add the four optional `ZeroEnv` fields, pass them through Compose, return/cache startup Integrations, and implement a channel service that validates:

```ts
const environmentKeyByChannel = {
  gmail: 'NANGO_GMAIL_INTEGRATION_KEY',
  outlook: 'NANGO_OUTLOOK_INTEGRATION_KEY',
  zoho_mail: 'NANGO_ZOHO_MAIL_INTEGRATION_KEY',
  imap_smtp: 'NANGO_IMAP_SMTP_INTEGRATION_KEY',
} as const;
```

Validation must compare the matching Integration's `provider` with the channel plugin's `nangoProviders`.

- [ ] **Step 6: Run focused runtime tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/nango/channels.test.ts tests/unit/integrations/nango/client.test.ts tests/unit/integrations/nango/service.test.ts tests/architecture/no-mail-provider-env.test.ts tests/architecture/nango-credential-boundary.test.ts
```

Expected: PASS.

### Task 2: Replace Mapping Reads in Configuration and Binding

**Files:**

- Modify: `apps/server/src/integrations/gmail/channel-config-service.ts`
- Modify: `apps/server/src/integrations/mail-channel/channel-config-service.ts`
- Modify: `apps/server/src/modules/mail-accounts/runtime/nango.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/trpc/routes/integrations.ts`
- Delete: `apps/server/src/modules/mail-accounts/application/nango-channel-mapping.ts`
- Delete: `apps/server/tests/unit/modules/mail-accounts/application/nango-channel-mapping.test.ts`
- Test: `apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts`
- Test: `apps/server/tests/unit/integrations/mail-channel/channel-config-service.test.ts`
- Test: `apps/server/tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts`
- Test: `apps/server/tests/unit/trpc/routes/integrations.test.ts`
- Test: `apps/server/tests/architecture/gmail-connect-ui-boundary.test.ts`

**Interfaces:**

- Configuration services consume:

```ts
getNangoStatus(channelId: MailChannelId): Promise<NangoChannelRuntimeStatus>;
```

- `NangoRuntime` produces:

```ts
{
  client: Pick<NangoClient, 'listConnections' | 'getConnection'>;
  channels: NangoChannelIntegrationService;
  credentialRepository: NangoCredentialResolverOptions['repository'];
}
```

- Connection list and binding inputs remain `{ channelId, connectionId }`; the backend calls `runtime.channels.requireIntegrationKey(channelId)`.

- [ ] **Step 1: Change configuration tests to require fixed-key status**

Remove mapping fixtures and assert Nango is configured only when the channel runtime state is `available`. Assert safe responses contain neither `integrationId` nor `gmailIntegrationId`.

- [ ] **Step 2: Run configuration tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/integrations/mail-channel/channel-config-service.test.ts
```

Expected: FAIL because production services still call `getMapping()`.

- [ ] **Step 3: Change route boundary tests**

Assert `integrationsRouter` no longer exposes Integration-list or mapping mutations and `connectionsRouter` obtains the Integration Key from the server-owned channel service.

- [ ] **Step 4: Run route tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/trpc/routes/integrations.test.ts tests/architecture/gmail-connect-ui-boundary.test.ts
```

Expected: FAIL while old procedures and mapping reads remain.

- [ ] **Step 5: Replace mapping reads**

Make configuration status asynchronous, inject `getNangoChannelServiceForEnvironment(env)`, remove `integrationRepository` from `NangoRuntime`, and use:

```ts
const integrationKey = await runtime.channels.requireIntegrationKey(channelId);
```

for both safe Connection listing and binding. Continue passing the resolved key into
`bindNangoMailbox()` so mailbox authorization records retain `nangoProviderConfigKey`.

- [ ] **Step 6: Remove mapping application service and admin procedures**

Delete the mapping service and these tRPC procedures:

```text
listNangoGmailIntegrations
setNangoGmailIntegration
listNangoIntegrations
setNangoIntegration
```

- [ ] **Step 7: Run focused server tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/integrations/mail-channel/channel-config-service.test.ts tests/unit/modules/mail-accounts/application/bind-nango-mailbox.test.ts tests/unit/trpc/routes/integrations.test.ts tests/architecture/gmail-connect-ui-boundary.test.ts
```

Expected: PASS.

### Task 3: Remove Frontend Integration Selection

**Files:**

- Modify: `apps/mail/components/integrations/gmail-settings-dialog.tsx`
- Modify: `apps/mail/components/integrations/managed-channel-settings-dialog.tsx`
- Modify: `apps/server/tests/architecture/integrations-ui-boundary.test.ts`

**Interfaces:**

- The Gmail and managed-channel dialogs consume only safe per-channel Nango state.
- No browser call lists or mutates Nango Integration Keys.

- [ ] **Step 1: Change frontend architecture tests**

Assert the dialogs do not contain:

```text
listNangoGmailIntegrations
setNangoGmailIntegration
listNangoIntegrations
setNangoIntegration
Select a Gmail Integration
```

- [ ] **Step 2: Run the architecture test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/integrations-ui-boundary.test.ts
```

Expected: FAIL because both dialogs still render manual selectors.

- [ ] **Step 3: Remove selector state, queries, mutations and markup**

Keep the Nango authorization-source card and its safe state/error label. Remove the duplicate Nango authorization block, selector imports that become unused and mapping-specific toast messages.

- [ ] **Step 4: Run architecture and Mail type/build validation**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/integrations-ui-boundary.test.ts
pnpm --filter @zero/mail exec tsc --noEmit
```

Expected: PASS.

### Task 4: Remove the Obsolete Database Table

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/integrations/core/repository.ts`
- Modify: `apps/server/src/db/migrations/0000_steady_silver_centurion.sql`
- Modify: `apps/server/src/db/migrations/meta/0000_snapshot.json`
- Modify: `apps/server/tests/helpers/mail-core/schema-contract.ts`
- Modify: `apps/server/tests/unit/db/mail-channel-schema.test.ts`
- Modify: `apps/server/tests/unit/mail-core/schema-definition.test.ts`
- Modify: `apps/server/tests/unit/mail-core/__snapshots__/schema-structure-parity.test.ts.snap`
- Modify: `apps/server/tests/unit/modules/mail-accounts/application/connect-channel-oauth.test.ts`
- Modify: `apps/server/tests/unit/modules/mail-accounts/application/connect-gmail-oauth.test.ts`

**Interfaces:**

- `SystemIntegrationRepository` retains OAuth configuration/session operations and binding counts.
- `getMapping()`, `setMapping()` and `deleteMapping()` are removed.
- `authorizationBinding.nangoProviderConfigKey` remains unchanged.

- [ ] **Step 1: Change schema contract tests**

Remove `channelIntegrationMapping` from the expected integration tables and assert the generated structure has no `integration.channel_mapping`.

- [ ] **Step 2: Run schema tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/db/mail-channel-schema.test.ts tests/unit/mail-core/schema-definition.test.ts tests/unit/mail-core/schema-structure-parity.test.ts
```

Expected: FAIL while the table remains exported.

- [ ] **Step 3: Remove schema and repository mapping operations**

Delete the Drizzle table, SQL template block, snapshot table object, schema helper entry and obsolete mock methods. Do not alter `authorization_binding.nango_provider_config_key`.

- [ ] **Step 4: Run schema tests and update the intentional snapshot**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-core/schema-structure-parity.test.ts -u
pnpm --filter @zero/server exec vitest run tests/unit/db/mail-channel-schema.test.ts tests/unit/mail-core/schema-definition.test.ts tests/unit/mail-core/schema-structure-parity.test.ts
```

Expected: PASS with the single-table removal reflected in the snapshot.

### Task 5: Full Verification and Hygiene Review

**Files:**

- Modify only files already listed if verification reveals an in-scope defect.

- [ ] **Step 1: Scan for forbidden residue**

Run:

```powershell
git grep -n -I -E "channelIntegrationMapping|getMapping\\(|setMapping\\(|deleteMapping\\(|listNangoGmailIntegrations|setNangoGmailIntegration|listNangoIntegrations|setNangoIntegration|gmailIntegrationId|authorizationSources\\.nango\\.integrationId" -- apps packages
```

Expected: no matches.

- [ ] **Step 2: Run the complete Server unit and architecture suites**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit tests/architecture --exclude tests/unit/modules/mail-outbound/application/enqueue-submission.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run:

```powershell
pnpm --filter @zero/server exec tsc --noEmit
pnpm --filter @zero/mail exec tsc --noEmit
pnpm --filter @zero/server lint
pnpm --filter @zero/mail lint
```

Expected: PASS without warnings.

- [ ] **Step 4: Review the final diff**

Confirm:

- only fixed Server environment keys choose Nango Integrations;
- browser and database mapping surfaces are absent;
- mailbox-level Nango references remain;
- no dependency or lockfile changes occurred;
- cache directories remain untracked.
