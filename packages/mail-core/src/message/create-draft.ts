import {
  commitPreparedBlob,
  contentAddressedObjectKey,
  discardCommittedBlobs,
  discardTemporaryBlobs,
  prepareBlob,
  type PreparedBlob,
  verifyPreparedBlob,
} from '../blob/blob-lifecycle';
import type {
  BlobRecord,
  EmailPartRecord,
  EmailRecord,
  IdentityRecord,
  MailCoreDependencies,
  MailTransaction,
  ThreadRecord,
} from '../store';
import {
  MailCoreError,
  type BlobId,
  type EmailId,
  type MailAccountId,
  type MailboxId,
  type ThreadId,
} from '../types';
import type { CreateDraftInput, DraftAttachment, DraftContent, DraftResult } from './draft-types';
import { applyEmailAggregateDelta } from './email-aggregates';
import { createEmailSearchDocument } from './search-document';
import { readEmailPart } from './read-email-part';
import { renderDraft } from './render-draft';
import { normalizeSubject } from '../thread';
import { recordChanges } from '../changes';
import type { ParsedEmail } from './types';
import { parseRawEmail } from './mime';
import { z } from 'zod';

export type DraftReferences = {
  identity: IdentityRecord;
  reply: EmailRecord | null;
  attachments: DraftAttachmentReference[];
};

export type DraftAttachmentReference =
  | {
      source: 'blob';
      blob: BlobRecord;
    }
  | {
      source: 'part';
      emailId: EmailId;
      part: EmailPartRecord;
      rawBlob: BlobRecord;
    };

export type PreparedDraftRevision = {
  raw: PreparedBlob;
  all: PreparedBlob[];
};

export type DraftRevisionBlob = {
  prepared: PreparedBlob;
  record: BlobRecord;
  isNew: boolean;
};

export type DraftRevisionBlobs = {
  raw: DraftRevisionBlob;
  all: DraftRevisionBlob[];
};

const referencedBlobIds = (emails: EmailRecord[]): Set<BlobId> =>
  new Set(emails.flatMap((email) => (email.blobId === null ? [] : [email.blobId])));

const previewFrom = (content: Pick<DraftContent, 'htmlBody' | 'textBody'>): string => {
  const source =
    content.textBody || content.htmlBody.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ');
  return source.trim().slice(0, 256);
};

const participantSummaryFrom = (
  identity: IdentityRecord,
  content: Pick<DraftContent, 'cc' | 'to'>,
): string | null => {
  const participants = Array.from(
    new Set(
      [
        identity.name?.trim() || identity.email,
        ...content.to.map(({ email, name }) => name?.trim() || email),
        ...content.cc.map(({ email, name }) => name?.trim() || email),
      ].filter((value) => value.length > 0),
    ),
  );
  return participants.length === 0 ? null : participants.slice(0, 3).join(', ');
};

const sameIdentity = (left: IdentityRecord, right: IdentityRecord): boolean =>
  left.id === right.id &&
  left.name === right.name &&
  left.email === right.email &&
  left.replyTo === right.replyTo;

const sameReply = (left: EmailRecord | null, right: EmailRecord | null): boolean =>
  left?.id === right?.id &&
  left?.threadId === right?.threadId &&
  left?.messageId === right?.messageId &&
  left?.draftRevision === right?.draftRevision &&
  left?.references.join('\u0000') === right?.references.join('\u0000') &&
  left?.destroyedAt?.getTime() === right?.destroyedAt?.getTime();

const sameBlob = (left: BlobRecord, right: BlobRecord): boolean =>
  left.id === right.id &&
  left.sha256 === right.sha256 &&
  left.sizeBytes === right.sizeBytes &&
  left.contentType === right.contentType &&
  left.objectKey === right.objectKey &&
  left.status === right.status;

const sameAttachments = (
  left: DraftAttachmentReference[],
  right: DraftAttachmentReference[],
): boolean =>
  left.length === right.length &&
  left.every((reference, index) => {
    const compared = right[index];
    if (compared === undefined || compared.source !== reference.source) return false;
    if (reference.source === 'blob' && compared.source === 'blob') {
      return sameBlob(reference.blob, compared.blob);
    }
    if (reference.source === 'part' && compared.source === 'part') {
      return (
        reference.emailId === compared.emailId &&
        reference.part.id === compared.part.id &&
        reference.part.rawBlobId === compared.part.rawBlobId &&
        reference.part.offsetStart === compared.part.offsetStart &&
        reference.part.encodedLength === compared.part.encodedLength &&
        reference.part.decodedLength === compared.part.decodedLength &&
        reference.part.transferEncoding === compared.part.transferEncoding &&
        sameBlob(reference.rawBlob, compared.rawBlob)
      );
    }
    return false;
  });

export async function requireDraftReferences(
  tx: MailTransaction,
  accountId: MailAccountId,
  content: DraftContent,
): Promise<DraftReferences> {
  if ((await tx.accounts.findById(accountId)) === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
  }
  const identity = await tx.identities.findById(accountId, content.identityId);
  if (identity === null) {
    throw new MailCoreError('IDENTITY_NOT_FOUND', { entityId: content.identityId });
  }
  const reply =
    content.replyToEmailId === null
      ? null
      : await tx.emails.findById(accountId, content.replyToEmailId);
  if (
    content.replyToEmailId !== null &&
    (reply === null || reply.destroyedAt !== null || reply.mailboxIds.length === 0)
  ) {
    throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: content.replyToEmailId });
  }
  const attachments: DraftAttachmentReference[] = [];
  for (const attachmentId of content.attachmentBlobIds) {
    const blob = await tx.blobs.findById(accountId, attachmentId);
    if (blob !== null) {
      if (blob.status !== 'ready' || blob.readyAt === null || blob.deletedAt !== null) {
        throw new MailCoreError('BLOB_INTEGRITY', { entityId: attachmentId });
      }
      attachments.push({ source: 'blob', blob });
      continue;
    }
    const located = await tx.emails.findPartById(accountId, attachmentId);
    if (located === null) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: attachmentId });
    }
    const sourceEmail = await tx.emails.findById(accountId, located.emailId);
    const rawBlob = await tx.blobs.findById(accountId, located.part.rawBlobId);
    if (
      sourceEmail === null ||
      sourceEmail.destroyedAt !== null ||
      sourceEmail.mailboxIds.length === 0 ||
      sourceEmail.blobId !== located.part.rawBlobId ||
      (located.part.kind !== 'attachment' && located.part.kind !== 'inline') ||
      rawBlob === null ||
      rawBlob.status !== 'ready' ||
      rawBlob.readyAt === null ||
      rawBlob.deletedAt !== null
    ) {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: attachmentId });
    }
    attachments.push({
      source: 'part',
      emailId: located.emailId,
      part: located.part,
      rawBlob,
    });
  }
  return { identity, reply, attachments };
}

export function requireStableReferences(before: DraftReferences, after: DraftReferences): void {
  if (
    !sameIdentity(before.identity, after.identity) ||
    !sameReply(before.reply, after.reply) ||
    !sameAttachments(before.attachments, after.attachments)
  ) {
    throw new MailCoreError('IDEMPOTENCY_CONFLICT');
  }
}

export async function loadDraftAttachments(
  dependencies: MailCoreDependencies,
  references: DraftAttachmentReference[],
): Promise<DraftAttachment[]> {
  const attachments: DraftAttachment[] = [];
  for (const reference of references) {
    if (reference.source === 'blob') {
      const record = reference.blob;
      const bytes = await verifyPreparedBlob(
        dependencies.blobStore,
        {
          accountId: record.accountId,
          sha256: record.sha256,
          sizeBytes: record.sizeBytes,
        },
        record.objectKey,
        true,
      );
      attachments.push({
        id: record.id,
        filename: record.id,
        contentType: record.contentType,
        sizeBytes: record.sizeBytes,
        bytes,
      });
      continue;
    }
    const part = await readEmailPart(dependencies, {
      accountId: reference.rawBlob.accountId,
      emailId: reference.emailId,
      partId: reference.part.id,
    });
    attachments.push({
      id: reference.part.id,
      filename: part.filename ?? reference.part.id,
      contentType: part.contentType,
      sizeBytes: part.sizeBytes,
      bytes: part.bytes,
    });
  }
  return attachments;
}

export async function prepareDraftRevision(
  dependencies: MailCoreDependencies,
  input: {
    accountId: MailAccountId;
    raw: Uint8Array;
  },
): Promise<PreparedDraftRevision> {
  const all: PreparedBlob[] = [];
  try {
    const raw = await prepareBlob(dependencies.blobStore, {
      accountId: input.accountId,
      bytes: input.raw,
      contentType: 'message/rfc822',
    });
    all.push(raw);
    return { raw, all };
  } catch (error) {
    await discardTemporaryBlobs(dependencies.blobStore, all);
    throw error;
  }
}

export async function allocateDraftRevisionBlobs(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  accountId: MailAccountId,
  prepared: PreparedDraftRevision,
  now: Date,
): Promise<DraftRevisionBlobs> {
  const resolved = new Map<string, DraftRevisionBlob>();
  const allocate = async (pending: PreparedBlob): Promise<DraftRevisionBlob> => {
    const key = `${pending.sha256}:${pending.sizeBytes}`;
    const alreadyResolved = resolved.get(key);
    if (alreadyResolved !== undefined) {
      return alreadyResolved;
    }
    const existing = await tx.blobs.findByDigest(accountId, pending.sha256, pending.sizeBytes);
    if (existing !== null) {
      if (existing.status !== 'ready' || existing.readyAt === null || existing.deletedAt !== null) {
        throw new MailCoreError('BLOB_INTEGRITY', { entityId: existing.id });
      }
      await verifyPreparedBlob(dependencies.blobStore, pending, existing.objectKey, true);
      const reused = { prepared: pending, record: existing, isNew: false };
      resolved.set(key, reused);
      return reused;
    }
    const id = dependencies.idFactory.next<'Blob'>() as BlobId;
    const created: DraftRevisionBlob = {
      prepared: pending,
      record: {
        id,
        accountId,
        sha256: pending.sha256,
        sizeBytes: pending.sizeBytes,
        contentType: pending.contentType,
        objectKey: contentAddressedObjectKey(accountId, pending.sha256),
        status: 'pending',
        createdAt: now,
        readyAt: null,
        deletedAt: null,
      },
      isNew: true,
    };
    resolved.set(key, created);
    return created;
  };
  const raw = await allocate(prepared.raw);
  return {
    raw,
    all: [...resolved.values()],
  };
}

export async function requireDraftQuota(
  tx: MailTransaction,
  input: {
    accountId: MailAccountId;
    excludeEmailId: EmailId | null;
    revisionBlobs: DraftRevisionBlobs;
  },
): Promise<void> {
  const account = await tx.accounts.findById(input.accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
  }
  if (account.storageQuotaBytes === null) {
    return;
  }
  const emails = (await tx.emails.listByAccount(input.accountId)).filter(
    ({ id }) => id !== input.excludeEmailId,
  );
  const referenced = referencedBlobIds(emails);
  for (const submission of await tx.submissions.listByAccount(input.accountId)) {
    referenced.add(submission.rawBlobId);
  }
  input.revisionBlobs.all.forEach(({ record }) => referenced.add(record.id));
  const newRecords = new Map(
    input.revisionBlobs.all.filter(({ isNew }) => isNew).map(({ record }) => [record.id, record]),
  );
  let total = 0n;
  for (const blobId of referenced) {
    const blob = newRecords.get(blobId) ?? (await tx.blobs.findById(input.accountId, blobId));
    if (blob === null || (blob.status !== 'ready' && blob.status !== 'pending')) {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: blobId });
    }
    total += blob.sizeBytes;
  }
  if (total > account.storageQuotaBytes) {
    throw new MailCoreError('OVER_QUOTA');
  }
}

export async function insertDraftRevisionBlobs(
  tx: MailTransaction,
  revision: DraftRevisionBlobs,
): Promise<void> {
  for (const { record, isNew } of revision.all) {
    if (!isNew) continue;
    await tx.blobs.insert(record);
  }
}

export async function commitDraftRevisionBlobs(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  accountId: MailAccountId,
  revision: DraftRevisionBlobs,
  readyAt: Date,
  committedObjectKeys: string[],
): Promise<void> {
  for (const { prepared, record, isNew } of revision.all) {
    if (!isNew) continue;
    const objectAlreadyOwned = (await tx.blobs.listByAccount(accountId)).some(
      (blob) =>
        blob.id !== record.id &&
        blob.objectKey === record.objectKey &&
        blob.status === 'ready' &&
        blob.deletedAt === null,
    );
    if (!objectAlreadyOwned && !committedObjectKeys.includes(record.objectKey)) {
      committedObjectKeys.push(record.objectKey);
    }
    const receipt = await commitPreparedBlob(dependencies.blobStore, prepared, record.objectKey);
    await verifyPreparedBlob(dependencies.blobStore, prepared, receipt.objectKey);
    await tx.blobs.update(accountId, record.id, {
      status: 'ready',
      readyAt,
    });
  }
}

export function draftReplyHeaders(reply: EmailRecord | null): {
  inReplyTo: string[];
  references: string[];
} {
  if (reply?.messageId === null || reply?.messageId === undefined) {
    return { inReplyTo: [], references: reply?.references ?? [] };
  }
  return {
    inReplyTo: [reply.messageId],
    references: Array.from(new Set([...reply.references, reply.messageId])),
  };
}

const draftAddressSchema = z.string().email();

export const normalizeDraftContent = (
  dependencies: Pick<MailCoreDependencies, 'sanitizeHtml'>,
  content: DraftContent,
): DraftContent => ({
  ...content,
  to: content.to.map(normalizeDraftAddress),
  cc: content.cc.map(normalizeDraftAddress),
  bcc: content.bcc.map(normalizeDraftAddress),
  htmlBody:
    content.htmlBody.length === 0 ? '' : dependencies.sanitizeHtml(content.htmlBody).trimEnd(),
});

const normalizeDraftAddress = (address: DraftContent['to'][number]) => {
  const email = address.email.trim().normalize('NFC').toLocaleLowerCase('und');
  if (
    !draftAddressSchema.safeParse(email).success ||
    (address.name !== undefined && /[\r\n]/u.test(address.name))
  ) {
    throw new MailCoreError('INVALID_EMAIL');
  }
  return { ...address, email };
};

export function buildDraftParts(
  dependencies: MailCoreDependencies,
  parsed: ParsedEmail,
  rawBlobId: BlobId,
): EmailPartRecord[] {
  const idByPath = new Map(
    parsed.parts.map(({ partPath }) => [partPath, dependencies.idFactory.next<'EmailPart'>()]),
  );
  return parsed.parts.map((part) => ({
    id: idByPath.get(part.partPath)!,
    parentPartId: part.parentPath === null ? null : idByPath.get(part.parentPath)!,
    partPath: part.partPath,
    contentType: part.contentType,
    charset: part.charset,
    disposition: part.disposition,
    filename: part.filename,
    contentId: part.contentId,
    rawBlobId,
    offsetStart: part.section.offsetStart,
    encodedLength: part.section.encodedLength,
    decodedLength: part.section.decodedLength,
    transferEncoding: part.section.transferEncoding,
    sizeBytes: part.section.decodedLength,
    kind: part.kind,
  }));
}

export function draftEmailContent(
  dependencies: MailCoreDependencies,
  input: {
    content: DraftContent;
    references: DraftReferences;
    revision: DraftRevisionBlobs;
    raw: Uint8Array;
    parsed: ParsedEmail;
    draftRevision: number;
    messageId: string;
  },
): Pick<
  EmailRecord,
  | 'bcc'
  | 'blobId'
  | 'cc'
  | 'draftRevision'
  | 'from'
  | 'hasAttachment'
  | 'htmlBody'
  | 'identityId'
  | 'inReplyTo'
  | 'messageId'
  | 'parserVersion'
  | 'parseWarnings'
  | 'parts'
  | 'preview'
  | 'references'
  | 'replyToEmailId'
  | 'replyTo'
  | 'sender'
  | 'sentAt'
  | 'sizeBytes'
  | 'subject'
  | 'textBody'
  | 'to'
> {
  const replyHeaders = draftReplyHeaders(input.references.reply);
  const from = [
    {
      email: input.references.identity.email,
      ...(input.references.identity.name === null ? {} : { name: input.references.identity.name }),
    },
  ];
  return {
    identityId: input.references.identity.id,
    blobId: input.revision.raw.record.id,
    textBody: input.content.textBody,
    htmlBody: input.content.htmlBody,
    messageId: input.messageId,
    replyToEmailId: input.content.replyToEmailId,
    inReplyTo: replyHeaders.inReplyTo,
    references: replyHeaders.references,
    subject: input.content.subject,
    preview: previewFrom(input.content),
    sentAt: null,
    sizeBytes: BigInt(input.raw.byteLength),
    hasAttachment: input.references.attachments.length > 0,
    draftRevision: input.draftRevision,
    sender: from,
    from,
    replyTo:
      input.references.identity.replyTo === null
        ? []
        : [{ email: input.references.identity.replyTo }],
    to: structuredClone(input.content.to),
    cc: structuredClone(input.content.cc),
    bcc: structuredClone(input.content.bcc),
    parserVersion: 1,
    parseWarnings: [],
    parts: buildDraftParts(dependencies, input.parsed, input.revision.raw.record.id),
  };
}

const buildThread = (
  id: ThreadId,
  accountId: MailAccountId,
  references: DraftReferences,
  content: DraftContent,
  now: Date,
): ThreadRecord => ({
  id,
  accountId,
  normalizedSubject: normalizeSubject(content.subject),
  latestReceivedAt: now,
  emailCount: 0,
  unreadCount: 0,
  hasAttachment: false,
  participantSummary: participantSummaryFrom(references.identity, content),
  preview: previewFrom(content),
  createdAt: now,
  updatedAt: now,
});

export type PreparedDraftCreate = {
  accountId: MailAccountId;
  content: DraftContent;
  now: Date;
  emailId: EmailId;
  messageId: string;
  preflight: DraftReferences;
  raw: Uint8Array;
  parsed: ParsedEmail;
  prepared: PreparedDraftRevision;
};

export type ValidatedDraftCreate = {
  references: DraftReferences;
  revision: DraftRevisionBlobs;
  newThread: boolean;
  threadId: ThreadId;
  draftsMailboxId: MailboxId;
};

export async function prepareDraftCreate(
  dependencies: MailCoreDependencies,
  input: CreateDraftInput,
): Promise<PreparedDraftCreate> {
  const content = normalizeDraftContent(dependencies, input);
  const now = dependencies.clock.now();
  const emailId = dependencies.idFactory.next<'Email'>() as EmailId;
  const messageId = `<${emailId}@local.zero>`;
  const preflight = await dependencies.unitOfWork.run((tx) =>
    requireDraftReferences(tx, input.accountId, content),
  );
  const attachments = await loadDraftAttachments(dependencies, preflight.attachments);
  const replyHeaders = draftReplyHeaders(preflight.reply);
  const raw = renderDraft({
    emailId,
    revision: 1,
    messageId,
    date: now,
    identity: preflight.identity,
    content,
    ...replyHeaders,
    attachments,
  });
  const parsed = await parseRawEmail(raw, {
    sanitizeHtml: dependencies.sanitizeHtml,
  });
  const prepared = await prepareDraftRevision(dependencies, {
    accountId: input.accountId,
    raw,
  });
  return {
    accountId: input.accountId,
    content,
    now,
    emailId,
    messageId,
    preflight,
    raw,
    parsed,
    prepared,
  };
}

export async function createDraftInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  preparedCreate: PreparedDraftCreate,
  committedObjectKeys: string[],
  validated?: ValidatedDraftCreate,
): Promise<DraftResult> {
  const { accountId, content, now, emailId, messageId, raw, parsed } = preparedCreate;
  const checked =
    validated ?? (await validateDraftCreateInTransaction(dependencies, tx, preparedCreate));
  const { references, revision, newThread, threadId, draftsMailboxId } = checked;

  await insertDraftRevisionBlobs(tx, revision);
  if (newThread) {
    await tx.threads.insert(buildThread(threadId, accountId, references, content, now));
  }
  const emailContent = draftEmailContent(dependencies, {
    content,
    references,
    revision,
    raw,
    parsed,
    draftRevision: 1,
    messageId,
  });
  const stored = await tx.emails.insert({
    id: emailId,
    accountId,
    threadId,
    ...emailContent,
    receivedAt: now,
    lifecycle: 'draft',
    createdAt: now,
    updatedAt: now,
    destroyedAt: null,
    mailboxIds: [draftsMailboxId],
    restoreMailboxIds: [],
    keywords: ['$draft'],
  });
  await tx.emails.publishSearchDocument(
    accountId,
    emailId,
    createEmailSearchDocument({
      subject: content.subject,
      addresses: [
        ...stored.sender,
        ...stored.from,
        ...stored.replyTo,
        ...stored.to,
        ...stored.cc,
        ...stored.bcc,
      ],
      textBody: content.textBody,
      htmlBody: content.htmlBody,
    }),
  );
  await commitDraftRevisionBlobs(dependencies, tx, accountId, revision, now, committedObjectKeys);
  const aggregateChanges = await applyEmailAggregateDelta(tx, {
    accountId,
    before: null,
    after: stored,
    now,
  });
  const stateVersion = await recordChanges(tx, {
    accountId,
    changes: [
      {
        collection: 'email',
        entityId: emailId,
        changeType: 'created',
        changedProperties: null,
      },
      ...(newThread
        ? [
            {
              collection: 'thread' as const,
              entityId: threadId,
              changeType: 'created' as const,
              changedProperties: null,
            },
          ]
        : []),
      ...aggregateChanges.filter(
        ({ collection, entityId }) =>
          !(newThread && collection === 'thread' && entityId === threadId),
      ),
    ],
    createdAt: now,
  });
  return { ...stored, stateVersion };
}

export async function validateDraftCreateInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  preparedCreate: PreparedDraftCreate,
): Promise<ValidatedDraftCreate> {
  const { accountId, content, now, preflight, prepared } = preparedCreate;
  const references = await requireDraftReferences(tx, accountId, content);
  requireStableReferences(preflight, references);
  const revision = await allocateDraftRevisionBlobs(dependencies, tx, accountId, prepared, now);
  await requireDraftQuota(tx, {
    accountId,
    excludeEmailId: null,
    revisionBlobs: revision,
  });
  const newThread = references.reply === null;
  const threadId =
    references.reply?.threadId ?? (dependencies.idFactory.next<'Thread'>() as ThreadId);
  if (!newThread && (await tx.threads.findById(accountId, threadId)) === null) {
    throw new MailCoreError('THREAD_NOT_FOUND', { entityId: threadId });
  }
  const draftsMailbox = await tx.mailboxes.findByRole(accountId, 'drafts');
  if (draftsMailbox === null) {
    throw new MailCoreError('MAILBOX_NOT_FOUND');
  }
  return {
    references,
    revision,
    newThread,
    threadId,
    draftsMailboxId: draftsMailbox.id,
  };
}

export async function createDraft(
  dependencies: MailCoreDependencies,
  input: CreateDraftInput,
): Promise<DraftResult> {
  const preparedCreate = await prepareDraftCreate(dependencies, input);
  const committedObjectKeys: string[] = [];
  let operationCompleted = false;
  try {
    return await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const result = await createDraftInTransaction(
        dependencies,
        tx,
        preparedCreate,
        committedObjectKeys,
      );
      operationCompleted = true;
      return result;
    });
  } catch (error) {
    if (!operationCompleted) {
      await discardCommittedBlobs(dependencies.blobStore, input.accountId, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, preparedCreate.prepared.all);
  }
}
