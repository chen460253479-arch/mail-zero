import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

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

const seedBoundMailbox = async (
  sql: Parameters<Parameters<typeof withMailTestDatabase>[0]>[0]['sql'],
) => {
  await sql`
    INSERT INTO integration.connection (
      id, user_id, email, normalized_email, channel_id,
      status, provider_key, created_at, updated_at
    ) VALUES (
      'connection-gmail-1',
      ${EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID},
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
    INSERT INTO integration.authorization_binding (
      id, connection_id, auth_source, credential_type,
      nango_connection_id, nango_provider_config_key,
      created_at, updated_at
    ) VALUES (
      'binding-gmail-1',
      'connection-gmail-1',
      'nango',
      'oauth2',
      'connect-gmail-1',
      'gmail',
      now(),
      now()
    )
  `;
  await sql`
    INSERT INTO mail.account (
      id, connection_id, user_id
    ) VALUES (
      'account-gmail-1',
      'connection-gmail-1',
      ${EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID}
    )
  `;
};

describe('external access grant and browser session persistence', () => {
  it('stores only digests and consumes the launch code once', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await ensureExternalIntegrationPrincipal(db);
      await seedBoundMailbox(sql);
      const repository = createPostgresExternalAccessRepository(db);
      const createdAt = new Date('2026-07-29T10:00:00.000Z');
      const { launchCode } = await createAccessGrant(
        {
          allowedNangoConnectIds: ['connect-gmail-1'],
        },
        {
          ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
          repository,
          clock: { now: () => createdAt },
          nextId: () => 'grant-1',
          randomBytes,
        },
      );

      const [storedGrant] = await sql<
        Array<{
          code_digest: string;
          scopes: Array<{
            nangoConnectionId: string;
            connectionId: string;
            mailAccountId: string;
          }>;
        }>
      >`
        SELECT code_digest, scopes
        FROM integration.external_access_grant
        WHERE id = 'grant-1'
      `;
      expect(storedGrant).toEqual({
        code_digest: digestExternalSecret(launchCode),
        scopes: [
          {
            nangoConnectionId: 'connect-gmail-1',
            connectionId: 'connection-gmail-1',
            mailAccountId: 'account-gmail-1',
          },
        ],
      });
      expect(storedGrant!.code_digest).not.toBe(launchCode);

      const consumedAt = new Date('2026-07-29T10:01:00.000Z');
      const first = await consumeLaunchCode(
        { launchCode },
        {
          repository,
          clock: { now: () => consumedAt },
          nextId: () => 'external-session-1',
          randomBytes,
        },
      );
      const [storedSession] = await sql<
        Array<{
          token_digest: string;
          active_connection_id: string;
        }>
      >`
        SELECT token_digest, active_connection_id
        FROM integration.external_browser_session
        WHERE id = 'external-session-1'
      `;
      expect(storedSession).toEqual({
        token_digest: digestExternalSecret(first.sessionToken),
        active_connection_id: 'connection-gmail-1',
      });
      expect(storedSession!.token_digest).not.toBe(first.sessionToken);

      await expect(
        consumeLaunchCode(
          { launchCode },
          {
            repository,
            clock: { now: () => consumedAt },
            nextId: () => 'external-session-2',
            randomBytes,
          },
        ),
      ).rejects.toMatchObject({
        code: 'LAUNCH_CODE_INVALID',
      });

      const [rawSecretMatches] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM (
          SELECT code_digest AS secret
          FROM integration.external_access_grant
          UNION ALL
          SELECT token_digest AS secret
          FROM integration.external_browser_session
        ) AS stored
        WHERE stored.secret IN (
          ${launchCode},
          ${first.sessionToken}
        )
      `;
      expect(rawSecretMatches?.count).toBe(0);
    });
  });
});
