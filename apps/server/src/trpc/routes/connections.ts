import {
  bindNangoMailbox,
  listSafeNangoConnections,
  NangoBindingError,
} from '../../modules/mail-accounts/application/bind-nango-mailbox';
import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { provisionGmailMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-gmail-mailbox';
import { createMailboxLifecycleForDatabase } from '../../modules/mail-accounts/runtime/lifecycle-environment';
import { resolveGmailConnectMode } from '../../modules/mail-accounts/application/gmail-connection-options';
import { createChannelConfigRepository } from '../../integrations/core/channel-config-repository';
import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import { withNangoRuntime, type NangoRuntime } from '../../modules/mail-accounts/runtime/nango';
import { resolveFetchedNangoCredential } from '../../modules/mail-accounts/credentials/nango';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { getNangoServiceForEnvironment } from '../../integrations/nango/runtime';
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
  throw error;
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
  listNangoGmailConnections: privateProcedure.query(async () => {
    if ((await getGmailAuthorizationOptions()).mode !== 'nango') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'MAIL_CHANNEL_UNAVAILABLE',
      });
    }
    return await withConfiguredNango(async (runtime) => {
      const mapping = await runtime.integrationRepository.getMapping('gmail', 'nango');
      if (!mapping) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MAIL_CHANNEL_UNAVAILABLE',
        });
      }
      const channel = defaultMailChannelRegistry.get('gmail');
      const connections = await listSafeNangoConnections(
        mapping.externalIntegrationId,
        runtime.client,
        async (connectionId) => {
          const connection = await runtime.client.getConnection(
            connectionId,
            mapping.externalIntegrationId,
          );
          const resolved = resolveFetchedNangoCredential(connection.credentials);
          if (resolved.credential.type !== 'oauth2') {
            throw new Error('Unsupported Nango credential');
          }
          const identity = await channel.resolveIdentity({ credential: resolved.credential });
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
  }),
  bindNango: privateProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const database = createDb(env.HYPERDRIVE.connectionString);
      try {
        if ((await getGmailAuthorizationOptionsForDatabase(database.db)).mode !== 'nango') {
          throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
        }
        return await withConfiguredNango(async (runtime) => {
          const mapping = await runtime.integrationRepository.getMapping('gmail', 'nango');
          if (!mapping) {
            throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
          }
          const integrationId = mapping.externalIntegrationId;
          const connectionRepository = createPostgresConnectionRepository(database.db);
          const binding = await bindNangoMailbox(
            {
              userId: ctx.sessionUser.id,
              channelId: 'gmail',
              integrationId,
              connectionId: input.connectionId,
            },
            {
              client: runtime.client,
              getChannel: (channelId) => defaultMailChannelRegistry.get(channelId),
              isIntegrationAvailable: async (channelId, candidateIntegrationId) =>
                channelId === 'gmail' && candidateIntegrationId === integrationId,
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
          await provisionGmailMailboxInDatabase(database.db, env, {
            userId: ctx.sessionUser.id,
            connectionId: binding.id,
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
