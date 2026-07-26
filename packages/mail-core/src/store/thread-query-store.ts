import type { EmailId, MailAccountId, MailboxId, ThreadId } from '../types';
import type { ThreadRecord } from './repositories';

export type ThreadQueryPosition = {
  latestReceivedAt: Date;
  threadId: ThreadId;
};

export type ThreadQueryProjection = ThreadRecord & {
  emailIds: EmailId[];
  mailboxIds: MailboxId[];
};

export interface ThreadQueryRepository {
  query(input: {
    accountId: MailAccountId;
    mailboxId: MailboxId | null;
    after: ThreadQueryPosition | null;
    limit: number;
  }): Promise<{
    threads: ThreadQueryProjection[];
    hasMore: boolean;
  }>;
  findById(accountId: MailAccountId, threadId: ThreadId): Promise<ThreadQueryProjection | null>;
}
