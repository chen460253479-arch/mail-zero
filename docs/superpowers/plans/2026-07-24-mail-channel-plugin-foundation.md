# Mail Channel Plugin Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Gmail-centric mail stack into a channel registry with a stable mailbox identity, a separate authorization binding, and Gmail as the first fully registered channel without changing Gmail behavior.

**Architecture:** A `MailboxChannel` registry owns provider-specific driver construction, identity, scopes, capabilities, and sync hooks. The stable `connection` row owns mailbox identity and lifecycle; a one-to-one `authorizationBinding` owns encrypted credentials and immutable authorization source. Existing Gmail code remains the concrete implementation and is moved behind the registry rather than duplicated.

**Tech Stack:** TypeScript, Cloudflare Workers/Durable Objects, tRPC, Drizzle/PostgreSQL, React 19, TanStack Query, Vitest.

## Global Constraints

- Use 2-space indentation, single quotes, semicolons, and a 100-character line width.
- Do not run project-wide lint or format commands.
- Do not add empty plugin classes, compatibility wrappers with no consumer, or speculative channels.
- Register only Gmail in this plan; Outlook, Zoho Mail, and IMAP/SMTP require separately tested plugins.
- Preserve existing connection IDs and Gmail behavior during migration.
- Keep provider-specific types out of provider-neutral registry and lifecycle modules.
- Write the failing test before each behavior change.
- Commit only the files named by the current task.

---

## File Structure

### New focused modules

- `apps/server/src/lib/mail-channel/types.ts` — channel IDs, capabilities, credential shapes, and the `MailboxChannel` contract.
- `apps/server/src/lib/mail-channel/registry.ts` — the registered-channel map and exact lookup functions.
- `apps/server/src/lib/mail-channel/gmail.ts` — Gmail registration using the existing Google driver.
- `apps/server/src/lib/mail-channel/registry.test.ts` — registry and capability contract tests.
- `apps/server/src/lib/credentials/encryption.ts` — authenticated encryption for credential snapshots.
- `apps/server/src/lib/credentials/encryption.test.ts` — encryption round-trip and invalid-key tests.
- `apps/server/src/lib/credentials/zero-oauth.ts` — reads and writes Zero-managed OAuth snapshots.
- `apps/server/src/lib/credentials/zero-oauth.test.ts` — credential mapping tests.
- `apps/server/src/lib/mail-channel/gmail-sync.ts` — Gmail push/history adapter extracted from the core pipeline.
- `apps/server/src/lib/mail-channel/gmail-sync.test.ts` — adapter routing tests.
- `apps/mail/components/connection/disconnect-dialog.tsx` — disconnect/retain/delete interaction.

### Existing modules changed

- `apps/server/src/db/schema.ts` — stable mailbox fields and one-to-one authorization table.
- `apps/server/src/db/migrations/*` — generated schema migration plus explicit data backfill.
- `apps/server/src/types.ts` — replace provider enum use in shared payloads with `MailChannelId`.
- `apps/server/src/lib/driver/types.ts` — separate mail operations from authorization lifecycle.
- `apps/server/src/lib/driver/index.ts` — delegate driver construction to the channel registry.
- `apps/server/src/lib/auth.ts` — create/update authorization bindings after Better Auth OAuth.
- `apps/server/src/lib/server-utils.ts` — resolve a connection plus authorization before driver creation.
- `apps/server/src/main.ts` — transactional mailbox and authorization persistence methods.
- `apps/server/src/pipelines.ts` — delegate Gmail-specific push/history behavior to Gmail channel code.
- `apps/server/src/trpc/routes/connections.ts` — lifecycle endpoints and safe connection response fields.
- `apps/mail/hooks/use-connections.ts` — consume channel/status data.
- `apps/mail/types/index.ts` — expose `channelId`, `authSource`, and connection status.
- `apps/mail/app/(routes)/settings/connections/page.tsx` — use the explicit disconnect dialog.
- `apps/mail/components/ui/nav-main.tsx` and related provider branches — use capabilities/channel IDs.
- `apps/mail/messages/en.json` — base-locale disconnect and retained-data copy.

---

### Task 1: Define the minimal channel contract and Gmail registry

**Files:**
- Create: `apps/server/src/lib/mail-channel/types.ts`
- Create: `apps/server/src/lib/mail-channel/registry.ts`
- Create: `apps/server/src/lib/mail-channel/gmail.ts`
- Create: `apps/server/src/lib/mail-channel/registry.test.ts`
- Modify: `apps/server/src/lib/driver/index.ts`

**Interfaces:**
- Produces: `MailChannelId`, `MailCapability`, `ResolvedCredential`, `MailboxChannel`.
- Produces: `getMailChannel(id)`, `listMailChannels()`, `providerIdToChannelId(providerId)`.
- Consumes: existing `GoogleMailManager` and `ManagerConfig`.

- [ ] **Step 1: Write the failing registry tests**

```ts
import { describe, expect, it } from 'vitest';

import { getMailChannel, listMailChannels, providerIdToChannelId } from './registry';

describe('mail channel registry', () => {
  it('registers only channels that are operational', () => {
    expect(listMailChannels().map(({ id }) => id)).toEqual(['gmail']);
  });

  it('maps the legacy Google provider to Gmail', () => {
    expect(providerIdToChannelId('google')).toBe('gmail');
  });

  it('rejects unknown channels instead of returning a partial plugin', () => {
    expect(() => getMailChannel('zoho_mail')).toThrow('Unsupported mail channel');
  });
});
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel/registry.test.ts
```

Expected: FAIL because `./registry` does not exist.

- [ ] **Step 3: Add the exact channel contract**

```ts
import type { MailClient, ManagerConfig } from '../driver/types';

export const mailChannelIds = ['gmail', 'outlook', 'zoho_mail', 'imap_smtp'] as const;
export type MailChannelId = (typeof mailChannelIds)[number];

export const mailCapabilities = [
  'read_messages',
  'send_messages',
  'drafts',
  'attachments',
  'labels',
  'threads',
  'push_sync',
] as const;
export type MailCapability = (typeof mailCapabilities)[number];

export type OAuth2Credential = {
  type: 'oauth2';
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date | null;
  scope: string;
};

export type BasicCredential = {
  type: 'basic';
  username: string;
  password: string;
  host: string;
  port: number;
  secure: boolean;
};

export type ResolvedCredential = OAuth2Credential | BasicCredential;

export interface MailboxChannel {
  id: MailChannelId;
  displayName: string;
  capabilities: ReadonlySet<MailCapability>;
  createClient(config: ManagerConfig): MailClient;
  resolveIdentity(
    config: ManagerConfig,
  ): Promise<{ email: string; name: string; picture: string }>;
  getScope(config: ManagerConfig): string;
  revoke(config: ManagerConfig, token: string): Promise<boolean>;
}
```

- [ ] **Step 4: Register Gmail without adding unused channels**

```ts
import { GoogleMailManager } from '../driver/google';
import type { MailboxChannel } from './types';

export const gmailChannel: MailboxChannel = {
  id: 'gmail',
  displayName: 'Gmail',
  capabilities: new Set([
    'read_messages',
    'send_messages',
    'drafts',
    'attachments',
    'labels',
    'threads',
    'push_sync',
  ]),
  createClient: (config) => new GoogleMailManager(config),
  resolveIdentity: (config) => new GoogleMailManager(config).getUserInfo(),
  getScope: (config) => new GoogleMailManager(config).getScope(),
  revoke: (config, token) => new GoogleMailManager(config).revokeToken(token),
};
```

```ts
import { gmailChannel } from './gmail';
import type { MailboxChannel, MailChannelId } from './types';

const channels = new Map<MailChannelId, MailboxChannel>([['gmail', gmailChannel]]);

export const listMailChannels = () => Array.from(channels.values());

export const getMailChannel = (id: MailChannelId | (string & {})) => {
  const channel = channels.get(id as MailChannelId);
  if (!channel) throw new Error(`Unsupported mail channel: ${id}`);
  return channel;
};

export const providerIdToChannelId = (providerId: string): MailChannelId => {
  if (providerId === 'google') return 'gmail';
  if (providerId === 'microsoft') return 'outlook';
  throw new Error(`Unsupported provider: ${providerId}`);
};
```

Update `createDriver()` to call `getMailChannel().createClient()` and remove the duplicate provider
map.

- [ ] **Step 5: Run the focused tests**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel/registry.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit the registry**

```bash
git add apps/server/src/lib/mail-channel apps/server/src/lib/driver/index.ts
git commit -m "refactor: add mail channel registry"
```

---

### Task 2: Separate mailbox identity from authorization state

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: generated files under `apps/server/src/db/migrations/`
- Create: `apps/server/src/lib/mail-channel/mailbox-identity.ts`
- Create: `apps/server/src/lib/mail-channel/mailbox-identity.test.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Produces: `normalizeMailboxEmail(email: string): string`.
- Produces: `authorizationBinding` Drizzle table.
- Produces: `createMailboxWithAuthorization()` and `findConnectionWithAuthorization()`.

- [ ] **Step 1: Write normalization and uniqueness-policy tests**

```ts
import { describe, expect, it } from 'vitest';

import { normalizeMailboxEmail } from './mailbox-identity';

describe('normalizeMailboxEmail', () => {
  it('normalizes case and whitespace only', () => {
    expect(normalizeMailboxEmail('  User.Name+tag@GMAIL.com ')).toBe(
      'user.name+tag@gmail.com',
    );
  });

  it('rejects an empty mailbox identity', () => {
    expect(() => normalizeMailboxEmail('   ')).toThrow('Mailbox email is required');
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel/mailbox-identity.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalization**

```ts
export const normalizeMailboxEmail = (email: string) => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('Mailbox email is required');
  return normalized;
};
```

- [ ] **Step 4: Add stable mailbox and authorization schemas**

Change `connection` to own:

```ts
channelId: text('channel_id').$type<MailChannelId>().notNull(),
normalizedEmail: text('normalized_email').notNull(),
status: text('status')
  .$type<'connected' | 'disconnected' | 'reconnect_required' | 'deleting'>()
  .notNull()
  .default('connected'),
disconnectedAt: timestamp('disconnected_at'),
```

Add a one-to-one table:

```ts
export const authorizationBinding = createTable(
  'authorization_binding',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id')
      .notNull()
      .unique()
      .references(() => connection.id, { onDelete: 'cascade' }),
    authSource: text('auth_source').$type<'zero_oauth' | 'nango' | 'manual'>().notNull(),
    credentialType: text('credential_type').$type<'oauth2' | 'basic' | 'custom'>().notNull(),
    encryptedCredentialSnapshot: text('encrypted_credential_snapshot'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    credentialFetchedAt: timestamp('credential_fetched_at'),
    nangoConnectionId: text('nango_connection_id'),
    nangoProviderConfigKey: text('nango_provider_config_key'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [
    unique().on(table.nangoProviderConfigKey, table.nangoConnectionId),
    index('authorization_connection_id_idx').on(table.connectionId),
  ],
);
```

Replace the existing email uniqueness rule with:

```ts
unique().on(t.userId, t.normalizedEmail)
```

- [ ] **Step 5: Generate and edit the migration for a lossless backfill**

Run:

```bash
pnpm db:generate
```

Expected: one new numbered SQL migration and matching Drizzle metadata.

In the generated SQL, order operations as follows:

```sql
ALTER TABLE "mail0_connection" ADD COLUMN "channel_id" text;
ALTER TABLE "mail0_connection" ADD COLUMN "normalized_email" text;
ALTER TABLE "mail0_connection" ADD COLUMN "status" text DEFAULT 'connected';
UPDATE "mail0_connection"
SET "channel_id" = CASE "provider_id"
  WHEN 'google' THEN 'gmail'
  WHEN 'microsoft' THEN 'outlook'
END,
"normalized_email" = lower(trim("email"));
```

Create `mail0_authorization_binding` with nullable snapshot/fetched-at fields and insert one
`zero_oauth` binding for every existing connection. Make the new mailbox identity columns non-null,
but keep the snapshot nullable and keep legacy token columns until Task 4 has switched runtime
reads. This is an expand migration and remains compatible with the current runtime.

- [ ] **Step 6: Add transactional data-access methods**

Add methods that return an explicit joined shape:

```ts
type ConnectionWithAuthorization = {
  connection: typeof connection.$inferSelect;
  authorization: typeof authorizationBinding.$inferSelect | null;
};
```

`findConnectionWithAuthorization(userId, connectionId)` must filter by both IDs. Creation must
normalize the email and let the database unique constraint resolve concurrent duplicate attempts.

- [ ] **Step 7: Add a migration preflight for disabled legacy channels**

Before applying the contract migration, count legacy rows whose provider is not currently
registered. The migration command must stop with:

```text
Cannot contract mail provider columns: unregistered legacy channel connections exist
```

This prevents an old Microsoft row from becoming unreadable before the Outlook plugin is completed.

- [ ] **Step 8: Run focused tests and server typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel/mailbox-identity.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: both PASS.

- [ ] **Step 9: Commit the data model**

```bash
git add apps/server/src/db apps/server/src/lib/mail-channel/mailbox-identity.ts apps/server/src/lib/mail-channel/mailbox-identity.test.ts apps/server/src/main.ts
git commit -m "refactor: separate mailbox identity from authorization"
```

---

### Task 3: Encrypt and backfill Zero-managed OAuth credentials

**Files:**
- Create: `apps/server/src/lib/credentials/encryption.ts`
- Create: `apps/server/src/lib/credentials/encryption.test.ts`
- Create: `apps/server/src/lib/credentials/zero-oauth.ts`
- Create: `apps/server/src/lib/credentials/zero-oauth.test.ts`
- Create: `apps/server/src/db/backfill-authorization-bindings.ts`
- Create: `apps/server/src/db/backfill-authorization-bindings.test.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `.env.example`
- Modify: `apps/server/package.json`

**Interfaces:**
- Produces: `encryptCredential(value, key)`, `decryptCredential(payload, key)`.
- Produces: `createZeroOAuthSnapshot()` and `readZeroOAuthSnapshot()`.

- [ ] **Step 1: Write encryption tests**

```ts
import { describe, expect, it } from 'vitest';

import { decryptCredential, encryptCredential } from './encryption';

const key = Buffer.alloc(32, 7).toString('base64');

describe('credential encryption', () => {
  it('round-trips a credential without exposing plaintext', async () => {
    const encrypted = await encryptCredential({ accessToken: 'secret' }, key);
    expect(encrypted).not.toContain('secret');
    await expect(decryptCredential(encrypted, key)).resolves.toEqual({
      accessToken: 'secret',
    });
  });

  it('rejects keys that are not 32 bytes', async () => {
    await expect(encryptCredential({ value: 'x' }, 'bad')).rejects.toThrow(
      'CREDENTIAL_ENCRYPTION_KEY',
    );
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/encryption.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement AES-256-GCM using Web Crypto**

Use a versioned JSON envelope:

```ts
type EncryptedEnvelope = {
  version: 1;
  iv: string;
  ciphertext: string;
};
```

Import the base64-decoded 32-byte key with `{ name: 'AES-GCM' }`, generate a 12-byte IV, and encode
the envelope as JSON. `decryptCredential()` must reject any version other than `1`.

- [ ] **Step 4: Add typed Zero OAuth snapshot mapping**

```ts
export type ZeroOAuthSnapshot = {
  type: 'oauth2';
  accessToken: string;
  refreshToken: string;
  scope: string;
};

export const createZeroOAuthSnapshot = (input: Omit<ZeroOAuthSnapshot, 'type'>) => ({
  type: 'oauth2' as const,
  ...input,
});
```

The read function validates with Zod before returning the snapshot.

- [ ] **Step 5: Add the encryption secret contract**

Add to `ZeroEnv`:

```ts
CREDENTIAL_ENCRYPTION_KEY: string;
```

Add to `.env.example`:

```dotenv
# Base64-encoded 32-byte key used to encrypt mailbox credentials.
CREDENTIAL_ENCRYPTION_KEY=
```

Do not add a real secret to `wrangler.jsonc`.

- [ ] **Step 6: Write the failing backfill policy tests**

```ts
it('encrypts every legacy OAuth credential into its authorization binding');
it('skips a binding that already has an encrypted snapshot');
it('fails before writing when a legacy connection has no authorization binding');
it('reports matching source and populated binding counts');
```

- [ ] **Step 7: Implement the application-level backfill**

Export a testable function:

```ts
export const backfillAuthorizationBindings = async ({
  repository,
  encryptionKey,
}: BackfillDependencies): Promise<{ sourceCount: number; populatedCount: number }> => {
  const rows = await repository.listLegacyOAuthConnections();
  await repository.assertBindingsExist(rows.map(({ id }) => id));
  let populatedCount = 0;
  for (const row of rows) {
    if (row.encryptedCredentialSnapshot) {
      populatedCount += 1;
      continue;
    }
    const snapshot = await encryptCredential(
      createZeroOAuthSnapshot({
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        scope: row.scope,
      }),
      encryptionKey,
    );
    await repository.saveSnapshot(row.authorizationId, snapshot, row.expiresAt);
    populatedCount += 1;
  }
  return { sourceCount: rows.length, populatedCount };
};
```

Add this server script:

```json
"db:backfill-mail-auth": "tsx src/db/backfill-authorization-bindings.ts"
```

The executable reads `DATABASE_URL` and `CREDENTIAL_ENCRYPTION_KEY`, prints counts only, and exits
non-zero when source and populated counts differ. It never prints credential values.

- [ ] **Step 8: Run focused tests and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/encryption.test.ts src/lib/credentials/zero-oauth.test.ts src/db/backfill-authorization-bindings.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit encrypted credential storage and backfill**

```bash
git add .env.example apps/server/package.json apps/server/src/env.ts apps/server/src/lib/credentials apps/server/src/db
git commit -m "feat: encrypt mailbox authorization credentials"
```

---

### Task 4: Route OAuth ingestion and driver creation through the new boundaries

**Files:**
- Modify: `apps/server/src/lib/auth.ts`
- Modify: `apps/server/src/lib/server-utils.ts`
- Modify: `apps/server/src/lib/driver/types.ts`
- Modify: `apps/server/src/routes/agent/index.ts`
- Modify: `apps/server/src/main.ts`
- Create: `apps/server/src/lib/credentials/resolve.ts`
- Create: `apps/server/src/lib/credentials/resolve.test.ts`

**Interfaces:**
- Produces: `resolveConnectionCredential(binding): Promise<ResolvedCredential>`.
- Produces: async `connectionToDriver(connectionWithAuthorization)`.

- [ ] **Step 1: Write credential resolution tests**

Test these exact cases:

```ts
it('resolves zero_oauth through the encrypted snapshot');
it('rejects a disconnected mailbox');
it('rejects a mailbox without an authorization binding');
it('rejects an auth source that has no registered resolver');
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/resolve.test.ts
```

Expected: FAIL because `resolve.ts` does not exist.

- [ ] **Step 3: Implement a resolver map with only real sources**

```ts
const resolvers = {
  zero_oauth: resolveZeroOAuthCredential,
} satisfies Partial<Record<AuthSource, CredentialResolver>>;
```

Do not register `nango` or `manual` until their resolver exists.

- [ ] **Step 4: Make OAuth account linking persist both records atomically**

In `connectionHandlerHook`, map Better Auth `providerId` through
`providerIdToChannelId()`, resolve the channel identity, encrypt the snapshot, and call one database
method that upserts the mailbox plus its `zero_oauth` authorization. Do not write tokens to the
mailbox row.

- [ ] **Step 5: Make driver construction authorization-source agnostic**

```ts
export const connectionToDriver = async (record: ConnectionWithAuthorization) => {
  const credential = await resolveConnectionCredential(record);
  const channel = getMailChannel(record.connection.channelId);
  if (credential.type !== 'oauth2') {
    throw new Error(`Credential ${credential.type} is not supported by ${channel.id}`);
  }
  return channel.createClient({
    auth: {
      userId: record.connection.userId,
      email: record.connection.email,
      accessToken: credential.accessToken,
      refreshToken: credential.refreshToken ?? '',
    },
  });
};
```

Update the Zero Agent initialization to await this function.

- [ ] **Step 6: Split authorization methods out of the mail-operation interface**

Rename the operational interface to `MailClient`. Keep the existing concrete driver methods, but
remove `getTokens`, `getUserInfo`, `getScope`, and `revokeToken` from the operational interface;
those methods are accessed through the channel registration during OAuth lifecycle operations.

- [ ] **Step 7: Run the credential backfill before contracting the schema**

Run:

```bash
pnpm --dir apps/server db:backfill-mail-auth
```

Expected: the command reports equal source and populated binding counts and does not print secrets.

- [ ] **Step 8: Add the contract migration**

After runtime reads and OAuth writes use `authorizationBinding`, modify the schema so
`encryptedCredentialSnapshot` and `credentialFetchedAt` are non-null, remove legacy
`accessToken`, `refreshToken`, `scope`, `expiresAt`, and `providerId` columns from `connection`, then
run:

```bash
pnpm db:generate
```

Expected: a second migration that only adds the final not-null constraints and drops the five
legacy columns. Do not combine it with the expand migration from Task 2.

- [ ] **Step 9: Run focused tests and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/resolve.test.ts src/lib/mail-channel/registry.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 10: Commit the runtime boundary**

```bash
git add apps/server/src/lib/auth.ts apps/server/src/lib/server-utils.ts apps/server/src/lib/driver apps/server/src/lib/credentials apps/server/src/routes/agent/index.ts apps/server/src/main.ts
git commit -m "refactor: resolve mail drivers through channel credentials"
```

---

### Task 5: Move Gmail sync behavior behind the Gmail channel

**Files:**
- Create: `apps/server/src/lib/mail-channel/sync-types.ts`
- Create: `apps/server/src/lib/mail-channel/gmail-sync.ts`
- Create: `apps/server/src/lib/mail-channel/gmail-sync.test.ts`
- Modify: `apps/server/src/lib/mail-channel/gmail.ts`
- Modify: `apps/server/src/lib/mail-channel/types.ts`
- Modify: `apps/server/src/lib/driver/types.ts`
- Modify: `apps/server/src/lib/driver/google.ts`
- Modify: `apps/server/src/routes/agent/index.ts`
- Modify: `apps/server/src/pipelines.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/env.ts`

**Interfaces:**
- Produces: `ChannelPushEvent`, `ChannelChangeSet`, `ChannelSyncAdapter`.
- Gmail produces: `parsePushEvent()` and provider-neutral `listChanges()`.

- [ ] **Step 1: Write adapter tests with Gmail fixtures**

```ts
it('parses a Gmail history notification into a provider-neutral push event');
it('rejects a push payload without a history ID');
it('returns changed message IDs and the next cursor');
```

Use a small fixture containing only `emailAddress` and `historyId`; do not copy full Gmail responses.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel/gmail-sync.test.ts
```

Expected: FAIL because `gmail-sync.ts` does not exist.

- [ ] **Step 3: Define provider-neutral sync values**

```ts
export type ChannelPushEvent = {
  mailbox: string;
  cursor: string;
};

export type ChannelChange = {
  remoteMessageId: string;
  remoteThreadId: string;
  addedLabelIds: string[];
  removedLabelIds: string[];
  deleted: boolean;
};

export interface ChannelSyncAdapter {
  parsePushEvent(payload: unknown): ChannelPushEvent;
}

export type ChannelChangeSet = {
  changes: ChannelChange[];
  nextCursor: string;
};
```

- [ ] **Step 4: Extract Gmail-only parsing and history mapping**

Move Gmail push parsing into `gmail-sync.ts` and register it as `gmailChannel.sync`. Replace
`MailClient.listHistory<T>()` with:

```ts
listChanges(cursor: string): Promise<ChannelChangeSet>;
```

Implement this method in `GoogleMailManager`; Gmail API types and history mapping stay inside the
Google driver and return only `ChannelChangeSet`. Update the Zero Agent forwarding method from
`listHistory<T>()` to `listChanges()`.

- [ ] **Step 5: Replace provider branches with registry dispatch**

The core pipeline should perform:

```ts
const channel = getMailChannel(foundConnection.channelId);
if (!channel.sync) {
  return yield* Effect.fail({
    _tag: 'UnsupportedSyncChannel' as const,
    channelId: channel.id,
  });
}
const result = await agent.listChanges(cursor);
```

Remove direct imports of `gmail_v1` from `pipelines.ts`. Rename provider-neutral KV access helpers
to `mail_sync_cursor` and `mail_sync_locks`; keep the physical Cloudflare bindings unchanged in this
plan if renaming bindings would require infrastructure migration.

- [ ] **Step 6: Run adapter, pipeline, and type checks**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel/gmail-sync.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS and no `gmail_v1` import in `pipelines.ts`.

- [ ] **Step 7: Commit sync extraction**

```bash
git add apps/server/src/lib/mail-channel apps/server/src/pipelines.ts apps/server/src/main.ts apps/server/src/env.ts
git commit -m "refactor: isolate Gmail sync behind channel plugin"
```

---

### Task 6: Implement explicit disconnect, retention, and manual cleanup

**Files:**
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/main.ts`
- Create: `apps/server/src/lib/connection-lifecycle.ts`
- Create: `apps/server/src/lib/connection-lifecycle.test.ts`
- Create: `apps/mail/components/connection/disconnect-dialog.tsx`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx`
- Modify: `apps/mail/types/index.ts`
- Modify: `apps/mail/messages/en.json`

**Interfaces:**
- Produces: `disconnectAuthorization({ connectionId, deleteLocalData })`.
- Produces tRPC mutations: `connections.disconnect`, `connections.deleteRetainedData`.

- [ ] **Step 1: Write lifecycle tests**

```ts
it('disconnects by deleting credentials and retaining mailbox data');
it('marks the mailbox deleting before destructive cleanup');
it('does not delete a Nango connection when removing a local binding');
it('allows retained data cleanup only for a disconnected mailbox');
it('does not expose an operation that updates authSource in place');
```

Use injected repository and cleanup functions so the policy test does not require a live database.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/connection-lifecycle.test.ts
```

Expected: FAIL because the lifecycle module does not exist.

- [ ] **Step 3: Implement lifecycle orchestration**

The non-destructive path must execute in this order:

```ts
await stopMailboxTasks(connection);
await removeAuthorizationBinding(connection.id);
await markDisconnected(connection.id, new Date());
```

The destructive path must mark `deleting`, stop work, delete the binding, invoke idempotent cleanup
for SQL summaries/style, per-connection Durable Object data, KV cursors/locks, attachments, and then
delete the mailbox row.

- [ ] **Step 4: Replace the ambiguous delete mutation**

Use an explicit input:

```ts
z.object({
  connectionId: z.string().uuid(),
  deleteLocalData: z.boolean(),
});
```

Return `{ status: 'disconnected' | 'deleted' }`. Keep Nango deletion out of the lifecycle service.

- [ ] **Step 5: Add the focused dialog**

The checkbox defaults to false. Button copy must be:

```text
Disconnect and keep data
Disconnect and delete data
```

Only disconnected rows show `Delete retained local data`. Connected rows never show the cleanup
entry.

- [ ] **Step 6: Run server tests and frontend typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/connection-lifecycle.test.ts
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/mail exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit connection lifecycle**

```bash
git add apps/server/src/trpc/routes/connections.ts apps/server/src/main.ts apps/server/src/lib/connection-lifecycle.ts apps/server/src/lib/connection-lifecycle.test.ts apps/mail/components/connection/disconnect-dialog.tsx "apps/mail/app/(routes)/settings/connections/page.tsx" apps/mail/types/index.ts apps/mail/messages/en.json
git commit -m "feat: add explicit mailbox disconnect lifecycle"
```

---

### Task 7: Remove remaining product-layer provider checks and verify Gmail

**Files:**
- Modify: `apps/mail/components/mail/mail.tsx`
- Modify: `apps/mail/components/ui/nav-main.tsx`
- Modify: `apps/mail/components/ui/recursive-folder.tsx`
- Modify: `apps/mail/components/ui/sidebar-labels.tsx`
- Modify: `apps/server/src/trpc/routes/ai/search.ts`
- Modify: any remaining core file reported by the focused search

**Interfaces:**
- Consumes: `channelId` and channel capability values returned by `connections.list/getDefault`.

- [ ] **Step 1: Add capabilities to safe connection responses**

Return:

```ts
{
  id,
  email,
  name,
  picture,
  channelId,
  status,
  authSource,
  capabilities: Array.from(getMailChannel(channelId).capabilities),
}
```

- [ ] **Step 2: Replace UI provider checks**

Use capabilities for labels, folders, drafts, and push-specific affordances. Use `channelId` only
for channel-specific copy or icon selection.

- [ ] **Step 3: Run a focused coupling search**

Run:

```bash
git grep -n -I -E "providerId === ['\"]google['\"]|EProviders\\.google|gmail_v1" -- apps/mail apps/server/src/pipelines.ts apps/server/src/trpc
```

Expected: no product-layer or core-pipeline matches. Matches inside Gmail plugin/driver files are
allowed.

- [ ] **Step 4: Run targeted verification**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/mail-channel src/lib/credentials src/lib/connection-lifecycle.test.ts
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
```

Expected: all commands PASS.

- [ ] **Step 5: Run targeted formatting and lint checks**

Run Prettier and ESLint only on files changed by this plan:

```bash
pnpm exec prettier --check apps/server/src/lib/mail-channel apps/server/src/lib/credentials apps/server/src/lib/connection-lifecycle.ts apps/server/src/trpc/routes/connections.ts apps/mail/components/connection apps/mail/app/\(routes\)/settings/connections/page.tsx
pnpm --dir apps/server exec eslint src/lib/mail-channel src/lib/credentials src/lib/connection-lifecycle.ts src/trpc/routes/connections.ts
```

Expected: PASS without modifying unrelated files.

- [ ] **Step 6: Commit final provider-neutral cleanup**

```bash
git add apps/mail apps/server/src
git commit -m "refactor: make mail product flows channel neutral"
```
