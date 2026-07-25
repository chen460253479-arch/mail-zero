import type { EmailId, Keyword, MailAccountId, MailAddress, MailboxId } from '../types';

export type ParseRawEmailDependencies = {
  sanitizeHtml(html: string): string;
};

export type ParsedPart = {
  parentPath: string | null;
  partPath: string;
  contentType: string;
  charset: string | null;
  disposition: 'inline' | 'attachment' | null;
  related: boolean;
  kind: 'body' | 'inline' | 'attachment';
  filename: string | null;
  contentId: string | null;
  bytes: Uint8Array;
  sizeBytes: bigint;
};

export type ParsedEmail = {
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  subject: string;
  sentAt: Date | null;
  from: MailAddress[];
  sender: MailAddress[];
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  textBody: string;
  htmlBody: string;
  parts: ParsedPart[];
  attachments: ParsedPart[];
  hasAttachment: boolean;
};

export type ImportEmailInput = {
  accountId: MailAccountId;
  provider: string;
  remoteEmailId: string;
  remoteThreadId: string | null;
  raw: Uint8Array;
  mailboxIds: MailboxId[];
  keywords: Keyword[];
  receivedAt: Date;
};

export type ImportEmailResult = {
  created: boolean;
  emailId: EmailId;
};
