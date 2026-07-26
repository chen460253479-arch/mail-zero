import type {
  BlobId,
  EmailId,
  EmailSubmissionId,
  IdentityId,
  Keyword,
  MailAccountId,
  MailAddress,
  MailboxId,
  MailboxKind,
  MailboxRole,
  ThreadId,
} from '../types';
import type { EmailAggregateProjection, ReconcileMailAggregatesResult } from '../mailbox';
import type { SubmissionAttemptOutcome, SubmissionStatus } from '../submission/types';
import type { ChangeCollection, MailChange } from '../changes/types';

export type AccountStatus = 'active' | 'suspended' | 'deleting';
export type EmailLifecycle = 'draft' | 'received' | 'sent';
export type BlobStatus = 'pending' | 'ready' | 'deleting';
export type { SubmissionAttemptOutcome, SubmissionStatus } from '../submission/types';
export type { ChangeCollection, ChangeType } from '../changes/types';

export interface MailAccountRecord {
  id: MailAccountId;
  userId: string;
  connectionId: string;
  status: AccountStatus;
  stateVersion: bigint;
  timezone: string;
  storageQuotaBytes: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertMailAccount = Pick<MailAccountRecord, 'id' | 'userId' | 'connectionId'> &
  Partial<
    Pick<
      MailAccountRecord,
      'status' | 'stateVersion' | 'timezone' | 'storageQuotaBytes' | 'createdAt' | 'updatedAt'
    >
  >;

export interface MailboxRecord {
  id: MailboxId;
  accountId: MailAccountId;
  parentId: MailboxId | null;
  name: string;
  normalizedName: string;
  kind: MailboxKind;
  role: MailboxRole | null;
  color: string | null;
  sortOrder: number;
  isSubscribed: boolean;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BlobRecord {
  id: BlobId;
  accountId: MailAccountId;
  sha256: string;
  sizeBytes: bigint;
  contentType: string;
  objectKey: string;
  status: BlobStatus;
  createdAt: Date;
  readyAt: Date | null;
  deletedAt: Date | null;
}

export interface ThreadRecord {
  id: ThreadId;
  accountId: MailAccountId;
  normalizedSubject: string;
  latestReceivedAt: Date;
  emailCount: number;
  unreadCount: number;
  hasAttachment: boolean;
  participantSummary: string | null;
  preview: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadReferenceRecord {
  accountId: MailAccountId;
  normalizedSubjectHash: string;
  messageIdHash: string;
  emailId: EmailId;
  threadId: ThreadId;
  createdAt: Date;
}

export interface EmailPartRecord {
  id: string;
  parentPartId: string | null;
  partPath: string;
  contentType: string;
  charset: string | null;
  disposition: 'inline' | 'attachment' | null;
  filename: string | null;
  contentId: string | null;
  blobId: BlobId | null;
  sizeBytes: bigint;
  kind: 'body' | 'inline' | 'attachment';
}

export interface EmailContentRecord {
  preview: string;
  textBlobId: BlobId | null;
  htmlBlobId: BlobId | null;
  parserVersion: number;
  parseWarnings: string[];
}

export interface EmailRecord extends EmailContentRecord {
  id: EmailId;
  accountId: MailAccountId;
  identityId: IdentityId | null;
  threadId: ThreadId;
  blobId: BlobId | null;
  messageId: string | null;
  replyToEmailId: EmailId | null;
  inReplyTo: string[];
  references: string[];
  subject: string;
  sentAt: Date | null;
  receivedAt: Date;
  sizeBytes: bigint;
  hasAttachment: boolean;
  lifecycle: EmailLifecycle;
  draftRevision: number;
  createdAt: Date;
  updatedAt: Date;
  destroyedAt: Date | null;
  sender: MailAddress[];
  from: MailAddress[];
  replyTo: MailAddress[];
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  parts: EmailPartRecord[];
  mailboxIds: MailboxId[];
  restoreMailboxIds: MailboxId[];
  keywords: Keyword[];
}

export interface RemoteEmailRecord {
  accountId: MailAccountId;
  provider: string;
  remoteEmailId: string;
  remoteThreadId: string | null;
  emailId: EmailId;
  contentFingerprint: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface EmailSearchDocument {
  subject: string;
  addressText: string;
  bodyText: string;
}

export interface IdentityRecord {
  id: IdentityId;
  accountId: MailAccountId;
  name: string | null;
  email: string;
  replyTo: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SubmissionBlobKind = 'raw' | 'text' | 'html' | 'part';

export interface SubmissionBlobReference {
  blobId: BlobId;
  kind: SubmissionBlobKind;
  position: number;
  sha256: string;
  sizeBytes: bigint;
  contentType: string;
  objectKey: string;
}

export interface SubmissionRecord {
  id: EmailSubmissionId;
  accountId: MailAccountId;
  emailId: EmailId;
  identityId: IdentityId;
  status: SubmissionStatus;
  sendAt: Date;
  idempotencyKey: string;
  draftRevision: number;
  frozenBlobs: SubmissionBlobReference[];
  attemptCount: number;
  nextAttemptAt: Date | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
}

export interface SubmissionAttemptRecord {
  id: string;
  accountId: MailAccountId;
  submissionId: EmailSubmissionId;
  attemptNumber: number;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: SubmissionAttemptOutcome | null;
  providerCode: string | null;
  safeResponse: string | null;
  retryAt: Date | null;
}

export type MailChangeRecord = MailChange;

type MutableFields<RecordType, Immutable extends keyof RecordType> = Partial<
  Omit<RecordType, Immutable>
>;

export interface AccountRepository {
  findById(id: MailAccountId): Promise<MailAccountRecord | null>;
  findByConnectionId(connectionId: string): Promise<MailAccountRecord | null>;
  insert(input: InsertMailAccount): Promise<MailAccountRecord>;
  update(
    id: MailAccountId,
    patch: MutableFields<MailAccountRecord, 'id' | 'stateVersion'>,
  ): Promise<MailAccountRecord>;
}

export interface MailboxRepository {
  findById(accountId: MailAccountId, id: MailboxId): Promise<MailboxRecord | null>;
  findByRole(accountId: MailAccountId, role: MailboxRole): Promise<MailboxRecord | null>;
  findByNormalizedName(
    accountId: MailAccountId,
    parentId: MailboxId | null,
    normalizedName: string,
  ): Promise<MailboxRecord | null>;
  existsOutsideAccount(accountId: MailAccountId, id: MailboxId): Promise<boolean>;
  hasChild(accountId: MailAccountId, id: MailboxId): Promise<boolean>;
  hasEmail(accountId: MailAccountId, id: MailboxId): Promise<boolean>;
  listByAccount(accountId: MailAccountId): Promise<MailboxRecord[]>;
  insert(record: MailboxRecord): Promise<MailboxRecord>;
  update(
    accountId: MailAccountId,
    id: MailboxId,
    patch: MutableFields<MailboxRecord, 'id' | 'accountId'>,
  ): Promise<MailboxRecord>;
  delete(accountId: MailAccountId, id: MailboxId): Promise<void>;
}

export interface BlobRepository {
  findById(accountId: MailAccountId, id: BlobId): Promise<BlobRecord | null>;
  findByObjectKeyExcluding(
    accountId: MailAccountId,
    objectKey: string,
    exclusion: Pick<BlobRecord, 'status' | 'contentType'>,
  ): Promise<BlobRecord | null>;
  findByDigest(
    accountId: MailAccountId,
    sha256: string,
    sizeBytes: bigint,
  ): Promise<BlobRecord | null>;
  listDeletingByContentType(
    accountId: MailAccountId,
    contentType: string,
    limit: number,
  ): Promise<BlobRecord[]>;
  listByAccount(accountId: MailAccountId): Promise<BlobRecord[]>;
  insert(record: BlobRecord): Promise<BlobRecord>;
  update(
    accountId: MailAccountId,
    id: BlobId,
    patch: MutableFields<BlobRecord, 'id' | 'accountId'>,
  ): Promise<BlobRecord>;
  delete(accountId: MailAccountId, id: BlobId): Promise<void>;
}

export interface ThreadRepository {
  findById(accountId: MailAccountId, id: ThreadId): Promise<ThreadRecord | null>;
  existsOutsideAccount(accountId: MailAccountId, id: ThreadId): Promise<boolean>;
  listByAccount(accountId: MailAccountId): Promise<ThreadRecord[]>;
  insert(record: ThreadRecord): Promise<ThreadRecord>;
  update(
    accountId: MailAccountId,
    id: ThreadId,
    patch: MutableFields<ThreadRecord, 'id' | 'accountId'>,
  ): Promise<ThreadRecord>;
  delete(accountId: MailAccountId, id: ThreadId): Promise<void>;
}

export interface ThreadReferenceRepository {
  findCandidates(input: {
    accountId: MailAccountId;
    normalizedSubjectHash: string;
    messageIdHashes: string[];
  }): Promise<ThreadReferenceRecord[]>;
  insert(record: ThreadReferenceRecord): Promise<void>;
  moveThread(accountId: MailAccountId, fromThreadId: ThreadId, toThreadId: ThreadId): Promise<void>;
  deleteByEmail(accountId: MailAccountId, emailId: EmailId): Promise<void>;
}

export interface MailAggregateRepository {
  applyEmailDelta(input: {
    accountId: MailAccountId;
    before: EmailAggregateProjection | null;
    after: EmailAggregateProjection | null;
    now: Date;
  }): Promise<{
    threadChanges: { threadId: ThreadId; changedProperties: string[] }[];
    mailboxChanges: { mailboxId: MailboxId; changedProperties: string[] }[];
  }>;
}

export interface MailAggregateMaintenanceRepository {
  reconcile(input: {
    accountId: MailAccountId;
    repair: boolean;
    now: Date;
  }): Promise<ReconcileMailAggregatesResult>;
}

export interface FindRemoteEmailInput {
  accountId: MailAccountId;
  provider: string;
  remoteEmailId: string;
}

export interface EmailRepository {
  findById(accountId: MailAccountId, id: EmailId): Promise<EmailRecord | null>;
  existsOutsideAccount(accountId: MailAccountId, id: EmailId): Promise<boolean>;
  findByRemoteId(input: FindRemoteEmailInput): Promise<RemoteEmailRecord | null>;
  listByAccount(accountId: MailAccountId): Promise<EmailRecord[]>;
  listByThread(accountId: MailAccountId, threadId: ThreadId): Promise<EmailRecord[]>;
  moveThread(
    accountId: MailAccountId,
    fromThreadId: ThreadId,
    toThreadId: ThreadId,
    updatedAt: Date,
  ): Promise<EmailId[]>;
  hasRetainedEmailInThread(accountId: MailAccountId, threadId: ThreadId): Promise<boolean>;
  insert(record: EmailRecord): Promise<EmailRecord>;
  update(
    accountId: MailAccountId,
    id: EmailId,
    patch: MutableFields<EmailRecord, 'id' | 'accountId'>,
  ): Promise<EmailRecord>;
  linkRemote(record: RemoteEmailRecord): Promise<RemoteEmailRecord>;
  replaceMailboxes(
    accountId: MailAccountId,
    emailId: EmailId,
    mailboxIds: MailboxId[],
  ): Promise<void>;
  replaceKeywords(accountId: MailAccountId, emailId: EmailId, keywords: Keyword[]): Promise<void>;
  replaceRestoreMailboxes(
    accountId: MailAccountId,
    emailId: EmailId,
    mailboxIds: MailboxId[],
  ): Promise<void>;
  publishSearchDocument(
    accountId: MailAccountId,
    emailId: EmailId,
    document: EmailSearchDocument,
  ): Promise<void>;
  deleteSearchDocument(accountId: MailAccountId, emailId: EmailId): Promise<void>;
  delete(accountId: MailAccountId, id: EmailId): Promise<void>;
}

export interface IdentityRepository {
  findById(accountId: MailAccountId, id: IdentityId): Promise<IdentityRecord | null>;
  existsOutsideAccount(accountId: MailAccountId, id: IdentityId): Promise<boolean>;
  listByAccount(accountId: MailAccountId): Promise<IdentityRecord[]>;
  insert(record: IdentityRecord): Promise<IdentityRecord>;
  update(
    accountId: MailAccountId,
    id: IdentityId,
    patch: MutableFields<IdentityRecord, 'id' | 'accountId'>,
  ): Promise<IdentityRecord>;
  delete(accountId: MailAccountId, id: IdentityId): Promise<void>;
}

export interface SubmissionRepository {
  findById(accountId: MailAccountId, id: EmailSubmissionId): Promise<SubmissionRecord | null>;
  findByIdempotencyKey(
    accountId: MailAccountId,
    idempotencyKey: string,
  ): Promise<SubmissionRecord | null>;
  listByIdentity(accountId: MailAccountId, identityId: IdentityId): Promise<SubmissionRecord[]>;
  listByAccount(accountId: MailAccountId): Promise<SubmissionRecord[]>;
  insert(record: SubmissionRecord): Promise<SubmissionRecord>;
  update(
    accountId: MailAccountId,
    id: EmailSubmissionId,
    patch: MutableFields<
      SubmissionRecord,
      | 'id'
      | 'accountId'
      | 'emailId'
      | 'identityId'
      | 'idempotencyKey'
      | 'draftRevision'
      | 'frozenBlobs'
    >,
  ): Promise<SubmissionRecord>;
  recordAttempt(record: SubmissionAttemptRecord): Promise<void>;
  updateAttempt(
    accountId: MailAccountId,
    submissionId: EmailSubmissionId,
    attemptNumber: number,
    patch: MutableFields<
      SubmissionAttemptRecord,
      'id' | 'accountId' | 'submissionId' | 'attemptNumber' | 'startedAt'
    >,
  ): Promise<SubmissionAttemptRecord>;
  listAttempts(
    accountId: MailAccountId,
    submissionId: EmailSubmissionId,
  ): Promise<SubmissionAttemptRecord[]>;
}

export interface QueryChangesInput {
  accountId: MailAccountId;
  collection?: ChangeCollection;
  afterState?: bigint;
  throughState?: bigint;
  limit?: number;
}

export interface ChangeRepository {
  recordChange(record: MailChangeRecord): Promise<void>;
  oldestAvailableState(accountId: MailAccountId): Promise<bigint>;
  queryChanges(input: QueryChangesInput): Promise<MailChangeRecord[]>;
  hasChanges(input: Omit<QueryChangesInput, 'limit'>): Promise<boolean>;
}
