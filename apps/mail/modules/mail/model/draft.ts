import type { Email, EmailAddress } from './email';

export type DraftAttachmentReference = {
  blobId: string;
  filename: string;
};

export type DraftAttachmentDescriptor = DraftAttachmentReference & {
  contentType: string;
  size: string;
};

export type DraftContent = {
  identityId: string;
  replyToEmailId: string | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments: DraftAttachmentReference[];
};

export type Draft = Email & {
  draftRevision: number;
};
