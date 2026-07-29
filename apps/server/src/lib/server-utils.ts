import { getContext } from 'hono/context-storage';

import { createPostgresConnectionRepository } from '../modules/mail-accounts/postgres/connection-repository';
import type { UserWorkspaceService } from '../modules/user-workspace/service';
import type { HonoContext } from '../ctx';
import { user } from '../db/schema';
import { eq } from 'drizzle-orm';

let workspaceService: UserWorkspaceService | undefined;

export const configureUserWorkspaceService = (service: UserWorkspaceService) => {
  workspaceService = service;
};

const getUserWorkspaceService = () => {
  if (workspaceService) return workspaceService;
  throw new Error('User workspace service is not configured');
};

export const getUserWorkspace = (userId: string) => getUserWorkspaceService().forUser(userId);

export const getActiveConnection = async () => {
  const c = getContext<HonoContext>();
  const { sessionUser, auth, services } = c.var;
  if (!sessionUser) throw new Error('Session Not Found');
  if (!services) throw new Error('Runtime services are not configured');

  const db = services.database.db;
  const repository = createPostgresConnectionRepository(db);
  const userData = await db.query.user.findFirst({
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

  try {
    if (auth) {
      await auth.api.signOut({ headers: c.req.raw.headers });
    }
  } catch (error) {
    console.warn(`[getActiveConnection] Session cleanup failed for user ${sessionUser.id}:`, error);
  }
  throw new Error('No connections found for user');
};
