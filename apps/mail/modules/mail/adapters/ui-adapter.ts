import type { Attachment, Label, ParsedMessage, Sender } from '../../../types';
import type { CustomerMarker, Email, EmailPart } from '../model/email';
import type { ThreadSummary } from '../model/thread';
import type { Mailbox } from '../model/mailbox';
import { m } from '@/paraglide/messages';

export type MailDisplayOptions = {
  accountId: string;
  backendBaseUrl: string;
};

export type MailThreadDisplay = {
  messages: ParsedMessage[];
  latest?: ParsedMessage;
  hasUnread: boolean;
  totalReplies: number;
  labels: Array<{ id: string; name: string }>;
  isLatestDraft: boolean;
};

const keywordLabels: Readonly<Record<string, string>> = {
  $flagged: 'STARRED',
  $important: 'IMPORTANT',
};

const mailboxLabels = (mailboxIds: readonly string[], mailboxes: readonly Mailbox[]): Label[] =>
  mailboxIds.flatMap((mailboxId) => {
    const mailbox = mailboxes.find((candidate) => candidate.id === mailboxId);
    if (!mailbox || mailbox.kind === 'system') return [];

    return [
      {
        id: mailbox.id,
        name: mailbox.name,
        type: mailbox.kind,
        ...(mailbox.color
          ? {
              color: {
                backgroundColor: mailbox.color,
                textColor: mailbox.color,
              },
            }
          : {}),
      },
    ];
  });

const keywordTags = (keywords: Record<string, true>): Label[] =>
  Object.keys(keywords).flatMap((keyword) => {
    const name = keywordLabels[keyword];
    return name ? [{ id: keyword, name, type: 'keyword' }] : [];
  });

const customerTags = (markers: readonly CustomerMarker[]): Label[] =>
  markers.map((marker) => ({
    id: `crm/customer:${marker.customerId}`,
    name: m['common.mail.customerEmail']({ customerName: marker.customerName }),
    type: 'crm/customer',
    color: {
      backgroundColor: '#12341D',
      textColor: '#D1F0D9',
    },
  }));

const tagsFor = (
  mailboxIds: readonly string[],
  keywords: Record<string, true>,
  mailboxes: readonly Mailbox[],
  customerMarkers: readonly CustomerMarker[],
) => [
  ...mailboxLabels(mailboxIds, mailboxes),
  ...keywordTags(keywords),
  ...customerTags(customerMarkers),
];

const participantSender = (participants: string | null): Sender => {
  const first = participants?.split(',')[0]?.trim() ?? '';
  const namedAddress = /^(.*?)\s*<([^>]+)>$/.exec(first);
  if (namedAddress) {
    return {
      name: namedAddress[1]?.trim() || namedAddress[2] || '',
      email: namedAddress[2] || '',
    };
  }

  if (first.includes('@')) {
    return { name: first, email: first };
  }

  return { name: first, email: '' };
};

export function adaptThreadSummaryForList(
  summary: ThreadSummary,
  mailboxes: readonly Mailbox[],
): ParsedMessage {
  return {
    id: summary.id,
    emailId: summary.latestEmail.id,
    threadId: summary.id,
    title: summary.subject,
    subject: summary.subject,
    tags: tagsFor(summary.mailboxIds, summary.keywords, mailboxes, summary.customerMarkers),
    sender: participantSender(summary.participants),
    to: [],
    cc: null,
    bcc: null,
    tls: true,
    receivedOn: summary.latestReceivedAt,
    unread: summary.unreadCount > 0,
    body: summary.preview,
    processedHtml: '',
    blobUrl: '',
    isDraft: summary.latestEmail.lifecycle === 'draft',
    hasAttachment: summary.hasAttachment,
    attachments: [],
  };
}

const valueForPart = (email: Email, part: EmailPart | undefined) =>
  part ? email.bodyValues[part.id]?.value : undefined;

const safeSize = (size: string) => {
  const parsed = Number(size);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : Number.MAX_SAFE_INTEGER;
};

const baseUrl = (value: string) => value.replace(/\/+$/, '');

const attachmentFor = (part: EmailPart, options: MailDisplayOptions): Attachment | null => {
  if (!part.blobId) return null;
  const filename = part.filename || 'attachment';
  const url = `${baseUrl(options.backendBaseUrl)}/api/mail/accounts/${encodeURIComponent(
    options.accountId,
  )}/blobs/${encodeURIComponent(part.blobId)}/${encodeURIComponent(filename)}`;

  return {
    attachmentId: part.blobId,
    filename,
    mimeType: part.contentType,
    size: safeSize(part.size),
    body: url,
    headers: [],
  };
};

export function adaptEmailForDisplay(
  email: Email,
  mailboxes: readonly Mailbox[],
  options: MailDisplayOptions,
): ParsedMessage {
  const html = valueForPart(email, email.htmlBody[0]);
  const text = valueForPart(email, email.textBody[0]);
  const body = html ?? text ?? email.preview;
  const sender = email.sender[0] ?? email.from[0] ?? { name: null, email: '' };

  return {
    id: email.id,
    threadId: email.threadId,
    title: email.subject,
    subject: email.subject,
    tags: tagsFor(
      Object.keys(email.mailboxIds),
      email.keywords,
      mailboxes,
      email.customerMarker ? [email.customerMarker] : [],
    ),
    sender: { name: sender.name ?? sender.email, email: sender.email },
    to: email.to.map((address) => ({ name: address.name ?? undefined, email: address.email })),
    cc:
      email.cc.length > 0
        ? email.cc.map((address) => ({ name: address.name ?? undefined, email: address.email }))
        : null,
    bcc:
      email.bcc.length > 0
        ? email.bcc.map((address) => ({ name: address.name ?? undefined, email: address.email }))
        : null,
    tls: true,
    receivedOn: email.receivedAt,
    unread: email.keywords.$seen !== true,
    body: text ?? email.preview,
    processedHtml: body,
    decodedBody: body,
    blobUrl: `${baseUrl(options.backendBaseUrl)}/api/mail/accounts/${encodeURIComponent(
      options.accountId,
    )}/emails/${encodeURIComponent(email.id)}/raw`,
    references: email.references.join(' ') || undefined,
    inReplyTo: email.inReplyTo.join(' ') || undefined,
    replyTo: email.replyTo[0]?.email,
    messageId: email.messageId ?? undefined,
    isDraft: email.lifecycle === 'draft',
    hasAttachment: email.hasAttachment,
    attachments: email.attachments.flatMap((part) => {
      const attachment = attachmentFor(part, options);
      return attachment ? [attachment] : [];
    }),
  };
}

export function buildThreadDisplay(
  emails: readonly Email[],
  mailboxes: readonly Mailbox[],
  options: MailDisplayOptions,
): MailThreadDisplay {
  const messages = emails.map((email) => adaptEmailForDisplay(email, mailboxes, options));
  const latest = messages.at(-1);
  const labels = Array.from(
    new Map(
      messages
        .flatMap((message) => message.tags)
        .filter((tag) => tag.type !== 'keyword')
        .map((tag) => [tag.id, { id: tag.id, name: tag.name }]),
    ).values(),
  );

  return {
    messages,
    latest,
    hasUnread: messages.some((message) => message.unread && !message.isDraft),
    totalReplies: messages.filter((message) => !message.isDraft).length,
    labels,
    isLatestDraft: latest?.isDraft === true,
  };
}
