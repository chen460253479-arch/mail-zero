import { describe, expect, it, vi } from 'vitest';

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
            folderIds: ['folder-1'],
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

  it('resolves and returns the selected Zoho account and folders as binding data', async () => {
    const createClient = vi.fn(async () => ({
      getMailboxContext: async () => ({
        accountId: '100',
        folderIds: ['201', '202'],
        email: 'owner@example.com',
        name: 'Owner',
        picture: '' as const,
      }),
    })) as never;
    const plugin = createZohoMailPlugin({ createClient });

    await expect(
      plugin.resolveBinding?.({
        credential,
        externalData: { accountId: '100', folderIds: ['201', '202'] },
      }),
    ).resolves.toEqual({
      identity: {
        email: 'owner@example.com',
        name: 'Owner',
        picture: '',
      },
      externalData: { accountId: '100', folderIds: ['201', '202'] },
    });
    expect(createClient).toHaveBeenCalledWith({
      credential,
      externalData: { accountId: '100', folderIds: ['201', '202'] },
    });
  });

  it('preserves account-only externalData during the first binding stage', async () => {
    const plugin = createZohoMailPlugin({
      createClient: async () =>
        ({
          getMailboxContext: async () => ({
            accountId: '100',
            folderIds: [],
            email: 'owner@example.com',
            name: 'Owner',
            picture: '',
          }),
        }) as never,
    });

    await expect(
      plugin.resolveBinding?.({ credential, externalData: { accountId: '100' } }),
    ).resolves.toMatchObject({
      externalData: { accountId: '100' },
    });
  });
});
