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
  nextStateVersion(accountId: MailAccountId): Promise<bigint>;
}

export interface MailUnitOfWork {
  run<T>(operation: (tx: MailTransaction) => Promise<T>): Promise<T>;
}
