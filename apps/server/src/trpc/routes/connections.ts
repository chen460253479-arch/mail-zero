import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import {
  deleteConnectionLocalData,
  getZeroDB,
} from '../../lib/server-utils';
import {
  deleteRetainedMailboxData,
  disconnectAuthorization,
  type ConnectionLifecycleDependencies,
} from '../../lib/connection-lifecycle';
import { Ratelimit } from '@upstash/ratelimit';
import { TRPCError } from '@trpc/server';
import { disableBrainFunction } from '../../lib/brain';
import type { EProviders } from '../../types';
import { z } from 'zod';

const createLifecycleDependencies = async (
  userId: string,
): Promise<ConnectionLifecycleDependencies> => {
  const db = await getZeroDB(userId);
  return {
    repository: {
      getConnection: (connectionId) => db.findUserConnection(connectionId),
      removeAuthorizationBinding: (connectionId) =>
        db.removeAuthorizationBinding(connectionId),
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
      const connections = await db.findManyConnections();

      const disconnectedIds = connections
        .filter((connection) => connection.status === 'disconnected')
        .map((connection) => connection.id);

      return {
        connections: connections.map((connection) => {
          return {
            id: connection.id,
            email: connection.email,
            name: connection.name,
            picture: connection.picture,
            createdAt: connection.createdAt,
            channelId: connection.channelId,
            status: connection.status,
            providerId: connection.providerId,
          };
        }),
        disconnectedIds,
      };
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
    const connection = user?.defaultConnectionId
      ? (await db.findUserConnection(user.defaultConnectionId)) || (await db.findFirstConnection())
      : await db.findFirstConnection();
    if (!connection) return null;
    return {
      id: connection.id,
      email: connection.email,
      name: connection.name,
      picture: connection.picture,
      createdAt: connection.createdAt,
      channelId: connection.channelId,
      status: connection.status,
      providerId: connection.providerId,
    };
  }),
});
