import {
  bindNangoMailbox,
  listSafeNangoConnections,
  NangoBindingError,
} from '../../modules/mail-accounts/application/bind-nango-mailbox';
import {
  bindManualMailbox,
  ManualMailboxBindingError,
} from '../../modules/mail-accounts/application/bind-manual-mailbox';
import { provisionChannelMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-channel-mailbox';
import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { createMailboxLifecycleForDatabase } from '../../modules/mail-accounts/runtime/lifecycle-environment';
import { resolveGmailConnectMode } from '../../modules/mail-accounts/application/gmail-connection-options';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import { manualCredentialSnapshotSchema } from '../../modules/mail-accounts/credentials/manual';
import { withNangoRuntime, type NangoRuntime } from '../../modules/mail-accounts/runtime/nango';
import { resolveFetchedNangoCredential } from '../../modules/mail-accounts/credentials/nango';
import { createIdentityMailChannelRegistry } from '../../runtime/mail/channel-registry';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { mailChannelIds, type MailChannelId } from '../../mail-channel/contracts';
import { getNangoServiceForEnvironment } from '../../integrations/nango/runtime';
import { createZohoWebhookSetup } from '../../runtime/mail/zoho-webhook-setup';
import { mailAccount } from '../../modules/mail/postgres/schema/accounts';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { NangoIntegrationError } from '../../integrations/nango/errors';
import { user as userTable } from '../../db/schema';
import { Ratelimit } from '@upstash/ratelimit';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../../db';
import type { DB } from '../../db';
import { env } from '../../env';
import { z } from 'zod';

const nangoRuntimeConfig = () => ({
  databaseUrl: env.HYPERDRIVE.connectionString,
  NANGO_BASE_URL: env.NANGO_BASE_URL,
  NANGO_SECRET_KEY: env.NANGO_SECRET_KEY,
});

const withConfiguredNango = async <T>(run: (runtime: NangoRuntime) => Promise<T>): Promise<T> => {
  try {
    return await withNangoRuntime(nangoRuntimeConfig(), run);
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

const getGmailAuthorizationOptionsForDatabase = async (db: DB) => {
  const repository = createSystemIntegrationRepository(db);
  const channelRepository = createChannelConfigRepository(db);
  const [zeroOAuth, nangoMapping, channelConfig] = await Promise.all([
    repository.get('gmail_zero_oauth'),
    repository.getMapping('gmail', 'nango'),
    channelRepository.get('gmail'),
  ]);
  const nangoStatus = getNangoServiceForEnvironment(env).getStatus();
  const availability = {
    zeroOAuthAvailable: zeroOAuth?.status === 'active',
    nangoAvailable: nangoStatus.state === 'available' && nangoMapping !== null,
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

const getChannelAuthorizationOptionsForDatabase = async (db: DB, channelId: MailChannelId) => {
  const repository = createSystemIntegrationRepository(db);
  const channelRepository = createChannelConfigRepository(db);
  const [zeroOAuth, nangoMapping, channelConfig] = await Promise.all([
    channelId === 'imap_smtp'
      ? Promise.resolve(null)
      : repository.get(integrationKeyByChannel[channelId]),
    repository.getMapping(channelId, 'nango'),
    channelRepository.get(channelId),
  ]);
  const nangoStatus = getNangoServiceForEnvironment(env).getStatus();
  const availability = {
    zeroOAuthAvailable: zeroOAuth?.status === 'active',
    nangoAvailable: nangoStatus.state === 'available' && nangoMapping !== null,
    manualAvailable:
      channelId === 'imap_smtp' &&
      env.MAIL_PROTOCOL_WORKER_URL !== undefined &&
      env.MAIL_PROTOCOL_WORKER_SECRET !== undefined,
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

const getChannelAuthorizationOptions = async (channelId: MailChannelId) => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    return await getChannelAuthorizationOptionsForDatabase(db, channelId);
  } finally {
    await conn.end();
  }
};

const getGmailAuthorizationOptions = async () => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    return await getGmailAuthorizationOptionsForDatabase(db);
  } finally {
    await conn.end();
  }
};

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

const listChannelNangoConnections = async (channelId: MailChannelId) => {
  if ((await getChannelAuthorizationOptions(channelId)).mode !== 'nango') {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'MAIL_CHANNEL_UNAVAILABLE',
    });
  }
  return await withConfiguredNango(async (runtime) => {
    const mapping = await runtime.integrationRepository.getMapping(channelId, 'nango');
    if (!mapping) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'MAIL_CHANNEL_UNAVAILABLE',
      });
    }
    const database = createDb(env.HYPERDRIVE.connectionString);
    try {
      const channel = createIdentityMailChannelRegistry(database.db, env).get(channelId);
      const connections = await listSafeNangoConnections(
        mapping.externalIntegrationId,
        runtime.client,
        async (connectionId) => {
          const connection = await runtime.client.getConnection(
            connectionId,
            mapping.externalIntegrationId,
          );
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
    } finally {
      await database.conn.end();
    }
  });
};

export const connectionsRouter = router({
  list: privateProcedure
    .use(
      createRateLimiterMiddleware({
        limiter: Ratelimit.slidingWindow(120, '1m'),
        generatePrefix: ({ sessionUser }) => `ratelimit:get-connections-${sessionUser?.id}`,
      }),
    )
    .query(async ({ ctx }) => {
      const { sessionUser } = ctx;
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        const records = await createPostgresConnectionRepository(
          database.db,
        ).listConnectionsWithAuthorization(sessionUser.id);

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
      } finally {
        await database.conn.end();
      }
    }),
  getGmailAuthorizationOptions: privateProcedure.query(getGmailAuthorizationOptions),
  getChannelAuthorizationOptions: privateProcedure
    .input(z.object({ channelId: mailChannelIdSchema }))
    .query(async ({ input }) => await getChannelAuthorizationOptions(input.channelId)),
  listNangoGmailConnections: privateProcedure.query(
    async () => await listChannelNangoConnections('gmail'),
  ),
  listNangoConnections: privateProcedure
    .input(z.object({ channelId: mailChannelIdSchema }))
    .query(async ({ input }) => await listChannelNangoConnections(input.channelId)),
  bindNango: privateProcedure
    .input(
      z.object({
        channelId: mailChannelIdSchema.default('gmail'),
        connectionId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        if (
          (await getChannelAuthorizationOptionsForDatabase(database.db, input.channelId)).mode !==
          'nango'
        ) {
          throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
        }
        return await withConfiguredNango(async (runtime) => {
          const mapping = await runtime.integrationRepository.getMapping(input.channelId, 'nango');
          if (!mapping) {
            throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
          }
          const integrationId = mapping.externalIntegrationId;
          const connectionRepository = createPostgresConnectionRepository(database.db);
          const channels = createIdentityMailChannelRegistry(database.db, env);
          const binding = await bindNangoMailbox(
            {
              userId: ctx.sessionUser.id,
              channelId: input.channelId,
              integrationId,
              connectionId: input.connectionId,
            },
            {
              client: runtime.client,
              getChannel: (channelId) => channels.get(channelId),
              isIntegrationAvailable: async (channelId, candidateIntegrationId) =>
                channelId === input.channelId && candidateIntegrationId === integrationId,
              repository: {
                findMailboxByNormalizedEmail: (userId, channelId, normalizedEmail) =>
                  connectionRepository.findMailboxByNormalizedEmail(
                    userId,
                    channelId,
                    normalizedEmail,
                  ),
                findByNangoReference: (candidateIntegrationId, connectionId) =>
                  connectionRepository.findByNangoReference(candidateIntegrationId, connectionId),
                save: (bindingInput) =>
                  connectionRepository.saveBinding({
                    userId: ctx.sessionUser.id,
                    ...bindingInput,
                  }),
              },
              encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
              now: () => new Date(),
            },
          );
          await provisionChannelMailboxInDatabase(database.db, env, {
            userId: ctx.sessionUser.id,
            connectionId: binding.id,
            channelId: input.channelId,
            identity: {
              email: binding.identity.email,
              name: binding.identity.name,
            },
          });
          return { id: binding.id };
        });
      } catch (error) {
        mapNangoBindingError(error);
      } finally {
        await database.conn.end();
      }
    }),
  bindManualImapSmtp: privateProcedure
    .input(manualCredentialSnapshotSchema.omit({ type: true }))
    .mutation(async ({ input, ctx }) => {
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        if (
          (await getChannelAuthorizationOptionsForDatabase(database.db, 'imap_smtp')).mode !==
          'manual'
        ) {
          throw new ManualMailboxBindingError('MAIL_CHANNEL_UNAVAILABLE');
        }
        const repository = createPostgresConnectionRepository(database.db);
        const binding = await bindManualMailbox(
          {
            userId: ctx.sessionUser.id,
            credential: { type: 'imap_smtp', ...input },
          },
          {
            channel: createIdentityMailChannelRegistry(database.db, env).get('imap_smtp'),
            repository: {
              findMailboxByNormalizedEmail: (userId, channelId, normalizedEmail) =>
                repository.findMailboxByNormalizedEmail(userId, channelId, normalizedEmail),
              save: (bindingInput) =>
                repository.saveBinding({
                  userId: ctx.sessionUser.id,
                  ...bindingInput,
                }),
            },
            encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
            now: () => new Date(),
          },
        );
        await provisionChannelMailboxInDatabase(database.db, env, {
          userId: ctx.sessionUser.id,
          connectionId: binding.id,
          channelId: 'imap_smtp',
          identity: binding.identity,
        });
        return { id: binding.id };
      } catch (error) {
        mapNangoBindingError(error);
      } finally {
        await database.conn.end();
      }
    }),
  getZohoWebhookSetup: privateProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        const connectionRecord = await createPostgresConnectionRepository(
          database.db,
        ).findOwnedConnection(ctx.sessionUser.id, input.connectionId);
        if (!connectionRecord || connectionRecord.channelId !== 'zoho_mail') {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        const account = await database.db.query.mailAccount.findFirst({
          where: eq(mailAccount.connectionId, connectionRecord.id),
          columns: { id: true },
        });
        if (!account) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
        const channelConfig = await createChannelConfigRepository(database.db).get('zoho_mail');
        if (!channelConfig?.inboxWatchEnabled) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'ZOHO_MAIL_WEBHOOK_DISABLED',
          });
        }
        const setup = await createZohoWebhookSetup(env, account.id);
        return { webhookUrl: setup.webhookUrl };
      } finally {
        await database.conn.end();
      }
    }),
  setDefault: privateProcedure
    .input(z.object({ connectionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { connectionId } = input;
      const user = ctx.sessionUser;
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        const foundConnection = await createPostgresConnectionRepository(
          database.db,
        ).findOwnedConnection(user.id, connectionId);
        if (!foundConnection) throw new TRPCError({ code: 'NOT_FOUND' });
        await database.db
          .update(userTable)
          .set({ defaultConnectionId: connectionId, updatedAt: new Date() })
          .where(eq(userTable.id, user.id));
      } finally {
        await database.conn.end();
      }
    }),
  disconnect: privateProcedure
    .input(
      z.object({
        connectionId: z.string().uuid(),
        deleteLocalData: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        const result = await createMailboxLifecycleForDatabase(database.db, env).disconnect({
          ...input,
          userId: ctx.sessionUser.id,
        });
        await database.db
          .update(userTable)
          .set({ defaultConnectionId: null, updatedAt: new Date() })
          .where(
            and(
              eq(userTable.id, ctx.sessionUser.id),
              eq(userTable.defaultConnectionId, input.connectionId),
            ),
          );
        return result;
      } finally {
        await database.conn.end();
      }
    }),
  deleteRetainedData: privateProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        return await createMailboxLifecycleForDatabase(database.db, env).deleteRetainedData({
          ...input,
          userId: ctx.sessionUser.id,
        });
      } finally {
        await database.conn.end();
      }
    }),
  getDefault: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.sessionUser) return null;
    const database = createDb(env.HYPERDRIVE.connectionString);
    try {
      const repository = createPostgresConnectionRepository(database.db);
      const foundUser = await database.db.query.user.findFirst({
        where: eq(userTable.id, ctx.sessionUser.id),
      });
      const selectedConnection = foundUser?.defaultConnectionId
        ? ((await repository.findOwnedConnection(
            ctx.sessionUser.id,
            foundUser.defaultConnectionId,
          )) ?? (await repository.findFirstOwnedConnection(ctx.sessionUser.id)))
        : await repository.findFirstOwnedConnection(ctx.sessionUser.id);
      if (!selectedConnection) return null;
      const record = await repository.findConnectionWithAuthorization(
        ctx.sessionUser.id,
        selectedConnection.id,
      );
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
    } finally {
      await database.conn.end();
    }
  }),
});
