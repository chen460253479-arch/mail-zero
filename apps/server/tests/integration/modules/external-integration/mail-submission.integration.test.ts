import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createPostgresExternalMailSubmissionRepository } from '../../../../src/modules/external-integration/postgres/mail-submission-repository';
import {
  authorizationBinding,
  connection,
  mailAccount,
  mailIdentity,
  mailTask,
  user,
} from '../../../../src/db/schema';
import type { ExternalMailSubmissionRecord } from '../../../../src/modules/external-integration/application/mail-submission';
import { createPostgresMailNotificationRepository } from '../../../../src/modules/mail-notifications/postgres/repository';
import { withMailTestDatabase } from '../../../helpers/mail-core/database';

const now = new Date('2026-08-05T08:00:00.000Z');

describe('external mail submission persistence', () => {
  it('resolves externalUserId + connectionId and atomically creates one durable task', async () => {
    await withMailTestDatabase(async ({ db }) => {
      await db.insert(user).values({
        id: 'user-1',
        name: 'CRM User 200',
        email: 'crm-user-200@example.test',
        emailVerified: true,
        username: 'crm_user_200',
        displayUsername: 'crm_user_200',
        role: 'user',
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(connection).values({
        id: 'internal-connection-1',
        userId: 'user-1',
        email: 'sender@example.test',
        normalizedEmail: 'sender@example.test',
        channelId: 'gmail',
        status: 'connected',
        providerKey: 'gmail',
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(authorizationBinding).values({
        id: 'binding-1',
        connectionId: 'internal-connection-1',
        authSource: 'nango',
        credentialType: 'oauth2',
        nangoConnectionId: 'connection_01',
        nangoProviderConfigKey: 'google-mail',
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(mailAccount).values({
        id: 'account-1',
        connectionId: 'internal-connection-1',
        userId: 'user-1',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(mailIdentity).values({
        id: 'identity-1',
        mailAccountId: 'account-1',
        email: 'sender@example.test',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });

      const repository = createPostgresExternalMailSubmissionRepository(db);
      await expect(repository.resolveScope('crm_user_200', 'connection_01')).resolves.toEqual({
        userId: 'user-1',
        mailAccountId: 'account-1',
        internalConnectionId: 'internal-connection-1',
        identityId: 'identity-1',
      });

      const record: ExternalMailSubmissionRecord = {
        id: 'external-submission-1',
        userId: 'user-1',
        mailAccountId: 'account-1',
        internalConnectionId: 'internal-connection-1',
        identityId: 'identity-1',
        externalUserId: 'crm_user_200',
        externalConnectionId: 'connection_01',
        idempotencyKey: 'crm-send-1001',
        requestFingerprint: 'a'.repeat(64),
        payload: {
          replyToMessageId: null,
          to: [{ email: 'customer@example.test' }],
          cc: [],
          bcc: [],
          subject: 'Itinerary',
          textBody: '',
          htmlBody: '<p>Your itinerary</p>',
          attachments: [],
          sendAt: null,
        },
        status: 'accepted',
        emailId: null,
        submissionId: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
      };

      await expect(repository.create({ record, taskId: 'task-1' })).resolves.toMatchObject({
        outcome: 'created',
        submission: { id: 'external-submission-1', publicStatus: 'accepted' },
      });
      await expect(repository.create({ record, taskId: 'task-2' })).resolves.toMatchObject({
        outcome: 'existing',
        submission: { id: 'external-submission-1' },
      });
      await expect(
        repository.create({
          record: { ...record, requestFingerprint: 'b'.repeat(64) },
          taskId: 'task-3',
        }),
      ).resolves.toMatchObject({ outcome: 'conflict' });

      const tasks = await db.select().from(mailTask).where(eq(mailTask.queue, 'external'));
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: 'task-1',
        type: 'prepare_external_mail_submission',
        payload: {
          type: 'prepare_external_mail_submission',
          submissionId: 'external-submission-1',
        },
      });

      await repository.recordProcessingFailure({
        id: record.id,
        code: 'ATTACHMENT_DOWNLOAD_FAILED',
        message: 'Attachment download failed',
        final: true,
        now: new Date('2026-08-05T08:01:00.000Z'),
      });
      const [notification] = await createPostgresMailNotificationRepository(db, {
        enabled: true,
      }).claim({
        owner: 'notification-worker',
        now: new Date('2026-08-05T08:01:01.000Z'),
        limit: 1,
        leaseForMs: 60_000,
      });
      expect(notification).toBeUndefined();
    });
  });
});
