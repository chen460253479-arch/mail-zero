import type { Email, EmailAddress } from './email';

export type DraftContent = {
  identityId: string;
  replyToEmailId: string | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  textBody: string;
  htmlBody: string;
  attachments: Array<{
    blobId: string;
    filename: string;
  }>;
};

export type Draft = Email & {
  draftRevision: number;
};
