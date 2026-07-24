# Administrator Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an administrator-only Integrations page that stores Nango and Gmail mailbox OAuth configuration in the database, removes Google social login, and presents Zero OAuth and Nango as two authorization sources under one Gmail connection entry.

**Architecture:** A typed system-integration repository owns encrypted database configuration and validation sessions. Integration services validate candidates before atomically replacing active configuration, while mail-channel runtime factories receive configuration explicitly instead of reading provider secrets from `env`. Administrator tRPC routes manage configuration; dedicated Hono routes handle OAuth redirects and callbacks.

**Tech Stack:** TypeScript, Hono, tRPC, Drizzle/PostgreSQL, Better Auth credentials sessions, Google OAuth2, Nango HTTP API, React Router, TanStack Query, Zod, Vitest.

## Global Constraints

- Only `role === 'admin'` may read or mutate system integration configuration.
- `CREDENTIAL_ENCRYPTION_KEY` remains the only integration secret supplied by environment.
- Nango Base URL and Gmail Client ID may be stored as typed public configuration; Nango Secret Key, Gmail Client Secret, and validation candidates must be encrypted.
- Never return saved secrets, ciphertext, provider tokens, OAuth state, or raw provider errors to the browser.
- Nango and Gmail mailbox OAuth configuration use the database as their only runtime source; do not add environment fallbacks.
- Current UI exposes Gmail only; do not create Outlook, Zoho, or IMAP/SMTP placeholders.
- Existing mailbox identity, duplicate-binding, disconnect, retained-data, Nango token-cache, and one-retry rules remain unchanged.
- No in-place authorization-source changes.
- Use TDD for every behavior change and commit each independently testable task.

---

### Task 1: Typed System Integration Persistence

**Files:**

- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/migrations/0040_admin_integrations.sql`
- Create: `apps/server/src/db/migrations/meta/0040_snapshot.json`
- Modify: `apps/server/src/db/migrations/meta/_journal.json`
- Create: `apps/server/src/lib/integrations/schemas.ts`
- Create: `apps/server/src/lib/integrations/repository.ts`
- Create: `apps/server/src/lib/integrations/repository.test.ts`

**Interfaces:**

- Produces `IntegrationKey = 'nango' | 'gmail_zero_oauth'`.
- Produces `SystemIntegrationRepository` with `get`, `saveActive`, `delete`, validation-session, mapping, and binding-count methods.
- Later tasks consume `parsePublicConfig(key, value)` and repository records without accessing raw JSON directly.

- [ ] **Step 1: Write failing schema and repository tests**

```ts
it('parses public configuration by integration key', () => {
  expect(parsePublicConfig('nango', { baseUrl: 'https://api.nango.dev' })).toEqual({
    baseUrl: 'https://api.nango.dev',
  });
  expect(parsePublicConfig('gmail_zero_oauth', { clientId: 'client-id' })).toEqual({
    clientId: 'client-id',
  });
});

it('never exposes encrypted secrets from safe records', () => {
  expect(toSafeIntegration(record)).toEqual({
    configured: true,
    key: 'nango',
    publicConfig: { baseUrl: 'https://api.nango.dev' },
    secretConfigured: true,
    status: 'active',
    validatedAt,
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/repository.test.ts
```

Expected: FAIL because the integration schema and repository do not exist.

- [ ] **Step 3: Add strongly typed tables**

Add Drizzle tables equivalent to:

```ts
export const systemIntegrationConfig = createTable('system_integration_config', {
  id: text('id').primaryKey(),
  integrationKey: text('integration_key').$type<'nango' | 'gmail_zero_oauth'>().notNull().unique(),
  publicConfig: jsonb('public_config').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  status: text('status').$type<'active' | 'error'>().notNull(),
  validatedAt: timestamp('validated_at').notNull(),
  updatedBy: text('updated_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const channelIntegrationMapping = createTable(
  'channel_integration_mapping',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').$type<MailChannelId>().notNull(),
    authSource: text('auth_source').$type<'nango'>().notNull(),
    externalIntegrationId: text('external_integration_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (table) => [unique().on(table.channelId, table.authSource)],
);

export const integrationOAuthSession = createTable('integration_oauth_session', {
  id: text('id').primaryKey(),
  integrationKey: text('integration_key').$type<'gmail_zero_oauth'>().notNull(),
  purpose: text('purpose').$type<'validate_config' | 'connect_mailbox'>().notNull(),
  encryptedPayload: text('encrypted_payload').notNull(),
  stateHash: text('state_hash').notNull().unique(),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').notNull(),
});
```

- [ ] **Step 4: Implement typed schemas and repository**

Use a discriminated map, not unconstrained JSON:

```ts
export const integrationPublicSchemas = {
  nango: z.object({ baseUrl: z.string().url() }),
  gmail_zero_oauth: z.object({ clientId: z.string().min(1) }),
} satisfies Record<IntegrationKey, z.ZodTypeAny>;

export const parsePublicConfig = <K extends IntegrationKey>(
  key: K,
  value: unknown,
): IntegrationPublicConfig<K> => integrationPublicSchemas[key].parse(value);
```

Repository writes must be transactional for active-config replacement, validation-session consumption, and mapping updates.

- [ ] **Step 5: Generate and inspect migration**

Run:

```bash
pnpm --dir apps/server db:generate --name admin_integrations
```

Expected: `0040_admin_integrations.sql` creates the three tables, both foreign keys, the unique integration key, unique state hash, and unique `(channel_id, auth_source)` mapping.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/repository.test.ts
git add apps/server/src/db apps/server/src/lib/integrations
git commit -m "feat: persist encrypted system integrations"
```

Expected: tests PASS.

---

### Task 2: Administrator Authorization Boundary

**Files:**

- Modify: `apps/server/src/trpc/trpc.ts`
- Create: `apps/server/src/lib/integrations/permissions.ts`
- Create: `apps/server/src/lib/integrations/permissions.test.ts`
- Modify: `apps/mail/config/navigation.ts`
- Modify: `apps/mail/app/(routes)/settings/layout.tsx`

**Interfaces:**

- Produces `adminProcedure`.
- Produces `assertAdministrator(sessionUser): void`.
- UI consumes session role only for navigation visibility; server authorization remains authoritative.

- [ ] **Step 1: Write failing permission tests**

```ts
it('rejects a non-admin session', () => {
  expect(() => assertAdministrator({ id: 'user-1', role: 'user' })).toThrow('ADMIN_REQUIRED');
});

it('accepts an administrator session', () => {
  expect(() => assertAdministrator({ id: 'admin-1', role: 'admin' })).not.toThrow();
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/permissions.test.ts
```

Expected: FAIL because `assertAdministrator` does not exist.

- [ ] **Step 3: Implement server middleware**

```ts
export const assertAdministrator = (user: { role?: string | null }) => {
  if (user.role !== 'admin') throw new IntegrationPermissionError('ADMIN_REQUIRED');
};

export const adminProcedure = privateProcedure.use(async ({ ctx, next }) => {
  assertAdministrator(ctx.sessionUser);
  return next({ ctx });
});
```

- [ ] **Step 4: Add UI route guard and admin-only navigation metadata**

Extend `NavItem` with `adminOnly?: boolean`, mark `/settings/integrations`, and filter the item using the current session. The settings loader must redirect non-admin users away from `/settings/integrations`, but it must not be treated as the security boundary.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/permissions.test.ts
git add apps/server/src/trpc/trpc.ts apps/server/src/lib/integrations apps/mail/config/navigation.ts apps/mail/app/(routes)/settings/layout.tsx
git commit -m "feat: restrict integration settings to administrators"
```

---

### Task 3: Nango Database Configuration and Mapping

**Files:**

- Create: `apps/server/src/lib/integrations/nango-service.ts`
- Create: `apps/server/src/lib/integrations/nango-service.test.ts`
- Modify: `apps/server/src/lib/nango/client.ts`
- Modify: `apps/server/src/lib/nango/client.test.ts`
- Modify: `apps/server/src/lib/credentials/nango-runtime.ts`
- Modify: `apps/server/src/lib/server-utils.ts`
- Modify: `apps/server/src/trpc/routes/connections.ts`

**Interfaces:**

- Produces `NangoIntegrationService.getSafeConfig`, `validateAndSave`, `listGmailIntegrations`, `setGmailMapping`, and `delete`.
- Produces `withConfiguredNango(run)` that loads and decrypts the active database configuration.
- Connections code no longer accepts an Integration ID supplied independently of the active Gmail mapping.

- [ ] **Step 1: Write failing service tests**

Cover:

```ts
it('keeps the old config when candidate permission validation fails');
it('requires integrations, connections, and credential read permission before initial save');
it('forbids Base URL changes while Nango bindings exist');
it('allows secret rotation only after every bound reference is readable');
it('forbids mapping changes and deletion while bindings exist');
it('returns safe state without the secret or ciphertext');
```

- [ ] **Step 2: Run red tests**

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/nango-service.test.ts
```

- [ ] **Step 3: Implement candidate validation**

```ts
type NangoCandidate = { baseUrl: string; secretKey: string };

const validateCandidate = async (
  candidate: NangoCandidate,
  references: Array<{ integrationId: string; connectionId: string }>,
) => {
  const client = new NangoClient({ ...candidate, fetch });
  const integrations = await client.listIntegrations();
  const testReferences =
    references.length > 0 ? references : await findCredentialTestReference(client, integrations);
  await mapWithConcurrency(testReferences, 5, ({ integrationId, connectionId }) =>
    client.getConnection(connectionId, integrationId),
  );
  return integrations;
};
```

Map provider exceptions to stable errors such as `NANGO_PERMISSION_VALIDATION_FAILED`, `NANGO_TEST_CONNECTION_REQUIRED`, and `INTEGRATION_IN_USE`.

- [ ] **Step 4: Replace env-backed runtime**

`withNangoCredentialResolver` must load `systemIntegrationConfig('nango')`, decrypt the Secret with `CREDENTIAL_ENCRYPTION_KEY`, and construct `NangoClient`. Remove `baseUrl` and `secretKey` parameters from callers.

Connections routes must derive `provider_config_key` from `channelIntegrationMapping(gmail, nango)` and reject a browser-supplied mismatch.

- [ ] **Step 5: Run Nango regression tests**

```bash
pnpm --dir apps/server exec vitest run src/lib/nango src/lib/credentials/nango.test.ts src/lib/integrations/nango-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lib/integrations apps/server/src/lib/nango apps/server/src/lib/credentials apps/server/src/lib/server-utils.ts apps/server/src/trpc/routes/connections.ts
git commit -m "feat: manage Nango configuration in the database"
```

---

### Task 4: Dynamic Gmail OAuth Test and Mailbox Authorization

**Files:**

- Create: `apps/server/src/lib/integrations/gmail-oauth-service.ts`
- Create: `apps/server/src/lib/integrations/gmail-oauth-service.test.ts`
- Create: `apps/server/src/routes/integrations.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/lib/driver/google.ts`
- Modify: `apps/server/src/lib/mail-channel/gmail.ts`
- Modify: `apps/server/src/lib/mail-channel/types.ts`
- Modify: `apps/server/src/lib/server-utils.ts`

**Interfaces:**

- Produces `GmailOAuthService.startValidation`, `completeValidation`, `startMailboxAuthorization`, and `completeMailboxAuthorization`.
- Produces `GmailOAuthRuntimeConfig = { clientId: string; clientSecret: string; redirectUri: string }`.
- Gmail channel client creation consumes explicit OAuth runtime configuration.

- [ ] **Step 1: Write failing OAuth state-machine tests**

Tests must cover:

```ts
it('stores only a state hash and encrypted payload');
it('rejects an expired, consumed, mismatched, or non-admin validation callback');
it('promotes the candidate only after token exchange and Gmail profile succeed');
it('revokes validation tokens and creates no mailbox binding');
it('keeps the active config when validation fails');
it('creates a zero_oauth binding only after authoritative Gmail identity resolution');
```

- [ ] **Step 2: Run red tests**

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/gmail-oauth-service.test.ts
```

- [ ] **Step 3: Implement high-entropy, one-time validation sessions**

```ts
const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
const stateHash = await sha256(state);
const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
```

For `validate_config`, encrypt `{ clientId, clientSecret }`. For `connect_mailbox`, encrypt the Gmail connection intent and bind it to the current user. Store only `stateHash`, bind every session to its initiating user, and atomically consume it before exchanging the authorization code.

- [ ] **Step 4: Implement dedicated redirect routes**

Mount under `/api/integrations`:

```text
GET /gmail/validation/start
GET /gmail/validation/callback
GET /gmail/connect/start
GET /gmail/connect/callback
```

Validation callback revokes tokens and redirects to `/settings/integrations?gmailValidation=success|error`. Mailbox callback creates the existing `Mailbox Connection + Authorization Binding` transaction and redirects to `/settings/connections`.

- [ ] **Step 5: Inject Gmail OAuth configuration**

Remove `env.GOOGLE_CLIENT_ID` and `env.GOOGLE_CLIENT_SECRET` reads from `GoogleMailManager`. Construct its `OAuth2Client` from `GmailOAuthRuntimeConfig`; Nango-backed clients may omit client credentials because they use an Access Token only, while Zero OAuth refresh/revoke paths must use the active Gmail configuration.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm --dir apps/server exec vitest run src/lib/integrations/gmail-oauth-service.test.ts src/lib/mail-channel/gmail.test.ts src/lib/credentials
git add apps/server/src/lib/integrations apps/server/src/routes/integrations.ts apps/server/src/main.ts apps/server/src/lib/driver/google.ts apps/server/src/lib/mail-channel apps/server/src/lib/server-utils.ts
git commit -m "feat: add database-backed Gmail mailbox OAuth"
```

---

### Task 5: Remove Google Social Login and Provider Environment Configuration

**Files:**

- Modify: `apps/server/src/lib/auth.ts`
- Delete: `apps/server/src/lib/auth-providers.ts`
- Modify: `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/env.ts`
- Modify: `.env.example`
- Modify: `apps/mail/app/(auth)/login/page.tsx`
- Modify: `apps/mail/lib/auth-client.ts`
- Create: `apps/server/tests/no-mail-provider-env.test.ts`

**Interfaces:**

- Better Auth retains credentials/admin authentication and unrelated plugins.
- No Google or Microsoft social provider remains.
- Gmail mailbox OAuth is available only through Task 4 routes.

- [ ] **Step 1: Write failing static boundary test**

```ts
it('contains no mailbox provider configuration environment variables', () => {
  for (const file of runtimeAndExampleFiles) {
    expect(read(file)).not.toMatch(
      /\b(NANGO_BASE_URL|NANGO_SECRET_KEY|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_ID|MICROSOFT_CLIENT_SECRET)\b/,
    );
  }
});

it('does not register Google or Microsoft social login', () => {
  expect(read('apps/server/src/lib/auth.ts')).not.toContain('socialProviders');
  expect(read('apps/mail/app/(auth)/login/page.tsx')).not.toContain('signIn.social');
});
```

- [ ] **Step 2: Run red test**

```bash
pnpm --dir apps/server exec vitest run tests/no-mail-provider-env.test.ts
```

- [ ] **Step 3: Remove shared social-mail OAuth path**

Delete `getSocialProviders`, the Better Auth account-create mailbox hook, Google login UI, public provider environment reporting, and provider secret Env fields. Preserve credential login, admin bootstrap, existing users, existing account rows, and mailbox data.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --dir apps/server exec vitest run tests/no-mail-provider-env.test.ts tests/create-admin-config.test.ts
git add -A -- .env.example apps/server/src/lib/auth.ts apps/server/src/lib/auth-providers.ts apps/server/src/routes/auth.ts apps/server/src/env.ts apps/mail/app/'(auth)'/login/page.tsx apps/mail/lib/auth-client.ts apps/server/tests
git commit -m "refactor: remove Google social login configuration"
```

---

### Task 6: Administrator Integration API

**Files:**

- Create: `apps/server/src/trpc/routes/integrations.ts`
- Create: `apps/server/src/trpc/routes/integrations.test.ts`
- Modify: `apps/server/src/trpc/index.ts`

**Interfaces:**

- Produces the administrator tRPC procedures from the approved spec.
- Consumes Task 2 `adminProcedure`, Task 3 `NangoIntegrationService`, and Task 4 `GmailOAuthService`.

- [ ] **Step 1: Write failing router tests**

Use caller tests to prove:

```ts
it('rejects every integration query and mutation for a non-admin');
it('overview returns only safe fields and binding counts');
it('blank secret preserves the existing encrypted secret');
it('Nango save, mapping, and delete return stable domain errors');
it('Gmail validation start returns only a redirect URL and session status');
```

- [ ] **Step 2: Run red tests**

```bash
pnpm --dir apps/server exec vitest run src/trpc/routes/integrations.test.ts
```

- [ ] **Step 3: Implement the router**

Expose:

```ts
export const integrationsRouter = router({
  getOverview: adminProcedure.query(...),
  validateAndSaveNango: adminProcedure.input(nangoCandidateSchema).mutation(...),
  deleteNango: adminProcedure.mutation(...),
  listNangoGmailIntegrations: adminProcedure.query(...),
  setNangoGmailIntegration: adminProcedure.input(mappingSchema).mutation(...),
  startGmailValidation: adminProcedure.input(gmailCandidateSchema).mutation(...),
  getGmailValidationStatus: adminProcedure.input(sessionIdSchema).query(...),
  deleteGmailZeroOAuth: adminProcedure.mutation(...),
});
```

Return `CONFLICT` for in-use configuration, `PRECONDITION_FAILED` for validation failures, and never use provider messages as tRPC messages.

- [ ] **Step 4: Register, verify, and commit**

```bash
pnpm --dir apps/server exec vitest run src/trpc/routes/integrations.test.ts
git add apps/server/src/trpc
git commit -m "feat: expose administrator integration management API"
```

---

### Task 7: Administrator Integrations Page

**Files:**

- Create: `apps/mail/app/(routes)/settings/integrations/page.tsx`
- Create: `apps/mail/components/integrations/nango-settings-card.tsx`
- Create: `apps/mail/components/integrations/gmail-oauth-settings-card.tsx`
- Modify: `apps/mail/app/routes.ts`
- Modify: `apps/mail/config/navigation.ts`
- Modify: `apps/mail/messages/en.json`

**Interfaces:**

- Consumes `trpc.integrations.*`.
- Never receives or renders saved Secret values.

- [ ] **Step 1: Add server response and route-guard boundary tests before UI code**

Required assertions:

```text
non-admin route redirects
configured Secret renders only “Secret Key configured”
blank Secret update retains current value
in-use config disables destructive actions and shows mailbox count
Gmail validation popup reports success, refusal, close, and timeout
```

- [ ] **Step 2: Build focused cards**

`NangoSettingsCard` owns Base URL, optional replacement Secret, validation/save state, Gmail Integration dropdown, usage count, and guarded delete.

`GmailOAuthSettingsCard` owns Client ID, optional replacement Secret, fixed Redirect URL, validation popup/session polling, usage count, and guarded delete.

Do not place both forms in the route file; the page composes the two cards and owns query invalidation only.

- [ ] **Step 3: Add admin route and navigation**

Register `/settings/integrations`, add translated navigation copy, and show the item only to administrators. Direct navigation by non-admin must redirect even though the server also rejects API access.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
git add apps/mail/app apps/mail/components/integrations apps/mail/config/navigation.ts apps/mail/messages/en.json
git commit -m "feat: add administrator integration settings"
```

If the repository-wide commands fail only on known baseline errors, record the full output and verify that no changed file appears in the diagnostics.

---

### Task 8: Unified Gmail Connection Entry

**Files:**

- Create: `apps/mail/components/connection/gmail-connect-dialog.tsx`
- Modify: `apps/mail/components/connection/add.tsx`
- Delete: `apps/mail/components/connection/nango-connect-dialog.tsx`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx`
- Modify: `apps/server/src/trpc/routes/connections.ts`
- Modify: `apps/mail/messages/en.json`

**Interfaces:**

- Produces one Gmail card with automatic authorization-source routing.
- Server returns `{ zeroOAuthAvailable, nangoAvailable, nangoConnections }` without credentials.

- [ ] **Step 1: Write failing server routing tests**

Cover all four combinations:

```ts
expect(options(false, false)).toEqual({ mode: 'unconfigured' });
expect(options(true, false)).toEqual({ mode: 'zero_oauth' });
expect(options(false, true)).toEqual({ mode: 'nango' });
expect(options(true, true)).toEqual({ mode: 'choose' });
```

Also assert that a client cannot override the configured Gmail Nango Integration ID.

- [ ] **Step 2: Implement safe authorization options**

Replace `nangoChannels` and browser-selected Integration IDs with Gmail-specific endpoints that read active system configuration:

```text
connections.getGmailAuthorizationOptions
connections.listNangoGmailConnections
connections.bindNango
```

`bindNango` accepts only `connectionId`; channel and Integration mapping are resolved server-side.

- [ ] **Step 3: Replace the standalone Nango card**

Clicking Gmail:

- starts Zero OAuth immediately when it is the only source;
- opens Nango list immediately when it is the only source;
- shows “Authorize new Gmail” plus Nango-marked existing connections when both exist;
- shows a clear administrator-configuration message when neither exists.

The Nango icon is presentation metadata only; every saved binding remains `channel = gmail`, `auth_source = nango`.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --dir apps/server exec vitest run src/trpc/routes/connections.test.ts src/lib/nango/bind.test.ts
pnpm --dir apps/mail exec tsc --noEmit
git add -A -- apps/mail/components/connection apps/mail/app/'(routes)'/settings/connections apps/mail/messages/en.json apps/server/src/trpc/routes/connections.ts
git commit -m "feat: unify Gmail authorization source selection"
```

---

### Task 9: Security, Migration, and End-to-End Verification

**Files:**

- Modify: `apps/server/tests/nango-credential-boundary.test.ts`
- Modify: `apps/server/tests/no-mail-provider-env.test.ts`
- Create: `apps/server/tests/integration-config-boundary.test.ts`
- Modify: `docs/superpowers/specs/2026-07-24-admin-integrations-design.md` only if implementation reveals a necessary, approved clarification

**Interfaces:**

- Final verification only; no new runtime abstraction.

- [ ] **Step 1: Add static and behavioral security boundaries**

Assert:

```text
frontend source contains none of the provider Secret field names or ciphertext fields
integration query outputs contain no encryptedSecret/encryptedPayload/stateHash
runtime source contains no removed provider environment variables
local mailbox disconnect never deletes a Nango Connection
Google validation callback cannot create a mailbox
mailbox OAuth callback cannot promote system configuration
```

- [ ] **Step 2: Run the complete focused suite**

```bash
pnpm --dir apps/server exec vitest run \
  src/lib/integrations \
  src/lib/nango \
  src/lib/credentials \
  src/lib/mail-channel \
  src/trpc/routes/integrations.test.ts \
  src/trpc/routes/connections.test.ts \
  tests/nango-credential-boundary.test.ts \
  tests/no-mail-provider-env.test.ts \
  tests/integration-config-boundary.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run formatting, type checks, and build**

```bash
pnpm exec prettier --check \
  "apps/server/src/lib/integrations/**/*.{ts,tsx}" \
  "apps/server/src/trpc/routes/integrations.ts" \
  "apps/server/src/routes/integrations.ts" \
  "apps/mail/app/(routes)/settings/integrations/page.tsx" \
  "apps/mail/components/integrations/**/*.tsx" \
  "apps/mail/components/connection/**/*.tsx"

pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/mail exec tsc --noEmit
pnpm --dir apps/mail build
```

Expected: changed files have no TypeScript diagnostics and the frontend build completes. Any pre-existing repository-wide diagnostics must be reported separately and not described as feature failures.

- [ ] **Step 4: Inspect migration and secret boundary**

```bash
git diff --check
git status --short
git diff --stat HEAD~9..HEAD
```

Manually confirm no migration contains Secret literals, no API response spreads database config rows, and no logger receives candidate config or provider responses.

- [ ] **Step 5: Commit final test hardening**

```bash
git add apps/server/tests docs/superpowers/specs
git commit -m "test: enforce integration configuration boundaries"
```
