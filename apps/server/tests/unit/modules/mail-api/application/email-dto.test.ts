import type { EmailRecord, MailAccountId } from '@zero/mail-core';
import { describe, expect, it, vi } from 'vitest';

import { toEmailDto } from '../../../../../src/modules/mail-api/application/email-dto';

const accountId = 'account-email-dto' as MailAccountId;
const email: EmailRecord = {
  id: 'email-1' as EmailRecord['id'],
  accountId,
  identityId: 'identity-1' as NonNullable<EmailRecord['identityId']>,
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
  textBody: '0123456789',
  htmlBody: '',
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
      rawBlobId: 'raw-blob' as NonNullable<EmailRecord['blobId']>,
      offsetStart: 100n,
      encodedLength: 11n,
      decodedLength: 11n,
      transferEncoding: '8bit',
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
    const readBlobRange = vi.fn();
    const dto = await toEmailDto({ readBlob, readBlobRange } as never, accountId, email);

    expect(readBlob).not.toHaveBeenCalled();
    expect(readBlobRange).not.toHaveBeenCalled();
    expect(dto).toMatchObject({
      identityId: email.identityId,
      mailboxIds: { 'mailbox-inbox': true },
      keywords: { $seen: true },
      bodyValues: {},
      size: '99',
    });
    expect(dto).not.toHaveProperty('accountId');
    expect(dto).not.toHaveProperty('textBlobId');
  });

  it('returns requested body values from the PostgreSQL projection and bounds UTF-8 bytes', async () => {
    const readBlobRange = vi.fn();
    const dto = await toEmailDto({ readBlobRange } as never, accountId, email, {
      fetchTextBodyValues: true,
      maxBodyValueBytes: 4,
    });

    expect(readBlobRange).not.toHaveBeenCalled();
    expect(dto.bodyValues).toEqual({
      'part-text': { value: '0123', isTruncated: true },
    });
    expect((dto as { textBody: Array<{ blobId: string | null }> }).textBody[0]?.blobId).toBe(
      'part-text',
    );
  });

  it('returns only requested properties and avoids an unselected body read', async () => {
    const readBlob = vi.fn();
    const readBlobRange = vi.fn();
    const dto = await toEmailDto({ readBlob, readBlobRange } as never, accountId, email, {
      properties: ['subject'],
      fetchTextBodyValues: true,
    });

    expect(dto).toEqual({ id: email.id, subject: email.subject });
    expect(readBlob).not.toHaveBeenCalled();
    expect(readBlobRange).not.toHaveBeenCalled();
  });
});
