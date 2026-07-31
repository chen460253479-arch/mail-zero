import type { BlobId, EmailId, IdentityId, MailAccountId, MailAddress } from '../types';
import type { EmailRecord, IdentityRecord } from '../store';

export type DraftContent = {
  identityId: IdentityId;
  replyToEmailId: EmailId | null;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments: DraftAttachmentInput[];
};

export type DraftAttachmentInput = {
  blobId: BlobId;
  filename: string;
};

export type CreateDraftInput = DraftContent & {
  accountId: MailAccountId;
};

export type UpdateDraftInput = {
  accountId: MailAccountId;
  emailId: EmailId;
  expectedRevision: number;
  content: DraftContent;
};

export type DestroyDraftInput = {
  accountId: MailAccountId;
  emailId: EmailId;
};

export type DraftResult = EmailRecord & {
  stateVersion: bigint;
};

export type DestroyDraftResult = {
  emailId: EmailId;
  stateVersion: bigint;
};

export type DraftAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: bigint;
  bytes: Uint8Array;
};

export type RenderDraftInput = {
  emailId: EmailId;
  revision: number;
  messageId: string;
  date: Date;
  identity: IdentityRecord;
  content: DraftContent;
  inReplyTo: string[];
  references: string[];
  attachments: DraftAttachment[];
};
