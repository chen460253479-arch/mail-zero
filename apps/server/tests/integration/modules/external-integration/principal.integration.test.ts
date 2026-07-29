import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import {
  EXTERNAL_INTEGRATION_PRINCIPAL_EMAIL,
  EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
  ensureExternalIntegrationPrincipal,
} from '../../../../src/modules/external-integration/principal';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';
import { account, user } from '../../../../src/db/schema';

describe('external integration principal', () => {
  it('creates one stable principal without a login account', async () => {
    await withMailTestDatabase(async ({ db }) => {
      const first = await ensureExternalIntegrationPrincipal(db);
      const second = await ensureExternalIntegrationPrincipal(db);

      expect(first).toEqual({
        userId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
      });
      expect(second).toEqual(first);
      await expect(
        db.query.user.findFirst({
          where: eq(user.id, first.userId),
        }),
      ).resolves.toMatchObject({
        id: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
        email: EXTERNAL_INTEGRATION_PRINCIPAL_EMAIL,
        role: 'user',
      });
      await expect(
        db.query.account.findMany({
          where: eq(account.userId, first.userId),
        }),
      ).resolves.toEqual([]);
    });
  });
});
