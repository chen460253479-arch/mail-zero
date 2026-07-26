import { describe, expect, it } from 'vitest';

import type {
  EmailAggregateProjection,
  EmailId,
  EmailRecord,
  ThreadId,
  ThreadRecord,
} from '@zero/mail-core';

import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

const at = (day: number) => new Date(`2026-01-${day.toString().padStart(2, '0')}T00:00:00.000Z`);

describe('PostgreSQL incremental mail aggregates', () => {
  it('maintains Mailbox Thread boundaries and Thread counters from Email deltas', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'aggregate-delta');
      const threadId = 'aggregate-delta-thread' as ThreadId;
      const thread: ThreadRecord = {
        id: threadId,
        accountId: h.accountId,
        normalizedSubject: 'aggregate delta',
        latestReceivedAt: at(1),
        emailCount: 0,
        unreadCount: 0,
        hasAttachment: false,
        participantSummary: null,
        preview: null,
        createdAt: at(1),
        updatedAt: at(1),
      };
      const email = (id: string, receivedAt: Date, unread: boolean): EmailRecord => ({
        id: id as EmailId,
        accountId: h.accountId,
        identityId: null,
        threadId,
        blobId: null,
        messageId: `${id}@example.test`,
        replyToEmailId: null,
        inReplyTo: [],
        references: [],
        subject: 'aggregate delta',
        preview: id,
        sentAt: null,
        receivedAt,
        sizeBytes: 1n,
        hasAttachment: false,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: receivedAt,
        updatedAt: receivedAt,
        destroyedAt: null,
        sender: [],
        from: [{ name: id, email: `${id}@example.test` }],
        replyTo: [],
        to: [],
        cc: [],
        bcc: [],
        textBlobId: null,
        htmlBlobId: null,
        parserVersion: 1,
        parseWarnings: [],
        parts: [],
        mailboxIds: [h.inbox.id],
        restoreMailboxIds: [],
        keywords: unread ? [] : ['$seen'],
      });
      const first = email('aggregate-delta-first', at(1), true);
      const second = email('aggregate-delta-second', at(2), false);
      second.to = [{ name: 'To Recipient', email: 'to@example.test' }];
      second.cc = [{ name: 'Cc Recipient', email: 'cc@example.test' }];
      const projection = (record: EmailRecord): EmailAggregateProjection => ({
        emailId: record.id,
        threadId: record.threadId,
        mailboxIds: record.mailboxIds,
        visible: record.destroyedAt === null && record.mailboxIds.length > 0,
        unread: !record.keywords.includes('$seen'),
        hasAttachment: record.hasAttachment,
        receivedAt: record.receivedAt,
      });

      await unitOfWork.run(async (tx) => {
        await tx.threads.insert(thread);
        await tx.emails.insert(first);
        await tx.mailAggregates.applyEmailDelta({
          accountId: h.accountId,
          before: null,
          after: projection(first),
          now: at(1),
        });
        await tx.emails.insert(second);
        await tx.mailAggregates.applyEmailDelta({
          accountId: h.accountId,
          before: null,
          after: projection(second),
          now: at(2),
        });
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.threads.findById(h.accountId, threadId)).toMatchObject({
          emailCount: 2,
          unreadCount: 1,
          latestReceivedAt: at(2),
          preview: second.preview,
          participantSummary: 'aggregate-delta-second, To Recipient, Cc Recipient',
        });
        expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
          totalEmails: 2,
          unreadEmails: 1,
          totalThreads: 1,
          unreadThreads: 1,
        });
      });

      await unitOfWork.run(async (tx) => {
        await tx.emails.update(h.accountId, first.id, { keywords: ['$seen'] });
        await tx.mailAggregates.applyEmailDelta({
          accountId: h.accountId,
          before: projection(first),
          after: projection({ ...first, keywords: ['$seen'] }),
          now: at(3),
        });
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.threads.findById(h.accountId, threadId)).toMatchObject({
          emailCount: 2,
          unreadCount: 0,
        });
        expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
          totalEmails: 2,
          unreadEmails: 0,
          totalThreads: 1,
          unreadThreads: 0,
        });
      });

      await unitOfWork.run(async (tx) => {
        for (const record of [first, second]) {
          const before = projection({
            ...record,
            keywords: ['$seen'],
          });
          await tx.emails.update(h.accountId, record.id, {
            destroyedAt: at(4),
            mailboxIds: [],
          });
          await tx.mailAggregates.applyEmailDelta({
            accountId: h.accountId,
            before,
            after: null,
            now: at(4),
          });
        }
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.threads.findById(h.accountId, threadId)).toMatchObject({
          emailCount: 0,
          unreadCount: 0,
        });
        expect(await tx.mailboxes.findById(h.accountId, h.inbox.id)).toMatchObject({
          totalEmails: 0,
          unreadEmails: 0,
          totalThreads: 0,
          unreadThreads: 0,
        });
      });
    }));
});
