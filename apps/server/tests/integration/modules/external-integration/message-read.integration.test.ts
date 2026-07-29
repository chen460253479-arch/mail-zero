import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
  ensureExternalIntegrationPrincipal,
} from '../../../../src/modules/external-integration/principal';
import { createPostgresExternalMessageRepository } from '../../../../src/modules/external-integration/postgres/repository';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

describe('external message PostgreSQL scope', () => {
  it('resolves only messages and attachments owned by the integration principal', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await ensureExternalIntegrationPrincipal(db);
      await sql`
        INSERT INTO auth.user_account (
          id, name, email, email_verified, role, created_at, updated_at
        ) VALUES (
          'normal-user', 'Normal User', 'normal@example.test', true, 'user', now(), now()
        )
      `;

      for (const owner of [
        {
          userId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
          suffix: 'external',
          nangoConnectionId: 'connect-gmail-1',
        },
        {
          userId: 'normal-user',
          suffix: 'normal',
          nangoConnectionId: 'connect-gmail-2',
        },
      ]) {
        await sql`
          INSERT INTO integration.connection (
            id, user_id, email, normalized_email, name, channel_id,
            status, provider_key, created_at, updated_at
          ) VALUES (
            ${`connection-${owner.suffix}`},
            ${owner.userId},
            ${`${owner.suffix}@example.test`},
            ${`${owner.suffix}@example.test`},
            ${owner.suffix},
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
            ${`authorization-${owner.suffix}`},
            ${`connection-${owner.suffix}`},
            'nango',
            'oauth2',
            ${owner.nangoConnectionId},
            'google-mail',
            now(),
            now()
          )
        `;
        await sql`
          INSERT INTO mail.account (id, connection_id, user_id)
          VALUES (
            ${`account-${owner.suffix}`},
            ${`connection-${owner.suffix}`},
            ${owner.userId}
          )
        `;
        await sql`
          INSERT INTO mail.thread (
            id, mail_account_id, normalized_subject, latest_received_at,
            email_count, unread_count, has_attachment
          ) VALUES (
            ${`thread-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            'trip',
            now(),
            1,
            1,
            true
          )
        `;
        await sql`
          INSERT INTO mail.email (
            id, mail_account_id, thread_id, message_id_header, subject,
            normalized_subject, preview, received_at, size_bytes,
            has_attachment, lifecycle
          ) VALUES (
            ${`email-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            ${`thread-${owner.suffix}`},
            ${`<${owner.suffix}@example.test>`},
            'Trip',
            'trip',
            'Trip preview',
            now(),
            1024,
            true,
            'received'
          )
        `;
        await sql`
          INSERT INTO mail.email_content (
            mail_account_id, email_id, parser_version, preview,
            parse_warnings, parsed_at
          ) VALUES (
            ${`account-${owner.suffix}`},
            ${`email-${owner.suffix}`},
            1,
            'Trip preview',
            ARRAY[]::text[],
            now()
          )
        `;
        await sql`
          INSERT INTO mail.blob (
            id, mail_account_id, sha256, size_bytes, content_type,
            object_key, status, ready_at
          ) VALUES (
            ${`blob-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            ${`sha-${owner.suffix}`},
            4,
            'application/pdf',
            ${`accounts/account-${owner.suffix}/blobs/sha-${owner.suffix}`},
            'ready',
            now()
          )
        `;
        await sql`
          INSERT INTO mail.email_part (
            id, mail_account_id, email_id, position, part_path,
            content_type, disposition, filename, blob_id, size_bytes, kind
          ) VALUES (
            ${`part-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            ${`email-${owner.suffix}`},
            0,
            '1',
            'application/pdf',
            'attachment',
            'invoice.pdf',
            ${`blob-${owner.suffix}`},
            4,
            'attachment'
          )
        `;
      }

      const repository = createPostgresExternalMessageRepository(db);

      await expect(
        repository.findMessageScope({
          messageId: 'email-external',
          ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
        }),
      ).resolves.toEqual({
        mailAccountId: 'account-external',
        nangoConnectionId: 'connect-gmail-1',
        channelId: 'gmail',
      });
      await expect(
        repository.findMessageScope({
          messageId: 'email-normal',
          ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
        }),
      ).resolves.toBeNull();
      await expect(
        repository.findAttachmentScope({
          attachmentId: 'part-external',
          ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
        }),
      ).resolves.toMatchObject({
        mailAccountId: 'account-external',
        emailId: 'email-external',
        blobId: 'blob-external',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 4n,
      });
      await expect(
        repository.findAttachmentScope({
          attachmentId: 'part-normal',
          ownerUserId: EXTERNAL_INTEGRATION_PRINCIPAL_USER_ID,
        }),
      ).resolves.toBeNull();
    });
  });
});
