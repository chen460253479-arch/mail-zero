import type { MailAccountId } from '../types';
import type {
  AccountRepository,
  BlobRepository,
  ChangeRepository,
  EmailRepository,
  IdentityRepository,
  MailboxRepository,
  SubmissionRepository,
  ThreadRepository,
} from './repositories';

export interface MailTransaction {
  accounts: AccountRepository;
  mailboxes: MailboxRepository;
  blobs: BlobRepository;
  threads: ThreadRepository;
  emails: EmailRepository;
  identities: IdentityRepository;
  submissions: SubmissionRepository;
  changes: ChangeRepository;
  /**
   * Acquires an account-scoped exclusive write lock until this unit of work
   * settles. Adapters must serialize callers that lock the same account.
   */
  lockAccount(accountId: MailAccountId): Promise<void>;
  nextStateVersion(accountId: MailAccountId): Promise<bigint>;
}

export interface MailUnitOfWork {
  /**
   * Publishes callback writes only when the callback and commit both succeed.
   * A rejection after a successful callback may have an unknown commit outcome.
   */
  run<T>(operation: (tx: MailTransaction) => Promise<T>): Promise<T>;
}
