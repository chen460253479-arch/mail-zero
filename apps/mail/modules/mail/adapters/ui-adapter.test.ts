import { describe, expect, it } from 'vitest';

import { adaptEmailForDisplay, adaptThreadSummaryForList, buildThreadDisplay } from './ui-adapter';
import type { ThreadSummary } from '../model/thread';
import type { Mailbox } from '../model/mailbox';
import type { Email } from '../model/email';

const mailboxes: Mailbox[] = [
  {
    id: 'mailbox-inbox',
    parentId: null,
    name: 'Inbox',
    kind: 'system',
    role: 'inbox',
    color: null,
    sortOrder: 0,
    isSubscribed: true,
    totalEmails: 1,
    unreadEmails: 1,
    totalThreads: 1,
    unreadThreads: 1,
  },
  {
    id: 'label-customer',
    parentId: null,
    name: 'Customer',
    kind: 'label',
    role: null,
    color: '#ff0000',
    sortOrder: 10,
    isSubscribed: true,
    totalEmails: 1,
    unreadEmails: 1,
    totalThreads: 1,
    unreadThreads: 1,
  },
];

const email: Email = {
  id: 'email-1',
  threadId: 'thread-1',
  blobId: 'blob-raw',
  mailboxIds: { 'mailbox-inbox': true, 'label-customer': true },
  keywords: { $flagged: true, $important: true },
  lifecycle: 'received',
  draftRevision: 0,
  messageId: '<message@example.com>',
  inReplyTo: [],
  references: ['<root@example.com>'],
  sender: [{ name: 'Ada', email: 'ada@example.com' }],
  from: [{ name: 'Ada', email: 'ada@example.com' }],
  replyTo: [{ name: null, email: 'reply@example.com' }],
  to: [{ name: null, email: 'user@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Quarterly report',
  preview: 'Attached is the report.',
  sentAt: '2026-07-26T23:59:00.000Z',
  receivedAt: '2026-07-27T00:00:00.000Z',
  size: '1024',
  hasAttachment: true,
  textBody: [],
  htmlBody: [
    {
      id: 'part-html',
      parentPartId: null,
      partPath: '1',
      contentType: 'text/html',
      charset: 'utf-8',
      disposition: null,
      filename: null,
      contentId: null,
      blobId: 'blob-html',
      size: '30',
      kind: 'body',
    },
  ],
  attachments: [
    {
      id: 'part-file',
      parentPartId: null,
      partPath: '2',
      contentType: 'application/pdf',
      charset: null,
      disposition: 'attachment',
      filename: 'report.pdf',
      contentId: null,
      blobId: 'blob-file',
      size: '994',
      kind: 'attachment',
    },
  ],
  bodyValues: {
    'part-html': {
      value: '<p>Attached is the report.</p>',
      isTruncated: false,
    },
  },
  customerMarker: {
    customerId: 'customer-123',
    customerName: 'Acme',
  },
};

describe('mail UI adapters', () => {
  it('renders a thread-list row from summary data without loading thread detail', () => {
    const summary: ThreadSummary = {
      id: 'thread-1',
      emailIds: ['email-1'],
      emailCount: 1,
      unreadCount: 1,
      hasAttachment: true,
      subject: 'Quarterly report',
      preview: 'Attached is the report.',
      participants: 'Ada <ada@example.com>, user@example.com',
      latestReceivedAt: '2026-07-27T00:00:00.000Z',
      mailboxIds: ['mailbox-inbox', 'label-customer'],
      keywords: { $flagged: true, 'crm/customer': true },
      customerMarkers: [{ customerId: 'customer-123', customerName: 'Acme' }],
      latestEmail: {
        id: 'email-1',
        lifecycle: 'received',
        receivedAt: '2026-07-27T00:00:00.000Z',
      },
    };

    expect(adaptThreadSummaryForList(summary, mailboxes)).toMatchObject({
      id: 'thread-1',
      emailId: 'email-1',
      threadId: 'thread-1',
      subject: 'Quarterly report',
      sender: { name: 'Ada', email: 'ada@example.com' },
      unread: true,
      receivedOn: '2026-07-27T00:00:00.000Z',
      body: 'Attached is the report.',
      isDraft: false,
      hasAttachment: true,
      tags: [
        { id: 'label-customer', name: 'Customer', type: 'label' },
        { id: '$flagged', name: 'STARRED', type: 'keyword' },
        {
          id: 'crm/customer:customer-123',
          name: '客户邮件 · Acme',
          type: 'crm/customer',
        },
      ],
    });
  });

  it('maps local body values and blob attachments for the detail display', () => {
    expect(
      adaptEmailForDisplay(email, mailboxes, {
        accountId: 'account-1',
        backendBaseUrl: 'https://api.example.com',
      }),
    ).toMatchObject({
      id: 'email-1',
      threadId: 'thread-1',
      decodedBody: '<p>Attached is the report.</p>',
      processedHtml: '<p>Attached is the report.</p>',
      references: '<root@example.com>',
      replyTo: 'reply@example.com',
      attachments: [
        {
          attachmentId: 'blob-file',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          size: 994,
          body: 'https://api.example.com/api/mail/accounts/account-1/blobs/blob-file/report.pdf',
        },
      ],
      tags: expect.arrayContaining([
        expect.objectContaining({
          id: 'crm/customer:customer-123',
          name: '客户邮件 · Acme',
        }),
      ]),
    });
  });

  it('builds thread-level unread, latest and draft state from local emails', () => {
    const draft = {
      ...email,
      id: 'draft-1',
      lifecycle: 'draft' as const,
      draftRevision: 2,
      receivedAt: '2026-07-27T00:01:00.000Z',
      keywords: { $draft: true as const },
    };

    expect(
      buildThreadDisplay([email, draft], mailboxes, {
        accountId: 'account-1',
        backendBaseUrl: 'https://api.example.com',
      }),
    ).toMatchObject({
      hasUnread: true,
      totalReplies: 1,
      isLatestDraft: true,
      latest: { id: 'draft-1', isDraft: true },
    });
  });
});
