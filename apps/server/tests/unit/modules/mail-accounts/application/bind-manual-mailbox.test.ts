import { describe, expect, it, vi } from 'vitest';

import {
  bindManualMailbox,
  type ManualMailboxBindingRepository,
} from '../../../../../src/modules/mail-accounts/application/bind-manual-mailbox';
import { decryptCredential } from '../../../../../src/infrastructure/security/credential-encryption';
import type { MailChannelPlugin } from '../../../../../src/mail-channel/contracts';

const encryptionKey = Buffer.alloc(32, 9).toString('base64');
const credential = {
  type: 'imap_smtp' as const,
  email: 'owner@example.com',
  username: 'login-name',
  password: 'app-password',
  imap: { host: 'imap.example.com', port: 993, secure: true },
  smtp: { host: 'smtp.example.com', port: 465, secure: true },
};

const createRepository = (): ManualMailboxBindingRepository => ({
  findMailboxByNormalizedEmail: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue({ id: 'connection-1' }),
});

const channel = {
  id: 'imap_smtp',
  providerKey: 'imap_smtp',
  displayName: 'IMAP/SMTP',
  credentialTypes: new Set(['imap_smtp']),
  capabilities: new Set(['read_messages', 'send_messages']),
  resolveIdentity: vi.fn().mockResolvedValue({
    email: 'owner@example.com',
    name: '',
    picture: '',
  }),
} satisfies MailChannelPlugin;

describe('manual IMAP/SMTP mailbox binding', () => {
  it('verifies both protocols before persisting an encrypted credential snapshot', async () => {
    const repository = createRepository();

    await bindManualMailbox(
      { userId: 'user-1', credential },
      {
        channel,
        repository,
        encryptionKey,
        now: () => new Date('2026-07-28T12:00:00.000Z'),
      },
    );

    expect(channel.resolveIdentity).toHaveBeenCalledWith({ credential });
    const saved = vi.mocked(repository.save).mock.calls[0]![0];
    expect(saved.authorization.encryptedCredentialSnapshot).not.toContain('app-password');
    await expect(
      decryptCredential(saved.authorization.encryptedCredentialSnapshot, encryptionKey),
    ).resolves.toEqual(credential);
  });

  it('does not persist when protocol verification fails', async () => {
    const repository = createRepository();
    const invalidChannel = {
      ...channel,
      resolveIdentity: vi.fn().mockRejectedValue(new Error('authentication failed')),
    };

    await expect(
      bindManualMailbox(
        { userId: 'user-1', credential },
        {
          channel: invalidChannel,
          repository,
          encryptionKey,
          now: () => new Date(),
        },
      ),
    ).rejects.toMatchObject({ code: 'MANUAL_MAILBOX_INVALID' });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
