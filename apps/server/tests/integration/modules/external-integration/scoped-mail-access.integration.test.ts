import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';

import {
  listScopedConnections,
  setScopedActiveConnection,
} from '../../../../src/modules/external-integration/application/list-scoped-connections';
import {
  EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
  ensureExternalIntegrationPrincipal,
} from '../../../../src/modules/external-integration/principal';
import {
  createAccessGrant,
  digestExternalSecret,
} from '../../../../src/modules/external-integration/application/create-access-grant';
import { createPostgresExternalAccessRepository } from '../../../../src/modules/external-integration/postgres/repository';
import { consumeLaunchCode } from '../../../../src/modules/external-integration/application/consume-launch-code';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

const seedMailbox = async (sql: Sql, suffix: string, channelId: 'gmail' | 'outlook') => {
  await sql`
    INSERT INTO integration.connection (
      id, user_id, email, normalized_email, channel_id,
      status, provider_key, created_at, updated_at
    ) VALUES (
      ${`connection-${suffix}`},
      ${EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID},
      ${`${suffix}@example.test`},
      ${`${suffix}@example.test`},
      ${channelId},
      'connected',
      ${channelId},
      now(),
      now()
    )
  `;
  await sql`
    INSERT INTO integration.authorization_binding (
      id, connection_id, auth_source, credential_type,
      nango_connection_id, nango_provider_config_key,
      created_at, updated_at
    ) VALUES (
      ${`binding-${suffix}`},
      ${`connection-${suffix}`},
      'nango',
      'oauth2',
      ${`connect-${suffix}`},
      ${channelId},
      now(),
      now()
    )
  `;
  await sql`
    INSERT INTO mail.account (
      id, connection_id, user_id
    ) VALUES (
      ${`account-${suffix}`},
      ${`connection-${suffix}`},
      ${EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID}
    )
  `;
};

describe('external scoped mailbox access', () => {
  it('lists and switches only granted connections without changing the user default', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await ensureExternalIntegrationPrincipal(db);
      await seedMailbox(sql, 'one', 'gmail');
      await seedMailbox(sql, 'two', 'outlook');
      await seedMailbox(sql, 'three', 'gmail');
      const repository = createPostgresExternalAccessRepository(db);
      const now = new Date('2026-07-29T10:00:00.000Z');
      const { launchCode } = await createAccessGrant(
        {
          allowedNangoConnectIds: ['connect-one', 'connect-two'],
        },
        {
          ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
          repository,
          clock: { now: () => now },
          nextId: () => 'grant-scoped',
          randomBytes,
        },
      );
      const { session, sessionToken } = await consumeLaunchCode(
        { launchCode },
        {
          repository,
          clock: { now: () => now },
          nextId: () => 'external-session-scoped',
          randomBytes,
        },
      );

      const listed = await listScopedConnections(session, repository);
      expect(listed.map(({ id }) => id)).toEqual(['connection-one', 'connection-two']);

      const switched = await setScopedActiveConnection(session, 'connection-two', repository, now);
      expect(switched.activeConnectionId).toBe('connection-two');
      await expect(
        setScopedActiveConnection(switched, 'connection-three', repository, now),
      ).rejects.toMatchObject({
        code: 'EXTERNAL_SESSION_SCOPE_NOT_FOUND',
      });

      await expect(
        repository.findSessionByDigest({
          tokenDigest: digestExternalSecret(sessionToken),
          now,
        }),
      ).resolves.toMatchObject({
        activeConnectionId: 'connection-two',
      });
      const [principal] = await sql<Array<{ default_connection_id: string | null }>>`
        SELECT default_connection_id
        FROM auth.user_account
        WHERE id = ${EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID}
      `;
      expect(principal?.default_connection_id).toBeNull();
    });
  });
});
