import type {
  MailChannelExternalData,
  MailChannelId,
  MailChannelPlugin,
} from '../../../mail-channel/contracts';
import { createNangoCredentialSnapshot, resolveFetchedNangoCredential } from '../credentials/nango';
import { isCompleteZohoMailExternalData } from '../../../mail-channel/zoho-mail/external-data';
import { encryptCredential } from '../../../infrastructure/security/credential-encryption';
import type { NangoConnectionSummary } from '../../../integrations/nango/schemas';
import type { NangoClient } from '../../../integrations/nango/client';
import { normalizeMailboxEmail } from './mailbox-identity';

export type NangoBindingErrorCode =
  | 'MAILBOX_ALREADY_CONNECTED'
  | 'NANGO_CONNECTION_ALREADY_BOUND'
  | 'NANGO_CONNECTION_INVALID'
  | 'MAIL_CHANNEL_UNAVAILABLE'
  | 'MAILBOX_IDENTITY_MISMATCH'
  | 'CHANNEL_EXTERNAL_DATA_INVALID';

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
  status:
    | 'pending_configuration'
    | 'connected'
    | 'disconnecting'
    | 'disconnected'
    | 'reconnect_required'
    | 'deleting';
};

export type SaveNangoBindingInput = {
  existingMailboxId: string | null;
  connectionStatus?: 'pending_configuration' | 'connected';
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
    externalData: MailChannelExternalData | null;
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
  ): Promise<{
    connectionId: string;
    userId: string;
    channelId: MailChannelId;
    status: ExistingMailbox['status'];
    externalData: MailChannelExternalData | null;
  } | null>;
  updateExternalData(input: {
    connectionId: string;
    externalData: MailChannelExternalData | null;
  }): Promise<void>;
  save(input: SaveNangoBindingInput): Promise<{ id: string }>;
}

export type BindNangoMailboxInput = {
  userId: string;
  expectedEndUserId: string | null;
  channelId: MailChannelId;
  integrationId: string;
  connectionId: string;
  externalData?: MailChannelExternalData;
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
  ready: boolean;
}> => {
  const channel = getChannel(input.channelId, dependencies.getChannel);
  if (!(await dependencies.isIntegrationAvailable(input.channelId, input.integrationId))) {
    throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
  }
  const boundReference = await dependencies.repository.findByNangoReference(
    input.integrationId,
    input.connectionId,
  );
  if (
    boundReference !== null &&
    (boundReference.userId !== input.userId || boundReference.channelId !== input.channelId)
  ) {
    throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
  }

  const connection = await dependencies.client
    .getConnection(input.connectionId, input.integrationId)
    .catch(() => {
      throw new NangoBindingError('NANGO_CONNECTION_INVALID');
    });
  if (
    connection.connection_id !== input.connectionId ||
    connection.provider_config_key !== input.integrationId ||
    !channel.nangoProviders?.includes(connection.provider) ||
    (input.expectedEndUserId !== null && connection.tags.end_user_id !== input.expectedEndUserId)
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

  let parsedExternalData: MailChannelExternalData | undefined;
  if (input.externalData !== undefined) {
    if (channel.parseExternalData === undefined) {
      throw new NangoBindingError('CHANNEL_EXTERNAL_DATA_INVALID');
    }
    try {
      parsedExternalData = channel.parseExternalData(input.externalData);
    } catch {
      throw new NangoBindingError('CHANNEL_EXTERNAL_DATA_INVALID');
    }
  }

  let binding;
  try {
    binding =
      channel.resolveBinding === undefined
        ? {
            identity: await channel.resolveIdentity({ credential: resolved.credential }),
            externalData: null,
          }
        : await channel.resolveBinding({
            credential: resolved.credential,
            ...(parsedExternalData === undefined ? {} : { externalData: parsedExternalData }),
          });
  } catch {
    throw new NangoBindingError('NANGO_CONNECTION_INVALID');
  }
  let effectiveExternalData = binding.externalData;
  if (boundReference !== null && channel.mergeExternalData !== undefined) {
    try {
      effectiveExternalData = channel.mergeExternalData({
        existing: boundReference.externalData,
        incoming: binding.externalData,
      });
    } catch {
      throw new NangoBindingError('CHANNEL_EXTERNAL_DATA_INVALID');
    }
  }
  const ready =
    input.channelId !== 'zoho_mail' || isCompleteZohoMailExternalData(effectiveExternalData);
  const identity = binding.identity;

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
  const pendingBoundReference = boundReference?.status === 'pending_configuration';
  if (
    boundReference !== null &&
    !pendingBoundReference &&
    boundReference.connectionId !== existing?.id
  ) {
    throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
  }
  if (pendingBoundReference && existing !== null && existing.id !== boundReference.connectionId) {
    throw new NangoBindingError('MAILBOX_ALREADY_CONNECTED');
  }
  if (
    existing &&
    existing.status !== 'disconnected' &&
    !(existing.status === 'reconnect_required' && existing.userId === input.userId)
  ) {
    if (boundReference?.connectionId === existing.id && existing.userId === input.userId) {
      await dependencies.repository.updateExternalData({
        connectionId: existing.id,
        externalData: effectiveExternalData,
      });
      return { id: existing.id, identity, ready };
    }
    throw new NangoBindingError('MAILBOX_ALREADY_CONNECTED');
  }

  const now = dependencies.now();
  let saved: { id: string };
  try {
    saved = await dependencies.repository.save({
      existingMailboxId: pendingBoundReference
        ? boundReference.connectionId
        : (existing?.id ?? null),
      connectionStatus: ready ? 'connected' : 'pending_configuration',
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
        externalData: effectiveExternalData,
      },
    });
  } catch (error) {
    const racedReference = await dependencies.repository.findByNangoReference(
      input.integrationId,
      input.connectionId,
    );
    if (racedReference !== null && racedReference.userId !== input.userId) {
      throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
    }
    if (racedReference !== null && racedReference.channelId !== input.channelId) {
      throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
    }
    const expectedConnectionId = pendingBoundReference
      ? boundReference.connectionId
      : (existing?.id ?? null);
    if (
      racedReference !== null &&
      expectedConnectionId !== null &&
      racedReference.connectionId !== expectedConnectionId
    ) {
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
  return { ...saved, identity, ready };
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
  endUserId: string | null,
): Promise<SafeNangoConnection[]> => {
  const summaries = (
    await client.listConnections(
      integrationId,
      endUserId === null ? undefined : { end_user_id: endUserId },
    )
  ).filter((summary) => endUserId === null || summary.tags.end_user_id === endUserId);
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
