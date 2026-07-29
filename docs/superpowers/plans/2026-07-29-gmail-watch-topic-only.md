# Gmail Watch Topic-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gmail Inbox Watch administrator flow require only a fully qualified Pub/Sub Topic name while preserving the fixed Webhook and existing idempotent incremental-sync pipeline.

**Architecture:** The Gmail channel `providerConfig` is reduced to `{ topicName?: string }`, matching Nango `watch-mailbox` and Gmail `users.watch`. The fixed Webhook accepts and structurally validates the standard Pub/Sub envelope without Subscription/OIDC configuration, then emits only a local synchronization signal for bound Gmail accounts.

**Tech Stack:** TypeScript 5.8, React 19, Zod 3/4, Hono, Vitest 3, Gmail API, PostgreSQL-backed mail-sync repository.

## Global Constraints

- The administrator configures only `projects/{project-id}/topics/{topic-name}`.
- Do not add Gmail Pub/Sub environment variables.
- Do not create or manage Google Cloud Topic or Subscription resources.
- Keep the Webhook URL fixed and read-only in the Gmail configuration dialog.
- Do not add label-filter configuration in this change.
- Do not change scheduled synchronization, manual synchronization, Watch renewal, authorization selection or Gmail outbound behavior.
- Invalid Webhook payloads must be acknowledged with `204` and must not record a signal.
- Webhook notifications may only wake the existing Gmail incremental-sync pipeline; they must not write message content directly.
- Preserve the uncommitted Server immutable-runtime work, the user's `.env.example` change, and untracked `node-compile-cache/` and `update-check/`.
- Do not create implementation commits or push unless the user explicitly requests it.

---

### Task 1: Lock the Topic-Only Configuration Contract

**Files:**

- Modify: `apps/server/tests/unit/mail-channel/gmail/config.test.ts`
- Modify: `apps/mail/modules/integrations/gmail-config.test.ts`
- Modify: `apps/server/tests/architecture/integrations-ui-boundary.test.ts`

**Interfaces:**

- Consumes: `parseGmailChannelConfig()`, `getGmailConfigErrors()`, and the Gmail settings source.
- Produces: executable assertions that only `topicName` remains in Gmail Watch configuration.

- [ ] **Step 1: Change the backend configuration test**

Replace the complete-Pub/Sub expectation with a Topic-only contract:

```ts
it('requires only a Google Pub/Sub Topic while Inbox Watch is enabled', () => {
  expect(() =>
    parseGmailChannelConfig({
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: true,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 10,
      providerConfig: {},
    }),
  ).toThrow();

  expect(
    parseGmailChannelConfig({
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: true,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 10,
      providerConfig: {
        topicName: 'projects/zero-mail/topics/gmail-inbound',
        subscriptionName: 'legacy',
        pushAudience: 'legacy',
        pushServiceAccount: 'legacy',
      },
    }),
  ).toMatchObject({
    inboxWatchEnabled: true,
    providerConfig: {
      topicName: 'projects/zero-mail/topics/gmail-inbound',
    },
  });
});
```

Add:

```ts
expect(parsed.providerConfig).not.toHaveProperty('subscriptionName');
expect(parsed.providerConfig).not.toHaveProperty('pushAudience');
expect(parsed.providerConfig).not.toHaveProperty('pushServiceAccount');
```

- [ ] **Step 2: Change the frontend form test**

The Watch validation expectation must become:

```ts
expect(
  getGmailConfigErrors({
    ...defaultGmailConfigForm,
    inboxWatchEnabled: true,
  }),
).toEqual({ topicName: 'Required' });
```

- [ ] **Step 3: Add an architecture boundary**

In `integrations-ui-boundary.test.ts`, assert the Gmail dialog and form module do not contain:

```ts
const gmailSources = [
  read('apps/mail/components/integrations/gmail-settings-dialog.tsx'),
  read('apps/mail/modules/integrations/gmail-config.ts'),
].join('\n');

for (const forbidden of [
  'subscriptionName',
  'pushAudience',
  'pushServiceAccount',
  'Subscription name',
  'OIDC audience',
  'Push service account',
]) {
  expect(gmailSources, forbidden).not.toContain(forbidden);
}
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/gmail/config.test.ts tests/architecture/integrations-ui-boundary.test.ts --reporter=dot
pnpm --filter @zero/mail exec vitest run modules/integrations/gmail-config.test.ts --reporter=dot
```

Expected: FAIL because the old fields remain required and rendered.

### Task 2: Reduce the Server Gmail Configuration Model

**Files:**

- Modify: `apps/server/src/mail-channel/gmail/config.ts`
- Modify: `apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts`
- Modify: `apps/server/tests/unit/mail-channel/gmail/inbound/trigger-policy.test.ts`
- Modify: `apps/server/tests/unit/mail-channel/gmail/inbound/webhook.test.ts`

**Interfaces:**

- Consumes: the Task 1 configuration contract.
- Produces: `GmailChannelProviderConfig = { topicName?: string }`.

- [ ] **Step 1: Remove the three provider fields**

Change the Provider fields to:

```ts
const providerConfigFields = {
  topicName: z.string().regex(googleTopicName).optional(),
};

export type GmailChannelProviderConfig = {
  topicName?: string;
};
```

The enabled branch must require only:

```ts
providerConfig: z.object({
  topicName: z.string().regex(googleTopicName),
}),
```

Delete `googleSubscriptionName`, `googleServiceAccount`, `subscriptionName`,
`pushAudience`, and `pushServiceAccount`.

- [ ] **Step 2: Update Server fixtures**

For every Gmail enabled-Watch fixture in the files listed above, retain:

```ts
providerConfig: {
  topicName: 'projects/zero-mail/topics/gmail-inbound',
},
```

Do not change the trigger-policy expectation:

```ts
subscriptionTarget: {
  version: 1,
  topicName: 'projects/zero-mail/topics/gmail-inbound',
},
```

- [ ] **Step 3: Run the backend configuration tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/gmail/config.test.ts tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/mail-channel/gmail/inbound/trigger-policy.test.ts --reporter=dot
```

Expected: PASS.

### Task 3: Remove the Gmail Push Authentication Configuration

**Files:**

- Delete: `apps/server/src/mail-channel/gmail/inbound/push-auth.ts`
- Delete: `apps/server/tests/unit/mail-channel/gmail/inbound/push-auth.test.ts`
- Modify: `apps/server/src/mail-channel/gmail/inbound/webhook.ts`
- Modify: `apps/server/src/runtime/mail/gmail-inbound.ts`
- Modify: `apps/server/tests/unit/mail-channel/gmail/inbound/webhook.test.ts`

**Interfaces:**

- Consumes: a standard Pub/Sub JSON request and the global Gmail Watch enabled flag.
- Produces: `handleGmailWebhookRequest(request, { getChannelConfig, recordSignal, enqueueDiscover })`.

- [ ] **Step 1: Rewrite the failing Webhook test**

Remove `authorization` and `x-goog-pubsub-subscription-name` from `createRequest`.
Remove `authenticatePush` from `createDependencies`. Replace the `401` test with:

```ts
it('accepts a valid Pub/Sub notification without authentication configuration', async () => {
  const events: unknown[] = [];
  const response = await handleGmailWebhookRequest(
    createRequest({ emailAddress: 'User@Example.test', historyId: '123' }),
    createDependencies({
      recordSignal: async (signal) => {
        events.push(signal);
        return ['sync-1'];
      },
    }),
  );

  expect(response.status).toBe(200);
  expect(events).toContainEqual({
    provider: 'gmail',
    externalAccount: 'user@example.test',
    cursorHint: '123',
  });
});
```

Keep the disabled-Watch and malformed-payload assertions.

- [ ] **Step 2: Run the Webhook test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/gmail/inbound/webhook.test.ts --reporter=dot
```

Expected: FAIL because `authenticatePush` is still required.

- [ ] **Step 3: Simplify the Webhook application boundary**

`GmailWebhookDependencies` becomes:

```ts
export type GmailWebhookDependencies = {
  getChannelConfig(): Promise<GmailChannelConfig>;
  recordSignal(signal: GmailSignal): Promise<string[]>;
  enqueueDiscover(syncId: string): Promise<void>;
};
```

Delete `requiredPushConfig`, the authentication call, the `401` response and
`defaultGmailPushAuthenticator`. The request flow starts with the enabled check and then parses
`request.json()`.

- [ ] **Step 4: Simplify runtime composition**

In `runtime/mail/gmail-inbound.ts`, import only `handleGmailWebhookRequest` and construct:

```ts
return await handleGmailWebhookRequest(request, {
  getChannelConfig: () => readGmailChannelConfig(db),
  recordSignal: (signal) => repository.recordSignal(signal),
  enqueueDiscover: (syncId) => runtimeEnv.MAIL_INGRESS_QUEUE.send({ type: 'discover', syncId }),
});
```

- [ ] **Step 5: Delete the authentication module and test**

Delete both `push-auth.ts` and `push-auth.test.ts`. Do not add replacement configuration.

- [ ] **Step 6: Run the Webhook tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/mail-channel/gmail/inbound/webhook.test.ts tests/unit/mail-channel/gmail/inbound/handle-push.test.ts --reporter=dot
```

Expected: PASS.

### Task 4: Reduce the Gmail Administrator Form

**Files:**

- Modify: `apps/mail/modules/integrations/gmail-config.ts`
- Modify: `apps/mail/components/integrations/gmail-settings-dialog.tsx`
- Modify: `apps/mail/modules/integrations/gmail-config.test.ts`
- Modify: `apps/server/tests/architecture/integrations-ui-boundary.test.ts`

**Interfaces:**

- Consumes: `SafeGmailChannelConfig` containing `providerConfig.topicName` and `webhookUrl`.
- Produces: a form that serializes only `{ topicName }`.

- [ ] **Step 1: Reduce the form type and defaults**

`GmailConfigForm` retains:

```ts
export type GmailConfigForm = {
  authSource: 'zero_oauth' | 'nango';
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  topicName: string;
};
```

Delete the three old default properties. When Watch is enabled, validate only:

```ts
if (form.inboxWatchEnabled && form.topicName.trim().length === 0) {
  errors.topicName = 'Required';
}
```

- [ ] **Step 2: Reduce hydration and serialization**

Hydrate only:

```ts
topicName: data.providerConfig.topicName ?? '',
```

Save only:

```ts
providerConfig: form.inboxWatchEnabled
  ? { topicName: form.topicName.trim() }
  : form.topicName.trim()
    ? { topicName: form.topicName.trim() }
    : {},
```

- [ ] **Step 3: Reduce the Watch UI**

Replace the four-field mapped grid with one field:

```tsx
<div className="grid gap-2">
  <Label htmlFor="gmail-topicName">Topic name</Label>
  <Input
    id="gmail-topicName"
    value={form.topicName}
    aria-invalid={Boolean(errors.topicName)}
    onChange={(event) => setForm((current) => ({ ...current, topicName: event.target.value }))}
  />
  {errors.topicName ? <p className="text-destructive text-xs">{errors.topicName}</p> : null}
</div>
```

Keep the Webhook endpoint read-only input and explanatory text.

- [ ] **Step 4: Run the frontend and architecture tests**

Run:

```powershell
pnpm --filter @zero/mail exec vitest run modules/integrations/gmail-config.test.ts --reporter=dot
pnpm --filter @zero/server exec vitest run tests/architecture/integrations-ui-boundary.test.ts --reporter=dot
```

Expected: PASS.

### Task 5: Remove Stale References and Verify the Complete Change

**Files:**

- Modify only files already listed if verification exposes an in-scope stale fixture.

**Interfaces:**

- Consumes: the completed Topic-only configuration and Webhook.
- Produces: repository evidence that no removed Gmail Watch field or authentication module remains.

- [ ] **Step 1: Scan for removed references**

Run:

```powershell
git grep -n -e "subscriptionName" -e "pushAudience" -e "pushServiceAccount" -e "defaultGmailPushAuthenticator" -e "authenticateGmailPush" -- apps/server/src apps/mail
```

Expected: no matches in production source.

- [ ] **Step 2: Run Server TypeScript and full tests**

Run:

```powershell
pnpm --filter @zero/server exec tsc --noEmit --pretty false
pnpm --filter @zero/server exec vitest run tests/unit tests/architecture --exclude tests/unit/modules/mail-outbound/application/enqueue-submission.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 3: Run Mail TypeScript and focused tests**

Run:

```powershell
pnpm --filter @zero/mail exec tsc --noEmit --pretty false
pnpm --filter @zero/mail exec vitest run modules/integrations/gmail-config.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 4: Run changed-file lint and formatting**

Run:

```powershell
pnpm --filter @zero/server exec eslint src/mail-channel/gmail/config.ts src/mail-channel/gmail/inbound/webhook.ts src/runtime/mail/gmail-inbound.ts tests/unit/mail-channel/gmail/config.test.ts tests/unit/integrations/gmail/channel-config-service.test.ts tests/unit/mail-channel/gmail/inbound/trigger-policy.test.ts tests/unit/mail-channel/gmail/inbound/webhook.test.ts tests/architecture/integrations-ui-boundary.test.ts
pnpm --filter @zero/mail exec eslint modules/integrations/gmail-config.ts modules/integrations/gmail-config.test.ts components/integrations/gmail-settings-dialog.tsx
pnpm exec prettier --check --ignore-unknown apps/server/src/mail-channel/gmail/config.ts apps/server/src/mail-channel/gmail/inbound/webhook.ts apps/server/src/runtime/mail/gmail-inbound.ts apps/server/tests/unit/mail-channel/gmail/config.test.ts apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts apps/server/tests/unit/mail-channel/gmail/inbound/trigger-policy.test.ts apps/server/tests/unit/mail-channel/gmail/inbound/webhook.test.ts apps/server/tests/architecture/integrations-ui-boundary.test.ts apps/mail/modules/integrations/gmail-config.ts apps/mail/modules/integrations/gmail-config.test.ts apps/mail/components/integrations/gmail-settings-dialog.tsx docs/superpowers/plans/2026-07-29-gmail-watch-topic-only.md
```

Expected: no changed-file lint errors and Prettier PASS.

- [ ] **Step 5: Run final hygiene checks**

Confirm:

- `pnpm-lock.yaml`, package dependencies, database schema and migrations did not change.
- No Gmail Pub/Sub environment variable was added.
- The fixed Webhook URL remains visible in the Gmail dialog.
- The Server immutable-runtime changes and `.env.example` parallel edit remain intact.
- `node-compile-cache/` and `update-check/` remain untracked and untouched.

### Task 6: Close the Gmail Dialog After a Successful Save

**Files:**

- Modify: `apps/server/tests/architecture/integrations-ui-boundary.test.ts`
- Modify: `apps/mail/components/integrations/gmail-settings-dialog.tsx`

**Interfaces:**

- Consumes: the existing `saveChannel.mutateAsync()`, `refresh()` and `onOpenChange()` flow.
- Produces: a Gmail settings dialog that closes only after save and cache refresh succeed.

- [ ] **Step 1: Add the failing interaction boundary test**

Read the Gmail settings dialog source, isolate the successful-save block before `catch`, and assert
that `await refresh()` appears before `onOpenChange(false)`. Assert that the `catch` block does not
contain `onOpenChange(false)`.

- [ ] **Step 2: Run the boundary test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/integrations-ui-boundary.test.ts --reporter=dot
```

Expected: FAIL because the successful save path does not close the dialog.

- [ ] **Step 3: Add the minimal close action**

Use a ref-backed dirty guard so the close callback reads the current value rather than a stale render
closure. After `await refresh()`, synchronously clear the guard and close through the shared close
path:

```ts
dirtyRef.current = false;
toast.success('Gmail channel configuration saved');
requestClose(false);
```

Keep the confirmation in `requestClose()` for genuine unsaved user changes. Do not call the parent
`onOpenChange(false)` directly from the successful-save path.

- [ ] **Step 4: Run the boundary test and Mail checks**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/integrations-ui-boundary.test.ts --reporter=dot
pnpm --filter @zero/mail exec tsc --noEmit
pnpm --filter @zero/mail exec eslint components/integrations/gmail-settings-dialog.tsx
```

Expected: PASS.

### Task 7: Lock and Hydrate the Saved Gmail Authorization Source

**Files:**

- Modify: `apps/server/src/integrations/gmail/channel-config-service.ts`
- Modify: `apps/server/tests/unit/integrations/gmail/channel-config-service.test.ts`
- Modify: `apps/mail/components/integrations/gmail-settings-dialog.tsx`
- Modify: `apps/server/tests/architecture/integrations-ui-boundary.test.ts`

**Interfaces:**

- Consumes: the persisted Gmail `channel_config.authSource` and React Query `dataUpdatedAt`.
- Produces: an API-enforced immutable authorization source and a form hydrated from the latest query
  version before it is displayed.

- [ ] **Step 1: Add failing lock and hydration tests**

Assert that the first successful Gmail save returns `authSourceLocked: true`, changing a configured
Nango channel to Zero OAuth fails with `GMAIL_AUTH_SOURCE_IN_USE` even with zero bindings, and the
frontend waits for the latest query version to hydrate.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts tests/architecture/integrations-ui-boundary.test.ts --reporter=dot
```

Expected: FAIL because locking currently depends on mailbox bindings and the form renders before
query hydration.

- [ ] **Step 3: Enforce the persisted authorization source**

Return `authSourceLocked: true` whenever a Gmail channel record exists, and reject a candidate whose
authorization source differs from the persisted record. Preserve the existing mixed-binding
consistency check.

- [ ] **Step 4: Gate form rendering on the latest query version**

Track the `dataUpdatedAt` version applied by the form hydration effect. While the query is fetching,
has no data, or the applied version differs from `config.dataUpdatedAt`, display the existing loader.
Once equal, render the form using the persisted authorization source.

- [ ] **Step 5: Verify the focused behavior and type safety**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/unit/integrations/gmail/channel-config-service.test.ts tests/architecture/integrations-ui-boundary.test.ts --reporter=dot
pnpm --filter @zero/server exec tsc --noEmit
pnpm --filter @zero/mail exec tsc --noEmit
```

Expected: PASS.
