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
import { renderDraft } from './render-draft';
import { normalizeSubject } from '../thread';
import { recordChanges } from '../changes';
import { z } from 'zod';

export type DraftReferences = {
  identity: IdentityRecord;
  reply: EmailRecord | null;
  attachments: BlobRecord[];
};

export type PreparedDraftRevision = {
  raw: PreparedBlob;
  text: PreparedBlob | null;
  html: PreparedBlob | null;
  all: PreparedBlob[];
};

export type DraftRevisionBlob = {
  prepared: PreparedBlob;
  record: BlobRecord;
  isNew: boolean;
};

export type DraftRevisionBlobs = {
  raw: DraftRevisionBlob;
  text: DraftRevisionBlob | null;
  html: DraftRevisionBlob | null;
  all: DraftRevisionBlob[];
};

const referencedBlobIds = (emails: EmailRecord[]): Set<BlobId> =>
  new Set(
    emails.flatMap((email) => [
      ...(email.blobId === null ? [] : [email.blobId]),
      ...(email.textBlobId === null ? [] : [email.textBlobId]),
      ...(email.htmlBlobId === null ? [] : [email.htmlBlobId]),
      ...email.parts.flatMap(({ blobId }) => (blobId === null ? [] : [blobId])),
    ]),
  );

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

const sameAttachments = (left: BlobRecord[], right: BlobRecord[]): boolean =>
  left.length === right.length &&
  left.every(
    (blob, index) =>
      blob.id === right[index]?.id &&
      blob.sha256 === right[index]?.sha256 &&
      blob.sizeBytes === right[index]?.sizeBytes &&
      blob.contentType === right[index]?.contentType &&
      blob.objectKey === right[index]?.objectKey &&
      blob.status === right[index]?.status,
  );

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
  const attachments: BlobRecord[] = [];
  for (const blobId of content.attachmentBlobIds) {
    const blob = await tx.blobs.findById(accountId, blobId);
    if (blob === null) {
      throw new MailCoreError('BLOB_NOT_FOUND', { entityId: blobId });
    }
    if (blob.status !== 'ready' || blob.readyAt === null || blob.deletedAt !== null) {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: blobId });
    }
    attachments.push(blob);
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
  records: BlobRecord[],
): Promise<DraftAttachment[]> {
  const attachments: DraftAttachment[] = [];
  for (const record of records) {
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
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      bytes,
    });
  }
  return attachments;
}

export async function prepareDraftRevision(
  dependencies: MailCoreDependencies,
  input: {
    accountId: MailAccountId;
    raw: Uint8Array;
    content: Pick<DraftContent, 'htmlBody' | 'textBody'>;
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
    const text =
      input.content.textBody.length === 0
        ? null
        : await prepareBlob(dependencies.blobStore, {
            accountId: input.accountId,
            bytes: new TextEncoder().encode(input.content.textBody),
            contentType: 'text/plain; charset=utf-8',
          });
    if (text !== null) {
      all.push(text);
    }
    const html =
      input.content.htmlBody.length === 0
        ? null
        : await prepareBlob(dependencies.blobStore, {
            accountId: input.accountId,
            bytes: new TextEncoder().encode(input.content.htmlBody),
            contentType: 'text/html; charset=utf-8',
          });
    if (html !== null) {
      all.push(html);
    }
    return { raw, text, html, all };
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
  const text = prepared.text === null ? null : await allocate(prepared.text);
  const html = prepared.html === null ? null : await allocate(prepared.html);
  return {
    raw,
    text,
    html,
    all: [...resolved.values()],
  };
}

export async function requireDraftQuota(
  tx: MailTransaction,
  input: {
    accountId: MailAccountId;
    excludeEmailId: EmailId | null;
    revisionBlobs: DraftRevisionBlobs;
    attachments: BlobRecord[];
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
  input.attachments.forEach(({ id }) => referenced.add(id));
  for (const submission of await tx.submissions.listByAccount(input.accountId)) {
    submission.frozenBlobs.forEach(({ blobId }) => referenced.add(blobId));
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
  attachments: BlobRecord[],
  content: DraftContent,
  revision: DraftRevisionBlobs,
): EmailPartRecord[] {
  const parts: EmailPartRecord[] = [];
  const addPart = (
    parentPartId: string | null,
    partPath: string,
    part: Omit<EmailPartRecord, 'id' | 'parentPartId' | 'partPath'>,
  ): string => {
    const id = dependencies.idFactory.next<'EmailPart'>();
    parts.push({ id, parentPartId, partPath, ...part });
    return id;
  };
  const structural = (contentType: string) => ({
    contentType,
    charset: null,
    disposition: null,
    filename: null,
    contentId: null,
    blobId: null,
    sizeBytes: 0n,
    kind: 'body' as const,
  });
  const body = (
    parentPartId: string | null,
    partPath: string,
    contentType: 'text/plain' | 'text/html',
    blob: DraftRevisionBlob | null,
  ) =>
    addPart(parentPartId, partPath, {
      contentType,
      charset: 'utf-8',
      disposition: null,
      filename: null,
      contentId: null,
      blobId: blob?.record.id ?? null,
      sizeBytes: blob?.record.sizeBytes ?? 0n,
      kind: 'body',
    });
  const hasHtml = content.htmlBody.length > 0;
  const hasAttachments = attachments.length > 0;
  let attachmentParent: string | null = null;
  let attachmentPrefix = '';
  if (hasAttachments) {
    attachmentParent = addPart(null, '1', structural('multipart/mixed'));
    attachmentPrefix = '1.';
  }
  if (hasHtml) {
    const alternativePath = hasAttachments ? '1.1' : '1';
    const alternative = addPart(
      hasAttachments ? attachmentParent : null,
      alternativePath,
      structural('multipart/alternative'),
    );
    body(alternative, `${alternativePath}.1`, 'text/plain', revision.text);
    body(alternative, `${alternativePath}.2`, 'text/html', revision.html);
  } else {
    body(attachmentParent, hasAttachments ? '1.1' : '1', 'text/plain', revision.text);
  }
  attachments.forEach((attachment, index) => {
    const position = 2 + index;
    addPart(attachmentParent, `${attachmentPrefix}${position}`, {
      contentType: attachment.contentType,
      charset: null,
      disposition: 'attachment',
      filename: attachment.id,
      contentId: null,
      blobId: attachment.id,
      sizeBytes: attachment.sizeBytes,
      kind: 'attachment',
    });
  });
  return parts;
}

export function draftEmailContent(
  dependencies: MailCoreDependencies,
  input: {
    content: DraftContent;
    references: DraftReferences;
    revision: DraftRevisionBlobs;
    raw: Uint8Array;
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
  | 'htmlBlobId'
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
  | 'textBlobId'
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
    textBlobId: input.revision.text?.record.id ?? null,
    htmlBlobId: input.revision.html?.record.id ?? null,
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
    parts: buildDraftParts(
      dependencies,
      input.references.attachments,
      input.content,
      input.revision,
    ),
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
  const prepared = await prepareDraftRevision(dependencies, {
    accountId: input.accountId,
    raw,
    content,
  });
  return {
    accountId: input.accountId,
    content,
    now,
    emailId,
    messageId,
    preflight,
    raw,
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
  const { accountId, content, now, emailId, messageId, raw } = preparedCreate;
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
    attachments: references.attachments,
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
