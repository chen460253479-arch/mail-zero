import { createNangoCredentialSnapshot, resolveFetchedNangoCredential } from '../credentials/nango';
import { encryptCredential } from '../../../infrastructure/security/credential-encryption';
import type { MailChannelId, MailChannelPlugin } from '../../../mail-channel/contracts';
import type { NangoConnectionSummary } from '../../../integrations/nango/schemas';
import type { NangoClient } from '../../../integrations/nango/client';
import { normalizeMailboxEmail } from './mailbox-identity';

export type NangoBindingErrorCode =
  | 'MAILBOX_ALREADY_CONNECTED'
  | 'NANGO_CONNECTION_ALREADY_BOUND'
  | 'NANGO_CONNECTION_INVALID'
  | 'MAIL_CHANNEL_UNAVAILABLE'
  | 'MAILBOX_IDENTITY_MISMATCH';

export class NangoBindingError extends Error {
  constructor(public readonly code: NangoBindingErrorCode) {
    super(code);
    this.name = 'NangoBindingError';
  }
}

type ExistingMailbox = {
  id: string;
  userId: string;
  channelId: MailChannelId;
  status: 'connected' | 'disconnecting' | 'disconnected' | 'reconnect_required' | 'deleting';
};

export type SaveNangoBindingInput = {
  existingMailboxId: string | null;
  mailbox: {
    email: string;
    normalizedEmail: string;
    name: string;
    picture: string;
    channelId: MailChannelId;
    providerKey: string;
  };
  authorization: {
    authSource: 'nango';
    credentialType: 'oauth2' | 'basic' | 'custom';
    encryptedCredentialSnapshot: string;
    accessTokenExpiresAt: Date | null;
    credentialFetchedAt: Date;
    nangoConnectionId: string;
    nangoProviderConfigKey: string;
  };
};

export interface NangoBindingRepository {
  findMailboxByNormalizedEmail(
    userId: string,
    channelId: MailChannelId,
    normalizedEmail: string,
  ): Promise<ExistingMailbox | null>;
  findByNangoReference(
    integrationId: string,
    connectionId: string,
  ): Promise<{ connectionId: string } | null>;
  save(input: SaveNangoBindingInput): Promise<{ id: string }>;
}

export type BindNangoMailboxInput = {
  userId: string;
  channelId: MailChannelId;
  integrationId: string;
  connectionId: string;
};

type BindNangoMailboxDependencies = {
  client: Pick<NangoClient, 'getConnection'>;
  getChannel(channelId: MailChannelId): MailChannelPlugin;
  isIntegrationAvailable(channelId: MailChannelId, integrationId: string): Promise<boolean>;
  repository: NangoBindingRepository;
  encryptionKey: string;
  now(): Date;
};

const getChannel = (
  channelId: MailChannelId,
  lookup: BindNangoMailboxDependencies['getChannel'],
): MailChannelPlugin => {
  try {
    return lookup(channelId);
  } catch {
    throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
  }
};

export const bindNangoMailbox = async (
  input: BindNangoMailboxInput,
  dependencies: BindNangoMailboxDependencies,
): Promise<{
  id: string;
  identity: { email: string; name: string; picture: string };
}> => {
  const channel = getChannel(input.channelId, dependencies.getChannel);
  if (!(await dependencies.isIntegrationAvailable(input.channelId, input.integrationId))) {
    throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
  }
  const boundReference = await dependencies.repository.findByNangoReference(
    input.integrationId,
    input.connectionId,
  );

  const connection = await dependencies.client
    .getConnection(input.connectionId, input.integrationId)
    .catch(() => {
      throw new NangoBindingError('NANGO_CONNECTION_INVALID');
    });
  if (
    connection.connection_id !== input.connectionId ||
    connection.provider_config_key !== input.integrationId ||
    !channel.nangoProviders?.includes(connection.provider)
  ) {
    throw new NangoBindingError('NANGO_CONNECTION_INVALID');
  }

  let resolved;
  try {
    resolved = resolveFetchedNangoCredential(connection.credentials, connection.connection_config);
  } catch {
    throw new NangoBindingError('NANGO_CONNECTION_INVALID');
  }
  if (!channel.credentialTypes.has(resolved.credential.type)) {
    throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
  }

  const identity = await channel.resolveIdentity({ credential: resolved.credential }).catch(() => {
    throw new NangoBindingError('NANGO_CONNECTION_INVALID');
  });

  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeMailboxEmail(identity.email);
  } catch {
    throw new NangoBindingError('NANGO_CONNECTION_INVALID');
  }

  const existing = await dependencies.repository.findMailboxByNormalizedEmail(
    input.userId,
    input.channelId,
    normalizedEmail,
  );
  if (existing && existing.channelId !== input.channelId) {
    throw new NangoBindingError('MAILBOX_IDENTITY_MISMATCH');
  }
  if (boundReference !== null && boundReference.connectionId !== existing?.id) {
    throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
  }
  if (
    existing &&
    existing.status !== 'disconnected' &&
    !(existing.status === 'reconnect_required' && existing.userId === input.userId)
  ) {
    throw new NangoBindingError('MAILBOX_ALREADY_CONNECTED');
  }

  const now = dependencies.now();
  let saved: { id: string };
  try {
    saved = await dependencies.repository.save({
      existingMailboxId: existing?.id ?? null,
      mailbox: {
        email: identity.email,
        normalizedEmail,
        name: identity.name,
        picture: identity.picture,
        channelId: input.channelId,
        providerKey: channel.providerKey,
      },
      authorization: {
        authSource: 'nango',
        credentialType:
          resolved.credential.type === 'oauth2'
            ? 'oauth2'
            : resolved.credential.type === 'basic'
              ? 'basic'
              : 'custom',
        encryptedCredentialSnapshot: await encryptCredential(
          createNangoCredentialSnapshot(resolved.credential),
          dependencies.encryptionKey,
        ),
        accessTokenExpiresAt: resolved.expiresAt,
        credentialFetchedAt: now,
        nangoConnectionId: input.connectionId,
        nangoProviderConfigKey: input.integrationId,
      },
    });
  } catch (error) {
    const racedReference = await dependencies.repository.findByNangoReference(
      input.integrationId,
      input.connectionId,
    );
    if (racedReference !== null && racedReference.connectionId !== existing?.id) {
      throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
    }
    const racedMailbox = await dependencies.repository.findMailboxByNormalizedEmail(
      input.userId,
      input.channelId,
      normalizedEmail,
    );
    if (racedMailbox !== null && racedMailbox.channelId !== input.channelId) {
      throw new NangoBindingError('MAILBOX_IDENTITY_MISMATCH');
    }
    if (
      racedMailbox !== null &&
      racedMailbox.status !== 'disconnected' &&
      !(racedMailbox.status === 'reconnect_required' && racedMailbox.userId === input.userId)
    ) {
      throw new NangoBindingError('MAILBOX_ALREADY_CONNECTED');
    }
    throw error;
  }
  return { ...saved, identity };
};

export type SafeNangoConnection = {
  connectionId: string;
  integrationId: string;
  email: string;
  displayName: string;
  authorizationStatus: 'valid' | 'invalid';
};

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const getSummaryEmail = (summary: NangoConnectionSummary): string =>
  stringValue(summary.tags.end_user_email) ||
  stringValue(summary.metadata?.email) ||
  stringValue(summary.metadata?.emailAddress);

const getSummaryName = (summary: NangoConnectionSummary): string =>
  stringValue(summary.metadata?.displayName) || stringValue(summary.metadata?.name);

export const listSafeNangoConnections = async (
  integrationId: string,
  client: Pick<NangoClient, 'listConnections'>,
  resolveIdentity: (connectionId: string) => Promise<{ email: string; displayName: string }>,
): Promise<SafeNangoConnection[]> => {
  const summaries = await client.listConnections(integrationId);
  const result = new Array<SafeNangoConnection>(summaries.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < summaries.length) {
      const index = nextIndex++;
      const summary = summaries[index]!;
      let email = getSummaryEmail(summary);
      let displayName = getSummaryName(summary);
      let fallbackFailed = false;
      if (!email && summary.errors.length === 0) {
        try {
          const identity = await resolveIdentity(summary.connection_id);
          email = identity.email;
          displayName = identity.displayName;
        } catch {
          fallbackFailed = true;
        }
      }

      result[index] = {
        connectionId: summary.connection_id,
        integrationId: summary.provider_config_key,
        email,
        displayName: displayName || email,
        authorizationStatus: summary.errors.length === 0 && !fallbackFailed ? 'valid' : 'invalid',
      };
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(5, summaries.length) }, async () => await worker()),
  );
  return result;
};
