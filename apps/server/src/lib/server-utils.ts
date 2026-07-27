import { getContext } from 'hono/context-storage';

import { createPostgresConnectionRepository } from '../modules/mail-accounts/postgres/connection-repository';
import { user } from '../db/schema';
import { createDb } from '../db';
import type { HonoContext } from '../ctx';
import { env } from '../env';
import { eq } from 'drizzle-orm';

export const getZeroDB = async (userId: string) => {
  const stub = env.ZERO_DB.get(env.ZERO_DB.idFromName(userId));
  return await stub.setMetaData(userId);
};

export const getActiveConnection = async () => {
  const c = getContext<HonoContext>();
  const { sessionUser, auth } = c.var;
  if (!sessionUser) throw new Error('Session Not Found');

  const database = createDb(env.HYPERDRIVE.connectionString);
  try {
    const repository = createPostgresConnectionRepository(database.db);
    const userData = await database.db.query.user.findFirst({
      where: eq(user.id, sessionUser.id),
    });

    if (userData?.defaultConnectionId) {
      const activeConnection = await repository.findOwnedConnection(
        sessionUser.id,
        userData.defaultConnectionId,
      );
      if (activeConnection) return activeConnection;
    }

    const firstConnection = await repository.findFirstOwnedConnection(sessionUser.id);
    if (firstConnection) return firstConnection;
  } finally {
    await database.conn.end();
  }

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
