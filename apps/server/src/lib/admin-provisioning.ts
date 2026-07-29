import { hashPassword } from 'better-auth/crypto';
import { and, count, eq, sql } from 'drizzle-orm';

import {
  parseAdminProvisioningConfig,
  validateAdminCredentials,
  type AdminCredentials,
} from './admin-provisioning-policy';
import { getUserWorkspace } from './server-utils';
import { defaultUserSettings } from './schemas';
import { account, user } from '../db/schema';
import { createDb } from '../db';
import { env } from '../env';

export type ProvisionAdminResult = {
  created: boolean;
  email: string;
  userId: string;
};

export class AdminProvisioningConflictError extends Error {}

export const provisionAdmin = async (
  credentials: AdminCredentials,
): Promise<ProvisionAdminResult> => {
  const normalized = validateAdminCredentials(credentials);
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  const { db, conn } = createDb(connectionString);

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('zero-local-superadmin'))`);

      const [userCount] = await tx.select({ value: count() }).from(user);
      const [existingUser] = await tx.select().from(user).where(eq(user.email, normalized.email));

      if (userCount?.value) {
        if (userCount.value === 1 && existingUser) {
          const [credentialAccount] = await tx
            .select()
            .from(account)
            .where(and(eq(account.userId, existingUser.id), eq(account.providerId, 'credential')));
          if (credentialAccount) {
            return {
              created: false,
              email: existingUser.email,
              userId: existingUser.id,
            };
          }

          const now = new Date();
          await tx
            .update(user)
            .set({
              name: normalized.name,
              emailVerified: true,
              role: 'admin',
              updatedAt: now,
            })
            .where(eq(user.id, existingUser.id));
          await tx.insert(account).values({
            id: crypto.randomUUID(),
            accountId: existingUser.id,
            providerId: 'credential',
            userId: existingUser.id,
            password: await hashPassword(normalized.password),
            createdAt: now,
            updatedAt: now,
          });

          return {
            created: true,
            email: existingUser.email,
            userId: existingUser.id,
          };
        }

        throw new AdminProvisioningConflictError(
          'Zero already contains a user. Local superadmin provisioning is intentionally one-time.',
        );
      }

      const now = new Date();
      const userId = crypto.randomUUID();
      await tx.insert(user).values({
        id: userId,
        name: normalized.name,
        email: normalized.email,
        emailVerified: true,
        role: 'admin',
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: await hashPassword(normalized.password),
        createdAt: now,
        updatedAt: now,
      });

      return { created: true, email: normalized.email, userId };
    });

    const workspace = getUserWorkspace(result.userId);
    const settings = await workspace.findUserSettings();
    if (!settings) await workspace.insertUserSettings(defaultUserSettings);

    return result;
  } finally {
    await conn.end();
  }
};

let configuredProvisioning: Promise<ProvisionAdminResult | null> | undefined;

export const ensureConfiguredAdmin = () => {
  configuredProvisioning ??= (async () => {
    const credentials = parseAdminProvisioningConfig(env);
    if (!credentials) return null;
    return provisionAdmin(credentials);
  })();
  return configuredProvisioning;
};
