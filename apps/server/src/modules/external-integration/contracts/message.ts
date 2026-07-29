import type { MailAddress } from '@zero/mail-core';

import type { MailChannelId } from '../../../mail-channel/contracts';

export type ExternalMessageSummary = {
  messageId: string;
  internetMessageId: string | null;
  threadId: string;
  mailAccountId: string;
  nangoConnectionId: string;
  channelId: MailChannelId;
  lifecycle: 'draft' | 'received' | 'sent';
  mailboxIds: string[];
  keywords: string[];
  subject: string;
  preview: string;
  sender: MailAddress[];
  from: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  sentAt: string | null;
  receivedAt: string;
  hasAttachment: boolean;
  attachmentCount: number;
};

export type ExternalMessageContent = {
  messageId: string;
  textBody: string | null;
  htmlBody: string | null;
};

export type ExternalAttachment = {
  attachmentId: string;
  filename: string | null;
  contentType: string;
  disposition: 'inline' | 'attachment' | null;
  size: string;
};
