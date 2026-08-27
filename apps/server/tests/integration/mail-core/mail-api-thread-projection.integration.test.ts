import type {
  EmailAggregateProjection,
  EmailId,
  EmailRecord,
  ThreadId,
  ThreadRecord,
} from '@zero/mail-core';
import { createDraft, createIdentity, createSubmission } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailSnoozeRepository } from '../../../src/modules/mail-snooze/postgres/repository';
import { createPostgresMailViewProjection } from '../../../src/modules/mail-api/projections/postgres';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('Mail API PostgreSQL Thread projection', () => {
  it('returns a bounded summary page and binds cursors to the mailbox', () =>
    withMailTestDatabase(async ({ db, sql, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'mail-api-view');
      const now = new Date('2026-01-01T00:00:00.000Z');
      await unitOfWork.run(async (tx) => {
        for (const index of [1, 2]) {
          const threadId = `view-thread-${index}` as ThreadId;
          const emailId = `view-email-${index}` as EmailId;
          const receivedAt = new Date(now.getTime() + index * 1_000);
          await tx.threads.insert({
            id: threadId,
            accountId: h.accountId,
            normalizedSubject: `subject-${index}`,
            latestReceivedAt: receivedAt,
            emailCount: 0,
            unreadCount: 0,
            hasAttachment: false,
            participantSummary: 'Sender',
            preview: `preview-${index}`,
            createdAt: now,
            updatedAt: receivedAt,
          } satisfies ThreadRecord);
          const record = {
            id: emailId,
            accountId: h.accountId,
            identityId: null,
            threadId,
            blobId: null,
            messageId: null,
            replyToEmailId: null,
            inReplyTo: [],
            references: [],
            subject: `Subject ${index}`,
            sentAt: null,
            receivedAt,
            sizeBytes: 1n,
            hasAttachment: false,
            lifecycle: 'received',
            draftRevision: 0,
            createdAt: now,
            updatedAt: now,
            destroyedAt: null,
            sender: [],
            from: [],
            replyTo: [],
            to: [{ email: `recipient-${index}@example.test` }],
            cc: [],
            bcc: [],
            preview: `preview-${index}`,
            textBody: '',
            htmlBody: '',
            parserVersion: 1,
            parseWarnings: [],
            parts: [],
            mailboxIds: [h.inbox.id],
            restoreMailboxIds: [],
            keywords: ['$seen'],
          } satisfies EmailRecord;
          await tx.emails.insert(record);
          await tx.mailAggregates.applyEmailDelta({
            accountId: h.accountId,
            before: null,
            after: {
              emailId,
              threadId,
              mailboxIds: [h.inbox.id],
              visible: true,
              unread: false,
              hasAttachment: false,
              receivedAt,
            } satisfies EmailAggregateProjection,
            now,
          });
          if (index === 2) {
            const older = {
              ...record,
              id: 'view-email-2-older' as EmailId,
              subject: 'Older',
              receivedAt: new Date(now.getTime() + 500),
              mailboxIds: [h.drafts.id],
              keywords: ['$flagged'],
            } satisfies EmailRecord;
            await tx.emails.insert(older);
            await tx.mailAggregates.applyEmailDelta({
              accountId: h.accountId,
              before: null,
              after: {
                emailId: older.id,
                threadId,
                mailboxIds: older.mailboxIds,
                visible: true,
                unread: true,
                hasAttachment: false,
                receivedAt: older.receivedAt,
              } satisfies EmailAggregateProjection,
              now,
            });
            await tx.emails.insert({
              ...record,
              id: 'view-email-2-unfiled' as EmailId,
              subject: 'Hidden newer',
              receivedAt: new Date(now.getTime() + 3_000),
              mailboxIds: [],
              keywords: ['$important'],
            });
          }
        }
      });
      await sql`
        INSERT INTO integration.crm_customer_marker (
          mail_account_id, email_id, customer_id, customer_name
        ) VALUES (
          ${h.accountId}, 'view-email-2', 'customer-123', '上海某某有限公司'
        )
      `;
      const projection = createPostgresMailViewProjection(db, 'thread-projection-cursor-key');
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'mail-api-view-foreign');
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          mailboxId: 'missing-mailbox',
          limit: 10,
        }),
      ).rejects.toMatchObject({ code: 'MAILBOX_NOT_FOUND' });
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          mailboxId: foreign.inbox.id,
          limit: 10,
        }),
      ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });
      await createPostgresMailSnoozeRepository(db).schedule({
        accountId: h.accountId,
        threadId: 'view-thread-2',
        wakeAt: new Date(now.getTime() + 60_000),
        restorePlan: [
          {
            emailId: 'view-email-2',
            addMailboxIds: [h.inbox.id],
            removeMailboxIds: [],
          },
        ],
        now,
      });
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          mailboxId: h.inbox.id,
          snoozed: true,
          limit: 10,
        }),
      ).resolves.toMatchObject({
        items: [{ id: 'view-thread-2' }],
      });
      const first = await projection.threadPage({
        accountId: h.accountId,
        mailboxId: h.inbox.id,
        limit: 1,
      });
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({
        id: 'view-thread-2',
        mailboxIds: { [h.inbox.id]: true, [h.drafts.id]: true },
        keywords: { $seen: true, $flagged: true, customer: true },
        customerMarkers: [{ customerId: 'customer-123', customerName: '上海某某有限公司' }],
        latestEmail: {
          id: 'view-email-2',
          to: [{ name: null, email: 'recipient-2@example.test' }],
        },
      });
      expect(first.items[0]?.emailIds).not.toContain('view-email-2-unfiled');
      expect(first.cursor).not.toBeNull();
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          mailboxId: h.drafts.id,
          cursor: first.cursor!,
          limit: 1,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          hasKeywords: ['customer'],
          limit: 10,
        }),
      ).resolves.toMatchObject({
        items: [{ id: 'view-thread-2' }],
      });
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          mailboxId: h.inbox.id,
          hasMailboxIds: [h.drafts.id],
          hasKeywords: ['$flagged'],
          unreadOnly: true,
          limit: 10,
        }),
      ).resolves.toMatchObject({
        items: [{ id: 'view-thread-2' }],
      });
      await expect(
        projection.threadDetail({
          accountId: h.accountId,
          threadId: 'view-thread-2',
        }),
      ).resolves.toMatchObject({
        customerMarkers: {
          'view-email-2': {
            customerId: 'customer-123',
            customerName: '上海某某有限公司',
          },
        },
      });
    }));

  it('projects the latest submission status for a Draft row', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'draft-submission-view');
      const identity = await createIdentity(h.dependencies, {
        accountId: h.accountId,
        name: 'Sender',
        email: 'sender@example.test',
        replyTo: null,
        makeDefault: true,
      });
      const draft = await createDraft(h.dependencies, {
        accountId: h.accountId,
        identityId: identity.id,
        replyToEmailId: null,
        to: [{ email: 'recipient@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Pending delivery',
        textBody: 'Body',
        htmlBody: '<p>Body</p>',
        attachments: [],
      });
      await createSubmission(h.dependencies, {
        accountId: h.accountId,
        emailId: draft.id,
        identityId: identity.id,
        idempotencyKey: 'pending-delivery',
        sendAt: null,
      });

      const projection = createPostgresMailViewProjection(db, 'thread-projection-cursor-key');
      await expect(
        projection.threadPage({
          accountId: h.accountId,
          mailboxId: h.drafts.id,
          lifecycle: 'draft',
          limit: 10,
        }),
      ).resolves.toMatchObject({
        items: [
          {
            latestEmail: {
              id: draft.id,
              submissionStatus: 'queued',
            },
          },
        ],
      });
    }));
});
