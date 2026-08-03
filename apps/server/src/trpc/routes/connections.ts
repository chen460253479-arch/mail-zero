import { mailSessionProcedure, privateProcedure, publicProcedure, router } from '../trpc';
import {
  bindManualMailbox,
  ManualMailboxBindingError,
} from '../../modules/mail-accounts/application/bind-manual-mailbox';
import {
  listSafeNangoConnections,
  NangoBindingError,
} from '../../modules/mail-accounts/application/bind-nango-mailbox';
import { provisionChannelMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-channel-mailbox';
import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { createMailboxLifecycleForDatabase } from '../../modules/mail-accounts/runtime/lifecycle-environment';
import { resolveGmailConnectMode } from '../../modules/mail-accounts/application/gmail-connection-options';
import {
  isDefaultConnectionSelectable,
  selectDefaultConnectionRecord,
} from '../../modules/mail-accounts/application/select-default-connection';
import { connectNangoMailbox } from '../../modules/mail-accounts/application/connect-nango-mailbox';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { manualCredentialSnapshotSchema } from '../../modules/mail-accounts/credentials/manual';
import { resolveFetchedNangoCredential } from '../../modules/mail-accounts/credentials/nango';
import { createIdentityMailChannelRegistry } from '../../runtime/mail/channel-registry';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { mailChannelIds, type MailChannelId } from '../../mail-channel/contracts';
import { createZohoWebhookSetup } from '../../runtime/mail/zoho-webhook-setup';
import { mailAccount } from '../../modules/mail/postgres/schema/accounts';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { NangoIntegrationError } from '../../integrations/nango/errors';
import type { RuntimeServices } from '../../runtime/node/services';
import { user as userTable } from '../../db/schema';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db';
import { z } from 'zod';

const withConfiguredNango = async <T>(
  services: RuntimeServices,
  run: (runtime: {
    client: RuntimeServices['nango'];
    channels: RuntimeServices['nangoChannels'];
  }) => Promise<T>,
): Promise<T> => {
  try {
    return await run({
      client: services.nango,
      channels: services.nangoChannels,
    });
  } catch (error) {
    if (
      error instanceof NangoIntegrationError &&
      (error.code === 'NANGO_NOT_CONFIGURED' || error.code === 'NANGO_INTEGRATION_UNAVAILABLE')
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: error.code,
      });
    }
    throw error;
  }
};

const getGmailAuthorizationOptionsForDatabase = async (db: DB, services: RuntimeServices) => {
  const repository = createSystemIntegrationRepository(db);
  const channelRepository = createChannelConfigRepository(db);
  const [zeroOAuth, channelConfig, nangoStatus] = await Promise.all([
    repository.get('gmail_zero_oauth'),
    channelRepository.get('gmail'),
    services.nangoChannels.getStatus('gmail'),
  ]);
  const availability = {
    zeroOAuthAvailable: zeroOAuth?.status === 'active',
    nangoAvailable: nangoStatus.state === 'available',
  };
  const selectedAuthSource =
    channelConfig?.authSource === 'zero_oauth' || channelConfig?.authSource === 'nango'
      ? channelConfig.authSource
      : null;
  return {
    ...availability,
    selectedAuthSource,
    mode: resolveGmailConnectMode({ ...availability, selectedAuthSource }),
  };
};

const integrationKeyByChannel = {
  gmail: 'gmail_zero_oauth',
  outlook: 'outlook_zero_oauth',
  zoho_mail: 'zoho_mail_zero_oauth',
} as const;

const getChannelAuthorizationOptionsForDatabase = async (
  db: DB,
  services: RuntimeServices,
  channelId: MailChannelId,
) => {
  const repository = createSystemIntegrationRepository(db);
  const channelRepository = createChannelConfigRepository(db);
  const [zeroOAuth, channelConfig, nangoStatus] = await Promise.all([
    channelId === 'imap_smtp'
      ? Promise.resolve(null)
      : repository.get(integrationKeyByChannel[channelId]),
    channelRepository.get(channelId),
    services.nangoChannels.getStatus(channelId),
  ]);
  const availability = {
    zeroOAuthAvailable: zeroOAuth?.status === 'active',
    nangoAvailable: nangoStatus.state === 'available',
    manualAvailable:
      channelId === 'imap_smtp' && defaultMailChannelRegistry.find('imap_smtp') !== undefined,
  };
  const selectedAuthSource =
    channelConfig?.authSource === 'zero_oauth' ||
    channelConfig?.authSource === 'nango' ||
    channelConfig?.authSource === 'manual'
      ? channelConfig.authSource
      : null;
  const mode =
    selectedAuthSource === 'zero_oauth' && availability.zeroOAuthAvailable
      ? 'zero_oauth'
      : selectedAuthSource === 'nango' && availability.nangoAvailable
        ? 'nango'
        : selectedAuthSource === 'manual' && availability.manualAvailable
          ? 'manual'
          : 'unavailable';
  return {
    channelId,
    ...availability,
    selectedAuthSource,
    mode,
  };
};

const getChannelAuthorizationOptions = async (
  services: RuntimeServices,
  channelId: MailChannelId,
) => await getChannelAuthorizationOptionsForDatabase(services.database.db, services, channelId);

const getGmailAuthorizationOptions = async (services: RuntimeServices) =>
  await getGmailAuthorizationOptionsForDatabase(services.database.db, services);

const mapNangoBindingError = (error: unknown): never => {
  if (error instanceof NangoBindingError) {
    const conflictCodes = new Set(['MAILBOX_ALREADY_CONNECTED', 'NANGO_CONNECTION_ALREADY_BOUND']);
    throw new TRPCError({
      code: conflictCodes.has(error.code) ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  if (error instanceof ManualMailboxBindingError) {
    throw new TRPCError({
      code: error.code === 'MAILBOX_ALREADY_CONNECTED' ? 'CONFLICT' : 'PRECONDITION_FAILED',
      message: error.code,
    });
  }
  throw error;
};

const mailChannelIdSchema = z.enum(mailChannelIds);

const listChannelNangoConnections = async (services: RuntimeServices, channelId: MailChannelId) => {
  if ((await getChannelAuthorizationOptions(services, channelId)).mode !== 'nango') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'MAIL_CHANNEL_UNAVAILABLE',
    });
  }
  return await withConfiguredNango(services, async (runtime) => {
    const integrationKey = await runtime.channels.requireIntegrationKey(channelId);
    const channel = createIdentityMailChannelRegistry(
      services.database.db,
      services.environment,
    ).get(channelId);
    const connections = await listSafeNangoConnections(
      integrationKey,
      runtime.client,
      async (connectionId) => {
        const connection = await runtime.client.getConnection(connectionId, integrationKey);
        const resolved = resolveFetchedNangoCredential(
          connection.credentials,
          connection.connection_config,
        );
        if (!channel.credentialTypes.has(resolved.credential.type)) {
          throw new Error('Unsupported Nango credential');
        }
        const identity = await channel.resolveIdentity({
          connectionId,
          credential: resolved.credential,
        });
        return { email: identity.email, displayName: identity.name };
      },
    );
    return connections.map(({ connectionId, email, displayName, authorizationStatus }) => ({
      connectionId,
      email,
      displayName,
      authorizationStatus,
    }));
  });
};

export const connectionsRouter = router({
  list: mailSessionProcedure.query(async ({ ctx }) => {
    const repository = createPostgresConnectionRepository(ctx.c.var.services!.database.db);
    const records = ctx.mailAccess.isAdministrator
      ? await repository.listAllConnectionsWithAuthorization()
      : await repository.listConnectionsWithAuthorization(ctx.mailAccess.userId);

    const disconnectedIds = records
      .filter(({ connection }) => connection.status === 'disconnected')
      .map(({ connection }) => connection.id);

    return {
      connections: records.map(({ connection, authorization }) => ({
        id: connection.id,
        email: connection.email,
        name: connection.name,
        picture: connection.picture,
        createdAt: connection.createdAt,
        channelId: connection.channelId,
        status: connection.status,
        authSource: authorization?.authSource ?? null,
        capabilities: Array.from(
          defaultMailChannelRegistry.find(connection.channelId)?.capabilities ?? [],
        ),
      })),
      disconnectedIds,
    };
  }),
  getGmailAuthorizationOptions: privateProcedure.query(
    async ({ ctx }) => await getGmailAuthorizationOptions(ctx.c.var.services!),
  ),
  getChannelAuthorizationOptions: privateProcedure
    .input(z.object({ channelId: mailChannelIdSchema }))
    .query(
      async ({ input, ctx }) =>
        await getChannelAuthorizationOptions(ctx.c.var.services!, input.channelId),
    ),
  listNangoGmailConnections: privateProcedure.query(
    async ({ ctx }) => await listChannelNangoConnections(ctx.c.var.services!, 'gmail'),
  ),
  listNangoConnections: privateProcedure
    .input(z.object({ channelId: mailChannelIdSchema }))
    .query(
      async ({ input, ctx }) =>
        await listChannelNangoConnections(ctx.c.var.services!, input.channelId),
    ),
  bindNango: privateProcedure
    .input(
      z.object({
        channelId: mailChannelIdSchema.default('gmail'),
        connectionId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const services = ctx.c.var.services!;
      try {
        return await connectNangoMailbox(
          {
            userId: ctx.sessionUser.id,
            channelId: input.channelId,
            connectionId: input.connectionId,
          },
          services,
        );
      } catch (error) {
        mapNangoBindingError(error);
      }
    }),
  bindManualImapSmtp: privateProcedure
    .input(manualCredentialSnapshotSchema.omit({ type: true }))
    .mutation(async ({ input, ctx }) => {
      const services = ctx.c.var.services!;
      const db = services.database.db;
      try {
        if (
          (await getChannelAuthorizationOptionsForDatabase(db, services, 'imap_smtp')).mode !==
          'manual'
        ) {
          throw new ManualMailboxBindingError('MAIL_CHANNEL_UNAVAILABLE');
        }
        const repository = createPostgresConnectionRepository(db);
        const binding = await bindManualMailbox(
          {
            userId: ctx.sessionUser.id,
            credential: { type: 'imap_smtp', ...input },
          },
          {
            channel: createIdentityMailChannelRegistry(db, services.environment).get('imap_smtp'),
            repository: {
              findMailboxByNormalizedEmail: (userId, channelId, normalizedEmail) =>
                repository.findMailboxByNormalizedEmail(userId, channelId, normalizedEmail),
              save: (bindingInput) =>
                repository.saveBinding({
                  userId: ctx.sessionUser.id,
                  ...bindingInput,
                }),
            },
            encryptionKey: services.config.credentialEncryptionKey,
            now: () => new Date(),
          },
        );
        await provisionChannelMailboxInDatabase(db, services, {
          userId: ctx.sessionUser.id,
          connectionId: binding.id,
          channelId: 'imap_smtp',
          identity: binding.identity,
        });
        return { id: binding.id };
      } catch (error) {
        mapNangoBindingError(error);
      }
    }),
  getZohoWebhookSetup: privateProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const services = ctx.c.var.services!;
      const db = services.database.db;
      const repository = createPostgresConnectionRepository(db);
      const connectionRecord =
        ctx.sessionUser.role === 'admin'
          ? await repository.findConnection(input.connectionId)
          : await repository.findOwnedConnection(ctx.sessionUser.id, input.connectionId);
      if (!connectionRecord || connectionRecord.channelId !== 'zoho_mail') {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const account = await db.query.mailAccount.findFirst({
        where: eq(mailAccount.connectionId, connectionRecord.id),
        columns: { id: true },
      });
      if (!account) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      const channelConfig = await createChannelConfigRepository(db).get('zoho_mail');
      if (!channelConfig?.inboxWatchEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ZOHO_MAIL_WEBHOOK_DISABLED',
        });
      }
      const setup = await createZohoWebhookSetup(services.environment, account.id);
      return { webhookUrl: setup.webhookUrl };
    }),
  setDefault: mailSessionProcedure
    .input(z.object({ connectionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { connectionId } = input;
      const db = ctx.c.var.services!.database.db;
      const repository = createPostgresConnectionRepository(db);
      const foundConnection = ctx.mailAccess.isAdministrator
        ? await repository.findConnection(connectionId)
        : await repository.findOwnedConnection(ctx.mailAccess.userId, connectionId);
      if (!foundConnection) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!isDefaultConnectionSelectable(foundConnection)) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      }
      await db
        .update(userTable)
        .set({ defaultConnectionId: connectionId, updatedAt: new Date() })
        .where(eq(userTable.id, ctx.mailAccess.userId));
    }),
  disconnect: privateProcedure
    .input(
      z.object({
        connectionId: z.string().uuid(),
        deleteLocalData: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const services = ctx.c.var.services!;
      const repository = createPostgresConnectionRepository(services.database.db);
      const targetConnection =
        ctx.sessionUser.role === 'admin'
          ? await repository.findConnection(input.connectionId)
          : await repository.findOwnedConnection(ctx.sessionUser.id, input.connectionId);
      if (!targetConnection) throw new TRPCError({ code: 'NOT_FOUND' });
      const result = await createMailboxLifecycleForDatabase(
        services.database.db,
        services,
      ).disconnect({
        ...input,
        userId: targetConnection.userId,
      });
      await services.database.db
        .update(userTable)
        .set({ defaultConnectionId: null, updatedAt: new Date() })
        .where(
          eq(userTable.defaultConnectionId, input.connectionId),
        );
      return result;
    }),
  deleteRetainedData: privateProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const services = ctx.c.var.services!;
      const repository = createPostgresConnectionRepository(services.database.db);
      const targetConnection =
        ctx.sessionUser.role === 'admin'
          ? await repository.findConnection(input.connectionId)
          : await repository.findOwnedConnection(ctx.sessionUser.id, input.connectionId);
      if (!targetConnection) throw new TRPCError({ code: 'NOT_FOUND' });
      return await createMailboxLifecycleForDatabase(
        services.database.db,
        services,
      ).deleteRetainedData({
        ...input,
        userId: targetConnection.userId,
      });
    }),
  getDefault: publicProcedure.query(async ({ ctx }) => {
    const db = ctx.c.var.services!.database.db;
    if (!ctx.sessionUser) return null;
    const repository = createPostgresConnectionRepository(db);
    const foundUser = await db.query.user.findFirst({
      where: eq(userTable.id, ctx.sessionUser.id),
    });
    const isAdministrator = ctx.sessionUser.role === 'admin';
    const records = isAdministrator
      ? await repository.listAllConnectionsWithAuthorization()
      : await repository.listConnectionsWithAuthorization(ctx.sessionUser.id);
    const record = selectDefaultConnectionRecord(records, foundUser?.defaultConnectionId ?? null);
    if (!record) return null;
    const { connection, authorization } = record;
    return {
      id: connection.id,
      email: connection.email,
      name: connection.name,
      picture: connection.picture,
      createdAt: connection.createdAt,
      channelId: connection.channelId,
      status: connection.status,
      authSource: authorization?.authSource ?? null,
      capabilities: Array.from(
        defaultMailChannelRegistry.find(connection.channelId)?.capabilities ?? [],
      ),
    };
  }),
});
