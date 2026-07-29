import { getContext } from 'hono/context-storage';

import {
  createUserWorkspaceService,
  type UserWorkspaceService,
} from '../modules/user-workspace/service';
import { createPostgresConnectionRepository } from '../modules/mail-accounts/postgres/connection-repository';
import type { HonoContext } from '../ctx';
import { user } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createDb } from '../db';
import { env } from '../env';

let workspaceService: UserWorkspaceService | undefined;

export const configureUserWorkspaceService = (service: UserWorkspaceService) => {
  workspaceService = service;
};

const getUserWorkspaceService = () => {
  if (workspaceService) return workspaceService;
  const database = createDb(env.HYPERDRIVE.connectionString);
  workspaceService = createUserWorkspaceService({ db: database.db });
  return workspaceService;
};

export const getUserWorkspace = (userId: string) => getUserWorkspaceService().forUser(userId);

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
      await auth.api.signOut({ headers: c.req.raw.headers });
    }
  } catch (error) {
    console.warn(`[getActiveConnection] Session cleanup failed for user ${sessionUser.id}:`, error);
  }
  throw new Error('No connections found for user');
};
