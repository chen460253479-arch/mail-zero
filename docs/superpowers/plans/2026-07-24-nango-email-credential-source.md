# Nango Email Credential Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select an already-authorized Nango mailbox connection, bind it to an installed Zero mail channel, cache encrypted credentials until they near expiry, and use the existing channel plugin for all mail operations.

**Architecture:** A small server-only Nango HTTP client lists configured integrations and connections and reads one credential record. A Nango credential resolver stores only the Nango reference plus an encrypted credential snapshot, refreshes OAuth access tokens inside a 15-minute safety window, and invalidates once on 401. The frontend is a two-step channel/connection selector and never receives credentials or a Nango API key.

**Tech Stack:** TypeScript, native Fetch, Zod, Cloudflare Workers/Durable Objects, tRPC, Drizzle/PostgreSQL, React 19, TanStack Query, Vitest.

## Global Constraints

- This plan depends on completion of `2026-07-24-mail-channel-plugin-foundation.md`.
- Use native Fetch; do not add `@nangohq/node` unless a missing API capability is proven.
- Zero never initiates a Nango authorization flow in this plan.
- Zero never requests or stores a Nango-managed OAuth Refresh Token.
- The frontend never receives Nango credentials or the Nango API key.
- Show only the intersection of configured Nango integrations and registered operational mail channels.
- Do not add Outlook, Zoho Mail, or IMAP/SMTP placeholders to the channel registry.
- Use 2-space indentation, single quotes, semicolons, and a 100-character line width.
- Do not run project-wide lint or format commands.
- Write the failing test before each behavior change.
- Commit only the files named by the current task.

---

## File Structure

### New focused modules

- `apps/server/src/lib/nango/types.ts` — validated Nango response and safe-view schemas.
- `apps/server/src/lib/nango/client.ts` — server-only HTTP calls.
- `apps/server/src/lib/nango/client.test.ts` — HTTP, filtering, and error tests.
- `apps/server/src/lib/nango/channel-catalog.ts` — maps configured integrations to registered channels.
- `apps/server/src/lib/nango/channel-catalog.test.ts` — intersection tests.
- `apps/server/src/lib/credentials/nango.ts` — binding validation, encrypted cache, expiry refresh.
- `apps/server/src/lib/credentials/nango.test.ts` — cache, refresh, 401, and Basic credential tests.
- `apps/server/src/lib/nango/bind.ts` — identity verification and transactional binding policy.
- `apps/server/src/lib/nango/bind.test.ts` — duplicate and disconnected-mailbox tests.
- `apps/mail/components/connection/nango-connect-dialog.tsx` — two-step Nango selector.

### Existing modules changed

- `.env.example` — Nango server configuration.
- `apps/server/src/env.ts` — typed Nango variables.
- `apps/server/src/trpc/routes/connections.ts` — Nango catalog/list/bind procedures.
- `apps/server/src/lib/credentials/resolve.ts` — register the implemented Nango resolver.
- `apps/server/src/lib/driver/google.ts` — accept a current Access Token without requiring a Refresh Token.
- `apps/server/src/lib/driver/microsoft.ts` — no activation; update only if shared OAuth config typing requires it.
- `apps/mail/components/connection/add.tsx` — Nango card.
- `apps/mail/app/(routes)/settings/connections/page.tsx` — Nango auth-source display/status.
- `apps/mail/messages/en.json` — base-locale selector and errors.

---

### Task 1: Implement a typed, server-only Nango client

**Files:**
- Create: `apps/server/src/lib/nango/types.ts`
- Create: `apps/server/src/lib/nango/client.ts`
- Create: `apps/server/src/lib/nango/client.test.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `NangoClient`.
- Produces: `listIntegrations()`, `listConnections()`, `getConnection()`.

- [ ] **Step 1: Write HTTP contract tests**

```ts
it('sends the secret only in the Authorization header');
it('lists connections without credential fields');
it('filters connection summaries by integration ID on the server');
it('requires provider_config_key when reading one connection');
it('maps 424 to an invalid-credentials error');
it('redacts the response body from thrown errors');
```

Inject `fetch` into the client constructor and assert calls with `vi.fn()`.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango/client.test.ts
```

Expected: FAIL because the Nango modules do not exist.

- [ ] **Step 3: Define strict response schemas**

```ts
export const nangoIntegrationSchema = z.object({
  unique_key: z.string().min(1),
  display_name: z.string().min(1),
  provider: z.string().min(1),
});

export const nangoConnectionSummarySchema = z.object({
  connection_id: z.string().min(1),
  provider_config_key: z.string().min(1),
  provider: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  tags: z.record(z.string(), z.string()),
  errors: z.array(z.object({ type: z.string(), log_id: z.string() })),
});
```

Define a discriminated credential schema for `OAUTH2`, `BASIC`, and `CUSTOM`; allow unknown fields only
inside `raw`/custom payloads.

- [ ] **Step 4: Implement the native Fetch client**

```ts
export class NangoClient {
  constructor(
    private readonly config: {
      baseUrl: string;
      secretKey: string;
      fetch: typeof fetch;
    },
  ) {}
}
```

All requests use:

```ts
headers: { Authorization: `Bearer ${this.config.secretKey}` }
```

`getConnection()` calls:

```text
GET /connections/{connectionId}?provider_config_key={integrationId}
```

Do not add `refresh_token=true`.

The current HTTP list endpoint is treated as an environment-wide list. `listConnections()` filters
validated summaries by `provider_config_key` in the server client before returning them to callers.

- [ ] **Step 5: Add environment contracts**

```ts
NANGO_BASE_URL?: string;
NANGO_SECRET_KEY?: string;
```

`.env.example`:

```dotenv
# Optional: enables selection of existing Nango mailbox connections.
NANGO_BASE_URL=https://api.nango.dev
NANGO_SECRET_KEY=
```

When the key is absent, Nango is unavailable and the frontend card is omitted.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango/client.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit the client**

```bash
git add .env.example apps/server/src/env.ts apps/server/src/lib/nango
git commit -m "feat: add typed Nango connection client"
```

---

### Task 2: Build the operational channel catalog

**Files:**
- Create: `apps/server/src/lib/nango/channel-catalog.ts`
- Create: `apps/server/src/lib/nango/channel-catalog.test.ts`
- Modify: `apps/server/src/lib/mail-channel/types.ts`

**Interfaces:**
- Produces: `listAvailableNangoChannels(integrations, channels)`.
- Adds optional `nangoProviders: readonly string[]` to a registered channel.

- [ ] **Step 1: Write intersection tests**

```ts
it('shows Gmail when Nango has Google Mail and Gmail is registered');
it('does not show Zoho when no Zoho channel plugin is registered');
it('does not expose non-mail Nango integrations');
it('deduplicates multiple Nango integrations for one channel while preserving integration IDs');
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango/channel-catalog.test.ts
```

Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Add explicit provider aliases to real plugins**

For Gmail:

```ts
nangoProviders: ['google-mail', 'google'],
```

Do not create a global guessed-provider map. Each operational plugin owns its aliases.

- [ ] **Step 4: Implement the intersection**

Return:

```ts
type AvailableNangoChannel = {
  channelId: MailChannelId;
  displayName: string;
  integrations: Array<{
    integrationId: string;
    displayName: string;
  }>;
};
```

Sort by display name for deterministic UI output.

- [ ] **Step 5: Run the catalog tests**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango/channel-catalog.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the catalog**

```bash
git add apps/server/src/lib/nango/channel-catalog.ts apps/server/src/lib/nango/channel-catalog.test.ts apps/server/src/lib/mail-channel
git commit -m "feat: map Nango integrations to mail channels"
```

---

### Task 3: Add the encrypted Nango credential resolver and expiry cache

**Files:**
- Create: `apps/server/src/lib/credentials/nango.ts`
- Create: `apps/server/src/lib/credentials/nango.test.ts`
- Modify: `apps/server/src/lib/credentials/resolve.ts`
- Modify: `apps/server/src/lib/driver/google.ts`

**Interfaces:**
- Produces: `resolveNangoCredential(record, now): Promise<ResolvedCredential>`.
- Produces: `invalidateNangoCredential(connectionId)`.

- [ ] **Step 1: Write cache policy tests**

```ts
it('uses an encrypted OAuth access token outside the 15-minute safety window');
it('fetches Nango when the access token expires within 15 minutes');
it('never requests a refresh token');
it('stores the refreshed access token and expiry atomically');
it('deduplicates concurrent refreshes for one authorization binding');
it('refetches Basic credentials after an authentication failure');
```

Use fake timers and an injected repository/Nango client.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/nango.test.ts
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement the refresh decision**

```ts
const refreshWindowMs = 15 * 60 * 1000;

export const shouldRefresh = (expiresAt: Date | null, now: Date) =>
  expiresAt !== null && expiresAt.getTime() - now.getTime() <= refreshWindowMs;
```

An absent OAuth snapshot also refreshes. Basic credentials have no time-based refresh.

- [ ] **Step 4: Implement one distributed refresh lock per binding**

The repository method runs a PostgreSQL advisory lock inside the refresh transaction:

```sql
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));
```

After acquiring the lock, re-read the snapshot and expiry. If another request already refreshed it,
return that value without calling Nango. Otherwise call Nango and update the snapshot before
committing. A small module-private Promise map may reduce same-isolate waits, but it is not the
correctness boundary.

- [ ] **Step 5: Make Gmail accept Nango access-token-only credentials**

Set both available values:

```ts
this.auth.setCredentials({
  access_token: config.auth.accessToken || undefined,
  refresh_token: config.auth.refreshToken || undefined,
  scope: this.getScope(),
});
```

Do not make the Google driver refresh a Nango token; the resolver supplies a fresh Access Token.

- [ ] **Step 6: Register only the completed resolver**

```ts
const resolvers = {
  zero_oauth: resolveZeroOAuthCredential,
  nango: resolveNangoCredential,
} satisfies Partial<Record<AuthSource, CredentialResolver>>;
```

- [ ] **Step 7: Run focused tests and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/nango.test.ts src/lib/credentials/resolve.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit credential resolution**

```bash
git add apps/server/src/lib/credentials apps/server/src/lib/driver/google.ts
git commit -m "feat: resolve cached Nango mailbox credentials"
```

---

### Task 4: Implement safe Nango browse and bind procedures

**Files:**
- Create: `apps/server/src/lib/nango/bind.ts`
- Create: `apps/server/src/lib/nango/bind.test.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Produces tRPC procedures: `connections.nangoChannels`, `connections.nangoConnections`,
  `connections.bindNango`.
- Produces: `bindNangoMailbox(input)`.

- [ ] **Step 1: Write binding-policy tests**

```ts
it('verifies the mailbox identity through the selected channel');
it('rejects an already-connected normalized email');
it('reuses a disconnected mailbox only when email and channel both match');
it('rejects a Nango connection already bound elsewhere');
it('does not persist anything when identity verification fails');
it('returns safe connection summaries without credentials');
it('resolves a missing display email without exposing credentials');
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango/bind.test.ts
```

Expected: FAIL because `bind.ts` does not exist.

- [ ] **Step 3: Add safe browse procedures**

Inputs:

```ts
const nangoConnectionsInput = z.object({
  channelId: z.enum(mailChannelIds),
  integrationId: z.string().min(1),
});
```

Before listing, verify that the selected integration belongs to the registered channel. Map the
response to:

```ts
{
  connectionId,
  integrationId,
  email,
  displayName,
  authorizationStatus,
}
```

Never spread a Nango response into the tRPC result.

Resolve display email in this order:

1. `tags.end_user_email`;
2. `metadata.email` or `metadata.emailAddress`;
3. fetch that one connection's credentials and call `channel.resolveIdentity()`.

Limit fallback identity requests to five concurrent calls. The returned tRPC object still contains
only the safe fields above.

- [ ] **Step 4: Resolve authoritative identity before binding**

On bind:

1. Fetch exactly one Nango connection with credentials.
2. Convert credentials through the selected channel.
3. Call `channel.resolveIdentity(driver)`.
4. Normalize the returned email.
5. Run duplicate and disconnected-mailbox checks.
6. Encrypt the credential snapshot.
7. Create the binding transactionally.

- [ ] **Step 5: Map exact domain errors**

Use:

```text
MAILBOX_ALREADY_CONNECTED
NANGO_CONNECTION_ALREADY_BOUND
NANGO_CONNECTION_INVALID
MAIL_CHANNEL_UNAVAILABLE
MAILBOX_IDENTITY_MISMATCH
```

Map user-fixable conflicts to tRPC `CONFLICT`/`PRECONDITION_FAILED`; do not return Nango bodies.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango/bind.test.ts src/lib/nango/client.test.ts
pnpm --dir apps/server exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit browse and bind APIs**

```bash
git add apps/server/src/lib/nango apps/server/src/trpc/routes/connections.ts apps/server/src/main.ts
git commit -m "feat: bind existing Nango mailbox connections"
```

---

### Task 5: Add the two-step Connect Email Nango selector

**Files:**
- Create: `apps/mail/components/connection/nango-connect-dialog.tsx`
- Modify: `apps/mail/components/connection/add.tsx`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx`
- Modify: `apps/mail/messages/en.json`

**Interfaces:**
- Consumes: `connections.nangoChannels`, `connections.nangoConnections`,
  `connections.bindNango`.

- [ ] **Step 1: Add the Nango card only when enabled**

Extend the connection settings response with `nangoEnabled`. Render a `Plug`-icon Nango card only
when true. Clicking it opens the selector; it never calls `linkSocial()`.

- [ ] **Step 2: Implement the channel screen**

Render one button per safe channel response. Selecting a channel stores:

```ts
type SelectedChannel = {
  channelId: MailChannelId;
  integrationId: string;
};
```

If a channel has multiple integration IDs, show each integration display name as a separate choice.

- [ ] **Step 3: Implement the connection screen**

Fetch only after a channel is selected. Display:

```text
email
displayName
authorizationStatus
```

Disable invalid connections. Do not render Connection IDs as primary labels.

- [ ] **Step 4: Bind and refresh local state**

On Save, call `bindNango`, close the dialog on success, invalidate
`connections.list/getDefault`, and show the existing connection success toast. On
`MAILBOX_ALREADY_CONNECTED`, show a specific duplicate-mailbox message.

- [ ] **Step 5: Add base-locale copy**

Add keys for:

```text
Use an existing Nango authorization
Choose a mail channel
Choose an authorized mailbox
No authorized mailboxes found
This mailbox is already connected
Connection needs attention in Nango
```

Use the base locale fallback for untranslated locales; do not bulk-edit unrelated translations.

- [ ] **Step 6: Run frontend typecheck and build**

Run:

```bash
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
```

Expected: PASS.

- [ ] **Step 7: Commit the selector**

```bash
git add apps/mail/components/connection apps/mail/app/\(routes\)/settings/connections/page.tsx apps/mail/messages/en.json
git commit -m "feat: select existing Nango mailbox authorization"
```

---

### Task 6: Recover once from stale tokens and expose reconnect state

**Files:**
- Modify: `apps/server/src/lib/driver/types.ts`
- Modify: `apps/server/src/lib/credentials/nango.ts`
- Create: `apps/server/src/lib/credentials/retrying-client.ts`
- Modify: `apps/server/src/trpc/trpc.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx`
- Create: `apps/server/src/lib/credentials/nango-retry.test.ts`

**Interfaces:**
- Produces: `createRetryingMailClient({ createClient, refreshCredential, classifyError })`.

- [ ] **Step 1: Write retry tests**

```ts
it('invalidates Nango cache and retries once after 401');
it('does not retry a second 401');
it('does not refresh on 403 missing scope');
it('marks reconnect_required after refresh failure');
it('uses a still-valid cached token when Nango is temporarily unavailable');
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/nango-retry.test.ts
```

Expected: FAIL because the retry wrapper does not exist.

- [ ] **Step 3: Implement a concise MailClient proxy with one-retry behavior**

```ts
export const createRetryingMailClient = <T extends MailClient>(options: RetryOptions<T>): T => {
  let client = options.createClient(options.initialCredential);
  return new Proxy(client, {
    get(_target, property) {
      const value = client[property as keyof T];
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          return await Reflect.apply(value, client, args);
        } catch (error) {
          if (!options.classifyError(error).unauthorized) throw error;
          const credential = await options.refreshCredential();
          client = options.createClient(credential);
          const retry = client[property as keyof T];
          return Reflect.apply(retry as Function, client, args);
        }
      };
    },
  }) as T;
};
```

No loop or recursive retry is allowed. `connectionToDriver()` applies this proxy only to Nango
bindings; Zero OAuth clients remain unchanged.

- [ ] **Step 4: Persist health state**

On unrecoverable auth failure, set mailbox status to `reconnect_required`. `connections.list`
returns that state and the UI displays a badge directing the user to repair the connection in Nango,
then remove/re-add authorization in Zero.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/credentials/nango.test.ts src/lib/credentials/nango-retry.test.ts
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/mail exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit retry and health state**

```bash
git add apps/server/src/lib/credentials apps/server/src/trpc apps/mail/app/\(routes\)/settings/connections/page.tsx
git commit -m "feat: recover stale Nango mailbox credentials"
```

---

### Task 7: End-to-end verification and security guard

**Files:**
- Create: `apps/server/tests/nango-credential-boundary.test.ts`
- Modify: only files required by failed focused checks

**Interfaces:**
- Verifies the complete Gmail + Nango existing-connection path.

- [ ] **Step 1: Add a static credential boundary test**

Test that:

```ts
expect(frontendSource).not.toMatch(/NANGO_SECRET_KEY|access_token|refresh_token/);
expect(nangoClientSource).not.toMatch(/refresh_token=true/);
expect(connectionRouterSource).not.toMatch(/credentials:\\s*connection\\.credentials/);
```

Also assert the Nango delete API path is absent from the local disconnect implementation.

- [ ] **Step 2: Run all focused server tests**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/nango src/lib/credentials tests/nango-credential-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typechecks and frontend build**

Run:

```bash
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
```

Expected: PASS.

- [ ] **Step 4: Run targeted formatting and lint checks**

Run:

```bash
pnpm exec prettier --check apps/server/src/lib/nango apps/server/src/lib/credentials/nango.ts apps/server/src/trpc/routes/connections.ts apps/mail/components/connection/nango-connect-dialog.tsx apps/mail/components/connection/add.tsx
pnpm --dir apps/server exec eslint src/lib/nango src/lib/credentials/nango.ts src/trpc/routes/connections.ts
```

Expected: PASS without touching unrelated files.

- [ ] **Step 5: Manually verify the supported happy path**

With a test Nango Gmail connection:

```text
Connect Email -> Nango -> Gmail -> authorized email -> Save
```

Expected:

- the mailbox appears once;
- the database stores the Nango reference and encrypted snapshot;
- no Refresh Token is stored;
- Gmail list/read/send uses the Gmail channel plugin;
- disconnecting with retained data does not delete the Nango Connection.

- [ ] **Step 6: Commit the guard**

```bash
git add apps/server/tests/nango-credential-boundary.test.ts
git commit -m "test: guard Nango mailbox credential boundary"
```
