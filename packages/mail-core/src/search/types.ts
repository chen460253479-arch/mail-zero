import type { EmailId, Keyword, MailAccountId, MailboxId, ThreadId } from '../types';
import type { EmailLifecycle } from '../store/repositories';

export type QueryDirection = 'asc' | 'desc';
export type EmailSortProperty = 'receivedAt' | 'sentAt' | 'size' | 'subject';

export type EmailQueryFilter = {
  mailboxId?: MailboxId;
  hasKeyword?: Keyword;
  notKeyword?: Keyword;
  lifecycle?: EmailLifecycle;
  after?: Date;
  before?: Date;
  address?: string;
  from?: string;
  to?: string;
  hasAttachment?: boolean;
  text?: string;
};

export type EmailQuerySort = {
  property: EmailSortProperty;
  direction: QueryDirection;
};

export type CursorSortValue =
  | { type: 'date'; value: string }
  | { type: 'null' }
  | { type: 'bigint'; value: string }
  | { type: 'string'; value: string };

export type EmailCursorPayload = {
  version: 1;
  kind: 'email';
  accountId: MailAccountId;
  sort: EmailSortProperty;
  direction: QueryDirection;
  query: string;
  value: CursorSortValue;
  emailId: EmailId;
};

export type ThreadCursorPayload = {
  version: 1;
  kind: 'thread';
  accountId: MailAccountId;
  query: string;
  latestReceivedAt: string;
  threadId: ThreadId;
};

export type CursorPayload = EmailCursorPayload | ThreadCursorPayload;
