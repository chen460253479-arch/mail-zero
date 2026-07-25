import PostalMime, { type Address, type Attachment, type Mailbox } from 'postal-mime';

import type { ParsedEmail, ParsedPart, ParseRawEmailDependencies } from './types';
import { normalizeMessageId } from '../thread';
import type { MailAddress } from '../types';

const toMailAddress = (mailbox: Mailbox): MailAddress => ({
  ...(mailbox.name === '' ? {} : { name: mailbox.name }),
  email: mailbox.address,
});

const flattenAddress = (address: Address): MailAddress[] =>
  address.group === undefined ? [toMailAddress(address)] : address.group.map(toMailAddress);

const normalizeAddresses = (addresses: Address | Address[] | undefined): MailAddress[] => {
  if (addresses === undefined) {
    return [];
  }
  return (Array.isArray(addresses) ? addresses : [addresses]).flatMap(flattenAddress);
};

const splitMessageIds = (value: string | undefined): string[] => {
  if (value === undefined) {
    return [];
  }
  const bracketed = [...value.matchAll(/<([^<>]+)>/gu)].map((match) => match[1]!);
  const candidates = bracketed.length > 0 ? bracketed : value.split(/\s+/gu).filter(Boolean);

  return Array.from(
    new Set(candidates.map(normalizeMessageId).filter((candidate) => candidate.length > 0)),
  );
};

const toBytes = (content: Attachment['content']): Uint8Array => {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  return content instanceof Uint8Array
    ? Uint8Array.from(content)
    : new Uint8Array(content.slice(0));
};

const normalizeAttachment = (attachment: Attachment): ParsedPart => {
  const bytes = toBytes(attachment.content);
  return {
    contentType: attachment.mimeType,
    disposition: attachment.disposition,
    filename: attachment.filename,
    contentId: attachment.contentId ?? null,
    bytes,
    sizeBytes: BigInt(bytes.byteLength),
  };
};

const toDate = (value: string | undefined): Date | null => {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export async function parseRawEmail(
  raw: Uint8Array,
  dependencies: ParseRawEmailDependencies,
): Promise<ParsedEmail> {
  const parsed = await new PostalMime({
    attachmentEncoding: 'arraybuffer',
  }).parse(Uint8Array.from(raw));
  const attachments = parsed.attachments.map(normalizeAttachment);
  const htmlBody = parsed.html === undefined ? '' : dependencies.sanitizeHtml(parsed.html);

  return {
    messageId: splitMessageIds(parsed.messageId)[0] ?? null,
    inReplyTo: splitMessageIds(parsed.inReplyTo),
    references: splitMessageIds(parsed.references),
    subject: parsed.subject ?? '',
    sentAt: toDate(parsed.date),
    from: normalizeAddresses(parsed.from),
    sender: normalizeAddresses(parsed.sender),
    replyTo: normalizeAddresses(parsed.replyTo),
    to: normalizeAddresses(parsed.to),
    cc: normalizeAddresses(parsed.cc),
    bcc: normalizeAddresses(parsed.bcc),
    textBody: parsed.text?.trimEnd() ?? '',
    htmlBody,
    attachments,
    hasAttachment: attachments.some(({ disposition }) => disposition === 'attachment'),
  };
}
