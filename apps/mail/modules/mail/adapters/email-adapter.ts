import type { Email } from '../model/email';
import type { EmailDto } from './contracts';

const adaptAddresses = (addresses: EmailDto['from']) =>
  addresses.map((address) => ({
    name: address.name ?? null,
    email: address.email,
  }));

export function adaptEmail(dto: EmailDto): Email {
  return {
    ...dto,
    mailboxIds: { ...dto.mailboxIds },
    keywords: { ...dto.keywords },
    sender: adaptAddresses(dto.sender),
    from: adaptAddresses(dto.from),
    replyTo: adaptAddresses(dto.replyTo),
    to: adaptAddresses(dto.to),
    cc: adaptAddresses(dto.cc),
    bcc: adaptAddresses(dto.bcc),
    inReplyTo: [...dto.inReplyTo],
    references: [...dto.references],
    textBody: dto.textBody.map((part) => ({ ...part })),
    htmlBody: dto.htmlBody.map((part) => ({ ...part })),
    attachments: dto.attachments.map((part) => ({ ...part })),
    bodyValues: Object.fromEntries(
      Object.entries(dto.bodyValues).map(([partId, value]) => [partId, { ...value }]),
    ),
  };
}
