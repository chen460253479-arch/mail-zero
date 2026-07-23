import { readFileSync } from 'node:fs';
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
});
