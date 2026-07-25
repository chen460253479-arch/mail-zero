import type { EmailId, Keyword, MailAccountId, MailboxId } from '../types';

export interface SearchEmailFilter {
  mailboxId?: MailboxId;
  hasKeyword?: Keyword;
  after?: Date;
  before?: Date;
  address?: string;
  hasAttachment?: boolean;
  text?: string;
}

export interface SearchEmailSort {
  property: 'receivedAt' | 'sentAt' | 'size' | 'subject';
  direction: 'asc' | 'desc';
}

export interface SearchEmailInput {
  accountId: MailAccountId;
  filter: SearchEmailFilter;
  sort: SearchEmailSort;
  limit: number;
  cursor: string | null;
}

export interface SearchEmailResult {
  emailIds: EmailId[];
  nextCursor: string | null;
}

export interface SearchStore {
  query(input: SearchEmailInput): Promise<SearchEmailResult>;
}
