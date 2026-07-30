import { eq, sql } from 'drizzle-orm';

import type {
  CreateManagedUserRecord,
  ManagedUserRepository,
} from '../application/provision-managed-user';
import { account, user, userSettings } from '../../../db/schema';
import { defaultUserSettings } from '../../../lib/schemas';
import type { DB } from '../../../db';

export const createPostgresManagedUserRepository = (db: DB): ManagedUserRepository => ({
  findByExternalUserId: async (externalUserId) => {
    const record = await db.query.user.findFirst({
      where: eq(user.username, externalUserId),
      columns: { id: true, role: true },
    });
    return record === undefined ? null : { userId: record.id, role: record.role };
  },

  create: async (record: CreateManagedUserRecord) =>
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`zero-managed-user:${record.externalUserId}`}))`,
      );
      const existing = await transaction.query.user.findFirst({
        where: eq(user.username, record.externalUserId),
        columns: { id: true },
      });
      if (existing !== undefined) return false;

      await transaction.insert(user).values({
        id: record.userId,
        name: record.name,
        email: record.email,
        emailVerified: record.emailVerified,
        username: record.externalUserId,
        displayUsername: record.externalUserId,
        role: record.role,
        mustChangePassword: record.mustChangePassword,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
      await transaction.insert(account).values({
        id: crypto.randomUUID(),
        accountId: record.userId,
        providerId: 'credential',
        userId: record.userId,
        password: record.passwordHash,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
      await transaction.insert(userSettings).values({
        id: crypto.randomUUID(),
        userId: record.userId,
        settings: defaultUserSettings,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
      return true;
    }),
});
