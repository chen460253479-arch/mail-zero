import { describe, expect, it } from 'vitest';

import type {
  EmailId,
  EmailRecord,
  MailAccountId,
  MailboxId,
  ThreadId,
  ThreadRecord,
} from '@zero/mail-core';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

const now = new Date('2026-01-01T00:00:00.000Z');

const threadRecord = (accountId: MailAccountId, id: ThreadId): ThreadRecord => ({
  id,
  accountId,
  normalizedSubject: 'thread reference',
  latestReceivedAt: now,
  emailCount: 1,
  unreadCount: 0,
  hasAttachment: false,
  participantSummary: null,
  preview: null,
  createdAt: now,
  updatedAt: now,
});

const emailRecord = (
  accountId: MailAccountId,
  mailboxId: MailboxId,
  threadId: ThreadId,
  id: EmailId,
): EmailRecord => ({
  id,
  accountId,
  identityId: null,
  threadId,
  blobId: null,
  messageId: `${id}@example.test`,
  replyToEmailId: null,
  inReplyTo: [],
  references: [],
  subject: 'thread reference',
  preview: '',
  sentAt: null,
  receivedAt: now,
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
  to: [],
  cc: [],
  bcc: [],
  textBody: '',
  htmlBody: '',
  parserVersion: 1,
  parseWarnings: [],
  parts: [],
  mailboxIds: [mailboxId],
  restoreMailboxIds: [],
  keywords: [],
});

describe('PostgreSQL ThreadReference repository', () => {
  it('persists scoped candidates and enforces account-consistent Email and Thread references', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const primary = await createPostgresMailTestHarness(db, unitOfWork, 'reference-primary');
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'reference-foreign');
      const threadA = 'reference-thread-a' as ThreadId;
      const threadB = 'reference-thread-b' as ThreadId;
      const foreignThread = 'reference-thread-foreign' as ThreadId;
      const emailA = 'reference-email-a' as EmailId;
      const emailB = 'reference-email-b' as EmailId;
      const foreignEmail = 'reference-email-foreign' as EmailId;
      await unitOfWork.run(async (tx) => {
        for (const record of [
          threadRecord(primary.accountId, threadA),
          threadRecord(primary.accountId, threadB),
          threadRecord(foreign.accountId, foreignThread),
        ]) {
          await tx.threads.insert(record);
        }
        for (const record of [
          emailRecord(primary.accountId, primary.inbox.id, threadA, emailA),
          emailRecord(primary.accountId, primary.inbox.id, threadB, emailB),
          emailRecord(foreign.accountId, foreign.inbox.id, foreignThread, foreignEmail),
        ]) {
          await tx.emails.insert(record);
        }
      });
      const reference = {
        accountId: primary.accountId,
        normalizedSubjectHash: 'subject-hash',
        messageIdHash: 'message-hash',
        emailId: emailA,
        threadId: threadA,
        createdAt: now,
      };

      await unitOfWork.run(async (tx) => {
        await tx.threadReferences.insert(reference);
        await tx.threadReferences.insert(reference);
      });
      await expect(
        unitOfWork.run((tx) =>
          tx.threadReferences.findCandidates({
            accountId: primary.accountId,
            normalizedSubjectHash: 'subject-hash',
            messageIdHashes: ['message-hash', 'message-hash'],
          }),
        ),
      ).resolves.toEqual([reference]);

      await unitOfWork.run((tx) =>
        tx.threadReferences.moveThread(primary.accountId, threadA, threadB),
      );
      await expect(
        unitOfWork.run((tx) =>
          tx.threadReferences.findCandidates({
            accountId: primary.accountId,
            normalizedSubjectHash: 'subject-hash',
            messageIdHashes: ['message-hash'],
          }),
        ),
      ).resolves.toEqual([{ ...reference, threadId: threadB }]);

      await expect(
        unitOfWork.run((tx) =>
          tx.threadReferences.insert({
            ...reference,
            emailId: foreignEmail,
          }),
        ),
      ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });

      await unitOfWork.run((tx) => tx.threadReferences.deleteByEmail(primary.accountId, emailA));
      await expect(
        unitOfWork.run((tx) =>
          tx.threadReferences.findCandidates({
            accountId: primary.accountId,
            normalizedSubjectHash: 'subject-hash',
            messageIdHashes: ['message-hash'],
          }),
        ),
      ).resolves.toEqual([]);
    }));
});
