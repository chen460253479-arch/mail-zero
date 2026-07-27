import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const read = (relativePath: string) => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const expectNoTokens = (relativePath: string, tokens: string[]) => {
  const source = read(relativePath);
  for (const token of tokens) {
    expect(
      source.includes(token),
      `${relativePath} still contains forbidden token: ${token}`,
    ).toBe(false);
  }
};

const listRuntimeSourceFiles = (relativeDirectory: string): string[] => {
  const absoluteDirectory = resolve(repoRoot, relativeDirectory);

  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return listRuntimeSourceFiles(relativePath);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [relativePath] : [];
  });
};

describe('self-hosted commercial billing removal', () => {
  it('keeps all runtime source free of commercial entitlement architecture', () => {
    const runtimeFiles = [
      ...listRuntimeSourceFiles('apps/mail/app'),
      ...listRuntimeSourceFiles('apps/mail/components'),
      ...listRuntimeSourceFiles('apps/mail/config'),
      ...listRuntimeSourceFiles('apps/mail/hooks'),
      ...listRuntimeSourceFiles('apps/mail/lib'),
      ...listRuntimeSourceFiles('apps/mail/providers'),
      ...listRuntimeSourceFiles('apps/server/src'),
    ];
    const forbiddenPatterns = [
      /\bpricingDialog\b/,
      /\buseBilling\b/,
      /\bisProCustomer\b/,
      /\bAutumnProvider\b/,
      /\bAUTUMN_SECRET_KEY\b/,
      /\bautumn-js\b/,
      /\bisPro\b/,
      /\bZero Pro\b/i,
    ];

    for (const relativePath of runtimeFiles) {
      const source = read(relativePath);
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(source),
          `${relativePath} still contains forbidden commercial billing pattern: ${pattern}`,
        ).toBe(false);
      }
    }
  });

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

  it('removes pricing routes, subscription copy, and Pro email campaigns', () => {
    const removedFiles = [
      'apps/mail/app/(full-width)/pricing.tsx',
      'apps/mail/components/pricing/comparision.tsx',
      'apps/mail/components/pricing/pricing-card.tsx',
      'apps/mail/components/ui/pricing-dialog.tsx',
      'apps/mail/components/ui/pricing-switch.tsx',
      'apps/server/src/lib/react-emails/email-sequences.tsx',
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
    expectNoTokens('README.md', ['Autumn Setup', 'AUTUMN_SECRET_KEY']);
    expectNoTokens('AGENT.md', ['AUTUMN_SECRET_KEY']);
  });

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
});
