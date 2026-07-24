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
import { getMailChannel, listMailChannels } from '../../lib/mail-channel/registry';
import { deleteConnectionLocalData, getZeroDB } from '../../lib/server-utils';
import { mailChannelIds, type MailChannelId } from '../../lib/mail-channel/types';
import { listAvailableNangoChannels } from '../../lib/nango/channel-catalog';
import { resolveFetchedNangoCredential } from '../../lib/credentials/nango';
import { disableBrainFunction } from '../../lib/brain';
import { NangoClient } from '../../lib/nango/client';
import { Ratelimit } from '@upstash/ratelimit';
import type { EProviders } from '../../types';
import { TRPCError } from '@trpc/server';
import { env } from '../../env';
import { z } from 'zod';

const isNangoEnabled = () => Boolean(env.NANGO_BASE_URL && env.NANGO_SECRET_KEY);

const getNangoClient = () => {
  if (!env.NANGO_BASE_URL || !env.NANGO_SECRET_KEY) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'NANGO_NOT_CONFIGURED',
    });
  }
  return new NangoClient({
    baseUrl: env.NANGO_BASE_URL,
    secretKey: env.NANGO_SECRET_KEY,
    fetch,
  });
};

const getNangoCatalog = async (client: NangoClient) =>
  listAvailableNangoChannels(await client.listIntegrations(), listMailChannels());

const isCatalogSelectionValid = (
  catalog: Awaited<ReturnType<typeof getNangoCatalog>>,
  channelId: MailChannelId,
  integrationId: string,
) =>
  catalog.some(
    (channel) =>
      channel.channelId === channelId &&
      channel.integrations.some((integration) => integration.integrationId === integrationId),
  );

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
      await disableBrainFunction({
        id: connection.id,
        providerId: mailbox.providerId as EProviders,
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
        nangoEnabled: isNangoEnabled(),
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
            capabilities: Array.from(getMailChannel(connection.channelId).capabilities),
          };
        }),
        disconnectedIds,
      };
    }),
  nangoChannels: privateProcedure.query(async () => {
    if (!isNangoEnabled()) return [];
    return await getNangoCatalog(getNangoClient());
  }),
  nangoConnections: privateProcedure
    .input(
      z.object({
        channelId: z.enum(mailChannelIds),
        integrationId: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      const client = getNangoClient();
      const catalog = await getNangoCatalog(client);
      if (!isCatalogSelectionValid(catalog, input.channelId, input.integrationId)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'MAIL_CHANNEL_UNAVAILABLE',
        });
      }
      const channel = getMailChannel(input.channelId);
      return await listSafeNangoConnections(input.integrationId, client, async (connectionId) => {
        const connection = await client.getConnection(connectionId, input.integrationId);
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
      });
    }),
  bindNango: privateProcedure
    .input(
      z.object({
        channelId: z.enum(mailChannelIds),
        integrationId: z.string().min(1),
        connectionId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const client = getNangoClient();
      const catalog = await getNangoCatalog(client);
      const db = await getZeroDB(ctx.sessionUser.id);
      try {
        return await bindNangoMailbox(
          { ...input, userId: ctx.sessionUser.id },
          {
            client,
            getChannel: getMailChannel,
            isIntegrationAvailable: async (channelId, integrationId) =>
              isCatalogSelectionValid(catalog, channelId, integrationId),
            repository: {
              findMailboxByNormalizedEmail: (normalizedEmail) =>
                db.findConnectionByNormalizedEmail(normalizedEmail),
              findByNangoReference: (integrationId, connectionId) =>
                db.findAuthorizationByNangoReference(integrationId, connectionId),
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
                    mailbox.normalizedEmail,
                  );
                  if (existing && existing.channelId !== mailbox.channelId) {
                    throw new NangoBindingError('MAILBOX_IDENTITY_MISMATCH');
                  }
                  if (existing) throw new NangoBindingError('MAILBOX_ALREADY_CONNECTED');
                  throw error;
                }
              },
            },
            encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
            now: () => new Date(),
          },
        );
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
      capabilities: Array.from(getMailChannel(connection.channelId).capabilities),
    };
  }),
});
