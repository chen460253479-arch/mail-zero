import {
  commitPreparedBlob,
  discardCommittedBlobs,
  discardTemporaryBlobs,
  prepareBlob,
  type PreparedBlob,
  verifyPreparedBlob,
} from './blob-lifecycle';
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
  type ThreadId,
} from '../types';
import type { CreateDraftInput, DraftAttachment, DraftContent, DraftResult } from './draft-types';
import { updateMailboxCounters, updateThreadCounters } from './update-email';
import { renderDraft } from './render-draft';
import { normalizeSubject } from '../thread';
import { recordChanges } from '../changes';

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
    await verifyPreparedBlob(
      dependencies.blobStore,
      {
        sha256: record.sha256,
        sizeBytes: record.sizeBytes,
      },
      record.objectKey,
      true,
    );
    let bytes: Uint8Array;
    try {
      bytes = await dependencies.blobStore.get(record.objectKey);
    } catch {
      throw new MailCoreError('BLOB_INTEGRITY', { entityId: record.id });
    }
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

export function allocateDraftRevisionBlobs(
  dependencies: MailCoreDependencies,
  accountId: MailAccountId,
  prepared: PreparedDraftRevision,
  now: Date,
): DraftRevisionBlobs {
  const allocate = (pending: PreparedBlob): DraftRevisionBlob => {
    const id = dependencies.idFactory.next<'Blob'>() as BlobId;
    return {
      prepared: pending,
      record: {
        id,
        accountId,
        sha256: pending.sha256,
        sizeBytes: pending.sizeBytes,
        contentType: pending.contentType,
        objectKey: `mail/${accountId}/blobs/${id}`,
        status: 'pending',
        createdAt: now,
        readyAt: null,
        deletedAt: null,
      },
    };
  };
  const raw = allocate(prepared.raw);
  const text = prepared.text === null ? null : allocate(prepared.text);
  const html = prepared.html === null ? null : allocate(prepared.html);
  return {
    raw,
    text,
    html,
    all: [raw, ...(text === null ? [] : [text]), ...(html === null ? [] : [html])],
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
  let total = input.revisionBlobs.all.reduce((sum, { record }) => sum + record.sizeBytes, 0n);
  for (const blobId of referenced) {
    const blob = await tx.blobs.findById(input.accountId, blobId);
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
  for (const { record } of revision.all) {
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
  for (const { prepared, record } of revision.all) {
    committedObjectKeys.push(record.objectKey);
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

export function buildDraftParts(
  dependencies: MailCoreDependencies,
  attachments: BlobRecord[],
): EmailPartRecord[] {
  return attachments.map((attachment, index) => ({
    id: dependencies.idFactory.next<'EmailPart'>(),
    parentPartId: null,
    partPath: (index + 1).toString(),
    contentType: attachment.contentType,
    charset: null,
    disposition: 'attachment',
    filename: attachment.id,
    contentId: null,
    blobId: attachment.id,
    sizeBytes: attachment.sizeBytes,
    kind: 'attachment',
  }));
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
    parts: buildDraftParts(dependencies, input.references.attachments),
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

export async function createDraft(
  dependencies: MailCoreDependencies,
  input: CreateDraftInput,
): Promise<DraftResult> {
  const now = dependencies.clock.now();
  const emailId = dependencies.idFactory.next<'Email'>() as EmailId;
  const messageId = `<${emailId}@local.zero>`;
  const preflight = await dependencies.unitOfWork.run((tx) =>
    requireDraftReferences(tx, input.accountId, input),
  );
  const attachments = await loadDraftAttachments(dependencies, preflight.attachments);
  const replyHeaders = draftReplyHeaders(preflight.reply);
  const raw = renderDraft({
    emailId,
    revision: 1,
    messageId,
    date: now,
    identity: preflight.identity,
    content: input,
    ...replyHeaders,
    attachments,
  });
  const prepared = await prepareDraftRevision(dependencies, {
    accountId: input.accountId,
    raw,
    content: input,
  });
  const revision = allocateDraftRevisionBlobs(dependencies, input.accountId, prepared, now);
  const committedObjectKeys: string[] = [];
  let operationCompleted = false;
  try {
    return await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const references = await requireDraftReferences(tx, input.accountId, input);
      requireStableReferences(preflight, references);
      await requireDraftQuota(tx, {
        accountId: input.accountId,
        excludeEmailId: null,
        revisionBlobs: revision,
        attachments: references.attachments,
      });
      await insertDraftRevisionBlobs(tx, revision);
      const newThread = references.reply === null;
      const threadId =
        references.reply?.threadId ?? (dependencies.idFactory.next<'Thread'>() as ThreadId);
      if (newThread) {
        await tx.threads.insert(buildThread(threadId, input.accountId, references, input, now));
      } else if ((await tx.threads.findById(input.accountId, threadId)) === null) {
        throw new MailCoreError('THREAD_NOT_FOUND', { entityId: threadId });
      }
      const content = draftEmailContent(dependencies, {
        content: input,
        references,
        revision,
        raw,
        draftRevision: 1,
        messageId,
      });
      const draftsMailbox = await tx.mailboxes.findByRole(input.accountId, 'drafts');
      if (draftsMailbox === null) {
        throw new MailCoreError('MAILBOX_NOT_FOUND');
      }
      const stored = await tx.emails.insert({
        id: emailId,
        accountId: input.accountId,
        threadId,
        ...content,
        receivedAt: now,
        lifecycle: 'draft',
        createdAt: now,
        updatedAt: now,
        destroyedAt: null,
        mailboxIds: [draftsMailbox.id],
        restoreMailboxIds: [],
        keywords: ['$draft'],
      });
      await commitDraftRevisionBlobs(
        dependencies,
        tx,
        input.accountId,
        revision,
        now,
        committedObjectKeys,
      );
      const threadChange = await updateThreadCounters(tx, input.accountId, threadId, now);
      const mailboxChanges = await updateMailboxCounters(tx, input.accountId, now);
      const stateVersion = await recordChanges(tx, {
        accountId: input.accountId,
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
            : threadChange === null
              ? []
              : [threadChange]),
          ...mailboxChanges,
        ],
        createdAt: now,
      });
      operationCompleted = true;
      return { ...stored, stateVersion };
    });
  } catch (error) {
    if (!operationCompleted) {
      await discardCommittedBlobs(dependencies.blobStore, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, prepared.all);
  }
}
