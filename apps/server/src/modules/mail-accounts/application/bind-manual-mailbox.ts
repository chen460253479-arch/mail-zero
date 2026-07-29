import type {
  ImapSmtpCredential,
  MailChannelId,
  MailChannelPlugin,
} from '../../../mail-channel/contracts';
import { encryptCredential } from '../../../infrastructure/security/credential-encryption';
import { createManualCredentialSnapshot } from '../credentials/manual';
import { normalizeMailboxEmail } from './mailbox-identity';

export type ManualMailboxBindingRepository = {
  findMailboxByNormalizedEmail(
    userId: string,
    channelId: 'imap_smtp',
    normalizedEmail: string,
  ): Promise<{
    id: string;
    userId: string;
    channelId: MailChannelId;
    status: 'connected' | 'disconnecting' | 'disconnected' | 'reconnect_required' | 'deleting';
  } | null>;
  save(input: {
    existingMailboxId: string | null;
    mailbox: {
      email: string;
      normalizedEmail: string;
      name: string;
      picture: string;
      channelId: 'imap_smtp';
      providerKey: string;
    };
    authorization: {
      authSource: 'manual';
      credentialType: 'custom';
      encryptedCredentialSnapshot: string;
      accessTokenExpiresAt: null;
      credentialFetchedAt: Date;
    };
  }): Promise<{ id: string }>;
};

export type BindManualMailboxDependencies = {
  channel: MailChannelPlugin;
  repository: ManualMailboxBindingRepository;
  encryptionKey: string;
  now(): Date;
};

export class ManualMailboxBindingError extends Error {
  constructor(
    readonly code:
      | 'MAILBOX_ALREADY_CONNECTED'
      | 'MAILBOX_IDENTITY_MISMATCH'
      | 'MANUAL_MAILBOX_INVALID'
      | 'MAIL_CHANNEL_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'ManualMailboxBindingError';
  }
}

export const bindManualMailbox = async (
  input: {
    userId: string;
    credential: ImapSmtpCredential;
  },
  dependencies: BindManualMailboxDependencies,
): Promise<{ id: string; identity: { email: string; name: string; picture: string } }> => {
  if (
    dependencies.channel.id !== 'imap_smtp' ||
    !dependencies.channel.credentialTypes.has('imap_smtp')
  ) {
    throw new ManualMailboxBindingError('MAIL_CHANNEL_UNAVAILABLE');
  }

  let identity: { email: string; name: string; picture: string };
  try {
    identity = await dependencies.channel.resolveIdentity({
      credential: input.credential,
    });
  } catch {
    throw new ManualMailboxBindingError('MANUAL_MAILBOX_INVALID');
  }
  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeMailboxEmail(identity.email);
  } catch {
    throw new ManualMailboxBindingError('MANUAL_MAILBOX_INVALID');
  }
  if (normalizedEmail !== normalizeMailboxEmail(input.credential.email)) {
    throw new ManualMailboxBindingError('MAILBOX_IDENTITY_MISMATCH');
  }

  const existing = await dependencies.repository.findMailboxByNormalizedEmail(
    input.userId,
    'imap_smtp',
    normalizedEmail,
  );
  if (existing !== null && existing.channelId !== 'imap_smtp') {
    throw new ManualMailboxBindingError('MAILBOX_IDENTITY_MISMATCH');
  }
  if (
    existing !== null &&
    existing.status !== 'disconnected' &&
    !(existing.status === 'reconnect_required' && existing.userId === input.userId)
  ) {
    throw new ManualMailboxBindingError('MAILBOX_ALREADY_CONNECTED');
  }

  const saved = await dependencies.repository.save({
    existingMailboxId: existing?.id ?? null,
    mailbox: {
      email: identity.email,
      normalizedEmail,
      name: identity.name,
      picture: identity.picture,
      channelId: 'imap_smtp',
      providerKey: dependencies.channel.providerKey,
    },
    authorization: {
      authSource: 'manual',
      credentialType: 'custom',
      encryptedCredentialSnapshot: await encryptCredential(
        createManualCredentialSnapshot(input.credential),
        dependencies.encryptionKey,
      ),
      accessTokenExpiresAt: null,
      credentialFetchedAt: dependencies.now(),
    },
  });
  return { ...saved, identity };
};
