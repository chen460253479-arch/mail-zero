import { eq } from 'drizzle-orm';
import { getContext } from 'hono/context-storage';

import { authorizationBinding, connection } from '../db/schema';
import { createDb, type DB } from '../db';
import type { HonoContext } from '../ctx';
import { resolveConnectionCredential } from '../modules/mail-accounts/credentials/resolve';
import { createRetryingMailClient } from '../modules/mail-accounts/credentials/retry';
import { withNangoCredentialResolver } from '../modules/mail-accounts/runtime/nango';
import { loadGmailOAuthRuntimeConfig } from '../runtime/mail/gmail-oauth';
import { env } from '../env';
import { getMailChannel } from './mail-channel/registry';

export const getZeroDB = async (userId: string) => {
  const stub = env.ZERO_DB.get(env.ZERO_DB.idFromName(userId));
  return await stub.setMetaData(userId);
};

export const getActiveConnection = async () => {
  const c = getContext<HonoContext>();
  const { sessionUser, auth } = c.var;
  if (!sessionUser) throw new Error('Session Not Found');

  const db = await getZeroDB(sessionUser.id);
  const userData = await db.findUser();

  if (userData?.defaultConnectionId) {
    const activeConnection = await db.findUserConnection(userData.defaultConnectionId);
    if (activeConnection) return activeConnection;
  }

  const firstConnection = await db.findFirstConnection();
  if (firstConnection) return firstConnection;

  try {
    if (auth) {
      await auth.api.revokeSession({ headers: c.req.raw.headers });
      await auth.api.signOut({ headers: c.req.raw.headers });
    }
  } catch (error) {
    console.warn(
      `[getActiveConnection] Session cleanup failed for user ${sessionUser.id}:`,
      error,
    );
  }
  throw new Error('No connections found for user');
};

export type ConnectionWithAuthorization = {
  connection: typeof connection.$inferSelect;
  authorization: typeof authorizationBinding.$inferSelect | null;
};

export const findConnectionWithAuthorization = async (
  db: DB,
  connectionId: string,
): Promise<ConnectionWithAuthorization | undefined> => {
  const [record] = await db
    .select({
      connection,
      authorization: authorizationBinding,
    })
    .from(connection)
    .leftJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
    .where(eq(connection.id, connectionId))
    .limit(1);
  return record;
};

const getAuthErrorCode = (error: unknown): string => {
  const candidate = error as {
    code?: string | number;
    originalError?: { code?: string | number };
  };
  return String(candidate.code ?? candidate.originalError?.code ?? '');
};

const markReconnectRequired = async (connectionId: string): Promise<void> => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    await db
      .update(connection)
      .set({ status: 'reconnect_required', updatedAt: new Date() })
      .where(eq(connection.id, connectionId));
  } finally {
    await conn.end();
  }
};

export const connectionToDriver = async (record: ConnectionWithAuthorization) => {
  const isNango = record.authorization?.authSource === 'nango';
  const channel = getMailChannel(record.connection.channelId);
  const credential = await (async () => {
    try {
      return isNango
        ? await withNangoCredentialResolver(
            {
              databaseUrl: env.HYPERDRIVE.connectionString,
              encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
            },
            async (nango) =>
              await resolveConnectionCredential(record, env.CREDENTIAL_ENCRYPTION_KEY, {
                nango,
              }),
          )
        : await resolveConnectionCredential(record, env.CREDENTIAL_ENCRYPTION_KEY);
    } catch (error) {
      if (isNango && getAuthErrorCode(error) === 'INVALID_CREDENTIALS') {
        await markReconnectRequired(record.connection.id);
      }
      throw error;
    }
  })();
  if (credential.type !== 'oauth2') {
    throw new Error(`Credential ${credential.type} is not supported by ${channel.id}`);
  }
  const oauth =
    !isNango && channel.id === 'gmail'
      ? await loadGmailOAuthRuntimeConfig({
          databaseUrl: env.HYPERDRIVE.connectionString,
          encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
          redirectUri: `${env.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/gmail/connect/callback`,
        })
      : undefined;

  const createDriver = (resolved: typeof credential) =>
    channel.createClient({
      auth: {
        userId: record.connection.userId,
        accessToken: resolved.accessToken,
        refreshToken: resolved.refreshToken ?? '',
        email: record.connection.email,
      },
      oauth,
    });

  if (!isNango) return createDriver(credential);
  if (!record.authorization?.id) throw new Error('Nango authorization ID is missing');
  const authorizationId = record.authorization.id;

  return createRetryingMailClient({
    initialCredential: credential,
    createClient: createDriver,
    refreshCredential: async () =>
      await withNangoCredentialResolver(
        {
          databaseUrl: env.HYPERDRIVE.connectionString,
          encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
        },
        async (nango) => {
          await nango.repository.invalidate(authorizationId);
          const refreshed = await resolveConnectionCredential(
            record,
            env.CREDENTIAL_ENCRYPTION_KEY,
            { nango: { ...nango, forceRefresh: true } },
          );
          if (refreshed.type !== 'oauth2') {
            throw new Error(`Credential ${refreshed.type} is not supported by ${channel.id}`);
          }
          return refreshed;
        },
      ),
    classifyError: (error) => {
      const code = getAuthErrorCode(error);
      return {
        unauthorized: code === '401',
        unrecoverableAuth: code === 'INVALID_CREDENTIALS',
      };
    },
    onUnrecoverableAuth: async () => await markReconnectRequired(record.connection.id),
  });
};

export const resetConnection = async (connectionId: string): Promise<void> => {
  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    await db
      .update(connection)
      .set({
        status: 'reconnect_required',
        updatedAt: new Date(),
      })
      .where(eq(connection.id, connectionId));
  } finally {
    await conn.end();
  }
};
