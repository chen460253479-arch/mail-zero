export {
  databaseUrlFor,
  requireSafeDatabase,
  runFailureIndependentCleanup,
  withMailTestDatabase as withMailSyncTestDatabase,
} from '../../mail-core/helpers/database';

import type { Sql } from 'postgres';

export const insertMailSyncAccountFixture = async (sql: Sql): Promise<void> => {
  await sql`
    INSERT INTO auth.user_account (
      id, name, email, email_verified, role, created_at, updated_at
    ) VALUES (
      'user-1', 'User', 'user@example.com', true, 'admin', now(), now()
    )
  `;
  await sql`
    INSERT INTO integration.connection (
      id, user_id, email, normalized_email, channel_id, status,
      provider_key, created_at, updated_at
    ) VALUES (
      'connection-1', 'user-1', 'user@example.com', 'user@example.com',
      'gmail', 'connected', 'gmail', now(), now()
    )
  `;
  await sql`
    INSERT INTO mail.account (id, connection_id, user_id)
    VALUES ('account-1', 'connection-1', 'user-1')
  `;
};
