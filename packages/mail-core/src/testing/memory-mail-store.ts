import type {
  AccountRepository,
  BlobRecord,
  BlobRepository,
  ChangeRepository,
  EmailRecord,
  EmailRepository,
  EmailSearchDocument,
  FindRemoteEmailInput,
  IdentityRecord,
  IdentityRepository,
  InsertMailAccount,
  MailAccountRecord,
  MailAggregateMaintenanceRepository,
  MailAggregateRepository,
  MailboxRecord,
  MailboxRepository,
  MailChangeRecord,
  QueryChangesInput,
  QuerySubmissionPageInput,
  RemoteEmailRecord,
  SubmissionRecord,
  SubmissionRepository,
  ThreadRecord,
  ThreadReferenceRecord,
  ThreadReferenceRepository,
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
import type { ThreadQueryProjection, ThreadQueryRepository } from '../store/thread-query-store';
import type { EnqueueMailNotification, MailNotificationRepository } from '../notifications';
import { calculateEmailAggregateDelta } from '../mailbox/email-aggregate-delta';
import type { MailTransaction, MailUnitOfWork } from '../store/unit-of-work';
import type { AggregateMismatch, MailAggregateValues } from '../mailbox';
import { mergeMailChanges } from '../changes/merge-change';
import { MailCoreError } from '../types';

export interface MemoryMailState {
  accounts: Map<string, MailAccountRecord>;
  mailboxes: Map<string, MailboxRecord>;
  blobs: Map<string, BlobRecord>;
  threads: Map<string, ThreadRecord>;
  threadReferences: Map<string, ThreadReferenceRecord>;
  mailboxThreads: Map<
    string,
    {
      accountId: MailAccountId;
      mailboxId: MailboxId;
      threadId: ThreadId;
      emailCount: number;
      unreadCount: number;
    }
  >;
  emails: Map<string, EmailRecord>;
  emailSearchDocuments: Map<string, EmailSearchDocument>;
  remoteEmails: Map<string, RemoteEmailRecord>;
  identities: Map<string, IdentityRecord>;
  submissions: Map<string, SubmissionRecord>;
  changes: Map<string, MailChangeRecord>;
  notifications: Map<string, EnqueueMailNotification>;
  oldestAvailableStates: Map<MailAccountId, bigint>;
}

const copy = <Value>(value: Value): Value => structuredClone(value);

const entityKey = (accountId: MailAccountId, entityId: string): string =>
  `${accountId}\u0000${entityId}`;

const remoteKey = (input: FindRemoteEmailInput): string =>
  `${input.accountId}\u0000${input.provider}\u0000${input.remoteEmailId}`;

const changeKey = (record: MailChangeRecord): string =>
  [record.accountId, record.stateVersion, record.collection, record.entityId].join('\u0000');

const threadReferenceKey = (record: ThreadReferenceRecord): string =>
  [record.accountId, record.normalizedSubjectHash, record.messageIdHash, record.emailId].join(
    '\u0000',
  );

const searchDocumentFromEmail = (record: EmailRecord): EmailSearchDocument => ({
  subject: record.subject,
  addressText: [
    ...record.sender,
    ...record.from,
    ...record.replyTo,
    ...record.to,
    ...record.cc,
    ...record.bcc,
  ]
    .flatMap(({ email, name }) => [name ?? '', email])
    .join(' '),
  bodyText: record.preview,
});

const createEmptyState = (): MemoryMailState => ({
  accounts: new Map(),
  mailboxes: new Map(),
  blobs: new Map(),
  threads: new Map(),
  threadReferences: new Map(),
  mailboxThreads: new Map(),
  emails: new Map(),
  emailSearchDocuments: new Map(),
  remoteEmails: new Map(),
  identities: new Map(),
  submissions: new Map(),
  changes: new Map(),
  notifications: new Map(),
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
  observeSubmissionQuery: (input: QuerySubmissionPageInput) => void,
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
    async listByUser(userId) {
      return [...state.accounts.values()]
        .filter((candidate) => candidate.userId === userId)
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
        )
        .map(copy);
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
    async hasChild(accountId, id) {
      return [...state.mailboxes.values()].some(
        (candidate) => candidate.accountId === accountId && candidate.parentId === id,
      );
    },
    async hasEmail(accountId, id) {
      return [...state.emails.values()].some(
        (candidate) => candidate.accountId === accountId && candidate.mailboxIds.includes(id),
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
    async findByObjectKeyExcluding(accountId, objectKey, exclusion) {
      const record = [...state.blobs.values()].find(
        (candidate) =>
          candidate.accountId === accountId &&
          candidate.objectKey === objectKey &&
          (candidate.status !== exclusion.status ||
            candidate.contentType !== exclusion.contentType),
      );
      return record === undefined ? null : copy(record);
    },
    async findByDigest(accountId, kind, sha256, sizeBytes) {
      const record = [...state.blobs.values()].find(
        (candidate) =>
          candidate.accountId === accountId &&
          candidate.kind === kind &&
          candidate.sha256 === sha256 &&
          candidate.sizeBytes === sizeBytes,
      );
      return record === undefined ? null : copy(record);
    },
    async listDeletingByContentType(accountId, contentType, limit) {
      return [...state.blobs.values()]
        .filter(
          (candidate) =>
            candidate.accountId === accountId &&
            candidate.status === 'deleting' &&
            candidate.contentType === contentType,
        )
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
        )
        .slice(0, limit)
        .map(copy);
    },
    async listByAccount(accountId) {
      return listScoped(state.blobs, accountId);
    },
    async insert(record) {
      const duplicate = [...state.blobs.values()].find(
        (candidate) =>
          candidate.accountId === record.accountId &&
          candidate.kind === record.kind &&
          candidate.sha256 === record.sha256 &&
          candidate.sizeBytes === record.sizeBytes,
      );
      if (duplicate !== undefined) {
        throw new MailCoreError('BLOB_INTEGRITY', { entityId: duplicate.id });
      }
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

  const projectThread = (
    accountId: MailAccountId,
    threadRecord: ThreadRecord,
  ): ThreadQueryProjection | null => {
    const emails = [...state.emails.values()]
      .filter(
        (email) =>
          email.accountId === accountId &&
          email.threadId === threadRecord.id &&
          email.destroyedAt === null &&
          email.mailboxIds.length > 0,
      )
      .sort(
        (left, right) =>
          left.receivedAt.getTime() - right.receivedAt.getTime() || left.id.localeCompare(right.id),
      );
    const latest = emails.at(-1);
    if (latest === undefined) {
      return null;
    }
    return {
      ...copy(threadRecord),
      latestReceivedAt: new Date(latest.receivedAt),
      emailIds: emails.map(({ id }) => id),
      mailboxIds: [...new Set(emails.flatMap(({ mailboxIds }) => mailboxIds))].sort(),
    };
  };

  const threadQueries: ThreadQueryRepository = {
    async query(input) {
      const compare = (
        left: Pick<ThreadQueryProjection, 'id' | 'latestReceivedAt'>,
        right: { threadId: ThreadId; latestReceivedAt: Date },
      ): number => {
        const time = right.latestReceivedAt.getTime() - left.latestReceivedAt.getTime();
        return time === 0 ? left.id.localeCompare(right.threadId) : time;
      };
      const ordered = [...state.threads.values()]
        .filter(({ accountId }) => accountId === input.accountId)
        .flatMap((threadRecord) => {
          const projection = projectThread(input.accountId, threadRecord);
          return projection === null ? [] : [projection];
        })
        .filter(
          ({ mailboxIds }) => input.mailboxId === null || mailboxIds.includes(input.mailboxId),
        )
        .sort((left, right) =>
          compare(left, {
            latestReceivedAt: right.latestReceivedAt,
            threadId: right.id,
          }),
        )
        .filter((thread) => input.after === null || compare(thread, input.after) > 0);
      return {
        threads: ordered.slice(0, input.limit).map(copy),
        hasMore: ordered.length > input.limit,
      };
    },
    async findById(accountId, threadId) {
      const threadRecord = state.threads.get(entityKey(accountId, threadId));
      if (threadRecord === undefined) {
        return null;
      }
      const projection = projectThread(accountId, threadRecord);
      return projection === null ? null : copy(projection);
    },
  };

  const threadReferences: ThreadReferenceRepository = {
    async findCandidates(input) {
      const messageIdHashes = new Set(input.messageIdHashes);
      if (messageIdHashes.size === 0) {
        return [];
      }
      return [...state.threadReferences.values()]
        .filter(
          (record) =>
            record.accountId === input.accountId &&
            record.normalizedSubjectHash === input.normalizedSubjectHash &&
            messageIdHashes.has(record.messageIdHash),
        )
        .sort(
          (left, right) =>
            left.messageIdHash.localeCompare(right.messageIdHash) ||
            left.emailId.localeCompare(right.emailId),
        )
        .map(copy);
    },
    async insert(record) {
      state.threadReferences.set(threadReferenceKey(record), copy(record));
    },
    async moveThread(accountId, fromThreadId, toThreadId) {
      for (const [key, record] of state.threadReferences) {
        if (record.accountId === accountId && record.threadId === fromThreadId) {
          state.threadReferences.set(key, copy({ ...record, threadId: toThreadId }));
        }
      }
    },
    async deleteByEmail(accountId, emailId) {
      for (const [key, record] of state.threadReferences) {
        if (record.accountId === accountId && record.emailId === emailId) {
          state.threadReferences.delete(key);
        }
      }
    },
  };

  const emails: EmailRepository = {
    async findById(accountId, id) {
      return findScoped(state.emails, accountId, id);
    },
    async findByIds(accountId, ids) {
      return ids.flatMap((id) => {
        const record = findScoped(state.emails, accountId, id);
        return record === null ? [] : [record];
      });
    },
    async findPartById(accountId, partId) {
      for (const email of listScoped(state.emails, accountId)) {
        const part = email.parts.find(({ id }) => id === partId);
        if (part !== undefined) {
          return { emailId: email.id, part: copy(part) };
        }
      }
      return null;
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
    async listByMailbox(accountId, mailboxId) {
      return listScoped(state.emails, accountId).filter(
        (email) => email.destroyedAt === null && email.mailboxIds.includes(mailboxId),
      );
    },
    async moveThread(accountId, fromThreadId, toThreadId, updatedAt) {
      const movedEmailIds: EmailId[] = [];
      for (const [key, email] of state.emails) {
        if (
          email.accountId === accountId &&
          email.threadId === fromThreadId &&
          email.destroyedAt === null &&
          email.mailboxIds.length > 0
        ) {
          state.emails.set(key, copy({ ...email, threadId: toThreadId, updatedAt }));
          movedEmailIds.push(email.id);
        }
      }
      return movedEmailIds.sort();
    },
    async hasRetainedEmailInThread(accountId, threadId) {
      return [...state.emails.values()].some(
        (email) =>
          email.accountId === accountId &&
          email.threadId === threadId &&
          (email.destroyedAt !== null || email.mailboxIds.length === 0),
      );
    },
    async insert(record) {
      const stored = copy(record);
      state.emails.set(entityKey(record.accountId, record.id), stored);
      state.emailSearchDocuments.set(
        entityKey(record.accountId, record.id),
        searchDocumentFromEmail(record),
      );
      return copy(stored);
    },
    async update(accountId, id, patch) {
      const updated = updateScoped(state.emails, accountId, id, patch, 'EMAIL_NOT_FOUND');
      const key = entityKey(accountId, id);
      const currentDocument = state.emailSearchDocuments.get(key);
      state.emailSearchDocuments.set(key, {
        ...searchDocumentFromEmail(updated),
        bodyText: currentDocument?.bodyText ?? updated.preview,
      });
      return updated;
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
    async publishSearchDocument(accountId, emailId, document) {
      if ((await emails.findById(accountId, emailId)) === null) {
        throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: emailId });
      }
      state.emailSearchDocuments.set(entityKey(accountId, emailId), copy(document));
    },
    async deleteSearchDocument(accountId, emailId) {
      state.emailSearchDocuments.delete(entityKey(accountId, emailId));
    },
    async delete(accountId, id) {
      state.emails.delete(entityKey(accountId, id));
      state.emailSearchDocuments.delete(entityKey(accountId, id));
      for (const [key, remote] of state.remoteEmails) {
        if (remote.accountId === accountId && remote.emailId === id) {
          state.remoteEmails.delete(key);
        }
      }
    },
  };

  const aggregateProjectionEmails = (accountId: MailAccountId, threadId: ThreadId): EmailRecord[] =>
    [...state.emails.values()]
      .filter(
        (email) =>
          email.accountId === accountId &&
          email.threadId === threadId &&
          email.destroyedAt === null &&
          email.mailboxIds.length > 0,
      )
      .sort(
        (left, right) =>
          left.receivedAt.getTime() - right.receivedAt.getTime() || left.id.localeCompare(right.id),
      );

  const summaryFrom = (email: EmailRecord): string | null => {
    const participants = [
      ...new Set(
        [...email.from, ...email.to, ...email.cc].map(
          ({ email: address, name }) => name?.trim() || address,
        ),
      ),
    ];
    return participants.length === 0 ? null : participants.slice(0, 3).join(', ');
  };

  const mailAggregates: MailAggregateRepository = {
    async applyEmailDelta(input) {
      const delta = calculateEmailAggregateDelta(input.before, input.after);
      const originalThreads = new Map<string, ThreadRecord>();
      const originalMailboxes = new Map<string, MailboxRecord>();
      const rememberThread = (threadId: ThreadId): ThreadRecord => {
        const key = entityKey(input.accountId, threadId);
        const current = state.threads.get(key);
        if (current === undefined) {
          throw new MailCoreError('THREAD_NOT_FOUND', { entityId: threadId });
        }
        originalThreads.set(key, originalThreads.get(key) ?? copy(current));
        return current;
      };
      const rememberMailbox = (mailboxId: MailboxId): MailboxRecord => {
        const key = entityKey(input.accountId, mailboxId);
        const current = state.mailboxes.get(key);
        if (current === undefined) {
          throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
        }
        originalMailboxes.set(key, originalMailboxes.get(key) ?? copy(current));
        return current;
      };
      for (const change of delta.threadDeltas) {
        const current = rememberThread(change.threadId);
        const visible = aggregateProjectionEmails(input.accountId, change.threadId);
        const latest = visible.at(-1);
        const next = {
          ...current,
          emailCount: current.emailCount + change.emailDelta,
          unreadCount: current.unreadCount + change.unreadDelta,
          hasAttachment: visible.some(({ hasAttachment }) => hasAttachment),
          latestReceivedAt: latest?.receivedAt ?? current.latestReceivedAt,
          participantSummary: latest === undefined ? null : summaryFrom(latest),
          preview: latest?.preview ?? null,
          updatedAt: input.now,
        };
        if (next.emailCount < 0 || next.unreadCount < 0 || next.unreadCount > next.emailCount) {
          throw new MailCoreError('STORAGE_FAILURE');
        }
        state.threads.set(entityKey(input.accountId, change.threadId), copy(next));
      }
      for (const change of delta.mailboxDeltas) {
        const current = rememberMailbox(change.mailboxId);
        state.mailboxes.set(
          entityKey(input.accountId, change.mailboxId),
          copy({
            ...current,
            totalEmails: current.totalEmails + change.emailDelta,
            unreadEmails: current.unreadEmails + change.unreadDelta,
            updatedAt: input.now,
          }),
        );
      }
      for (const change of delta.mailboxThreadDeltas) {
        const key = [input.accountId, change.mailboxId, change.threadId].join('\u0000');
        const current = state.mailboxThreads.get(key) ?? {
          accountId: input.accountId,
          mailboxId: change.mailboxId,
          threadId: change.threadId,
          emailCount: 0,
          unreadCount: 0,
        };
        const next = {
          ...current,
          emailCount: current.emailCount + change.emailDelta,
          unreadCount: current.unreadCount + change.unreadDelta,
        };
        if (next.emailCount < 0 || next.unreadCount < 0 || next.unreadCount > next.emailCount) {
          throw new MailCoreError('STORAGE_FAILURE');
        }
        const mailbox = rememberMailbox(change.mailboxId);
        const currentMailbox = state.mailboxes.get(entityKey(input.accountId, change.mailboxId))!;
        state.mailboxes.set(
          entityKey(input.accountId, change.mailboxId),
          copy({
            ...currentMailbox,
            totalThreads:
              currentMailbox.totalThreads +
              (current.emailCount === 0 && next.emailCount > 0
                ? 1
                : current.emailCount > 0 && next.emailCount === 0
                  ? -1
                  : 0),
            unreadThreads:
              currentMailbox.unreadThreads +
              (current.unreadCount === 0 && next.unreadCount > 0
                ? 1
                : current.unreadCount > 0 && next.unreadCount === 0
                  ? -1
                  : 0),
            updatedAt: input.now,
          }),
        );
        void mailbox;
        if (next.emailCount === 0) {
          state.mailboxThreads.delete(key);
        } else {
          state.mailboxThreads.set(key, copy(next));
        }
      }
      const properties = <RecordType extends object>(
        before: RecordType,
        after: RecordType,
        keys: (keyof RecordType)[],
      ): string[] =>
        keys
          .filter((key) => {
            const left = before[key];
            const right = after[key];
            return left instanceof Date && right instanceof Date
              ? left.getTime() !== right.getTime()
              : !Object.is(left, right);
          })
          .map(String);
      return {
        threadChanges: [...originalThreads].map(([key, before]) => {
          const after = state.threads.get(key)!;
          return {
            threadId: after.id,
            changedProperties: properties(before, after, [
              'latestReceivedAt',
              'emailCount',
              'unreadCount',
              'hasAttachment',
              'participantSummary',
              'preview',
            ]),
          };
        }),
        mailboxChanges: [...originalMailboxes].map(([key, before]) => {
          const after = state.mailboxes.get(key)!;
          if (
            after.totalEmails < 0 ||
            after.unreadEmails < 0 ||
            after.totalThreads < 0 ||
            after.unreadThreads < 0
          ) {
            throw new MailCoreError('STORAGE_FAILURE');
          }
          return {
            mailboxId: after.id,
            changedProperties: properties(before, after, [
              'totalEmails',
              'unreadEmails',
              'totalThreads',
              'unreadThreads',
            ]),
          };
        }),
      };
    },
  };

  const mailAggregateMaintenance: MailAggregateMaintenanceRepository = {
    async reconcile(input) {
      const mismatches: AggregateMismatch[] = [];
      const valuesDiffer = (
        expected: MailAggregateValues,
        actual: MailAggregateValues | null,
      ): boolean => actual === null || JSON.stringify(expected) !== JSON.stringify(actual);
      const visibleEmails = [...state.emails.values()].filter(
        (record) =>
          record.accountId === input.accountId &&
          record.destroyedAt === null &&
          record.mailboxIds.length > 0,
      );

      for (const current of listScoped(state.threads, input.accountId)) {
        const emails = visibleEmails
          .filter(({ threadId }) => threadId === current.id)
          .sort(
            (left, right) =>
              left.receivedAt.getTime() - right.receivedAt.getTime() ||
              left.id.localeCompare(right.id),
          );
        const latest = emails.at(-1);
        const expected: MailAggregateValues = {
          latestReceivedAt: (latest?.receivedAt ?? current.latestReceivedAt).toISOString(),
          emailCount: emails.length,
          unreadCount: emails.filter(({ keywords }) => !keywords.includes('$seen')).length,
          hasAttachment: emails.some(({ hasAttachment }) => hasAttachment),
          participantSummary: latest === undefined ? null : summaryFrom(latest),
          preview: latest?.preview ?? null,
        };
        const actual: MailAggregateValues = {
          latestReceivedAt: current.latestReceivedAt.toISOString(),
          emailCount: current.emailCount,
          unreadCount: current.unreadCount,
          hasAttachment: current.hasAttachment,
          participantSummary: current.participantSummary,
          preview: current.preview,
        };
        if (valuesDiffer(expected, actual)) {
          mismatches.push({ entityType: 'thread', entityId: current.id, expected, actual });
          if (input.repair) {
            state.threads.set(
              entityKey(input.accountId, current.id),
              copy({
                ...current,
                latestReceivedAt: new Date(expected.latestReceivedAt as string),
                emailCount: expected.emailCount as number,
                unreadCount: expected.unreadCount as number,
                hasAttachment: expected.hasAttachment as boolean,
                participantSummary: expected.participantSummary as string | null,
                preview: expected.preview as string | null,
                updatedAt: input.now,
              }),
            );
          }
        }
      }

      const expectedMailboxThreads = new Map<
        string,
        {
          accountId: MailAccountId;
          mailboxId: MailboxId;
          threadId: ThreadId;
          emailCount: number;
          unreadCount: number;
        }
      >();
      for (const record of visibleEmails) {
        for (const mailboxId of record.mailboxIds) {
          const key = [input.accountId, mailboxId, record.threadId].join('\u0000');
          const aggregate = expectedMailboxThreads.get(key) ?? {
            accountId: input.accountId,
            mailboxId,
            threadId: record.threadId,
            emailCount: 0,
            unreadCount: 0,
          };
          aggregate.emailCount += 1;
          if (!record.keywords.includes('$seen')) aggregate.unreadCount += 1;
          expectedMailboxThreads.set(key, aggregate);
        }
      }

      for (const current of listScoped(state.mailboxes, input.accountId)) {
        const emails = visibleEmails.filter(({ mailboxIds }) => mailboxIds.includes(current.id));
        const mailboxThreads = [...expectedMailboxThreads.values()].filter(
          ({ mailboxId }) => mailboxId === current.id,
        );
        const expected: MailAggregateValues = {
          totalEmails: emails.length,
          unreadEmails: emails.filter(({ keywords }) => !keywords.includes('$seen')).length,
          totalThreads: mailboxThreads.length,
          unreadThreads: mailboxThreads.filter(({ unreadCount }) => unreadCount > 0).length,
        };
        const actual: MailAggregateValues = {
          totalEmails: current.totalEmails,
          unreadEmails: current.unreadEmails,
          totalThreads: current.totalThreads,
          unreadThreads: current.unreadThreads,
        };
        if (valuesDiffer(expected, actual)) {
          mismatches.push({ entityType: 'mailbox', entityId: current.id, expected, actual });
          if (input.repair) {
            state.mailboxes.set(
              entityKey(input.accountId, current.id),
              copy({
                ...current,
                totalEmails: expected.totalEmails as number,
                unreadEmails: expected.unreadEmails as number,
                totalThreads: expected.totalThreads as number,
                unreadThreads: expected.unreadThreads as number,
                updatedAt: input.now,
              }),
            );
          }
        }
      }

      const currentMailboxThreads = new Map(
        [...state.mailboxThreads].filter(([, record]) => record.accountId === input.accountId),
      );
      for (const key of new Set([
        ...expectedMailboxThreads.keys(),
        ...currentMailboxThreads.keys(),
      ])) {
        const expectedRecord = expectedMailboxThreads.get(key);
        const current = currentMailboxThreads.get(key);
        const identity = expectedRecord ?? current!;
        const expected: MailAggregateValues = {
          emailCount: expectedRecord?.emailCount ?? 0,
          unreadCount: expectedRecord?.unreadCount ?? 0,
        };
        const actual =
          current === undefined
            ? null
            : { emailCount: current.emailCount, unreadCount: current.unreadCount };
        if (valuesDiffer(expected, actual)) {
          mismatches.push({
            entityType: 'mailbox_thread',
            entityId: `${identity.mailboxId}:${identity.threadId}`,
            expected,
            actual,
          });
        }
      }
      if (input.repair) {
        for (const key of currentMailboxThreads.keys()) state.mailboxThreads.delete(key);
        for (const [key, aggregate] of expectedMailboxThreads) {
          state.mailboxThreads.set(key, copy(aggregate));
        }
      }
      return { mismatches, repaired: input.repair };
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
    async existsOutsideAccount(accountId, id) {
      return [...state.submissions.values()].some(
        (candidate) => candidate.id === id && candidate.accountId !== accountId,
      );
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
    async listByAccount(accountId) {
      return listScoped(state.submissions, accountId);
    },
    async queryPage(input) {
      observeSubmissionQuery(copy(input));
      return listScoped(state.submissions, input.accountId)
        .filter((record) => input.status === undefined || record.status === input.status)
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
        )
        .filter(
          (record) =>
            input.after === null ||
            record.createdAt > input.after.createdAt ||
            (record.createdAt.getTime() === input.after.createdAt.getTime() &&
              record.id.localeCompare(input.after.submissionId) > 0),
        )
        .slice(0, input.limit);
    },
    async insert(record) {
      const stored = copy(record);
      state.submissions.set(entityKey(record.accountId, record.id), stored);
      return copy(stored);
    },
    async update(accountId, id, patch) {
      return updateScoped(state.submissions, accountId, id, patch, 'EMAIL_SUBMISSION_NOT_FOUND');
    },
  };

  const changes: ChangeRepository = {
    async recordChange(record) {
      const key = changeKey(record);
      const existing = state.changes.get(key);
      state.changes.set(
        key,
        copy(existing === undefined ? record : mergeMailChanges(existing, record)),
      );
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
          const collectionOrder = left.collection.localeCompare(right.collection);
          if (collectionOrder !== 0) {
            return collectionOrder;
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

  const notifications: MailNotificationRepository = {
    async enqueue(input) {
      if (!state.notifications.has(input.eventId)) {
        state.notifications.set(input.eventId, copy(input));
      }
    },
  };

  return {
    accounts,
    mailboxes,
    blobs,
    threads,
    threadReferences,
    threadQueries,
    emails,
    mailAggregates,
    mailAggregateMaintenance,
    identities,
    submissions,
    changes,
    notifications,
  };
};

export class MemoryMailUnitOfWork implements MailUnitOfWork {
  private state = createEmptyState();
  private readonly changeQueries: QueryChangesInput[] = [];
  private readonly submissionQueries: QuerySubmissionPageInput[] = [];
  private tail: Promise<void> = Promise.resolve();
  private commitAcknowledgementsBeforeFailure: number | null = null;
  private commitsBeforeRollbackFailure: number | null = null;

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
    const repositories = createRepositories(
      transactionState,
      (input) => {
        this.changeQueries.push(input);
      },
      (input) => {
        this.submissionQueries.push(input);
      },
    );
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
    if (this.commitsBeforeRollbackFailure !== null) {
      this.commitsBeforeRollbackFailure -= 1;
      if (this.commitsBeforeRollbackFailure === 0) {
        this.commitsBeforeRollbackFailure = null;
        throw new Error('transaction commit failed before publish');
      }
    }
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

  failCommitBeforePublishAfter(completedOperations: number): void {
    this.commitsBeforeRollbackFailure = completedOperations;
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

  observedSubmissionQueries(): QuerySubmissionPageInput[] {
    return copy(this.submissionQueries);
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
  searchDocument(id: EmailId): Promise<EmailSearchDocument | null>;
  identities(accountId?: MailAccountId): Promise<IdentityRecord[]>;
  identity(id: IdentityId): Promise<IdentityRecord | null>;
  submissions(accountId?: MailAccountId): Promise<SubmissionRecord[]>;
  submission(id: EmailSubmissionId): Promise<SubmissionRecord | null>;
  submissionQueries(): QuerySubmissionPageInput[];
  changes(accountId?: MailAccountId): Promise<MailChangeRecord[]>;
  notifications(accountId?: MailAccountId): Promise<EnqueueMailNotification[]>;
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
  async searchDocument(id) {
    const entry = [...unitOfWork.snapshot().emailSearchDocuments.entries()].find(([key]) =>
      key.endsWith(`\u0000${id}`),
    );
    return entry === undefined ? null : copy(entry[1]);
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
  submissionQueries() {
    return unitOfWork.observedSubmissionQueries();
  },
  async changes(accountId) {
    return filterByAccount(unitOfWork.snapshot().changes.values(), accountId);
  },
  async notifications(accountId) {
    return filterByAccount(unitOfWork.snapshot().notifications.values(), accountId);
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
        textBody: '',
        htmlBody: '',
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
