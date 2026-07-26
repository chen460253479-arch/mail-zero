import { describe, expect, it } from 'vitest';

import type { GmailApiExecutor } from './shared/api-transport';
import { createGmailPlugin } from './plugin';

const credential = {
  type: 'oauth2' as const,
  accessToken: 'access-token',
  expiresAt: new Date('2026-07-26T12:00:00.000Z'),
  scope: 'gmail.modify',
};

describe('Gmail channel plugin', () => {
  it('declares one provider-neutral inbound capability', async () => {
    const plugin = createGmailPlugin({
      createExecutor: async () =>
        ({
          runGmailApi: async (operation) =>
            await operation({
              users: {
                getProfile: async () => ({
                  data: { emailAddress: 'owner@example.com', historyId: '100' },
                }),
              },
            } as never),
        }) satisfies GmailApiExecutor,
      resolveIdentity: async () => ({
        email: 'owner@example.com',
        name: 'Owner',
        picture: '',
      }),
    });

    expect(plugin.id).toBe('gmail');
    expect(plugin.credentialTypes).toEqual(new Set(['oauth2']));
    expect(plugin.nangoProviders).toEqual(['google-mail', 'google']);
    expect(plugin).not.toHaveProperty('createClient');
    expect(plugin).not.toHaveProperty('sync');
    expect(plugin).not.toHaveProperty('legacyProviderId');

    const identity = await plugin.resolveIdentity({ credential });
    expect(identity.email).toBe('owner@example.com');

    const adapter = await plugin.inbound?.createAdapter({
      connectionId: 'connection-1',
      credential,
    });
    await expect(
      adapter?.establishCheckpoint({
        version: 1,
        mailboxRoles: ['inbox'],
        initialSync: 'none',
      }),
    ).resolves.toEqual({ version: 1, historyId: '100' });
  });
});
