import {
  deleteRetainedMailboxData,
  disconnectAuthorization,
  type ConnectionLifecycleDependencies,
} from '../../lib/connection-lifecycle';
import {
  bindNangoMailbox,
  listSafeNangoConnections,
  NangoBindingError,
} from '../../lib/nango/bind';
import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import { resolveGmailConnectMode } from '../../lib/integrations/gmail-connection-options';
import { withNangoRuntime, type NangoRuntime } from '../../lib/credentials/nango-runtime';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { findMailChannel, getMailChannel } from '../../lib/mail-channel/registry';
import { deleteConnectionLocalData, getZeroDB } from '../../lib/server-utils';
import { resolveFetchedNangoCredential } from '../../lib/credentials/nango';
import { NangoIntegrationError } from '../../integrations/nango/errors';
import { disableBrainFunction } from '../../lib/brain';
import { Ratelimit } from '@upstash/ratelimit';
import type { EProviders } from '../../types';
import { TRPCError } from '@trpc/server';
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

const createLifecycleDependencies = async (
  userId: string,
): Promise<ConnectionLifecycleDependencies> => {
  const db = await getZeroDB(userId);
  return {
    repository: {
      getConnection: (connectionId) => db.findUserConnection(connectionId),
      removeAuthorizationBinding: (connectionId) => db.removeAuthorizationBinding(connectionId),
      markDisconnected: (connectionId, disconnectedAt) =>
        db.markConnectionDisconnected(connectionId, disconnectedAt),
      markDeleting: (connectionId) => db.markConnectionDeleting(connectionId),
      deleteMailbox: (connectionId) => db.deleteMailbox(connectionId),
    },
    stopMailboxTasks: async (connection) => {
      const mailbox = await db.findUserConnection(connection.id);
      if (!mailbox) return;
      const providerId = findMailChannel(mailbox.channelId)?.legacyProviderId;
      if (!providerId) return;
      await disableBrainFunction({
        id: connection.id,
        providerId: providerId as EProviders,
      });
    },
    cleanupLocalData: (connection) => deleteConnectionLocalData(connection.id),
    now: () => new Date(),
  };
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
  listNangoGmailConnections: privateProcedure.query(async ({ ctx }) => {
    return await withConfiguredNango(async (runtime) => {
      const mapping = await runtime.integrationRepository.getMapping('gmail', 'nango');
      if (!mapping) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MAIL_CHANNEL_UNAVAILABLE',
        });
      }
      const channel = getMailChannel('gmail');
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
          const identity = await channel.resolveIdentity({
            auth: {
              userId: ctx.sessionUser.id,
              accessToken: resolved.credential.accessToken,
              refreshToken: '',
              email: '',
            },
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
  }),
  bindNango: privateProcedure
    .input(z.object({ connectionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getZeroDB(ctx.sessionUser.id);
      try {
        return await withConfiguredNango(async (runtime) => {
          const mapping = await runtime.integrationRepository.getMapping('gmail', 'nango');
          if (!mapping) {
            throw new NangoBindingError('MAIL_CHANNEL_UNAVAILABLE');
          }
          const integrationId = mapping.externalIntegrationId;
          return await bindNangoMailbox(
            {
              userId: ctx.sessionUser.id,
              channelId: 'gmail',
              integrationId,
              connectionId: input.connectionId,
            },
            {
              client: runtime.client,
              getChannel: getMailChannel,
              isIntegrationAvailable: async (channelId, candidateIntegrationId) =>
                channelId === 'gmail' && candidateIntegrationId === integrationId,
              repository: {
                findMailboxByNormalizedEmail: (channelId, normalizedEmail) =>
                  db.findConnectionByNormalizedEmail(channelId, normalizedEmail),
                findByNangoReference: (candidateIntegrationId, connectionId) =>
                  db.findAuthorizationByNangoReference(candidateIntegrationId, connectionId),
                save: async ({ mailbox, authorization }) => {
                  try {
                    return await db.createMailboxWithAuthorization(mailbox, authorization);
                  } catch (error) {
                    if (
                      await db.findAuthorizationByNangoReference(
                        authorization.nangoProviderConfigKey,
                        authorization.nangoConnectionId,
                      )
                    ) {
                      throw new NangoBindingError('NANGO_CONNECTION_ALREADY_BOUND');
                    }
                    const existing = await db.findConnectionByNormalizedEmail(
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
      const dependencies = await createLifecycleDependencies(ctx.sessionUser.id);
      const result = await disconnectAuthorization(input, dependencies);
      const db = await getZeroDB(ctx.sessionUser.id);
      const user = await db.findUser();
      if (user?.defaultConnectionId === input.connectionId) {
        await db.updateUser({ defaultConnectionId: null });
      }
      return result;
    }),
  deleteRetainedData: privateProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dependencies = await createLifecycleDependencies(ctx.sessionUser.id);
      return await deleteRetainedMailboxData(input.connectionId, dependencies);
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
