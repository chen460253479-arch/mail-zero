import {
  adaptAccount,
  adaptEmail,
  adaptMailbox,
  adaptSubmission,
  adaptThreadSummary,
} from './index';
import { describe, expect, it } from 'vitest';

describe('mail API adapters', () => {
  it('maps a local account without leaking provider details', () => {
    expect(
      adaptAccount({
        id: 'account-1',
        connectionId: 'connection-1',
        status: 'active',
        timezone: 'Asia/Shanghai',
        state: '42',
        storageQuotaBytes: null,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:01:00.000Z',
        capabilities: {
          mail: true,
          emailSubmission: true,
          blobUpload: true,
          snooze: true,
        },
      }),
    ).toEqual({
      id: 'account-1',
      connectionId: 'connection-1',
      status: 'active',
      timezone: 'Asia/Shanghai',
      state: '42',
      storageQuotaBytes: null,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:01:00.000Z',
      capabilities: {
        mail: true,
        emailSubmission: true,
        blobUpload: true,
        snooze: true,
      },
    });
  });

  it('maps mailbox counters and local role exactly', () => {
    expect(
      adaptMailbox({
        id: 'mailbox-1',
        parentId: null,
        name: 'Inbox',
        kind: 'system',
        role: 'inbox',
        color: null,
        sortOrder: 10,
        isSubscribed: true,
        totalEmails: 8,
        unreadEmails: 3,
        totalThreads: 6,
        unreadThreads: 2,
      }),
    ).toEqual({
      id: 'mailbox-1',
      parentId: null,
      name: 'Inbox',
      kind: 'system',
      role: 'inbox',
      color: null,
      sortOrder: 10,
      isSubscribed: true,
      totalEmails: 8,
      unreadEmails: 3,
      totalThreads: 6,
      unreadThreads: 2,
    });
  });

  it('keeps a thread summary lightweight and does not invent message bodies', () => {
    expect(
      adaptThreadSummary({
        id: 'thread-1',
        emailIds: ['email-1'],
        emailCount: 1,
        unreadCount: 1,
        hasAttachment: false,
        subject: 'Quarterly report',
        preview: 'Attached is the report.',
        participants: 'Ada <ada@example.com>',
        latestReceivedAt: '2026-07-27T00:00:00.000Z',
        mailboxIds: { 'mailbox-1': true },
        keywords: { $seen: true },
        latestEmail: {
          id: 'email-1',
          lifecycle: 'received',
          receivedAt: '2026-07-27T00:00:00.000Z',
          to: [{ name: null, email: 'user@example.com' }],
        },
      }),
    ).toEqual({
      id: 'thread-1',
      emailIds: ['email-1'],
      emailCount: 1,
      unreadCount: 1,
      hasAttachment: false,
      subject: 'Quarterly report',
      preview: 'Attached is the report.',
      participants: 'Ada <ada@example.com>',
      latestReceivedAt: '2026-07-27T00:00:00.000Z',
      mailboxIds: ['mailbox-1'],
      keywords: { $seen: true },
      customerMarkers: [],
      latestEmail: {
        id: 'email-1',
        lifecycle: 'received',
        receivedAt: '2026-07-27T00:00:00.000Z',
        to: [{ name: null, email: 'user@example.com' }],
      },
    });
  });

  it('maps a complete email including body parts and local blob ids', () => {
    const dto = {
      id: 'email-1',
      threadId: 'thread-1',
      blobId: 'blob-raw',
      identityId: null,
      mailboxIds: { 'mailbox-1': true as const },
      keywords: { $seen: true as const },
      lifecycle: 'received' as const,
      draftRevision: 0,
      messageId: '<message@example.com>',
      inReplyTo: [],
      references: [],
      sender: [{ name: 'Ada', email: 'ada@example.com' }],
      from: [{ name: 'Ada', email: 'ada@example.com' }],
      replyTo: [],
      to: [{ name: null, email: 'user@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Quarterly report',
      preview: 'Attached is the report.',
      sentAt: '2026-07-26T23:59:00.000Z',
      receivedAt: '2026-07-27T00:00:00.000Z',
      size: '1024',
      hasAttachment: true,
      textBody: [
        {
          id: 'part-text',
          parentPartId: null,
          partPath: '1',
          contentType: 'text/plain',
          charset: 'utf-8',
          disposition: null,
          filename: null,
          contentId: null,
          blobId: 'blob-text',
          size: '30',
          kind: 'body' as const,
        },
      ],
      htmlBody: [],
      attachments: [
        {
          id: 'part-file',
          parentPartId: null,
          partPath: '2',
          contentType: 'application/pdf',
          charset: null,
          disposition: 'attachment' as const,
          filename: 'report.pdf',
          contentId: null,
          blobId: 'blob-file',
          size: '994',
          kind: 'attachment' as const,
        },
      ],
      bodyValues: {
        'part-text': {
          value: 'Attached is the report.',
          isTruncated: false,
        },
      },
    };

    expect(adaptEmail(dto)).toEqual(dto);
  });

  it('normalizes an omitted address name to null', () => {
    const email = adaptEmail({
      id: 'email-without-name',
      threadId: 'thread-1',
      blobId: null,
      identityId: null,
      mailboxIds: { 'mailbox-1': true },
      keywords: {},
      lifecycle: 'received',
      draftRevision: 0,
      messageId: null,
      inReplyTo: [],
      references: [],
      sender: [{ email: 'ada@example.com' }],
      from: [{ email: 'ada@example.com' }],
      replyTo: [],
      to: [{ email: 'user@example.com' }],
      cc: [],
      bcc: [],
      subject: '',
      preview: '',
      sentAt: null,
      receivedAt: '2026-07-27T00:00:00.000Z',
      size: '0',
      hasAttachment: false,
      textBody: [],
      htmlBody: [],
      attachments: [],
      bodyValues: {},
    });

    expect(email.from).toEqual([{ name: null, email: 'ada@example.com' }]);
    expect(email.to).toEqual([{ name: null, email: 'user@example.com' }]);
  });

  it('preserves the real submission lifecycle instead of collapsing it to sent', () => {
    expect(
      adaptSubmission({
        id: 'submission-1',
        emailId: 'draft-1',
        identityId: 'identity-1',
        status: 'queued',
        sendAt: '2026-07-27T00:00:05.000Z',
        draftRevision: 3,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:01.000Z',
        sentAt: null,
      }),
    ).toEqual({
      id: 'submission-1',
      emailId: 'draft-1',
      identityId: 'identity-1',
      status: 'queued',
      sendAt: '2026-07-27T00:00:05.000Z',
      draftRevision: 3,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z',
      sentAt: null,
    });
  });
});
