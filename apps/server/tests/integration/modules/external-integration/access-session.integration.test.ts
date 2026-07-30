import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import {
  createAccessGrant,
  digestExternalSecret,
} from '../../../../src/modules/external-integration/application/create-access-grant';
import { createPostgresManagedUserRepository } from '../../../../src/modules/external-integration/postgres/managed-user-repository';
import { createPostgresExternalAccessRepository } from '../../../../src/modules/external-integration/postgres/repository';
import { provisionManagedUser } from '../../../../src/modules/external-integration/application/provision-managed-user';
import { createUserWorkspaceService } from '../../../../src/modules/user-workspace/service';
import type { MailInboundRuntimeResources } from '../../../../src/runtime/mail/inbound';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';
import type { RuntimeConfig } from '../../../../src/runtime/node/config';
import { createAuth } from '../../../../src/lib/auth';
import { session } from '../../../../src/db/schema';

const config = {
  nodeEnv: 'local',
  publicAppUrl: 'https://mail.zero.example.test',
  publicBackendUrl: 'https://api.zero.example.test',
  betterAuthTrustedOrigins: ['https://mail.zero.example.test'],
  cookieDomain: 'zero.example.test',
} as RuntimeConfig;

describe('managed Launch persistence and standard Session exchange', () => {
  it('stores only a code digest and consumes it once into a Better Auth Session', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      const managed = await provisionManagedUser(
        { externalUserId: 'user_200' },
        {
          repository: createPostgresManagedUserRepository(db),
          hashPassword: async (password) => `hashed:${password}`,
          now: () => new Date('2026-07-30T10:00:00.000Z'),
          newId: () => 'managed-user-1',
        },
      );
      await sql`
        INSERT INTO integration.connection (
          id, user_id, email, normalized_email, channel_id,
          status, provider_key, created_at, updated_at
        ) VALUES (
          'connection-gmail-1',
          ${managed.userId},
          'external@example.test',
          'external@example.test',
          'gmail',
          'connected',
          'gmail',
          now(),
          now()
        )
      `;
      await sql`
        INSERT INTO mail.account (id, connection_id, user_id)
        VALUES ('account-gmail-1', 'connection-gmail-1', ${managed.userId})
      `;

      const repository = createPostgresExternalAccessRepository(db);
      const { launchCode } = await createAccessGrant(
        { externalUserId: 'user_200' },
        {
          repository,
          clock: { now: () => new Date('2026-07-30T10:01:00.000Z') },
          nextId: () => 'grant-1',
          randomBytes,
        },
      );
      const [storedGrant] = await sql<Array<{ user_id: string; code_digest: string }>>`
        SELECT user_id, code_digest
        FROM integration.external_access_grant
        WHERE id = 'grant-1'
      `;
      expect(storedGrant).toEqual({
        user_id: managed.userId,
        code_digest: digestExternalSecret(launchCode),
      });
      expect(storedGrant!.code_digest).not.toBe(launchCode);

      const auth = createAuth({
        db,
        config,
        mail: {} as MailInboundRuntimeResources,
        userWorkspace: createUserWorkspaceService({ db }),
        email: { send: async () => undefined },
      });
      const response = await auth.api.consumeManagedLaunch({
        body: { launchCode },
        asResponse: true,
      });

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('https://mail.zero.example.test/mail/inbox');
      const cookie = response.headers.get('set-cookie');
      expect(cookie).toContain('better-auth');
      expect(cookie).not.toContain('zero-external-session');
      const storedSession = await db.query.session.findFirst({
        where: eq(session.userId, managed.userId),
      });
      expect(storedSession).toMatchObject({
        userId: managed.userId,
        authMethod: 'launch',
      });

      const repeated = await auth.api.consumeManagedLaunch({
        body: { launchCode },
        asResponse: true,
      });
      expect(repeated.status).toBe(400);
    });
  });
});
