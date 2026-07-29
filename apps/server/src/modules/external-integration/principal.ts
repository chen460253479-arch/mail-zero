import { eq } from 'drizzle-orm';

import { user } from '../../db/schema';
import type { DB } from '../../db';

export const EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID = 'zero-external-integration' as const;
export const EXTERNAL_INTEGRATION_PRINCIPAL_EMAIL = 'external-integration@zero.invalid' as const;

export type IntegrationPrincipal = {
  userId: typeof EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID;
};

export const ensureExternalIntegrationPrincipal = async (db: DB): Promise<IntegrationPrincipal> =>
  await db.transaction(async (transaction) => {
    const now = new Date();
    await transaction
      .insert(user)
      .values({
        id: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
        name: 'External Integration',
        email: EXTERNAL_INTEGRATION_PRINCIPAL_EMAIL,
        emailVerified: true,
        role: 'user',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    const principal = await transaction.query.user.findFirst({
      columns: {
        id: true,
        email: true,
        role: true,
      },
      where: eq(user.id, EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID),
    });
    if (principal?.email !== EXTERNAL_INTEGRATION_PRINCIPAL_EMAIL || principal.role !== 'user') {
      throw new Error('EXTERNAL_INTEGRATION_PRINCIPAL_CONFLICT');
    }

    return {
      userId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
    };
  });
