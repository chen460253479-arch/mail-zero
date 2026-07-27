import { describe, expect, it } from 'vitest';

import { withMailTestDatabase } from '../../../../tests/mail-core/helpers/database';
import { createPostgresConnectionRepository } from './connection-repository';

const insertUser = async (
  sql: Parameters<Parameters<typeof withMailTestDatabase>[0]>[0]['sql'],
  id: string,
  email: string,
): Promise<void> => {
  await sql`
    INSERT INTO auth.user_account (
      id, name, email, email_verified, role, created_at, updated_at
    ) VALUES (
      ${id}, ${id}, ${email}, true, 'admin', now(), now()
    )
  `;
};

const zeroOAuthAuthorization = {
  authSource: 'zero_oauth' as const,
  credentialType: 'oauth2' as const,
  encryptedCredentialSnapshot: 'encrypted',
  accessTokenExpiresAt: new Date('2026-07-27T12:00:00.000Z'),
  credentialFetchedAt: new Date('2026-07-27T11:00:00.000Z'),
};

const gmailMailbox = {
  email: 'Owner@Example.com',
  normalizedEmail: 'owner@example.com',
  name: 'Owner',
  picture: '',
  channelId: 'gmail' as const,
  providerKey: 'gmail',
};

describe('PostgreSQL mail connection repository', () => {
  it('persists a connection and its authorization in one operation', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      let nextId = 0;
      const repository = createPostgresConnectionRepository(db, {
        newId: () => `generated-${++nextId}`,
        now: () => new Date('2026-07-27T11:00:00.000Z'),
      });

      const result = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });

      expect(result).toEqual({ id: 'generated-1' });
      await expect(repository.findOwnedConnection('user-1', result.id)).resolves.toMatchObject({
        id: 'generated-1',
        userId: 'user-1',
        normalizedEmail: 'owner@example.com',
        status: 'connected',
      });
      await expect(repository.findConnectionWithAuthorization('user-1', result.id)).resolves
        .toMatchObject({
          authorization: {
            id: 'generated-2',
            connectionId: 'generated-1',
            authSource: 'zero_oauth',
          },
        });
      await expect(repository.findFirstOwnedConnection('user-1')).resolves.toMatchObject({
        id: 'generated-1',
      });
      await expect(repository.listConnectionsWithAuthorization('user-1')).resolves.toMatchObject([
        {
          connection: { id: 'generated-1' },
          authorization: { id: 'generated-2' },
        },
      ]);
    });
  });

  it('rejects a second active binding for the same provider mailbox across users', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      await insertUser(sql, 'user-2', 'user-2@example.com');
      const repository = createPostgresConnectionRepository(db);
      await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });

      await expect(
        repository.saveBinding({
          userId: 'user-2',
          existingMailboxId: null,
          mailbox: gmailMailbox,
          authorization: zeroOAuthAuthorization,
        }),
      ).rejects.toMatchObject({ code: 'MAILBOX_ALREADY_CONNECTED' });
    });
  });

  it('reattaches authorization only to an owned disconnected connection', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      await insertUser(sql, 'user-2', 'user-2@example.com');
      const repository = createPostgresConnectionRepository(db);
      const created = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });
      await repository.removeAuthorizationBinding('user-1', created.id);
      await repository.markDisconnected(
        'user-1',
        created.id,
        new Date('2026-07-27T12:00:00.000Z'),
      );

      await expect(
        repository.saveBinding({
          userId: 'user-2',
          existingMailboxId: created.id,
          mailbox: gmailMailbox,
          authorization: zeroOAuthAuthorization,
        }),
      ).rejects.toMatchObject({ code: 'MAILBOX_IDENTITY_MISMATCH' });

      await expect(
        repository.saveBinding({
          userId: 'user-1',
          existingMailboxId: null,
          mailbox: { ...gmailMailbox, name: 'Owner Again' },
          authorization: zeroOAuthAuthorization,
        }),
      ).resolves.toEqual({ id: created.id });
      await expect(repository.findOwnedConnection('user-1', created.id)).resolves.toMatchObject({
        name: 'Owner Again',
        status: 'connected',
        disconnectedAt: null,
      });
    });
  });

  it('returns active conflicts globally but only returns disconnected mailboxes to their owner', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      await insertUser(sql, 'user-2', 'user-2@example.com');
      const repository = createPostgresConnectionRepository(db);
      const created = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });

      await expect(
        repository.findMailboxByNormalizedEmail(
          'user-2',
          gmailMailbox.channelId,
          gmailMailbox.normalizedEmail,
        ),
      ).resolves.toMatchObject({ id: created.id, status: 'connected' });

      await repository.removeAuthorizationBinding('user-1', created.id);
      await repository.markDisconnected(
        'user-1',
        created.id,
        new Date('2026-07-27T12:00:00.000Z'),
      );

      await expect(
        repository.findMailboxByNormalizedEmail(
          'user-1',
          gmailMailbox.channelId,
          gmailMailbox.normalizedEmail,
        ),
      ).resolves.toMatchObject({ id: created.id, status: 'disconnected' });
      await expect(
        repository.findMailboxByNormalizedEmail(
          'user-2',
          gmailMailbox.channelId,
          gmailMailbox.normalizedEmail,
        ),
      ).resolves.toBeNull();
    });
  });

  it('marks only an owned connection reconnect_required', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      await insertUser(sql, 'user-2', 'user-2@example.com');
      const repository = createPostgresConnectionRepository(db);
      const created = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });

      await expect(
        repository.markReconnectRequired('user-2', created.id),
      ).rejects.toMatchObject({ code: 'MAILBOX_NOT_FOUND' });
      await repository.markReconnectRequired('user-1', created.id);
      await expect(repository.findOwnedConnection('user-1', created.id)).resolves.toMatchObject({
        status: 'reconnect_required',
      });
    });
  });

  it('finds an existing Nango authorization by its external reference', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      const repository = createPostgresConnectionRepository(db);
      const created = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: {
          ...zeroOAuthAuthorization,
          authSource: 'nango',
          encryptedCredentialSnapshot: 'encrypted-nango-access-token',
          nangoConnectionId: 'nango-connection-1',
          nangoProviderConfigKey: 'gmail-primary',
        },
      });

      await expect(
        repository.findByNangoReference('gmail-primary', 'nango-connection-1'),
      ).resolves.toEqual({ connectionId: created.id });
      await expect(
        repository.findByNangoReference('gmail-primary', 'missing'),
      ).resolves.toBeNull();
    });
  });

  it('replaces credentials when the owner reauthorizes reconnect_required', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      await insertUser(sql, 'user-2', 'user-2@example.com');
      const repository = createPostgresConnectionRepository(db);
      const created = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });
      await repository.markReconnectRequired('user-1', created.id);

      await expect(
        repository.saveBinding({
          userId: 'user-1',
          existingMailboxId: null,
          mailbox: gmailMailbox,
          authorization: {
            ...zeroOAuthAuthorization,
            encryptedCredentialSnapshot: 'replacement-encrypted',
          },
        }),
      ).resolves.toEqual({ id: created.id });
      await expect(
        repository.findConnectionWithAuthorization('user-1', created.id),
      ).resolves.toMatchObject({
        connection: { status: 'connected' },
        authorization: { encryptedCredentialSnapshot: 'replacement-encrypted' },
      });

      await expect(
        repository.saveBinding({
          userId: 'user-2',
          existingMailboxId: null,
          mailbox: gmailMailbox,
          authorization: zeroOAuthAuthorization,
        }),
      ).rejects.toMatchObject({ code: 'MAILBOX_ALREADY_CONNECTED' });
    });
  });

  it('marks local mail data deleting, exposes Blob keys, and deletes by owned connection', async () => {
    await withMailTestDatabase(async ({ db, sql }) => {
      await insertUser(sql, 'user-1', 'user-1@example.com');
      const repository = createPostgresConnectionRepository(db);
      const created = await repository.saveBinding({
        userId: 'user-1',
        existingMailboxId: null,
        mailbox: gmailMailbox,
        authorization: zeroOAuthAuthorization,
      });
      await sql`
        INSERT INTO mail.account (id, connection_id, user_id)
        VALUES ('account-1', ${created.id}, 'user-1')
      `;
      await sql`
        INSERT INTO mail.blob (
          id, mail_account_id, sha256, size_bytes, content_type,
          object_key, status, ready_at
        ) VALUES (
          'blob-1', 'account-1', 'digest', 4, 'message/rfc822',
          'accounts/account-1/blobs/digest', 'ready', now()
        )
      `;

      await expect(
        repository.listBlobObjectKeys('user-1', created.id),
      ).resolves.toEqual(['accounts/account-1/blobs/digest']);
      await repository.markDeleting('user-1', created.id);
      const [states] = await sql<
        Array<{ connection_status: string; account_status: string }>
      >`
        SELECT c.status AS connection_status, a.status AS account_status
        FROM integration.connection c
        JOIN mail.account a ON a.connection_id = c.id
        WHERE c.id = ${created.id}
      `;
      expect(states).toEqual({
        connection_status: 'deleting',
        account_status: 'deleting',
      });

      await repository.deleteMailbox('user-1', created.id);
      const [counts] = await sql<Array<{ connections: number; accounts: number; blobs: number }>>`
        SELECT
          (SELECT count(*)::integer FROM integration.connection WHERE id = ${created.id})
            AS connections,
          (SELECT count(*)::integer FROM mail.account WHERE id = 'account-1') AS accounts,
          (SELECT count(*)::integer FROM mail.blob WHERE id = 'blob-1') AS blobs
      `;
      expect(counts).toEqual({ connections: 0, accounts: 0, blobs: 0 });
    });
  });
});
