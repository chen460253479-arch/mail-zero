import type { BlobId, EmailRecord, MailAccountId } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import {
  createExternalMessageReader,
  type ExternalMessageRepository,
} from '../../../../../src/modules/external-integration/application/read-message';

const accountId = 'mail-account-1' as MailAccountId;
const textBlobId = 'text-blob-1' as BlobId;
const htmlBlobId = 'html-blob-1' as BlobId;

const email: EmailRecord = {
  id: 'local-email-1' as EmailRecord['id'],
  accountId,
  identityId: null,
  threadId: 'thread-1' as EmailRecord['threadId'],
  blobId: null,
  messageId: '<rfc-message-id@example.test>',
  replyToEmailId: null,
  inReplyTo: [],
  references: [],
  subject: 'Trip confirmation',
  preview: 'Your trip is confirmed',
  sentAt: new Date('2026-07-29T09:00:00.000Z'),
  receivedAt: new Date('2026-07-29T09:00:01.000Z'),
  sizeBytes: 4096n,
  hasAttachment: true,
  lifecycle: 'received',
  draftRevision: 0,
  createdAt: new Date('2026-07-29T09:00:01.000Z'),
  updatedAt: new Date('2026-07-29T09:00:01.000Z'),
  destroyedAt: null,
  sender: [{ name: 'Airline', email: 'airline@example.test' }],
  from: [{ name: 'Airline', email: 'airline@example.test' }],
  replyTo: [],
  to: [{ name: 'Traveler', email: 'traveler@example.test' }],
  cc: [],
  bcc: [],
  parts: [
    {
      id: 'text-part-1',
      parentPartId: null,
      partPath: '1',
      contentType: 'text/plain',
      charset: 'utf-8',
      disposition: null,
      filename: null,
      contentId: null,
      blobId: textBlobId,
      sizeBytes: 20n,
      kind: 'body',
    },
    {
      id: 'html-part-1',
      parentPartId: null,
      partPath: '2',
      contentType: 'text/html',
      charset: 'utf-8',
      disposition: null,
      filename: null,
      contentId: null,
      blobId: htmlBlobId,
      sizeBytes: 27n,
      kind: 'body',
    },
    {
      id: 'part-1',
      parentPartId: null,
      partPath: '3',
      contentType: 'application/pdf',
      charset: null,
      disposition: 'attachment',
      filename: 'invoice.pdf',
      contentId: null,
      blobId: 'attachment-blob-1' as BlobId,
      sizeBytes: 1024n,
      kind: 'attachment',
    },
  ],
  mailboxIds: ['inbox-1' as EmailRecord['mailboxIds'][number]],
  restoreMailboxIds: [],
  keywords: ['$seen' as EmailRecord['keywords'][number]],
  textBlobId,
  htmlBlobId,
  parserVersion: 1,
  parseWarnings: [],
};

const repository: ExternalMessageRepository = {
  findMessageScope: async ({ messageId }) =>
    messageId === email.id
      ? {
          mailAccountId: accountId,
          userId: 'managed-user-1',
          nangoConnectionId: 'connect-gmail-1',
          channelId: 'gmail',
        }
      : null,
  findAttachmentScope: async () => null,
};

const createReader = () =>
  createExternalMessageReader({
    repository,
    core: {
      getEmail: async () => email,
      getBlob: async () => {
        throw new Error('not used');
      },
      readBlob: async ({ blobId }) =>
        new TextEncoder().encode(blobId === textBlobId ? 'Plain body' : '<p>HTML body</p>'),
    },
  });

describe('external message reader', () => {
  it('uses the local email id as messageId and keeps the RFC id separate', async () => {
    const summary = await createReader().getSummary('local-email-1');

    expect(summary.messageId).toBe('local-email-1');
    expect(summary.internetMessageId).toBe('<rfc-message-id@example.test>');
    expect(summary).toMatchObject({
      mailAccountId: 'mail-account-1',
      nangoConnectionId: 'connect-gmail-1',
      channelId: 'gmail',
      mailboxIds: ['inbox-1'],
      keywords: ['$seen'],
      attachmentCount: 1,
    });
  });

  it('does not expose body, blob, credential, or raw MIME fields in the summary', async () => {
    const summary = await createReader().getSummary('local-email-1');

    expect(Object.keys(summary)).not.toEqual(
      expect.arrayContaining(['textBody', 'htmlBody', 'blobId', 'credentials', 'raw']),
    );
  });

  it('returns attachment metadata without attachment bytes or blob ids', async () => {
    await expect(createReader().listAttachments('local-email-1')).resolves.toEqual([
      {
        attachmentId: 'part-1',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        disposition: 'attachment',
        size: '1024',
      },
    ]);
  });

  it('reads body values only from the content endpoint', async () => {
    await expect(createReader().getContent('local-email-1')).resolves.toEqual({
      messageId: 'local-email-1',
      textBody: 'Plain body',
      htmlBody: '<p>HTML body</p>',
    });
  });

  it('returns not found only when the global message id does not exist', async () => {
    await expect(createReader().getSummary('missing-email')).rejects.toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
    });
  });
});
