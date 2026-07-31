import type {
  BlobId,
  EmailId,
  EmailRecord,
  MailAccountId,
  MailTransaction,
  MailUnitOfWork,
  MailboxId,
  ThreadId,
  ThreadRecord,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

export const queryAccountId = 'account-1' as MailAccountId;
export const otherQueryAccountId = 'account-2' as MailAccountId;
export const queryInboxId = 'mailbox-inbox' as MailboxId;
export const queryArchiveId = 'mailbox-archive' as MailboxId;

const at = (day: number): Date =>
  new Date(`2026-01-${day.toString().padStart(2, '0')}T00:00:00.000Z`);

const threadRecord = (
  id: ThreadId,
  latestReceivedAt: Date,
  overrides: Partial<ThreadRecord> = {},
): ThreadRecord => ({
  id,
  accountId: queryAccountId,
  normalizedSubject: id,
  latestReceivedAt,
  emailCount: 1,
  unreadCount: 0,
  hasAttachment: false,
  participantSummary: null,
  preview: null,
  createdAt: at(1),
  updatedAt: latestReceivedAt,
  ...overrides,
});

const emailRecord = (
  id: EmailId,
  threadId: ThreadId,
  receivedAt: Date,
  overrides: Partial<EmailRecord> = {},
): EmailRecord => ({
  id,
  accountId: queryAccountId,
  identityId: null,
  threadId,
  blobId: null,
  messageId: null,
  replyToEmailId: null,
  inReplyTo: [],
  references: [],
  subject: '',
  sentAt: null,
  receivedAt,
  sizeBytes: 10n,
  hasAttachment: false,
  lifecycle: 'received',
  draftRevision: 0,
  createdAt: receivedAt,
  updatedAt: receivedAt,
  destroyedAt: null,
  sender: [],
  from: [],
  replyTo: [],
  to: [],
  cc: [],
  bcc: [],
  preview: '',
  textBody: '',
  htmlBody: '',
  parserVersion: 1,
  parseWarnings: [],
  parts: [],
  mailboxIds: [queryInboxId],
  restoreMailboxIds: [],
  keywords: ['$seen'],
  ...overrides,
});

export const createQueryHarness = async () => {
  const baseDependencies = createMemoryMailCoreDependencies();
  const repositoryCalls = {
    emailListByAccount: 0,
    threadListByAccount: 0,
  };
  const unitOfWork: MailUnitOfWork = {
    run<Result>(operation: (transaction: MailTransaction) => Promise<Result>): Promise<Result> {
      return baseDependencies.unitOfWork.run((tx) =>
        operation({
          ...tx,
          emails: {
            ...tx.emails,
            listByAccount: (accountId) => {
              repositoryCalls.emailListByAccount += 1;
              return tx.emails.listByAccount(accountId);
            },
          },
          threads: {
            ...tx.threads,
            listByAccount: (accountId) => {
              repositoryCalls.threadListByAccount += 1;
              return tx.threads.listByAccount(accountId);
            },
          },
        }),
      );
    },
  };
  const dependencies = {
    ...baseDependencies,
    unitOfWork,
  };
  const threadA = 'thread-a' as ThreadId;
  const threadB = 'thread-b' as ThreadId;
  const threadC = 'thread-c' as ThreadId;
  const threadD = 'thread-d' as ThreadId;
  const email1 = 'email-1' as EmailId;
  const email2 = 'email-2' as EmailId;
  const email3 = 'email-3' as EmailId;
  const email4 = 'email-4' as EmailId;
  const destroyedEmail = 'email-5' as EmailId;
  const unfiledEmail = 'email-6' as EmailId;

  await baseDependencies.unitOfWork.run(async (tx) => {
    await tx.accounts.insert({
      id: queryAccountId,
      userId: 'user-1',
      connectionId: 'connection-1',
      stateVersion: 0n,
    });
    await tx.accounts.insert({
      id: otherQueryAccountId,
      userId: 'user-2',
      connectionId: 'connection-2',
      stateVersion: 0n,
    });
    for (const mailbox of [
      { id: queryInboxId, name: 'Inbox', normalizedName: 'inbox', role: 'inbox' as const },
      {
        id: queryArchiveId,
        name: 'Archive',
        normalizedName: 'archive',
        role: 'archive' as const,
      },
    ]) {
      await tx.mailboxes.insert({
        ...mailbox,
        accountId: queryAccountId,
        parentId: null,
        kind: 'system',
        color: null,
        sortOrder: 0,
        isSubscribed: true,
        totalEmails: 0,
        unreadEmails: 0,
        totalThreads: 0,
        unreadThreads: 0,
        createdAt: at(1),
        updatedAt: at(1),
        deletedAt: null,
      });
    }
    await tx.threads.insert(
      threadRecord(threadA, at(3), {
        emailCount: 3,
        hasAttachment: true,
        participantSummary: 'Sender',
        preview: 'release three',
      }),
    );
    await tx.threads.insert(threadRecord(threadB, at(4), { preview: 'archive' }));
    await tx.threads.insert(threadRecord(threadC, at(5)));
    await tx.threads.insert(threadRecord(threadD, at(6)));

    await tx.emails.insert(
      emailRecord(email1, threadA, at(1), {
        subject: 'Bravo',
        preview: 'release one',
        sizeBytes: 10n,
        hasAttachment: true,
        sender: [{ email: 'Sender@Example.Test', name: 'Sender' }],
      }),
    );
    await tx.emails.insert(
      emailRecord(email2, threadA, at(2), {
        subject: 'alpha',
        preview: 'release two',
        sentAt: at(3),
        sizeBytes: 20n,
        hasAttachment: true,
        from: [{ email: 'sender@example.test' }],
      }),
    );
    await tx.emails.insert(
      emailRecord(email3, threadA, at(3), {
        subject: 'charlie',
        preview: 'release three',
        sentAt: at(2),
        sizeBytes: 30n,
        hasAttachment: true,
        replyTo: [{ email: 'sender@example.test' }],
      }),
    );
    await tx.emails.insert(
      emailRecord(email4, threadB, at(4), {
        subject: 'Alpha',
        preview: 'archived notes',
        sizeBytes: 20n,
        mailboxIds: [queryArchiveId],
        keywords: ['$flagged'],
        lifecycle: 'sent',
        to: [{ email: 'sender@example.test' }],
      }),
    );
    await tx.emails.insert(
      emailRecord(destroyedEmail, threadC, at(5), {
        subject: 'destroyed',
        destroyedAt: at(6),
        mailboxIds: [],
      }),
    );
    await tx.emails.insert(
      emailRecord(unfiledEmail, threadD, at(6), {
        subject: 'unfiled',
        mailboxIds: [],
      }),
    );
  });

  const insertEmail = async (record: EmailRecord, thread?: ThreadRecord) => {
    await baseDependencies.unitOfWork.run(async (tx) => {
      if (thread !== undefined) {
        await tx.threads.insert(thread);
      }
      await tx.emails.insert(record);
    });
  };

  return {
    dependencies,
    repositoryCalls,
    accountId: queryAccountId,
    otherAccountId: otherQueryAccountId,
    inboxId: queryInboxId,
    archiveId: queryArchiveId,
    threadA,
    threadB,
    email1,
    email2,
    email3,
    email4,
    insertNewerMatchingEmail: () =>
      insertEmail(
        emailRecord('email-newer' as EmailId, threadA, at(9), {
          subject: 'release newer',
          preview: 'release newer',
          hasAttachment: true,
          sender: [{ email: 'sender@example.test' }],
        }),
      ),
    insertEqualKeyEmail: () =>
      insertEmail(
        emailRecord('email-25' as EmailId, threadA, at(2), {
          subject: 'equal key',
          preview: 'release equal',
          hasAttachment: true,
          sender: [{ email: 'sender@example.test' }],
        }),
      ),
    insertNewerThread: () => {
      const threadId = 'thread-newer' as ThreadId;
      return insertEmail(
        emailRecord('email-new-thread' as EmailId, threadId, at(9)),
        threadRecord(threadId, at(9)),
      );
    },
    insertBodySearchEmail: async () => {
      const blobId = 'blob-body-search' as BlobId;
      const bytes = new TextEncoder().encode('body-only ultrasecretterm');
      const pending = await dependencies.blobStore.putTemporary({
        userId: 'query-user',
        accountId: queryAccountId,
        kind: 'message_mime',
        bytes,
        contentType: 'text/plain; charset=utf-8',
      });
      const objectKey = 'mail/body-search';
      await dependencies.blobStore.commitTemporary({
        accountId: queryAccountId,
        temporaryKey: pending.temporaryKey,
        objectKey,
      });
      await baseDependencies.unitOfWork.run(async (tx) => {
        await tx.blobs.insert({
          id: blobId,
          accountId: queryAccountId,
          kind: 'message_mime',
          sha256: pending.sha256,
          sizeBytes: pending.size,
          contentType: 'text/plain; charset=utf-8',
          objectKey,
          status: 'ready',
          createdAt: at(7),
          readyAt: at(7),
          deletedAt: null,
        });
        await tx.emails.insert(
          emailRecord('email-body-search' as EmailId, threadA, at(7), {
            subject: 'ordinary subject',
            preview: 'short preview',
            textBody: 'body-only ultrasecretterm',
          }),
        );
        await tx.emails.publishSearchDocument(queryAccountId, 'email-body-search' as EmailId, {
          subject: 'ordinary subject',
          addressText: '',
          bodyText: 'body-only ultrasecretterm',
        });
      });
      return objectKey;
    },
    insertForeignBrokenBodyEmail: () =>
      baseDependencies.unitOfWork.run(async (tx) => {
        const blobId = 'blob-foreign-missing' as BlobId;
        await tx.blobs.insert({
          id: blobId,
          accountId: otherQueryAccountId,
          kind: 'message_mime',
          sha256: 'missing',
          sizeBytes: 10n,
          contentType: 'text/plain; charset=utf-8',
          objectKey: 'missing/foreign-body',
          status: 'ready',
          createdAt: at(7),
          readyAt: at(7),
          deletedAt: null,
        });
        await tx.emails.insert(
          emailRecord('email-foreign' as EmailId, 'thread-foreign' as ThreadId, at(7), {
            accountId: otherQueryAccountId,
            textBody: '',
          }),
        );
      }),
  };
};
