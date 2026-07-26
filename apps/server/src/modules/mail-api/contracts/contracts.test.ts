import { describe, expect, it } from 'vitest';

import { emailSchema, emailSetInputSchema } from './email';
import { submissionSetInputSchema } from './submission';
import { mailboxSchema } from './mailbox';
import { accountSchema } from './account';

describe('Mail API contracts', () => {
  it('serializes account bigint and Date fields to stable public strings', () => {
    expect(
      accountSchema.parse({
        id: 'account-1',
        connectionId: 'connection-1',
        status: 'active',
        timezone: 'UTC',
        state: 12n,
        storageQuotaBytes: 1024n,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        userId: 'private-user',
      }),
    ).toEqual({
      id: 'account-1',
      connectionId: 'connection-1',
      status: 'active',
      timezone: 'UTC',
      state: '12',
      storageQuotaBytes: '1024',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('strips database-only Mailbox fields', () => {
    expect(
      mailboxSchema.parse({
        id: 'mailbox-1',
        parentId: null,
        name: 'Inbox',
        normalizedName: 'inbox',
        kind: 'system',
        role: 'inbox',
        color: null,
        sortOrder: 10,
        isSubscribed: true,
        totalEmails: 2,
        unreadEmails: 1,
        totalThreads: 2,
        unreadThreads: 1,
        accountId: 'account-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      }),
    ).not.toHaveProperty('normalizedName');
  });

  it('does not expose provider or storage fields in an Email DTO', () => {
    const parsed = emailSchema.parse({
      id: 'email-1',
      threadId: 'thread-1',
      blobId: 'blob-raw',
      mailboxIds: { inbox: true },
      keywords: { $seen: true },
      lifecycle: 'received',
      draftRevision: 0,
      messageId: '<message@example.test>',
      inReplyTo: [],
      references: [],
      sender: [],
      from: [{ email: 'from@example.test' }],
      replyTo: [],
      to: [{ email: 'to@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Subject',
      preview: 'Preview',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00.000Z',
      size: '123',
      hasAttachment: false,
      textBody: [],
      htmlBody: [],
      attachments: [],
      bodyValues: {},
      remoteEmailId: 'gmail-message-id',
      provider: 'gmail',
      objectKey: 'mail/account/sha256/private',
      restoreMailboxIds: ['private'],
    });

    expect(parsed).not.toHaveProperty('remoteEmailId');
    expect(parsed).not.toHaveProperty('provider');
    expect(parsed).not.toHaveProperty('objectKey');
    expect(parsed).not.toHaveProperty('restoreMailboxIds');
  });

  it('caps the combined mutation count of every Set request', () => {
    const create = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `create-${index}`,
        {
          identityId: 'identity-1',
          replyToEmailId: null,
          to: [],
          cc: [],
          bcc: [],
          subject: '',
          textBody: '',
          htmlBody: '',
          attachmentBlobIds: [],
        },
      ]),
    );
    const destroy = Array.from({ length: 100 }, (_, index) => `email-${index}`);

    expect(
      emailSetInputSchema.safeParse({
        accountId: 'account-1',
        create,
        destroy,
      }).success,
    ).toBe(false);
    expect(
      submissionSetInputSchema.safeParse({
        accountId: 'account-1',
        create: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [
            `submission-${index}`,
            {
              emailId: `email-${index}`,
              identityId: 'identity-1',
              idempotencyKey: `key-${index}`,
            },
          ]),
        ),
        destroy: Array.from({ length: 100 }, (_, index) => `submission-${index}`),
      }).success,
    ).toBe(false);
  });
});
