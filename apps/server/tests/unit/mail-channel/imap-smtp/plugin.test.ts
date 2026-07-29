import { describe, expect, it, vi } from 'vitest';

import type { MailProtocolClient } from '../../../../src/mail-channel/imap-smtp/shared/protocol-client';
import { createImapSmtpPlugin } from '../../../../src/mail-channel/imap-smtp/plugin';

const credential = {
  type: 'imap_smtp' as const,
  email: 'owner@example.test',
  username: 'imap-login',
  password: 'secret',
  imap: { host: 'imap.example.test', port: 993, secure: true },
  smtp: { host: 'smtp.example.test', port: 587, secure: false },
};

const client: MailProtocolClient = {
  verify: vi.fn(async () => ({ email: 'owner@example.test' })),
  establishImapBaseline: vi.fn(),
  discoverImap: vi.fn(),
  fetchImapRaw: vi.fn(),
  sendSmtp: vi.fn(),
};

describe('IMAP/SMTP mail channel plugin', () => {
  it('declares scheduled-only capabilities and the Nango generic-email credential source', () => {
    const plugin = createImapSmtpPlugin({ createClient: async () => client });

    expect(plugin).toMatchObject({
      id: 'imap_smtp',
      providerKey: 'imap_smtp',
      displayName: 'IMAP/SMTP',
      nangoProviders: ['generic-email'],
    });
    expect([...plugin.credentialTypes]).toEqual(['imap_smtp']);
    expect([...plugin.syncModes!]).toEqual(['scheduled']);
    expect(plugin.webhookKind).toBeUndefined();
    expect([...plugin.capabilities]).toEqual(['read_messages', 'send_messages']);
  });

  it('uses the same protocol client for identity, inbound, and outbound', async () => {
    const createClient = vi.fn(async () => client);
    const plugin = createImapSmtpPlugin({ createClient });

    await expect(plugin.resolveIdentity({ credential })).resolves.toEqual({
      email: 'owner@example.test',
      name: '',
      picture: '',
    });
    await expect(
      plugin.inbound?.createAdapter({
        connectionId: 'connection-1',
        credential,
      }),
    ).resolves.toMatchObject({ provider: 'imap_smtp' });
    await expect(
      plugin.outbound?.createAdapter({
        connectionId: 'connection-1',
        credential,
      }),
    ).resolves.toMatchObject({ provider: 'imap_smtp' });
    expect(createClient).toHaveBeenCalledTimes(3);
  });
});
