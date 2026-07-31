import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import {
  createMailCoreMaintenance,
  type EmailAggregateProjection,
  type EmailId,
  type EmailRecord,
  type ThreadId,
  type ThreadRecord,
} from '@zero/mail-core';

import { mailbox, mailboxThread, thread } from '../../../src/modules/mail/postgres/schema';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

const at = (day: number) => new Date(`2026-02-${day.toString().padStart(2, '0')}T00:00:00.000Z`);

describe('PostgreSQL mail aggregate maintenance', () => {
  it('audits without writes, repairs every aggregate level, and is idempotent', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'aggregate-maintenance');
      const threadId = 'aggregate-maintenance-thread' as ThreadId;
      const threadRecord: ThreadRecord = {
        id: threadId,
        accountId: h.accountId,
        normalizedSubject: 'aggregate maintenance',
        latestReceivedAt: at(1),
        emailCount: 0,
        unreadCount: 0,
        hasAttachment: false,
        participantSummary: null,
        preview: null,
        createdAt: at(1),
        updatedAt: at(1),
      };
      const emailRecord: EmailRecord = {
        id: 'aggregate-maintenance-email' as EmailId,
        accountId: h.accountId,
        identityId: null,
        threadId,
        blobId: null,
        messageId: 'aggregate-maintenance@example.test',
        replyToEmailId: null,
        inReplyTo: [],
        references: [],
        subject: 'aggregate maintenance',
        preview: 'truth preview',
        sentAt: null,
        receivedAt: at(2),
        sizeBytes: 1n,
        hasAttachment: true,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: at(2),
        updatedAt: at(2),
        destroyedAt: null,
        sender: [],
        from: [{ name: 'Truth Sender', email: 'truth@example.test' }],
        replyTo: [],
        to: [],
        cc: [],
        bcc: [],
        textBody: '',
        htmlBody: '',
        parserVersion: 1,
        parseWarnings: [],
        parts: [],
        mailboxIds: [h.inbox.id],
        restoreMailboxIds: [],
        keywords: [],
      };
      const projection: EmailAggregateProjection = {
        emailId: emailRecord.id,
        threadId,
        mailboxIds: [h.inbox.id],
        visible: true,
        unread: true,
        hasAttachment: true,
        receivedAt: emailRecord.receivedAt,
      };

      await unitOfWork.run(async (tx) => {
        await tx.threads.insert(threadRecord);
        await tx.emails.insert(emailRecord);
        await tx.mailAggregates.applyEmailDelta({
          accountId: h.accountId,
          before: null,
          after: projection,
          now: at(2),
        });
      });

      await db
        .update(thread)
        .set({
          emailCount: 0,
          unreadCount: 0,
          hasAttachment: false,
          participantSummary: null,
          preview: 'corrupt',
        })
        .where(and(eq(thread.mailAccountId, h.accountId), eq(thread.id, threadId)));
      await db
        .update(mailbox)
        .set({ totalEmails: 0, unreadEmails: 0, totalThreads: 0, unreadThreads: 0 })
        .where(and(eq(mailbox.mailAccountId, h.accountId), eq(mailbox.id, h.inbox.id)));
      await db
        .delete(mailboxThread)
        .where(
          and(
            eq(mailboxThread.mailAccountId, h.accountId),
            eq(mailboxThread.mailboxId, h.inbox.id),
            eq(mailboxThread.threadId, threadId),
          ),
        );

      const maintenance = createMailCoreMaintenance(h.dependencies);
      const audit = await maintenance.reconcileMailAggregates({
        accountId: h.accountId,
        repair: false,
      });
      expect(audit.repaired).toBe(false);
      expect(audit.mismatches.map(({ entityType }) => entityType).sort()).toEqual([
        'mailbox',
        'mailbox_thread',
        'thread',
      ]);
      expect(
        audit.mismatches.find(({ entityType }) => entityType === 'mailbox_thread')?.actual,
      ).toBeNull();
      await unitOfWork.run(async (tx) => {
        expect(await tx.threads.findById(h.accountId, threadId)).toMatchObject({
          emailCount: 0,
          unreadCount: 0,
          preview: 'corrupt',
        });
        expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
          totalEmails: 0,
          unreadEmails: 0,
          totalThreads: 0,
          unreadThreads: 0,
        });
      });

      await expect(
        unitOfWork.run(async (tx) => {
          await tx.lockAccount(h.accountId);
          await tx.mailAggregateMaintenance.reconcile({
            accountId: h.accountId,
            repair: true,
            now: at(3),
          });
          throw new Error('force aggregate repair rollback');
        }),
      ).rejects.toThrow('force aggregate repair rollback');
      await unitOfWork.run(async (tx) => {
        expect(await tx.threads.findById(h.accountId, threadId)).toMatchObject({
          emailCount: 0,
          unreadCount: 0,
          preview: 'corrupt',
        });
        expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
          totalEmails: 0,
          unreadEmails: 0,
          totalThreads: 0,
          unreadThreads: 0,
        });
      });
      expect(
        await db
          .select()
          .from(mailboxThread)
          .where(
            and(
              eq(mailboxThread.mailAccountId, h.accountId),
              eq(mailboxThread.mailboxId, h.inbox.id),
              eq(mailboxThread.threadId, threadId),
            ),
          ),
      ).toEqual([]);

      const repair = await maintenance.reconcileMailAggregates({
        accountId: h.accountId,
        repair: true,
      });
      expect(repair.repaired).toBe(true);
      expect(repair.mismatches).toHaveLength(3);
      await unitOfWork.run(async (tx) => {
        expect(await tx.threads.findById(h.accountId, threadId)).toMatchObject({
          emailCount: 1,
          unreadCount: 1,
          latestReceivedAt: at(2),
          hasAttachment: true,
          participantSummary: 'Truth Sender',
          preview: 'truth preview',
        });
        expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
          totalEmails: 1,
          unreadEmails: 1,
          totalThreads: 1,
          unreadThreads: 1,
        });
      });
      const repairedMailboxThread = await db
        .select()
        .from(mailboxThread)
        .where(
          and(
            eq(mailboxThread.mailAccountId, h.accountId),
            eq(mailboxThread.mailboxId, h.inbox.id),
            eq(mailboxThread.threadId, threadId),
          ),
        );
      expect(repairedMailboxThread).toMatchObject([{ emailCount: 1, unreadCount: 1 }]);

      await expect(
        maintenance.reconcileMailAggregates({ accountId: h.accountId, repair: true }),
      ).resolves.toEqual({ mismatches: [], repaired: true });
    }));
});
