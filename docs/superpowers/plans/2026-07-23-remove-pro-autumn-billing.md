# Remove Pro and Autumn Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Zero into a billing-independent self-hosted application by removing every Pro entitlement gate, Autumn runtime integration, pricing surface, and billing dependency.

**Architecture:** Authentication remains the application access boundary, while feature-specific configuration such as `ENABLE_MEET` remains the only optional capability switch. Frontend feature paths call their existing AI, OAuth, and mail-provider integrations directly; backend paths no longer create Autumn clients or expose Autumn proxy routes.

**Tech Stack:** TypeScript, React 19, React Router 7, Hono, tRPC, Better Auth, Vitest, pnpm workspaces, Cloudflare Workers.

## Global Constraints

- The fork is self-hosted-only; do not add a SaaS/self-hosted runtime switch.
- Every authenticated user has the same capabilities.
- Preserve authentication, application rate limits, provider quotas, and provider-specific errors.
- Preserve `ENABLE_MEET` as the operator-owned meeting switch.
- Do not add a replacement billing, licensing, entitlement, or usage-metering system.
- Remove `autumn-js` and `AUTUMN_SECRET_KEY` completely.
- Do not run project-wide lint or format commands; use only targeted file commands.
- Follow the repository style: two-space indentation, single quotes, semicolons, and 100-character lines.

---

## File Map

### Regression contract

- Create `apps/server/tests/no-commercial-billing.test.ts` as a repository-level architectural
  contract. Each implementation task adds a focused assertion before changing its production
  files.

### AI capability

- Modify `apps/mail/components/create/ai-chat.tsx` to remove message-entitlement rendering and
  submission gating.
- Modify `apps/mail/components/ui/ai-sidebar.tsx` to remove Pro props, usage display, checkout
  triggers, usage tracking, and billing refetches.

### Connections and application shell

- Modify `apps/mail/app/(routes)/settings/connections/page.tsx` so the add button always opens
  the connection dialog.
- Modify `apps/mail/components/connection/add.tsx` to remove connection balance logic and
  checkout UI.
- Modify `apps/mail/components/ui/nav-user.tsx` to remove Pro branches, badges, checkout, and
  billing portal actions.
- Modify `apps/mail/components/ui/app-sidebar.tsx` to remove the upgrade card.
- Modify `apps/mail/components/mail/mail.tsx` and
  `apps/mail/components/settings/settings-card.tsx` to stop mounting the pricing dialog.
- Modify `apps/mail/providers/server-providers.tsx` to mount `QueryProvider` directly.

### Backend capability

- Delete `apps/server/src/routes/autumn.ts`.
- Modify `apps/server/src/main.ts` to remove the `/autumn` route.
- Modify `apps/server/src/ctx.ts` to remove Autumn request context.
- Modify `apps/server/src/lib/auth.ts` to remove Autumn customer deletion.
- Modify `apps/server/src/trpc/routes/meet.ts` to make `ENABLE_MEET` the only feature gate.
- Modify `apps/server/src/lib/utils.ts` to remove the backend Pro product helper.
- Modify `apps/server/src/env.ts` to remove `AUTUMN_SECRET_KEY`.

### Commercial surfaces and documentation

- Delete `apps/mail/app/(full-width)/pricing.tsx`.
- Delete `apps/mail/components/pricing/comparision.tsx`.
- Delete `apps/mail/components/pricing/pricing-card.tsx`.
- Delete `apps/mail/components/ui/pricing-dialog.tsx`.
- Delete `apps/mail/components/ui/pricing-switch.tsx`.
- Modify `apps/mail/app/routes.ts` and `apps/mail/components/navigation.tsx` to remove `/pricing`.
- Modify `apps/mail/app/(full-width)/privacy.tsx` to remove subscription billing and refund copy.
- Modify `apps/server/src/lib/auth.ts` and
  `apps/server/src/lib/react-emails/email-sequences.tsx` to remove Pro lifecycle emails.
- Modify `README.md` and `AGENT.md` to remove Autumn setup and configuration documentation.
- Delete pricing-only assets after reference verification:
  `apps/mail/public/pricing-gradient.png`, `apps/mail/public/small-pixel.png`,
  `apps/mail/public/purple-gradient.png`, `apps/mail/public/purple-zap.svg`, and
  `apps/mail/public/zap.svg`.

### Dependency cleanup

- Delete `apps/mail/hooks/use-billing.ts`.
- Modify `apps/mail/lib/utils.ts` to remove the frontend Pro product helper and Autumn type.
- Modify `.env.example`, `apps/mail/package.json`, `apps/server/package.json`, and
  `pnpm-workspace.yaml`.
- Regenerate `pnpm-lock.yaml` without lifecycle scripts.

---

### Task 1: Unlock AI Chat

**Files:**

- Create: `apps/server/tests/no-commercial-billing.test.ts`
- Modify: `apps/mail/components/create/ai-chat.tsx:1-20,198-274,393-398`
- Modify: `apps/mail/components/ui/ai-sidebar.tsx:1-49,121-154,337-462,490-550`

**Interfaces:**

- Consumes: Existing `useAgentChat`, `useAgent`, and AI tool-call behavior.
- Produces: AI chat that has no billing input, billing output, or entitlement-dependent UI.

- [ ] **Step 1: Add the failing AI billing-independence contract**

Create `apps/server/tests/no-commercial-billing.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const read = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

const expectNoTokens = (relativePath: string, tokens: string[]) => {
  const source = read(relativePath);
  for (const token of tokens) {
    expect(
      source.includes(token),
      `${relativePath} still contains forbidden token: ${token}`,
    ).toBe(false);
  }
};

describe('self-hosted commercial billing removal', () => {
  it('keeps AI chat independent of billing and entitlements', () => {
    expectNoTokens('apps/mail/components/create/ai-chat.tsx', [
      'useBilling',
      "useQueryState('pricingDialog')",
      'chatMessages.enabled',
      'Upgrade to Zero Pro',
      'Start 7 day free trial',
    ]);
    expectNoTokens('apps/mail/components/ui/ai-sidebar.tsx', [
      'useBilling',
      'isPro',
      'setPricingDialog',
      "featureId: 'chat-messages'",
      'refetchBilling',
      'Upgrade for unlimited messages',
    ]);
  });
});
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "AI chat"
```

Expected: FAIL because both AI components still contain `useBilling` and entitlement code.

- [ ] **Step 3: Remove AI entitlement rendering and submission gating**

In `apps/mail/components/create/ai-chat.tsx`:

- remove the `useBilling` and `Button` imports;
- keep `TextShimmer`, because it still renders the streaming state;
- remove `const { chatMessages } = useBilling();`;
- remove only the `pricingDialog` query state, retaining the other `useQueryState` calls;
- delete the complete exhausted-entitlement branch and make the existing empty-state branch the
  first condition:

```diff
-          {chatMessages && !chatMessages.enabled ? (
-            <div
-              onClick={() => setPricingDialog('true')}
-              className="absolute inset-0 flex flex-col items-center justify-center"
-            >
-              <TextShimmer className="text-center text-xl font-medium">
-                Upgrade to Zero Pro for unlimited AI chat
-              </TextShimmer>
-              <Button className="mt-2 h-8 w-52">Start 7 day free trial</Button>
-            </div>
-          ) : !messages.length ? (
+          {!messages.length ? (
```

Remove the entitlement-only disabled property from the submit button:

```tsx
<button
  form="ai-chat-form"
  type="submit"
  className="inline-flex cursor-pointer gap-1.5 rounded-lg"
>
```

- [ ] **Step 4: Remove AI sidebar billing state and metering**

In `apps/mail/components/ui/ai-sidebar.tsx`:

- remove the `useBilling` and `Gauge` imports;
- remove `isPro` from `ChatHeaderProps` and `ChatHeader` parameters;
- remove the `pricingDialog` and `chatMessages` state in `ChatHeader`;
- delete the entire `!isPro` usage-gauge and upgrade-tooltip branch;
- remove the `useBilling()` call in `AISidebar`;
- delete the following billing side effects from `onToolCall`:

```ts
await track({ featureId: 'chat-messages', value: 1 });
await refetchBilling();
```

- remove `isPro={isPro ?? false}` from both `ChatHeader` call sites.

The resulting `AISidebar` hook setup starts with:

```tsx
function AISidebar({ className }: AISidebarProps) {
  const { open, setOpen, isFullScreen, setIsFullScreen, toggleViewMode, isSidebar, isPopup } =
    useAISidebar();
  const queryClient = useQueryClient();
  const trpc = useTRPC();
```

- [ ] **Step 5: Run focused tests and targeted lint**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "AI chat"
pnpm --dir apps/mail exec eslint "components/create/ai-chat.tsx" "components/ui/ai-sidebar.tsx"
```

Expected: the AI contract PASSes and ESLint exits 0.

- [ ] **Step 6: Commit the AI change**

```powershell
git add -- apps/server/tests/no-commercial-billing.test.ts apps/mail/components/create/ai-chat.tsx apps/mail/components/ui/ai-sidebar.tsx
git commit -m "refactor: unlock self-hosted ai chat"
```

---

### Task 2: Remove Connection and Shell Pro Gates

**Files:**

- Modify: `apps/server/tests/no-commercial-billing.test.ts`
- Modify: `apps/mail/app/(routes)/settings/connections/page.tsx:21-41,205-230`
- Modify: `apps/mail/components/connection/add.tsx:9-51,74-90,108-117`
- Modify: `apps/mail/components/ui/app-sidebar.tsx:14-42,131-165`
- Modify: `apps/mail/components/ui/nav-user.tsx:1-12,95-106,230-240,511-555,635-657`
- Modify: `apps/mail/components/mail/mail.tsx:24-63,417-420`
- Modify: `apps/mail/components/settings/settings-card.tsx:1-4,36-39`
- Modify: `apps/mail/providers/server-providers.tsx`

**Interfaces:**

- Consumes: Existing `AddConnectionDialog`, Better Auth link-social flow, and `QueryProvider`.
- Produces: Unconditional connection entry points and an application shell with no billing UI.

- [ ] **Step 1: Add the failing connection and shell contract**

Append inside the existing `describe` block:

```ts
it('keeps connections and the application shell independent of billing', () => {
  const paths = [
    'apps/mail/app/(routes)/settings/connections/page.tsx',
    'apps/mail/components/connection/add.tsx',
    'apps/mail/components/ui/app-sidebar.tsx',
    'apps/mail/components/ui/nav-user.tsx',
    'apps/mail/components/mail/mail.tsx',
    'apps/mail/components/settings/settings-card.tsx',
    'apps/mail/providers/server-providers.tsx',
  ];

  for (const path of paths) {
    expectNoTokens(path, [
      'useBilling',
      'pricingDialog',
      'PricingDialog',
      'AutumnProvider',
      'Start 7 day free trial',
    ]);
  }

  expectNoTokens('apps/mail/components/connection/add.tsx', [
    'canCreateConnection',
    'handleUpgrade',
  ]);
  expectNoTokens('apps/mail/components/ui/nav-user.tsx', [
    'openBillingPortal',
    'billingCustomer',
    'Get verified',
  ]);
});
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "connections and the application shell"
```

Expected: FAIL because connection and navigation files still contain billing branches.

- [ ] **Step 3: Make connection entry points unconditional**

In `apps/mail/app/(routes)/settings/connections/page.tsx`, remove `useBilling`,
`useQueryState`, `isPro`, and `setPricingDialog`. Replace the entire Pro conditional with:

```tsx
<AddConnectionDialog>
  <Button
    variant="outline"
    className="group relative w-9 overflow-hidden duration-200 hover:w-full sm:hover:w-[32.5%]"
  >
    <Plus className="absolute left-2 h-4 w-4" />
    <span className="whitespace-nowrap pl-7 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      {m['pages.settings.connections.addEmail']()}
    </span>
  </Button>
</AddConnectionDialog>
```

In `apps/mail/components/connection/add.tsx`:

- remove `useBilling`, `useMemo`, and `toast`;
- remove `canCreateConnection` and `handleUpgrade`;
- delete the free-tier warning block;
- remove `disabled={!canCreateConnection}` from provider buttons.

The provider button becomes:

```tsx
<Button
  variant="outline"
  className="h-24 w-full flex-col items-center justify-center gap-2"
  onClick={async () =>
    await authClient.linkSocial({
      provider: provider.providerId,
      callbackURL: `${window.location.origin}${pathname}`,
    })
  }
>
```

- [ ] **Step 4: Remove shell upgrade and billing controls**

In `apps/mail/components/ui/app-sidebar.tsx`:

- remove `useBilling`, `useState`, and the upgrade-only `X` import;
- retain `useQueryState`, which is still used by the compose button;
- delete `showUpgrade`, `setShowUpgrade`, `setPricingDialog`, and the complete upgrade-card
  branch.

In `apps/mail/components/ui/nav-user.tsx`:

- remove `BadgeCheck`, `BanknoteIcon`, and `useBilling`;
- remove the `pricingDialog` query state;
- remove Pro badges from connection rows and the account footer;
- replace the conditional add-connection button with:

```tsx
<AddConnectionDialog>
  <Button className="hover:bg-offsetLight/80 dark:hover:bg-offsetDark/80 flex h-7 w-7 cursor-pointer items-center justify-center rounded-[5px] border border-dashed bg-transparent px-0 text-black dark:bg-[#262626] dark:text-[#929292]">
    <Plus className="size-4" />
  </Button>
</AddConnectionDialog>
```

- delete the billing portal menu item;
- delete the `Get verified` upsell button.

In `apps/mail/components/mail/mail.tsx`, remove the `PricingDialog` import, its live mount, and
the obsolete commented billing block.

In `apps/mail/components/settings/settings-card.tsx`, remove the `PricingDialog` import and
mount.

- [ ] **Step 5: Remove the frontend Autumn provider**

Replace `apps/mail/providers/server-providers.tsx` with:

```tsx
import { QueryProvider } from './query-provider';
import type { PropsWithChildren } from 'react';

export function ServerProviders({
  children,
  connectionId,
}: PropsWithChildren<{ connectionId: string | null }>) {
  return <QueryProvider connectionId={connectionId}>{children}</QueryProvider>;
}
```

- [ ] **Step 6: Run focused tests and targeted lint**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "connections and the application shell"
pnpm --dir apps/mail exec eslint "app/(routes)/settings/connections/page.tsx" "components/connection/add.tsx" "components/ui/app-sidebar.tsx" "components/ui/nav-user.tsx" "components/mail/mail.tsx" "components/settings/settings-card.tsx" "providers/server-providers.tsx"
```

Expected: the connection/shell contract PASSes and ESLint exits 0.

- [ ] **Step 7: Commit the connection and shell change**

```powershell
git add -- apps/server/tests/no-commercial-billing.test.ts "apps/mail/app/(routes)/settings/connections/page.tsx" apps/mail/components/connection/add.tsx apps/mail/components/ui/app-sidebar.tsx apps/mail/components/ui/nav-user.tsx apps/mail/components/mail/mail.tsx apps/mail/components/settings/settings-card.tsx apps/mail/providers/server-providers.tsx
git commit -m "refactor: remove pro gates from mail client"
```

---

### Task 3: Remove the Backend Autumn Boundary

**Files:**

- Modify: `apps/server/tests/no-commercial-billing.test.ts`
- Delete: `apps/server/src/routes/autumn.ts`
- Modify: `apps/server/src/main.ts:45,708-710`
- Modify: `apps/server/src/ctx.ts:1-12`
- Modify: `apps/server/src/lib/auth.ts:20-26,201-211`
- Modify: `apps/server/src/trpc/routes/meet.ts:1-47`
- Modify: `apps/server/src/lib/utils.ts:1-3,370-378`
- Modify: `apps/server/src/env.ts:76-80`

**Interfaces:**

- Consumes: Existing Hono routing, Better Auth deletion, tRPC meeting route, and `ENABLE_MEET`.
- Produces: A backend with no Autumn client, route, request context, or Pro authorization.

- [ ] **Step 1: Add the failing backend billing-removal contract**

Add `existsSync` to the Node imports:

```ts
import { existsSync, readFileSync } from 'node:fs';
```

Append inside the existing `describe` block:

```ts
it('contains no backend Autumn runtime or Pro authorization', () => {
  const paths = [
    'apps/server/src/main.ts',
    'apps/server/src/ctx.ts',
    'apps/server/src/env.ts',
    'apps/server/src/lib/auth.ts',
    'apps/server/src/lib/utils.ts',
    'apps/server/src/trpc/routes/meet.ts',
  ];

  for (const path of paths) {
    expectNoTokens(path, ['Autumn', 'autumn', 'isProCustomer', 'AUTUMN_SECRET_KEY']);
  }

  expect(existsSync(resolve(repoRoot, 'apps/server/src/routes/autumn.ts'))).toBe(false);
});
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "backend Autumn"
```

Expected: FAIL because the backend still imports Autumn and the proxy route still exists.

- [ ] **Step 3: Remove Autumn from request lifecycle and routing**

In `apps/server/src/ctx.ts`, remove the Autumn import and `autumn?: Autumn` field:

```ts
import type { Auth } from './lib/auth';
import type { ZeroEnv } from './env';

export type SessionUser = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>['user'];

export type HonoVariables = {
  auth: Auth;
  sessionUser?: SessionUser;
  traceId?: string;
  requestId?: string;
};
```

In `apps/server/src/main.ts`, remove the Autumn route import and route registration. The route
chain becomes:

```ts
.route('/ai', aiRouter)
.route('/public', publicRouter)
.on(['GET', 'POST', 'OPTIONS'], '/auth/*', (c) => {
```

Delete `apps/server/src/routes/autumn.ts`.

- [ ] **Step 4: Remove Autumn customer deletion**

In `apps/server/src/lib/auth.ts`:

- remove `import { Autumn } from 'autumn-js';`;
- delete the Autumn client creation, customer deletion, and catch block from `beforeDelete`;
- retain connection enumeration and provider token revocation.

The start of `beforeDelete` becomes:

```ts
beforeDelete: async (user, request) => {
  if (!request) throw new APIError('BAD_REQUEST', { message: 'Request object is missing' });
  const db = await getZeroDB(user.id);
  const connections = await db.findManyConnections();

  const revokedAccounts = (
    await Promise.allSettled(
      connections.map(async (connection) => {
```

- [ ] **Step 5: Make meetings depend only on operator configuration**

In `apps/server/src/trpc/routes/meet.ts`:

- remove `isProCustomer` and `Autumn` imports;
- retain `TRPCError`, which is still used for meeting API failures;
- change `.mutation(async ({ ctx }) => {` to `.mutation(async () => {`;
- remove the customer lookup and both authorization branches.

The mutation begins:

```ts
.mutation(async () => {
  const enableMeet = env.ENABLE_MEET === 'true';
  if (!enableMeet) return new Response('Not implemented', { status: 501 });

  const AuthHeader = env.MEET_AUTH_HEADER;
  const response = await fetch(env.MEET_API_URL + '/meetings', {
```

- [ ] **Step 6: Remove backend Pro helpers and configuration**

In `apps/server/src/lib/utils.ts`, remove the Autumn `Customer` import, `PRO_PLANS`, and
`isProCustomer`.

In `apps/server/src/env.ts`, remove:

```ts
AUTUMN_SECRET_KEY: string;
```

- [ ] **Step 7: Run focused tests, type checking, and targeted lint**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "backend Autumn"
pnpm --dir apps/server exec tsc --noEmit
pnpm --dir apps/server exec eslint "src/main.ts" "src/ctx.ts" "src/env.ts" "src/lib/auth.ts" "src/lib/utils.ts" "src/trpc/routes/meet.ts" "tests/no-commercial-billing.test.ts"
```

Expected: the backend contract PASSes, TypeScript exits 0, and ESLint exits 0.

- [ ] **Step 8: Commit the backend change**

```powershell
git add -- apps/server/tests/no-commercial-billing.test.ts apps/server/src/main.ts apps/server/src/ctx.ts apps/server/src/env.ts apps/server/src/lib/auth.ts apps/server/src/lib/utils.ts apps/server/src/trpc/routes/meet.ts apps/server/src/routes/autumn.ts
git commit -m "refactor: remove autumn backend integration"
```

---

### Task 4: Remove Pricing, Subscription Messaging, and Commercial Assets

**Files:**

- Modify: `apps/server/tests/no-commercial-billing.test.ts`
- Delete: `apps/mail/app/(full-width)/pricing.tsx`
- Delete: `apps/mail/components/pricing/comparision.tsx`
- Delete: `apps/mail/components/pricing/pricing-card.tsx`
- Delete: `apps/mail/components/ui/pricing-dialog.tsx`
- Delete: `apps/mail/components/ui/pricing-switch.tsx`
- Modify: `apps/mail/app/routes.ts:7-15`
- Modify: `apps/mail/components/navigation.tsx:157-161,244-252`
- Modify: `apps/mail/app/(full-width)/privacy.tsx:338-414`
- Modify: `apps/server/src/lib/auth.ts:1-9,48-58`
- Modify: `apps/server/src/lib/react-emails/email-sequences.tsx:117-160,396-480`
- Modify: `README.md:179-188`
- Modify: `AGENT.md:75-84`
- Delete: `apps/mail/public/pricing-gradient.png`
- Delete: `apps/mail/public/small-pixel.png`
- Delete: `apps/mail/public/purple-gradient.png`
- Delete: `apps/mail/public/purple-zap.svg`
- Delete: `apps/mail/public/zap.svg`

**Interfaces:**

- Consumes: Existing public full-width layout and non-commercial onboarding email sequence.
- Produces: Public and authenticated UI that contains no pricing, trial, upgrade, or subscription
  lifecycle surface.

- [ ] **Step 1: Add the failing commercial-surface contract**

Append inside the existing `describe` block:

```ts
it('removes pricing routes, subscription copy, and Pro email campaigns', () => {
  const removedFiles = [
    'apps/mail/app/(full-width)/pricing.tsx',
    'apps/mail/components/pricing/comparision.tsx',
    'apps/mail/components/pricing/pricing-card.tsx',
    'apps/mail/components/ui/pricing-dialog.tsx',
    'apps/mail/components/ui/pricing-switch.tsx',
  ];

  for (const path of removedFiles) {
    expect(existsSync(resolve(repoRoot, path)), `${path} should be deleted`).toBe(false);
  }

  expectNoTokens('apps/mail/app/routes.ts', ["route('/pricing'"]);
  expectNoTokens('apps/mail/components/navigation.tsx', ['/pricing', '>Pricing<']);
  expectNoTokens('apps/mail/app/(full-width)/privacy.tsx', [
    'Pricing and Refund Policy',
    'subscription fees',
    '7-day free trial',
  ]);
  expectNoTokens('apps/server/src/lib/auth.ts', ['Mail0ProEmail']);
  expectNoTokens('apps/server/src/lib/react-emails/email-sequences.tsx', [
    'Mail0ProEmail',
    'Mail0ProWelcomeEmail',
    'Mail0CancellationEmail',
    '/pricing',
  ]);
  expectNoTokens('README.md', ['Autumn Setup', 'AUTUMN_SECRET_KEY']);
  expectNoTokens('AGENT.md', ['AUTUMN_SECRET_KEY']);
});
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "pricing routes"
```

Expected: FAIL because pricing files, routes, subscription copy, and Pro email campaigns exist.

- [ ] **Step 3: Remove the pricing route and components**

Delete:

```text
apps/mail/app/(full-width)/pricing.tsx
apps/mail/components/pricing/comparision.tsx
apps/mail/components/pricing/pricing-card.tsx
apps/mail/components/ui/pricing-dialog.tsx
apps/mail/components/ui/pricing-switch.tsx
```

Remove the pricing entry from `apps/mail/app/routes.ts`. The full-width routes become:

```ts
layout('(full-width)/layout.tsx', [
  route('/about', '(full-width)/about.tsx'),
  route('/terms', '(full-width)/terms.tsx'),
  route('/privacy', '(full-width)/privacy.tsx'),
  route('/contributors', '(full-width)/contributors.tsx'),
  route('/hr', '(full-width)/hr.tsx'),
]),
```

Remove only the desktop `<NavigationMenuItem>` containing `<a href="/pricing">` and the mobile
`<Link to="/pricing">`. Do not edit the Home, Privacy, About, or resource entries.

- [ ] **Step 4: Remove pricing-only assets after confirming their references are gone**

Run:

```powershell
$assets = @('pricing-gradient.png', 'small-pixel.png', 'purple-gradient.png', 'purple-zap.svg', 'zap.svg')
foreach ($asset in $assets) {
  $hits = @(git grep -n -I -F $asset -- 'apps/mail/**')
  if ($hits.Count -gt 0) {
    $hits
    throw "Pricing asset is still referenced: $asset"
  }
}
```

Expected: no references after the pricing components are deleted.

Delete:

```text
apps/mail/public/pricing-gradient.png
apps/mail/public/small-pixel.png
apps/mail/public/purple-gradient.png
apps/mail/public/purple-zap.svg
apps/mail/public/zap.svg
```

- [ ] **Step 5: Remove subscription legal and campaign copy**

In `apps/mail/app/(full-width)/privacy.tsx`, delete the complete section whose title is
`Pricing and Refund Policy`; do not change unrelated privacy sections.

In `apps/server/src/lib/auth.ts`, remove `Mail0ProEmail` from the import list. Delete the
complete scheduled campaign array item at current lines 53-57 whose unique `react` property is:

```ts
react: Mail0ProEmail({ name }),
```

In `apps/server/src/lib/react-emails/email-sequences.tsx`, delete the complete exported
definitions for:

```ts
Mail0ProEmail
Mail0ProWelcomeEmail
Mail0CancellationEmail
```

Do not edit any other exported email component.

- [ ] **Step 6: Remove Autumn setup documentation**

In `README.md`, delete the Autumn setup subsection and its secret-key example.

In `AGENT.md`, delete the `AUTUMN_SECRET_KEY` environment-variable bullet. Do not change the
repository's command restrictions.

- [ ] **Step 7: Run focused tests and targeted checks**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "pricing routes"
pnpm --dir apps/mail exec eslint "app/routes.ts" "components/navigation.tsx" "app/(full-width)/privacy.tsx"
pnpm --dir apps/server exec eslint "src/lib/auth.ts" "src/lib/react-emails/email-sequences.tsx" "tests/no-commercial-billing.test.ts"
```

Expected: the commercial-surface contract PASSes and both targeted ESLint commands exit 0.

- [ ] **Step 8: Commit the commercial-surface removal**

```powershell
git add -- apps/server/tests/no-commercial-billing.test.ts apps/mail/app/routes.ts apps/mail/components/navigation.tsx "apps/mail/app/(full-width)/privacy.tsx" apps/server/src/lib/auth.ts apps/server/src/lib/react-emails/email-sequences.tsx README.md AGENT.md "apps/mail/app/(full-width)/pricing.tsx" apps/mail/components/pricing/comparision.tsx apps/mail/components/pricing/pricing-card.tsx apps/mail/components/ui/pricing-dialog.tsx apps/mail/components/ui/pricing-switch.tsx apps/mail/public/pricing-gradient.png apps/mail/public/small-pixel.png apps/mail/public/purple-gradient.png apps/mail/public/purple-zap.svg apps/mail/public/zap.svg
git commit -m "refactor: remove commercial pricing surfaces"
```

---

### Task 5: Remove Autumn Dependencies and Dead Billing Helpers

**Files:**

- Modify: `apps/server/tests/no-commercial-billing.test.ts`
- Delete: `apps/mail/hooks/use-billing.ts`
- Modify: `apps/mail/lib/utils.ts:1-10,622-630`
- Modify: `.env.example:43-47`
- Modify: `apps/mail/package.json`
- Modify: `apps/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Production source with all Autumn imports and billing consumers already removed.
- Produces: Installable workspace with no direct or runtime Autumn dependency or billing helper.

- [ ] **Step 1: Add the failing dependency-removal contract**

Append inside the existing `describe` block:

```ts
it('contains no Autumn packages, configuration, or dead billing helpers', () => {
  expect(existsSync(resolve(repoRoot, 'apps/mail/hooks/use-billing.ts'))).toBe(false);
  expectNoTokens('apps/mail/lib/utils.ts', ['isProCustomer', "from 'autumn-js'"]);
  expectNoTokens('.env.example', ['AUTUMN_SECRET_KEY']);

  for (const path of [
    'apps/mail/package.json',
    'apps/server/package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
  ]) {
    expectNoTokens(path, ['autumn-js']);
  }
});
```

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts -t "Autumn packages"
```

Expected: FAIL because the hook, environment key, direct dependencies, catalog, and lock entries
still exist.

- [ ] **Step 3: Remove frontend billing helpers**

Delete `apps/mail/hooks/use-billing.ts`.

In `apps/mail/lib/utils.ts`, remove:

```ts
import type { Customer } from 'autumn-js';
```

Also remove `PRO_PLANS` and `isProCustomer`:

```ts
const PRO_PLANS = ['pro-example', 'pro_annual', 'team', 'enterprise'] as const;

export const isProCustomer = (customer: Customer) => {
  return customer?.products && Array.isArray(customer.products)
    ? customer.products.some((product) =>
        PRO_PLANS.some((plan) => product.id?.includes(plan) || product.name?.includes(plan)),
      )
    : false;
};
```

- [ ] **Step 4: Remove dependency and environment declarations**

Remove `"autumn-js": "catalog:"` from both application package manifests.

Remove this catalog entry from `pnpm-workspace.yaml`:

```yaml
autumn-js: ^0.0.48
```

Remove this line from `.env.example`:

```env
AUTUMN_SECRET_KEY=
```

- [ ] **Step 5: Regenerate the lockfile without lifecycle scripts**

Run:

```powershell
pnpm install --lockfile-only --ignore-scripts
```

Expected: exit 0 and removal of Autumn package/importer entries from `pnpm-lock.yaml`.

- [ ] **Step 6: Run the complete architectural contract**

Run:

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts
```

Expected: all five commercial-billing-removal tests PASS.

- [ ] **Step 7: Commit dependency cleanup**

```powershell
git add -- apps/server/tests/no-commercial-billing.test.ts apps/mail/hooks/use-billing.ts apps/mail/lib/utils.ts .env.example apps/mail/package.json apps/server/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "build: remove autumn billing dependency"
```

---

### Task 6: Final Regression Verification

**Files:**

- Verify only; no planned production edits.

**Interfaces:**

- Consumes: The five committed implementation tasks.
- Produces: Evidence that the billing-free self-hosted build satisfies the design.

- [ ] **Step 1: Run the complete architectural contract**

```powershell
pnpm --dir apps/server exec vitest run tests/no-commercial-billing.test.ts
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run targeted frontend lint**

```powershell
pnpm --dir apps/mail exec eslint "components/create/ai-chat.tsx" "components/ui/ai-sidebar.tsx" "app/(routes)/settings/connections/page.tsx" "components/connection/add.tsx" "components/ui/app-sidebar.tsx" "components/ui/nav-user.tsx" "components/mail/mail.tsx" "components/settings/settings-card.tsx" "providers/server-providers.tsx" "app/routes.ts" "components/navigation.tsx" "app/(full-width)/privacy.tsx" "lib/utils.ts"
```

Expected: exit 0 with no errors or warnings.

- [ ] **Step 3: Run targeted backend lint and type checking**

```powershell
pnpm --dir apps/server exec eslint "src/main.ts" "src/ctx.ts" "src/env.ts" "src/lib/auth.ts" "src/lib/utils.ts" "src/trpc/routes/meet.ts" "src/lib/react-emails/email-sequences.tsx" "tests/no-commercial-billing.test.ts"
pnpm --dir apps/server exec tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 4: Build the frontend**

```powershell
pnpm --filter @zero/mail build
```

Expected: React Router production build exits 0.

- [ ] **Step 5: Dry-run the backend Worker build**

```powershell
pnpm --dir apps/server exec wrangler deploy --dry-run --env local
```

Expected: Worker bundle completes without deployment and exits 0.

- [ ] **Step 6: Verify zero runtime and dependency references**

```powershell
$patterns = 'pricingDialog|useBilling|isProCustomer|AutumnProvider|AUTUMN_SECRET_KEY|autumn-js'
$hits = @(git grep -n -I -E $patterns -- apps .env.example README.md AGENT.md pnpm-workspace.yaml ':!apps/server/tests/no-commercial-billing.test.ts')
if ($hits.Count -gt 0) {
  $hits
  throw 'Commercial billing references remain'
}

$lockHits = @(Select-String -LiteralPath 'pnpm-lock.yaml' -Pattern 'autumn-js')
if ($lockHits.Count -gt 0) {
  $lockHits
  throw 'Autumn remains in pnpm-lock.yaml'
}
```

Expected: no output and no exception.

- [ ] **Step 7: Verify repository state and commit history**

```powershell
git status --short
git log -5 --oneline
```

Expected: clean status and five implementation commits ending with:

```text
build: remove autumn billing dependency
refactor: remove commercial pricing surfaces
refactor: remove autumn backend integration
refactor: remove pro gates from mail client
refactor: unlock self-hosted ai chat
```
