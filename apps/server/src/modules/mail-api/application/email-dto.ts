import type {
  BlobId,
  EmailPartRecord,
  EmailRecord,
  MailAccountId,
  MailCore,
} from '@zero/mail-core';

import { emailSchema } from '../contracts/email';
import { readBodyValue } from './body-values';

export type EmailBodyProjection = {
  properties?: string[];
  fetchTextBodyValues?: boolean;
  fetchHTMLBodyValues?: boolean;
  maxBodyValueBytes?: number;
  bodyReadBudget?: { remainingBytes: number };
};

const idMap = (ids: readonly string[]): Record<string, true> =>
  Object.fromEntries(ids.map((id) => [id, true]));

const toPartDto = (part: EmailPartRecord) => ({
  id: part.id,
  parentPartId: part.parentPartId,
  partPath: part.partPath,
  contentType: part.contentType,
  charset: part.charset,
  disposition: part.disposition,
  filename: part.filename,
  contentId: part.contentId,
  blobId: part.blobId,
  size: part.sizeBytes,
  kind: part.kind,
});

const isTextBody = (part: EmailPartRecord) =>
  part.kind === 'body' && part.contentType.toLocaleLowerCase('und').startsWith('text/plain');

const isHtmlBody = (part: EmailPartRecord) =>
  part.kind === 'body' && part.contentType.toLocaleLowerCase('und').startsWith('text/html');

export async function toEmailDto(
  core: Pick<MailCore, 'readBlob' | 'readBlobRange'>,
  accountId: MailAccountId,
  email: EmailRecord,
  projection: EmailBodyProjection = {},
) {
  const textBody = email.parts.filter(isTextBody);
  const htmlBody = email.parts.filter(isHtmlBody);
  const includesBodyValues =
    projection.properties === undefined || projection.properties.includes('bodyValues');
  const requestedParts = [
    ...(includesBodyValues && projection.fetchTextBodyValues ? textBody : []),
    ...(includesBodyValues && projection.fetchHTMLBodyValues ? htmlBody : []),
  ].filter((part): part is EmailPartRecord & { blobId: BlobId } => part.blobId !== null);
  const maxBytes = projection.maxBodyValueBytes ?? 256_000;
  const bodyValues = Object.fromEntries(
    await Promise.all(
      requestedParts.map(async (part) => {
        const allowed =
          projection.bodyReadBudget === undefined
            ? maxBytes
            : Math.min(maxBytes, projection.bodyReadBudget.remainingBytes);
        if (projection.bodyReadBudget !== undefined) {
          projection.bodyReadBudget.remainingBytes -= allowed;
        }
        return [
          part.id,
          allowed === 0
            ? { value: '', isTruncated: true }
            : await readBodyValue(core, accountId, part.blobId, allowed),
        ];
      }),
    ),
  );
  const dto = emailSchema.parse({
    id: email.id,
    threadId: email.threadId,
    blobId: email.blobId,
    mailboxIds: idMap(email.mailboxIds),
    keywords: idMap(email.keywords),
    lifecycle: email.lifecycle,
    draftRevision: email.draftRevision,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    sender: email.sender,
    from: email.from,
    replyTo: email.replyTo,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    subject: email.subject,
    preview: email.preview,
    sentAt: email.sentAt,
    receivedAt: email.receivedAt,
    size: email.sizeBytes,
    hasAttachment: email.hasAttachment,
    textBody: textBody.map(toPartDto),
    htmlBody: htmlBody.map(toPartDto),
    attachments: email.parts
      .filter((part) => part.kind === 'attachment' || part.kind === 'inline')
      .map(toPartDto),
    bodyValues,
  });
  if (projection.properties === undefined) return dto;
  const selected = new Set(['id', ...projection.properties]);
  return Object.fromEntries(Object.entries(dto).filter(([property]) => selected.has(property)));
}
