import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createPostgresManagedUserRepository } from '../../../../src/modules/external-integration/postgres/managed-user-repository';
import { provisionManagedUser } from '../../../../src/modules/external-integration/application/provision-managed-user';
import {
  AdminProvisioningConflictError,
  provisionAdmin,
} from '../../../../src/lib/admin-provisioning';
import { createUserWorkspaceService } from '../../../../src/modules/user-workspace/service';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';
import { account, user, userSettings } from '../../../../src/db/schema';

describe('managed user persistence', () => {
  it('creates an ordinary credential user atomically and allows the first administrator to coexist', () =>
    withMailTestDatabase(async ({ db }) => {
      const createdAt = new Date('2026-07-30T08:00:00.000Z');
      const managed = await provisionManagedUser(
        { externalUserId: 'user_200' },
        {
          repository: createPostgresManagedUserRepository(db),
          hashPassword: async (password) => `hashed:${password}`,
          now: () => createdAt,
          newId: () => 'managed-user-1',
        },
      );

      expect(managed).toEqual({ userId: 'managed-user-1', created: true });
      await expect(
        db.query.user.findFirst({ where: eq(user.id, managed.userId) }),
      ).resolves.toMatchObject({
        id: 'managed-user-1',
        username: 'user_200',
        displayUsername: 'user_200',
        role: 'user',
        mustChangePassword: true,
      });
      await expect(
        db.query.account.findFirst({ where: eq(account.userId, managed.userId) }),
      ).resolves.toMatchObject({
        providerId: 'credential',
        password: 'hashed:user_200',
      });
      await expect(
        db.query.userSettings.findFirst({
          where: eq(userSettings.userId, managed.userId),
        }),
      ).resolves.toBeDefined();

      const dependencies = {
        db,
        userWorkspace: createUserWorkspaceService({ db }),
      };
      await expect(
        provisionAdmin(
          {
            name: 'Zero Administrator',
            email: 'admin@example.test',
            password: 'initial-admin-password',
          },
          dependencies,
        ),
      ).resolves.toMatchObject({ created: true, email: 'admin@example.test' });

      await expect(
        provisionAdmin(
          {
            name: 'Other Administrator',
            email: 'other-admin@example.test',
            password: 'second-admin-password',
          },
          dependencies,
        ),
      ).rejects.toBeInstanceOf(AdminProvisioningConflictError);
    }));
});
