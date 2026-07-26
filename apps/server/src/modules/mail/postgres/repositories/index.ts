import type { MailTransaction } from '@zero/mail-core';

import { createMailAggregateMaintenanceRepository } from './mail-maintenance-repository';
import { createThreadReferenceRepository } from './thread-reference-repository';
import { createMailAggregateRepository } from './mail-aggregate-repository';
import { createThreadQueryRepository } from './thread-query-repository';
import { createSubmissionRepository } from './submission-repository';
import { createIdentityRepository } from './identity-repository';
import { createMailboxRepository } from './mailbox-repository';
import { createAccountRepository } from './account-repository';
import { createThreadRepository } from './thread-repository';
import { createChangeRepository } from './change-repository';
import { createEmailRepository } from './email-repository';
import { createBlobRepository } from './blob-repository';
import type { MailDatabase } from './database';

export const createPostgresRepositories = (
  db: MailDatabase,
): Omit<MailTransaction, 'lockAccount' | 'nextStateVersion'> => ({
  accounts: createAccountRepository(db),
  mailboxes: createMailboxRepository(db),
  blobs: createBlobRepository(db),
  threads: createThreadRepository(db),
  threadReferences: createThreadReferenceRepository(db),
  threadQueries: createThreadQueryRepository(db),
  emails: createEmailRepository(db),
  mailAggregates: createMailAggregateRepository(db),
  mailAggregateMaintenance: createMailAggregateMaintenanceRepository(db),
  identities: createIdentityRepository(db),
  submissions: createSubmissionRepository(db),
  changes: createChangeRepository(db),
});

export { createAccountRepository } from './account-repository';
export { createBlobRepository } from './blob-repository';
export { createChangeRepository } from './change-repository';
export { createEmailRepository } from './email-repository';
export { createIdentityRepository } from './identity-repository';
export { createMailboxRepository } from './mailbox-repository';
export { createMailAggregateRepository } from './mail-aggregate-repository';
export { createMailAggregateMaintenanceRepository } from './mail-maintenance-repository';
export { createSubmissionRepository } from './submission-repository';
export { createThreadRepository } from './thread-repository';
export { createThreadQueryRepository } from './thread-query-repository';
export { createThreadReferenceRepository } from './thread-reference-repository';
