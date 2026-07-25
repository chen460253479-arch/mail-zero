import type {
  AccountRepository,
  BlobRecord,
  BlobRepository,
  ChangeRepository,
  EmailRecord,
  EmailRepository,
  FindRemoteEmailInput,
  IdentityRecord,
  IdentityRepository,
  InsertMailAccount,
  MailAccountRecord,
  MailboxRecord,
  MailboxRepository,
  MailChangeRecord,
  QueryChangesInput,
  RemoteEmailRecord,
  SubmissionAttemptRecord,
  SubmissionRecord,
  SubmissionRepository,
  ThreadRecord,
  ThreadRepository,
} from '../store/repositories';
import type {
  BlobId,
  EmailId,
  EmailSubmissionId,
  IdentityId,
  Keyword,
  MailAccountId,
  MailboxId,
  MailboxRole,
  ThreadId,
} from '../types';
import type { MailTransaction, MailUnitOfWork } from '../store/unit-of-work';
import { MailCoreError } from '../types';

export interface MemoryMailState {
  accounts: Map<string, MailAccountRecord>;
  mailboxes: Map<string, MailboxRecord>;
  blobs: Map<string, BlobRecord>;
  threads: Map<string, ThreadRecord>;
  emails: Map<string, EmailRecord>;
  remoteEmails: Map<string, RemoteEmailRecord>;
  identities: Map<string, IdentityRecord>;
  submissions: Map<string, SubmissionRecord>;
  submissionAttempts: Map<string, SubmissionAttemptRecord>;
  changes: Map<string, MailChangeRecord>;
  oldestAvailableStates: Map<MailAccountId, bigint>;
}

const copy = <Value>(value: Value): Value => structuredClone(value);

const entityKey = (accountId: MailAccountId, entityId: string): string =>
  `${accountId}\u0000${entityId}`;

const remoteKey = (input: FindRemoteEmailInput): string =>
  `${input.accountId}\u0000${input.provider}\u0000${input.remoteEmailId}`;

const changeKey = (record: MailChangeRecord): string =>
  [record.accountId, record.stateVersion, record.collection, record.entityId].join('\u0000');

const attemptKey = (record: SubmissionAttemptRecord): string =>
  `${record.accountId}\u0000${record.submissionId}\u0000${record.attemptNumber}`;

const createEmptyState = (): MemoryMailState => ({
  accounts: new Map(),
  mailboxes: new Map(),
  blobs: new Map(),
  threads: new Map(),
  emails: new Map(),
  remoteEmails: new Map(),
  identities: new Map(),
  submissions: new Map(),
  submissionAttempts: new Map(),
  changes: new Map(),
  oldestAvailableStates: new Map(),
});

const findScoped = <RecordType>(
  records: Map<string, RecordType>,
  accountId: MailAccountId,
  id: string,
): RecordType | null => {
  const record = records.get(entityKey(accountId, id));
  return record === undefined ? null : copy(record);
};

const listScoped = <RecordType extends { accountId: MailAccountId }>(
  records: Map<string, RecordType>,
  accountId: MailAccountId,
): RecordType[] =>
  [...records.values()].filter((record) => record.accountId === accountId).map(copy);

const updateScoped = <RecordType extends { id: string; accountId: MailAccountId }>(
  records: Map<string, RecordType>,
  accountId: MailAccountId,
  id: string,
  patch: Partial<Omit<RecordType, 'id' | 'accountId'>>,
  missingCode:
    | 'MAILBOX_NOT_FOUND'
    | 'BLOB_NOT_FOUND'
    | 'THREAD_NOT_FOUND'
    | 'EMAIL_NOT_FOUND'
    | 'IDENTITY_NOT_FOUND'
    | 'EMAIL_SUBMISSION_NOT_FOUND',
): RecordType => {
  const key = entityKey(accountId, id);
  const current = records.get(key);
  if (current === undefined) {
    throw new MailCoreError(missingCode, { entityId: id });
  }
  const updated = copy({ ...current, ...patch, id, accountId } as RecordType);
  records.set(key, updated);
  return copy(updated);
};

const createRepositories = (
  state: MemoryMailState,
  observeChangeQuery: (input: QueryChangesInput) => void,
): Omit<MailTransaction, 'lockAccount' | 'nextStateVersion'> => {
  const accounts: AccountRepository = {
    async findById(id) {
      const record = state.accounts.get(id);
      return record === undefined ? null : copy(record);
    },
    async findByConnectionId(connectionId) {
      const record = [...state.accounts.values()].find(
        (candidate) => candidate.connectionId === connectionId,
      );
      return record === undefined ? null : copy(record);
    },
    async insert(input: InsertMailAccount) {
      const createdAt = input.createdAt ?? new Date(0);
      const record: MailAccountRecord = {
        ...input,
        status: input.status ?? 'active',
        stateVersion: input.stateVersion ?? 0n,
        timezone: input.timezone ?? 'UTC',
        storageQuotaBytes: input.storageQuotaBytes ?? null,
        createdAt,
        updatedAt: input.updatedAt ?? createdAt,
      };
      const stored = copy(record);
      state.accounts.set(record.id, stored);
      return copy(stored);
    },
    async update(id, patch) {
      const current = state.accounts.get(id);
      if (current === undefined) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: id });
      }
      const updated = copy({ ...current, ...patch, id });
      state.accounts.set(id, updated);
      return copy(updated);
    },
  };

  const mailboxes: MailboxRepository = {
    async findById(accountId, id) {
      return findScoped(state.mailboxes, accountId, id);
    },
    async findByRole(accountId, role: MailboxRole) {
      const record = [...state.mailboxes.values()].find(
        (candidate) =>
          candidate.accountId === accountId &&
          candidate.role === role &&
          candidate.deletedAt === null,
      );
      return record === undefined ? null : copy(record);
    },
    async findByNormalizedName(accountId, parentId, normalizedName) {
      const record = [...state.mailboxes.values()].find(
        (candidate) =>
          candidate.accountId === accountId &&
          candidate.parentId === parentId &&
          candidate.normalizedName === normalizedName &&
          candidate.deletedAt === null,
      );
      return record === undefined ? null : copy(record);
    },
    async existsOutsideAccount(accountId, id) {
      return [...state.mailboxes.values()].some(
        (candidate) => candidate.id === id && candidate.accountId !== accountId,
      );
    },
    async listByAccount(accountId) {
      return listScoped(state.mailboxes, accountId);
    },
    async insert(record) {
      const stored = copy(record);
      state.mailboxes.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.mailboxes, accountId, id, patch, 'MAILBOX_NOT_FOUND');
    },
    async delete(accountId, id) {
      state.mailboxes.delete(entityKey(accountId, id));
    },
  };

  const blobs: BlobRepository = {
    async findById(accountId, id) {
      return findScoped(state.blobs, accountId, id);
    },
    async findByDigest(accountId, sha256, sizeBytes) {
      const record = [...state.blobs.values()].find(
        (candidate) =>
          candidate.accountId === accountId &&
          candidate.sha256 === sha256 &&
          candidate.sizeBytes === sizeBytes,
      );
      return record === undefined ? null : copy(record);
    },
    async listByAccount(accountId) {
      return listScoped(state.blobs, accountId);
    },
    async insert(record) {
      const stored = copy(record);
      state.blobs.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.blobs, accountId, id, patch, 'BLOB_NOT_FOUND');
    },
    async delete(accountId, id) {
      state.blobs.delete(entityKey(accountId, id));
    },
  };

  const threads: ThreadRepository = {
    async findById(accountId, id) {
      return findScoped(state.threads, accountId, id);
    },
    async existsOutsideAccount(accountId, id) {
      return [...state.threads.values()].some(
        (candidate) => candidate.id === id && candidate.accountId !== accountId,
      );
    },
    async listByAccount(accountId) {
      return listScoped(state.threads, accountId);
    },
    async insert(record) {
      const stored = copy(record);
      state.threads.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.threads, accountId, id, patch, 'THREAD_NOT_FOUND');
    },
    async delete(accountId, id) {
      state.threads.delete(entityKey(accountId, id));
    },
  };

  const emails: EmailRepository = {
    async findById(accountId, id) {
      return findScoped(state.emails, accountId, id);
    },
    async existsOutsideAccount(accountId, id) {
      return [...state.emails.values()].some(
        (candidate) => candidate.id === id && candidate.accountId !== accountId,
      );
    },
    async findByRemoteId(input) {
      const record = state.remoteEmails.get(remoteKey(input));
      return record === undefined ? null : copy(record);
    },
    async listByAccount(accountId) {
      return listScoped(state.emails, accountId);
    },
    async listByThread(accountId, threadId) {
      return listScoped(state.emails, accountId).filter((email) => email.threadId === threadId);
    },
    async insert(record) {
      const stored = copy(record);
      state.emails.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.emails, accountId, id, patch, 'EMAIL_NOT_FOUND');
    },
    async linkRemote(record) {
      const stored = copy(record);
      state.remoteEmails.set(
        remoteKey({
          accountId: record.accountId,
          provider: record.provider,
          remoteEmailId: record.remoteEmailId,
        }),
        stored,
      );
      return copy(stored);
    },
    async replaceMailboxes(accountId, emailId, mailboxIds) {
      await emails.update(accountId, emailId, {
        mailboxIds: [...mailboxIds],
      });
    },
    async replaceKeywords(accountId, emailId, keywords: Keyword[]) {
      await emails.update(accountId, emailId, { keywords: [...keywords] });
    },
    async replaceRestoreMailboxes(accountId, emailId, mailboxIds) {
      await emails.update(accountId, emailId, {
        restoreMailboxIds: [...mailboxIds],
      });
    },
    async delete(accountId, id) {
      state.emails.delete(entityKey(accountId, id));
      for (const [key, remote] of state.remoteEmails) {
        if (remote.accountId === accountId && remote.emailId === id) {
          state.remoteEmails.delete(key);
        }
      }
    },
  };

  const identities: IdentityRepository = {
    async findById(accountId, id) {
      return findScoped(state.identities, accountId, id);
    },
    async existsOutsideAccount(accountId, id) {
      return [...state.identities.values()].some(
        (candidate) => candidate.id === id && candidate.accountId !== accountId,
      );
    },
    async listByAccount(accountId) {
      return listScoped(state.identities, accountId);
    },
    async insert(record) {
      const stored = copy(record);
      state.identities.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.identities, accountId, id, patch, 'IDENTITY_NOT_FOUND');
    },
    async delete(accountId, id) {
      state.identities.delete(entityKey(accountId, id));
    },
  };

  const submissions: SubmissionRepository = {
    async findById(accountId, id) {
      return findScoped(state.submissions, accountId, id);
    },
    async findByIdempotencyKey(accountId, idempotencyKey) {
      const record = [...state.submissions.values()].find(
        (candidate) =>
          candidate.accountId === accountId && candidate.idempotencyKey === idempotencyKey,
      );
      return record === undefined ? null : copy(record);
    },
    async listByIdentity(accountId, identityId) {
      return listScoped(state.submissions, accountId).filter(
        (submission) => submission.identityId === identityId,
      );
    },
    async insert(record) {
      const stored = copy(record);
      state.submissions.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.submissions, accountId, id, patch, 'EMAIL_SUBMISSION_NOT_FOUND');
    },
    async recordAttempt(record) {
      const key = attemptKey(record);
      if (state.submissionAttempts.has(key)) {
        throw new MailCoreError('INVALID_SUBMISSION_TRANSITION', {
          entityId: record.submissionId,
        });
      }
      state.submissionAttempts.set(key, copy(record));
    },
    async updateAttempt(accountId, submissionId, attemptNumber, patch) {
      const key = `${accountId}\u0000${submissionId}\u0000${attemptNumber}`;
      const current = state.submissionAttempts.get(key);
      if (current === undefined || current.finishedAt !== null) {
        throw new MailCoreError('INVALID_SUBMISSION_TRANSITION', {
          entityId: submissionId,
        });
      }
      const updated = copy({ ...current, ...patch });
      state.submissionAttempts.set(key, updated);
      return copy(updated);
    },
    async listAttempts(accountId, submissionId) {
      return [...state.submissionAttempts.values()]
        .filter(
          (attempt) => attempt.accountId === accountId && attempt.submissionId === submissionId,
        )
        .sort((left, right) => left.attemptNumber - right.attemptNumber)
        .map(copy);
    },
  };

  const changes: ChangeRepository = {
    async recordChange(record) {
      state.changes.set(changeKey(record), copy(record));
    },
    async oldestAvailableState(accountId) {
      return state.oldestAvailableStates.get(accountId) ?? 0n;
    },
    async queryChanges(input: QueryChangesInput) {
      observeChangeQuery(copy(input));
      const records = [...state.changes.values()]
        .filter(
          (record) =>
            record.accountId === input.accountId &&
            (input.collection === undefined || record.collection === input.collection) &&
            (input.afterState === undefined || record.stateVersion > input.afterState) &&
            (input.throughState === undefined || record.stateVersion <= input.throughState),
        )
        .sort((left, right) => {
          if (left.stateVersion !== right.stateVersion) {
            return left.stateVersion < right.stateVersion ? -1 : 1;
          }
          return left.entityId.localeCompare(right.entityId);
        });
      if (input.limit === undefined || records.length <= input.limit) {
        return records.map(copy);
      }
      const cutoffState = records[input.limit - 1]!.stateVersion;
      return records.filter(({ stateVersion }) => stateVersion <= cutoffState).map(copy);
    },
    async hasChanges(input) {
      return [...state.changes.values()].some(
        (record) =>
          record.accountId === input.accountId &&
          (input.collection === undefined || record.collection === input.collection) &&
          (input.afterState === undefined || record.stateVersion > input.afterState) &&
          (input.throughState === undefined || record.stateVersion <= input.throughState),
      );
    },
  };

  return {
    accounts,
    mailboxes,
    blobs,
    threads,
    emails,
    identities,
    submissions,
    changes,
  };
};

export class MemoryMailUnitOfWork implements MailUnitOfWork {
  private state = createEmptyState();
  private readonly changeQueries: QueryChangesInput[] = [];
  private tail: Promise<void> = Promise.resolve();
  private commitAcknowledgementsBeforeFailure: number | null = null;

  async run<Result>(operation: (tx: MailTransaction) => Promise<Result>): Promise<Result> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.runIsolated(operation);
    } finally {
      release();
    }
  }

  private async runIsolated<Result>(
    operation: (tx: MailTransaction) => Promise<Result>,
  ): Promise<Result> {
    const transactionState = copy(this.state);
    const allocatedVersions = new Map<MailAccountId, bigint>();
    const repositories = createRepositories(transactionState, (input) => {
      this.changeQueries.push(input);
    });
    const transaction: MailTransaction = {
      ...repositories,
      lockAccount: async (accountId) => {
        if (!transactionState.accounts.has(accountId)) {
          throw new MailCoreError('ACCOUNT_NOT_FOUND', {
            entityId: accountId,
          });
        }
        // The memory adapter serializes every callback, which is stronger
        // than the account-scoped lock required by the port.
      },
      nextStateVersion: async (accountId) => {
        const allocated = allocatedVersions.get(accountId);
        if (allocated !== undefined) {
          return allocated;
        }
        const account = transactionState.accounts.get(accountId);
        if (account === undefined) {
          throw new MailCoreError('ACCOUNT_NOT_FOUND', {
            entityId: accountId,
          });
        }
        const version = account.stateVersion + 1n;
        transactionState.accounts.set(
          accountId,
          copy({
            ...account,
            stateVersion: version,
          }),
        );
        allocatedVersions.set(accountId, version);
        return version;
      },
    };

    const result = await operation(transaction);
    this.state = transactionState;
    if (this.commitAcknowledgementsBeforeFailure !== null) {
      this.commitAcknowledgementsBeforeFailure -= 1;
      if (this.commitAcknowledgementsBeforeFailure === 0) {
        this.commitAcknowledgementsBeforeFailure = null;
        throw new Error('transaction commit outcome unknown');
      }
    }
    return result;
  }

  failCommitAcknowledgementAfter(completedOperations: number): void {
    this.commitAcknowledgementsBeforeFailure = completedOperations;
  }

  snapshot(): MemoryMailState {
    return copy(this.state);
  }

  pruneChangesThrough(accountId: MailAccountId, stateVersion: bigint): void {
    for (const [key, change] of this.state.changes) {
      if (change.accountId === accountId && change.stateVersion <= stateVersion) {
        this.state.changes.delete(key);
      }
    }
    this.state.oldestAvailableStates.set(accountId, stateVersion);
  }

  observedChangeQueries(): QueryChangesInput[] {
    return copy(this.changeQueries);
  }
}

export interface MemoryMailInspector {
  accounts(): Promise<MailAccountRecord[]>;
  account(id: MailAccountId): Promise<MailAccountRecord | null>;
  mailboxes(accountId?: MailAccountId): Promise<MailboxRecord[]>;
  mailbox(id: MailboxId): Promise<MailboxRecord | null>;
  blobs(accountId?: MailAccountId): Promise<BlobRecord[]>;
  blob(id: BlobId): Promise<BlobRecord | null>;
  threads(accountId?: MailAccountId): Promise<ThreadRecord[]>;
  thread(id: ThreadId): Promise<ThreadRecord | null>;
  emails(accountId?: MailAccountId): Promise<EmailRecord[]>;
  email(id: EmailId): Promise<EmailRecord | null>;
  identities(accountId?: MailAccountId): Promise<IdentityRecord[]>;
  identity(id: IdentityId): Promise<IdentityRecord | null>;
  submissions(accountId?: MailAccountId): Promise<SubmissionRecord[]>;
  submission(id: EmailSubmissionId): Promise<SubmissionRecord | null>;
  attempts(submissionId: EmailSubmissionId): Promise<SubmissionAttemptRecord[]>;
  changes(accountId?: MailAccountId): Promise<MailChangeRecord[]>;
  changeQueries(): Promise<QueryChangesInput[]>;
  stateVersion(accountId: MailAccountId): Promise<bigint>;
  seedMailboxEmail(mailboxId: MailboxId): Promise<void>;
}

const findById = <RecordType extends { id: string }>(
  records: Iterable<RecordType>,
  id: string,
): RecordType | null => {
  const record = [...records].find((candidate) => candidate.id === id);
  return record === undefined ? null : copy(record);
};

const filterByAccount = <RecordType extends { accountId: MailAccountId }>(
  records: Iterable<RecordType>,
  accountId?: MailAccountId,
): RecordType[] =>
  [...records]
    .filter((record) => accountId === undefined || record.accountId === accountId)
    .map(copy);

export const createMemoryMailInspector = (
  unitOfWork: MemoryMailUnitOfWork,
): MemoryMailInspector => ({
  async accounts() {
    return [...unitOfWork.snapshot().accounts.values()].map(copy);
  },
  async account(id) {
    const record = unitOfWork.snapshot().accounts.get(id);
    return record === undefined ? null : copy(record);
  },
  async mailboxes(accountId) {
    return filterByAccount(unitOfWork.snapshot().mailboxes.values(), accountId);
  },
  async mailbox(id) {
    return findById(unitOfWork.snapshot().mailboxes.values(), id);
  },
  async blobs(accountId) {
    return filterByAccount(unitOfWork.snapshot().blobs.values(), accountId);
  },
  async blob(id) {
    return findById(unitOfWork.snapshot().blobs.values(), id);
  },
  async threads(accountId) {
    return filterByAccount(unitOfWork.snapshot().threads.values(), accountId);
  },
  async thread(id) {
    return findById(unitOfWork.snapshot().threads.values(), id);
  },
  async emails(accountId) {
    return filterByAccount(unitOfWork.snapshot().emails.values(), accountId);
  },
  async email(id) {
    return findById(unitOfWork.snapshot().emails.values(), id);
  },
  async identities(accountId) {
    return filterByAccount(unitOfWork.snapshot().identities.values(), accountId);
  },
  async identity(id) {
    return findById(unitOfWork.snapshot().identities.values(), id);
  },
  async submissions(accountId) {
    return filterByAccount(unitOfWork.snapshot().submissions.values(), accountId);
  },
  async submission(id) {
    return findById(unitOfWork.snapshot().submissions.values(), id);
  },
  async attempts(submissionId) {
    return [...unitOfWork.snapshot().submissionAttempts.values()]
      .filter((attempt) => attempt.submissionId === submissionId)
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map(copy);
  },
  async changes(accountId) {
    return filterByAccount(unitOfWork.snapshot().changes.values(), accountId);
  },
  async changeQueries() {
    return unitOfWork.observedChangeQueries();
  },
  async stateVersion(accountId) {
    return unitOfWork.snapshot().accounts.get(accountId)?.stateVersion ?? 0n;
  },
  async seedMailboxEmail(mailboxId) {
    const mailbox = findById(unitOfWork.snapshot().mailboxes.values(), mailboxId);
    if (mailbox === null) {
      throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
    }
    const suffix = (unitOfWork.snapshot().emails.size + 1).toString().padStart(8, '0');
    const now = new Date('2026-01-01T00:00:00.000Z');
    await unitOfWork.run((tx) =>
      tx.emails.insert({
        id: `seed-email-${suffix}` as EmailId,
        accountId: mailbox.accountId,
        identityId: null,
        threadId: `seed-thread-${suffix}` as ThreadId,
        blobId: null,
        messageId: null,
        replyToEmailId: null,
        inReplyTo: [],
        references: [],
        subject: '',
        preview: '',
        sentAt: null,
        receivedAt: now,
        sizeBytes: 0n,
        hasAttachment: false,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: now,
        updatedAt: now,
        destroyedAt: null,
        sender: [],
        from: [],
        replyTo: [],
        to: [],
        cc: [],
        bcc: [],
        textBlobId: null,
        htmlBlobId: null,
        parserVersion: 1,
        parseWarnings: [],
        parts: [],
        mailboxIds: [mailboxId],
        restoreMailboxIds: [],
        keywords: [],
      }),
    );
  },
});
