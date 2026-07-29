import { describe, expect, it } from 'vitest';

import { createOutlookPlugin } from '../../../../src/mail-channel/outlook/plugin';
import type { OAuth2Credential } from '../../../../src/mail-channel/contracts';

const credential: OAuth2Credential = {
  type: 'oauth2',
  accessToken: 'token',
  expiresAt: null,
  scope: 'Mail.Read Mail.Send',
};

describe('Outlook mail channel plugin', () => {
  it('exposes one Graph plugin for both Zero OAuth and Nango-hosted OAuth credentials', async () => {
    const plugin = createOutlookPlugin({
      createClient: async ({ credential: resolved }) => {
        expect(resolved).toBe(credential);
        return {
          getIdentity: async () => ({
            email: 'owner@example.com',
            name: 'Owner',
            picture: '',
          }),
        } as never;
      },
    });

    expect(plugin).toMatchObject({
      id: 'outlook',
      providerKey: 'outlook',
      displayName: 'Outlook',
      webhookKind: 'microsoft_graph',
    });
    expect(plugin.credentialTypes).toEqual(new Set(['oauth2']));
    expect(plugin.syncModes).toEqual(new Set(['scheduled', 'webhook']));
    expect(plugin.nangoProviders).toContain('microsoft');
    await expect(plugin.resolveIdentity({ credential })).resolves.toMatchObject({
      email: 'owner@example.com',
    });
  });
});
