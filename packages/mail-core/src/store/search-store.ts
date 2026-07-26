import type { CursorSortValue, EmailQueryFilter, EmailQuerySort } from '../search';
import type { EmailId, MailAccountId } from '../types';

export type SearchEmailFilter = EmailQueryFilter;
export type SearchEmailSort = EmailQuerySort;

export interface SearchEmailCursor {
  value: CursorSortValue;
  emailId: EmailId;
}

export interface SearchEmailInput {
  accountId: MailAccountId;
  filter: SearchEmailFilter;
  sort: SearchEmailSort;
  limit: number;
  cursor: SearchEmailCursor | null;
  calculateTotal: boolean;
}

export interface SearchEmailResult {
  emailIds: EmailId[];
  nextCursor: SearchEmailCursor | null;
  total: number | null;
}

export interface SearchStore {
  query(input: SearchEmailInput): Promise<SearchEmailResult>;
}
