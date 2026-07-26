import type { EmailRecord, MailAccountId } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';

import { toEmailDto } from './email-dto';

const accountId = 'account-email-dto' as MailAccountId;
const email: EmailRecord = {
  id: 'email-1' as EmailRecord['id'],
  accountId,
  identityId: null,
  threadId: 'thread-1' as EmailRecord['threadId'],
  blobId: null,
  messageId: null,
  replyToEmailId: null,
  inReplyTo: [],
  references: [],
  subject: 'Subject',
  sentAt: null,
  receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  sizeBytes: 99n,
  hasAttachment: false,
  lifecycle: 'received',
  draftRevision: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  destroyedAt: null,
  sender: [],
  from: [{ email: 'sender@example.test' }],
  replyTo: [],
  to: [],
  cc: [],
  bcc: [],
  preview: 'Preview',
  textBlobId: 'blob-text' as EmailRecord['textBlobId'],
  htmlBlobId: null,
  parserVersion: 1,
  parseWarnings: [],
  parts: [
    {
      id: 'part-text',
      parentPartId: null,
      partPath: '1',
      contentType: 'text/plain',
      charset: 'utf-8',
      disposition: null,
      filename: null,
      contentId: null,
      blobId: 'blob-text' as NonNullable<EmailRecord['textBlobId']>,
      sizeBytes: 11n,
      kind: 'body',
    },
  ],
  mailboxIds: ['mailbox-inbox' as EmailRecord['mailboxIds'][number]],
  restoreMailboxIds: [],
  keywords: ['$seen'],
};

describe('Email DTO', () => {
  it('does not read body blobs unless body values were requested', async () => {
    const readBlob = vi.fn();
    const dto = await toEmailDto({ readBlob } as never, accountId, email);

    expect(readBlob).not.toHaveBeenCalled();
    expect(dto).toMatchObject({
      mailboxIds: { 'mailbox-inbox': true },
      keywords: { $seen: true },
      bodyValues: {},
      size: '99',
    });
    expect(dto).not.toHaveProperty('accountId');
    expect(dto).not.toHaveProperty('textBlobId');
  });

  it('reads only requested parts and bounds returned bytes', async () => {
    const readBlob = vi.fn(async () => new TextEncoder().encode('0123456789'));
    const dto = await toEmailDto({ readBlob } as never, accountId, email, {
      fetchTextBodyValues: true,
      maxBodyValueBytes: 4,
    });

    expect(readBlob).toHaveBeenCalledOnce();
    expect(dto.bodyValues).toEqual({
      'part-text': { value: '0123', isTruncated: true },
    });
  });
});
