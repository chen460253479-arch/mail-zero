import { existsSync, readFileSync } from 'node:fs';
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
});
