import { describe, expect, it } from 'vitest';

import {
  queryThreads,
  type EmailId,
  type EmailRecord,
  type MailboxId,
  type ThreadId,
  type ThreadRecord,
} from '@zero/mail-core';

import { createPostgresMailTestHarness } from './helpers/harness';
import { withMailTestDatabase } from './helpers/database';

const at = (day: number): Date =>
  new Date(`2026-01-${day.toString().padStart(2, '0')}T00:00:00.000Z`);

describe('PostgreSQL Thread query repository', () => {
  it('pages visible Threads by their latest visible Email and filters by Mailbox', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const h = await createPostgresMailTestHarness(db, unitOfWork, 'thread-query');
      const makeThread = (id: string, latestReceivedAt: Date): ThreadRecord => ({
        id: id as ThreadId,
        accountId: h.accountId,
        normalizedSubject: id,
        latestReceivedAt,
        emailCount: 99,
        unreadCount: 0,
        hasAttachment: false,
        participantSummary: null,
        preview: null,
        createdAt: at(1),
        updatedAt: at(9),
      });
      const makeEmail = (
        id: string,
        threadId: ThreadId,
        receivedAt: Date,
        mailboxIds: MailboxId[],
        destroyedAt: Date | null = null,
      ): EmailRecord => ({
        id: id as EmailId,
        accountId: h.accountId,
        identityId: null,
        threadId,
        blobId: null,
        messageId: `${id}@example.test`,
        replyToEmailId: null,
        inReplyTo: [],
        references: [],
        subject: id,
        preview: id,
        sentAt: null,
        receivedAt,
        sizeBytes: 0n,
        hasAttachment: false,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: receivedAt,
        updatedAt: receivedAt,
        destroyedAt,
        sender: [],
        from: [],
        replyTo: [],
        to: [],
        cc: [],
        bcc: [],
        textBlobId: null,
        htmlBlobId: null,
        parserVersion: 1,
        parseWarnings: [],
        parts: [],
        mailboxIds,
        restoreMailboxIds: [],
        keywords: [],
      });
      const threadA = makeThread('thread-query-a', at(1));
      const threadB = makeThread('thread-query-b', at(2));
      const threadC = makeThread('thread-query-c', at(7));
      const threadD = makeThread('thread-query-d', at(3));

      await unitOfWork.run(async (tx) => {
        for (const record of [threadA, threadB, threadC, threadD]) {
          await tx.threads.insert(record);
        }
        for (const record of [
          makeEmail('email-a-visible', threadA.id, at(1), [h.inbox.id]),
          makeEmail('email-a-destroyed', threadA.id, at(8), [h.inbox.id], at(9)),
          makeEmail('email-b-visible', threadB.id, at(2), [h.inbox.id]),
          makeEmail('email-c-unfiled', threadC.id, at(7), []),
          makeEmail('email-d-drafts', threadD.id, at(3), [h.drafts.id]),
        ]) {
          await tx.emails.insert(record);
        }
      });

      const first = await queryThreads(h.dependencies, {
        accountId: h.accountId,
        limit: 1,
        cursor: null,
      });
      expect(first.threads.map(({ id }) => id)).toEqual([threadD.id]);
      expect(first.nextCursor).not.toBeNull();

      const second = await queryThreads(h.dependencies, {
        accountId: h.accountId,
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.threads.map(({ id }) => id)).toEqual([threadB.id, threadA.id]);
      expect(second.threads.map(({ latestReceivedAt }) => latestReceivedAt)).toEqual([
        at(2),
        at(1),
      ]);
      expect(second.nextCursor).toBeNull();

      const inbox = await queryThreads(h.dependencies, {
        accountId: h.accountId,
        mailboxId: h.inbox.id,
        limit: 10,
        cursor: null,
      });
      expect(inbox.threads.map(({ id }) => id)).toEqual([threadB.id, threadA.id]);
      expect(inbox.threads.map(({ emailIds }) => emailIds)).toEqual([
        ['email-b-visible'],
        ['email-a-visible'],
      ]);
    }));
});
