export type EmailAddress = {
  name: string | null;
  email: string;
};

export type EmailKeywordMap = Record<string, true>;
export type EmailMailboxMap = Record<string, true>;

export type EmailLifecycle = 'draft' | 'received' | 'sent';

export type CustomerMarker = {
  customerId: string;
  customerName: string;
};

export type EmailPart = {
  id: string;
  parentPartId: string | null;
  partPath: string;
  contentType: string;
  charset: string | null;
  disposition: 'inline' | 'attachment' | null;
  filename: string | null;
  contentId: string | null;
  blobId: string | null;
  size: string;
  kind: 'body' | 'inline' | 'attachment';
};

export type EmailBodyValue = {
  value: string;
  isTruncated: boolean;
};

export type Email = {
  id: string;
  threadId: string;
  blobId: string | null;
  mailboxIds: EmailMailboxMap;
  keywords: EmailKeywordMap;
  lifecycle: EmailLifecycle;
  draftRevision: number;
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  sender: EmailAddress[];
  from: EmailAddress[];
  replyTo: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  preview: string;
  sentAt: string | null;
  receivedAt: string;
  size: string;
  hasAttachment: boolean;
  textBody: EmailPart[];
  htmlBody: EmailPart[];
  attachments: EmailPart[];
  bodyValues: Record<string, EmailBodyValue>;
  customerMarker?: CustomerMarker | null;
};
