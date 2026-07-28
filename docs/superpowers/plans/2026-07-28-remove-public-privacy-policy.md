# Remove the Public Privacy Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely remove Zero's public `/privacy` policy surface while preserving the authenticated `/settings/privacy` mailbox security settings.

**Architecture:** Treat the public policy as a removable frontend surface consisting of one route module, one route registration, and links in public/authenticated navigation. Protect the boundary with an architecture test that rejects the public route and links while affirming the settings route and page remain.

**Tech Stack:** TypeScript, React Router 7, Vitest, ESLint

## Global Constraints

- Delete only the public `/privacy` policy surface.
- Preserve `/settings/privacy`, its route, navigation, translations, and behavior.
- Preserve generic product copy containing the word `privacy` when it does not link to `/privacy`.
- Do not rewrite historical plans or specifications.
- Preserve all unrelated uncommitted workspace changes.
- Leave implementation changes uncommitted until the user explicitly requests a commit.

---

### Task 1: Remove the public privacy-policy surface

**Files:**

- Create: `apps/server/tests/architecture/no-public-privacy-policy.test.ts`
- Delete: `apps/mail/app/(full-width)/privacy.tsx`
- Modify: `apps/mail/app/routes.ts`
- Modify: `apps/mail/app/(auth)/zero/login/page.tsx`
- Modify: `apps/mail/app/(auth)/zero/signup/page.tsx`
- Modify: `apps/mail/components/home/footer.tsx`
- Modify: `apps/mail/components/navigation.tsx`
- Modify: `apps/mail/components/ui/nav-user.tsx`
- Modify: `apps/server/tests/architecture/no-commercial-billing.test.ts`

**Interfaces:**

- Consumes: the existing React Router route table and navigation components.
- Produces: no `/privacy` route or link; unchanged `/settings/privacy` route and page.

- [ ] **Step 1: Write the failing architecture test**

Create `apps/server/tests/architecture/no-public-privacy-policy.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const repoRoot = resolve(serverRoot, '../..');
const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

describe('public privacy policy removal', () => {
  it('does not expose the public privacy-policy route or links', () => {
    expect(existsSync(resolve(repoRoot, 'apps/mail/app/(full-width)/privacy.tsx'))).toBe(false);
    expect(read('apps/mail/app/routes.ts')).not.toContain(
      "route('/privacy', '(full-width)/privacy.tsx')",
    );

    const publicSurfaceFiles = [
      'apps/mail/app/(auth)/zero/login/page.tsx',
      'apps/mail/app/(auth)/zero/signup/page.tsx',
      'apps/mail/components/home/footer.tsx',
      'apps/mail/components/navigation.tsx',
      'apps/mail/components/ui/nav-user.tsx',
    ];

    for (const path of publicSurfaceFiles) {
      expect(read(path), `${path} still links to /privacy`).not.toMatch(
        /(?:href|to)=["']\/privacy["']/,
      );
    }
  });

  it('preserves authenticated mailbox privacy settings', () => {
    expect(existsSync(resolve(repoRoot, 'apps/mail/app/(routes)/settings/privacy/page.tsx'))).toBe(
      true,
    );
    expect(read('apps/mail/app/routes.ts')).toContain(
      "route('/privacy', '(routes)/settings/privacy/page.tsx')",
    );
    expect(read('apps/mail/config/navigation.ts')).toContain("url: '/settings/privacy'");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/no-public-privacy-policy.test.ts
```

Expected: the first test fails because the public page, route, and links still exist; the settings-preservation test passes.

- [ ] **Step 3: Delete the public page and remove all public entries**

Delete `apps/mail/app/(full-width)/privacy.tsx`.

In `apps/mail/app/routes.ts`, remove only:

```ts
route('/privacy', '(full-width)/privacy.tsx'),
```

Remove the `/privacy` anchors or links from the login page, sign-up page, both footer locations,
the `aboutLinks` entry and standalone desktop item in `components/navigation.tsx`, and both
authenticated user-menu locations in `components/ui/nav-user.tsx`. When a separator exists only
between Privacy and Terms, remove that separator with the Privacy link.

Do not remove this settings route:

```ts
route('/privacy', '(routes)/settings/privacy/page.tsx'),
```

- [ ] **Step 4: Remove the stale billing-test dependency on the deleted page**

In `apps/server/tests/architecture/no-commercial-billing.test.ts`, delete only:

```ts
expectNoTokens('apps/mail/app/(full-width)/privacy.tsx', [
  'Pricing and Refund Policy',
  'subscription fees',
  '7-day free trial',
]);
```

Commercial billing remains covered by the suite-wide runtime scan and the other explicit checks.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```powershell
pnpm --filter @zero/server exec vitest run tests/architecture/no-public-privacy-policy.test.ts tests/architecture/no-commercial-billing.test.ts
```

Expected: both files pass.

- [ ] **Step 6: Verify the affected frontend files**

Run:

```powershell
pnpm --filter @zero/mail exec eslint "app/routes.ts" "app/(auth)/zero/login/page.tsx" "app/(auth)/zero/signup/page.tsx" "components/home/footer.tsx" "components/navigation.tsx" "components/ui/nav-user.tsx"
pnpm --filter @zero/mail exec tsc --noEmit
git diff --check
```

Expected: every command exits successfully. The changes remain uncommitted for user review.
