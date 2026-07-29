import { describe, expect, it } from 'vitest';

import { createZohoMailPlugin } from '../../../../src/mail-channel/zoho-mail/plugin';
import type { OAuth2Credential } from '../../../../src/mail-channel/contracts';

const credential: OAuth2Credential = {
  type: 'oauth2',
  accessToken: 'token',
  expiresAt: null,
  scope: 'ZohoMail.messages.READ',
};

describe('Zoho Mail channel plugin', () => {
  it('uses one provider plugin for Zero OAuth and Nango-hosted OAuth credentials', async () => {
    const plugin = createZohoMailPlugin({
      createClient: async ({ credential: resolved }) => {
        expect(resolved).toBe(credential);
        return {
          getMailboxContext: async () => ({
            accountId: 'account-1',
            inboxFolderId: 'folder-1',
            email: 'owner@example.com',
            name: 'Owner',
            picture: '',
          }),
        } as never;
      },
    });

    expect(plugin).toMatchObject({
      id: 'zoho_mail',
      providerKey: 'zoho_mail',
      webhookKind: 'zoho_mail',
    });
    expect(plugin.credentialTypes).toEqual(new Set(['oauth2']));
    expect(plugin.syncModes).toEqual(new Set(['scheduled', 'webhook']));
    expect(plugin.nangoProviders).toContain('zoho-mail');
    await expect(plugin.resolveIdentity({ credential })).resolves.toEqual({
      email: 'owner@example.com',
      name: 'Owner',
      picture: '',
    });
  });
});
