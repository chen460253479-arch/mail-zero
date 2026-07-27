import {
  bindNangoMailbox,
  listSafeNangoConnections,
  NangoBindingError,
} from '../../modules/mail-accounts/application/bind-nango-mailbox';
import { createPostgresConnectionRepository } from '../../modules/mail-accounts/postgres/connection-repository';
import { provisionGmailMailboxInDatabase } from '../../modules/mail-accounts/runtime/provision-gmail-mailbox';
import { createMailboxLifecycleForDatabase } from '../../modules/mail-accounts/runtime/lifecycle-environment';
import { resolveGmailConnectMode } from '../../modules/mail-accounts/application/gmail-connection-options';
import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import { withNangoRuntime, type NangoRuntime } from '../../modules/mail-accounts/runtime/nango';
import { resolveFetchedNangoCredential } from '../../modules/mail-accounts/credentials/nango';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { defaultMailChannelRegistry } from '../../mail-channel/registry';
import { NangoIntegrationError } from '../../integrations/nango/errors';
import { findMailChannel } from '../../lib/mail-channel/registry';
import { user as userTable } from '../../db/schema';
import { getZeroDB } from '../../lib/server-utils';
import { Ratelimit } from '@upstash/ratelimit';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../../db';
import { env } from '../../env';
import { z } from 'zod';

const nangoRuntimeConfig = () => ({
  databaseUrl: env.HYPERDRIVE.connectionString,
  encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
});

const withConfiguredNango = async <T>(run: (runtime: NangoRuntime) => Promise<T>): Promise<T> => {
  try {
    return await withNangoRuntime(nangoRuntimeConfig(), run);
  } catch (error) {
    if (error instanceof NangoIntegrationError && error.code === 'NANGO_NOT_CONFIGURED') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: error.code,
      });
    }
    throw error;
  }
};

const getGmailAuthorizationOptions = async () => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const repository = createSystemIntegrationRepository(db);
    const [zeroOAuth, nango, nangoMapping] = await Promise.all([
      repository.get('gmail_zero_oauth'),
      repository.get('nango'),
      repository.getMapping('gmail', 'nango'),
    ]);
    const availability = {
      zeroOAuthAvailable: zeroOAuth?.status === 'active',
      nangoAvailable: nango?.status === 'active' && nangoMapping !== null,
    };
    return {
      ...availability,
      mode: resolveGmailConnectMode(availability),
    };
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
      const db = await getZeroDB(sessionUser.id);
      const records = await db.findManyConnectionsWithAuthorization();

      const disconnectedIds = records
        .filter(({ connection }) => connection.status === 'disconnected')
        .map(({ connection }) => connection.id);

      return {
        connections: records.map(({ connection, authorization }) => {
          return {
            id: connection.id,
            email: connection.email,
            name: connection.name,
            picture: connection.picture,
            createdAt: connection.createdAt,
            channelId: connection.channelId,
            status: connection.status,
            authSource: authorization?.authSource ?? null,
            capabilities: Array.from(findMailChannel(connection.channelId)?.capabilities ?? []),
          };
        }),
        disconnectedIds,
      };
    }),
  getGmailAuthorizationOptions: privateProcedure.query(getGmailAuthorizationOptions),
  listNangoGmailConnections: privateProcedure.query(async () => {
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
        return await withConfiguredNango(async (runtime) => {
          const mapping = await runtime.integrationRepository.getMapping('gmail', 'nango');
          if (!mapping) {
            throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
          }
          const integrationId = mapping.externalIntegrationId;
          const connectionRepository = createPostgresConnectionRepository(database.db);
          return await bindNangoMailbox(
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
                save: async ({ mailbox, authorization }) => {
                  try {
                    const result = await connectionRepository.saveBinding({
                      userId: ctx.sessionUser.id,
                      existingMailboxId: null,
                      mailbox,
                      authorization,
                    });
                    await provisionGmailMailboxInDatabase(database.db, env, {
                      userId: ctx.sessionUser.id,
                      connectionId: result.id,
                      identity: {
                        email: mailbox.email,
                        name: mailbox.name,
                      },
                    });
                    return result;
                  } catch (error) {
                    if (
                      await connectionRepository.findByNangoReference(
                        authorization.nangoProviderConfigKey,
                        authorization.nangoConnectionId,
                      )
                    ) {
                      throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
                    }
                    const existing = await connectionRepository.findMailboxByNormalizedEmail(
                      ctx.sessionUser.id,
                      mailbox.channelId,
                      mailbox.normalizedEmail,
                    );
                    if (existing && existing.channelId !== mailbox.channelId) {
                      throw new NangoBindingError('MAILBOX_IDENTITY_MISMATCH');
                    }
                    if (existing && existing.status !== 'disconnected') {
                      throw new NangoBindingError('MAILBOX_ALREADY_CONNECTED');
                    }
                    throw error;
                  }
                },
              },
              encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
              now: () => new Date(),
            },
          );
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
      const db = await getZeroDB(user.id);
      const foundConnection = await db.findUserConnection(connectionId);
      if (!foundConnection) throw new TRPCError({ code: 'NOT_FOUND' });
      await db.updateUser({ defaultConnectionId: connectionId });
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
    const db = await getZeroDB(ctx.sessionUser.id);
    const user = await db.findUser();
    const selectedConnection = user?.defaultConnectionId
      ? (await db.findUserConnection(user.defaultConnectionId)) || (await db.findFirstConnection())
      : await db.findFirstConnection();
    if (!selectedConnection) return null;
    const record = await db.findConnectionWithAuthorization(selectedConnection.id);
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
      capabilities: Array.from(findMailChannel(connection.channelId)?.capabilities ?? []),
    };
  }),
});
