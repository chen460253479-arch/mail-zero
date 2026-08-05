import { describe, expect, it } from 'vitest';

import {
  createPostgresExternalCustomerMarkerRepository,
  createPostgresExternalMessageRepository,
} from '../../../../src/modules/external-integration/postgres/repository';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

describe('external message PostgreSQL scope', () => {
  it('resolves messages and attachments globally by id for managed users', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await sql`
        INSERT INTO auth.user_account (
          id, name, email, email_verified, username, display_username,
          role, created_at, updated_at
        ) VALUES
          (
            'managed-user-a', 'Managed User A', 'managed-a@example.test', true,
            'external-a', 'external-a', 'user', now(), now()
          ),
          (
            'managed-user-b', 'Managed User B', 'managed-b@example.test', true,
            'external-b', 'external-b', 'user', now(), now()
          ),
          (
            'admin-user', 'Administrator', 'admin@example.test', true,
            'admin', 'admin', 'admin', now(), now()
          ),
          (
            'manual-user', 'Manual User', 'manual@example.test', true,
            'manual-user', 'manual-user', 'user', now(), now()
          ),
          (
            'internal-user', 'Internal User', 'internal@example.test', true,
            NULL, NULL, 'user', now(), now()
          )
      `;

      for (const owner of [
        {
          userId: 'managed-user-a',
          suffix: 'managed-a',
          nangoConnectionId: 'connect-gmail-1',
          authSource: 'nango',
        },
        {
          userId: 'managed-user-b',
          suffix: 'managed-b',
          nangoConnectionId: 'connect-gmail-2',
          authSource: 'nango',
        },
        {
          userId: 'admin-user',
          suffix: 'admin',
          nangoConnectionId: 'connect-admin',
          authSource: 'nango',
        },
        {
          userId: 'manual-user',
          suffix: 'manual',
          nangoConnectionId: null,
          authSource: 'manual',
        },
        {
          userId: 'internal-user',
          suffix: 'internal',
          nangoConnectionId: 'connect-internal',
          authSource: 'nango',
        },
      ]) {
        const messageDigest = 'a'.repeat(64);
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
        if (owner.authSource === 'nango') {
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
        } else {
          await sql`
            INSERT INTO integration.authorization_binding (
              id, connection_id, auth_source, credential_type,
              encrypted_credential_snapshot, credential_fetched_at,
              created_at, updated_at
            ) VALUES (
              ${`authorization-${owner.suffix}`},
              ${`connection-${owner.suffix}`},
              'manual',
              'basic',
              'encrypted-test-credential',
              now(),
              now(),
              now()
            )
          `;
        }
        await sql`
          INSERT INTO mail.account (id, connection_id, user_id)
          VALUES (
            ${`account-${owner.suffix}`},
            ${`connection-${owner.suffix}`},
            ${owner.userId}
          )
        `;
        await sql`
          INSERT INTO mail.blob (
            id, mail_account_id, kind, sha256, size_bytes, content_type,
            object_key, status, ready_at
          ) VALUES (
            ${`blob-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            'message_mime',
            ${messageDigest},
            4,
            'message/rfc822',
            ${`mail/users/${owner.userId}/accounts/account-${owner.suffix}/messages/sha256/aa/${messageDigest}`},
            'ready',
            now()
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
            id, mail_account_id, thread_id, blob_id, message_id_header, subject,
            normalized_subject, preview, received_at, size_bytes,
            has_attachment, lifecycle
          ) VALUES (
            ${`email-${owner.suffix}`},
            ${`account-${owner.suffix}`},
            ${`thread-${owner.suffix}`},
            ${`blob-${owner.suffix}`},
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
          INSERT INTO mail.email_part (
            id, mail_account_id, email_id, position, part_path,
            content_type, disposition, filename, raw_blob_id,
            offset_start, encoded_length, decoded_length, transfer_encoding, kind
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
            0,
            4,
            4,
            'binary',
            'attachment'
          )
        `;
      }

      const repository = createPostgresExternalMessageRepository(db);

      await expect(
        repository.findMessageScope({
          messageId: 'email-managed-a',
        }),
      ).resolves.toEqual({
        mailAccountId: 'account-managed-a',
        userId: 'managed-user-a',
        nangoConnectionId: 'connect-gmail-1',
        channelId: 'gmail',
      });
      await expect(
        repository.findMessageScope({
          messageId: 'email-managed-b',
        }),
      ).resolves.toEqual({
        mailAccountId: 'account-managed-b',
        userId: 'managed-user-b',
        nangoConnectionId: 'connect-gmail-2',
        channelId: 'gmail',
      });
      await expect(
        repository.findAttachmentScope({
          attachmentId: 'part-managed-a',
        }),
      ).resolves.toMatchObject({
        mailAccountId: 'account-managed-a',
        emailId: 'email-managed-a',
        partId: 'part-managed-a',
      });
      await expect(
        repository.findAttachmentScope({
          attachmentId: 'part-managed-b',
        }),
      ).resolves.toMatchObject({
        mailAccountId: 'account-managed-b',
        emailId: 'email-managed-b',
        partId: 'part-managed-b',
      });
      await expect(
        repository.findMessageScope({
          messageId: 'email-missing',
        }),
      ).resolves.toBeNull();
      for (const suffix of ['admin', 'manual', 'internal']) {
        await expect(
          repository.findMessageScope({
            messageId: `email-${suffix}`,
          }),
        ).resolves.toBeNull();
        await expect(
          repository.findAttachmentScope({
            attachmentId: `part-${suffix}`,
          }),
        ).resolves.toBeNull();
      }

      const markers = createPostgresExternalCustomerMarkerRepository(db);
      await expect(
        markers.setCustomerMarker({
          messageId: 'email-managed-a',
          marker: {
            marked: true,
            customerId: 'customer-123',
            customerName: '上海某某有限公司',
          },
        }),
      ).resolves.toEqual({
        messageId: 'email-managed-a',
        marked: true,
        customerId: 'customer-123',
        customerName: '上海某某有限公司',
      });

      const stored = await sql<Array<{ customer_id: string; customer_name: string }>>`
        SELECT customer_id, customer_name
        FROM integration.crm_customer_marker
        WHERE email_id = 'email-managed-a'
      `;
      expect(stored).toEqual([{ customer_id: 'customer-123', customer_name: '上海某某有限公司' }]);

      const stateAfterFirstMark = await sql<Array<{ state_version: string }>>`
        SELECT state_version::text
        FROM mail.account
        WHERE id = 'account-managed-a'
      `;
      await markers.setCustomerMarker({
        messageId: 'email-managed-a',
        marker: {
          marked: true,
          customerId: 'customer-123',
          customerName: '上海某某有限公司',
        },
      });
      const stateAfterDuplicate = await sql<Array<{ state_version: string }>>`
        SELECT state_version::text
        FROM mail.account
        WHERE id = 'account-managed-a'
      `;
      expect(stateAfterDuplicate[0]?.state_version).toBe(stateAfterFirstMark[0]?.state_version);

      const changes = await sql<Array<{ collection: string; entity_id: string }>>`
        SELECT collection, entity_id
        FROM mail.change
        WHERE mail_account_id = 'account-managed-a'
        ORDER BY collection, entity_id
      `;
      expect(changes).toEqual([
        { collection: 'email', entity_id: 'email-managed-a' },
        { collection: 'thread', entity_id: 'thread-managed-a' },
      ]);

      await expect(
        markers.setCustomerMarker({
          messageId: 'email-managed-a',
          marker: { marked: false },
        }),
      ).resolves.toEqual({
        messageId: 'email-managed-a',
        marked: false,
        customerId: null,
        customerName: null,
      });
      const removed = await sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM integration.crm_customer_marker
        WHERE email_id = 'email-managed-a'
      `;
      expect(removed[0]?.count).toBe(0);
      await expect(
        markers.setCustomerMarker({
          messageId: 'email-admin',
          marker: {
            marked: true,
            customerId: 'forbidden',
            customerName: 'Forbidden',
          },
        }),
      ).resolves.toBeNull();
    });
  });
});
