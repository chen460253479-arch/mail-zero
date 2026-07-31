import { isDeepStrictEqual } from 'node:util';

import {
  allocateDraftRevisionBlobs,
  commitDraftRevisionBlobs,
  draftEmailContent,
  draftReplyHeaders,
  insertDraftRevisionBlobs,
  loadDraftAttachments,
  normalizeDraftContent,
  prepareDraftRevision,
  requireDraftQuota,
  requireDraftReferences,
  requireStableReferences,
  type DraftRevisionBlobs,
  type DraftReferences,
} from './create-draft';
import { discardCommittedBlobs, discardTemporaryBlobs } from '../blob/blob-lifecycle';
import type { EmailRecord, MailCoreDependencies, MailTransaction } from '../store';
import type { DraftResult, UpdateDraftInput } from './draft-types';
import { applyEmailAggregateDelta } from './email-aggregates';
import { createEmailSearchDocument } from './search-document';
import { renderDraft } from './render-draft';
import { normalizeSubject } from '../thread';
import { recordChanges } from '../changes';
import type { ParsedEmail } from './types';
import { MailCoreError } from '../types';
import { parseRawEmail } from './mime';

const requireMutableDraft = async (
  tx: MailTransaction,
  input: Pick<UpdateDraftInput, 'accountId' | 'emailId' | 'expectedRevision'>,
): Promise<EmailRecord> => {
  const email = await tx.emails.findById(input.accountId, input.emailId);
  if (email === null || email.destroyedAt !== null) {
    throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
  }
  if (email.lifecycle !== 'draft') {
    throw new MailCoreError('EMAIL_CONTENT_IMMUTABLE', { entityId: input.emailId });
  }
  if (email.draftRevision !== input.expectedRevision) {
    throw new MailCoreError('DRAFT_REVISION_CONFLICT', { entityId: input.emailId });
  }
  if ((await tx.threads.findById(input.accountId, email.threadId)) === null) {
    throw new MailCoreError('THREAD_NOT_FOUND', { entityId: email.threadId });
  }
  return email;
};

const changedDraftProperties = (before: EmailRecord, after: EmailRecord): string[] => {
  const properties: (keyof EmailRecord)[] = [
    'blobId',
    'identityId',
    'textBody',
    'htmlBody',
    'replyToEmailId',
    'inReplyTo',
    'references',
    'subject',
    'preview',
    'sizeBytes',
    'hasAttachment',
    'draftRevision',
    'sender',
    'from',
    'replyTo',
    'to',
    'cc',
    'bcc',
    'parts',
  ];
  return properties.filter((property) => !isDeepStrictEqual(before[property], after[property]));
};

const requireImmutableReplyTarget = (email: EmailRecord, references: DraftReferences): void => {
  if (references.reply?.id === email.id) {
    throw new MailCoreError('INVALID_PATCH', { entityId: email.id });
  }
  if (email.replyToEmailId !== references.reply?.id && email.replyToEmailId !== null) {
    throw new MailCoreError('INVALID_PATCH', { entityId: email.id });
  }
  if (email.replyToEmailId === null && references.reply !== null) {
    throw new MailCoreError('INVALID_PATCH', { entityId: email.id });
  }
  const requested = draftReplyHeaders(references.reply);
  if (
    !isDeepStrictEqual(email.inReplyTo, requested.inReplyTo) ||
    !isDeepStrictEqual(email.references, requested.references)
  ) {
    throw new MailCoreError('INVALID_PATCH', { entityId: email.id });
  }
};

const updateOwnedThreadSubject = async (
  tx: MailTransaction,
  email: EmailRecord,
  subject: string,
  now: Date,
): Promise<boolean> => {
  if (email.replyToEmailId !== null) {
    return false;
  }
  const visibleThreadEmails = (
    await tx.emails.listByThread(email.accountId, email.threadId)
  ).filter(({ destroyedAt, mailboxIds }) => destroyedAt === null && mailboxIds.length > 0);
  if (visibleThreadEmails.length !== 1 || visibleThreadEmails[0]?.id !== email.id) {
    return false;
  }
  const thread = await tx.threads.findById(email.accountId, email.threadId);
  if (thread === null) {
    throw new MailCoreError('THREAD_NOT_FOUND', { entityId: email.threadId });
  }
  const normalizedSubject = normalizeSubject(subject);
  if (thread.normalizedSubject === normalizedSubject) {
    return false;
  }
  await tx.threads.update(email.accountId, email.threadId, {
    normalizedSubject,
    updatedAt: now,
  });
  return true;
};

export type PreparedDraftUpdate = {
  input: UpdateDraftInput;
  content: UpdateDraftInput['content'];
  preflight: {
    email: EmailRecord;
    references: DraftReferences;
  };
  messageId: string;
  nextRevision: number;
  raw: Uint8Array;
  parsed: ParsedEmail;
  prepared: Awaited<ReturnType<typeof prepareDraftRevision>>;
  now: Date;
};

export type ValidatedDraftUpdate = {
  current: EmailRecord;
  references: DraftReferences;
  revision: DraftRevisionBlobs;
};

export async function prepareDraftUpdate(
  dependencies: MailCoreDependencies,
  input: UpdateDraftInput,
): Promise<PreparedDraftUpdate> {
  const content = normalizeDraftContent(dependencies, input.content);
  const normalizedInput: UpdateDraftInput = { ...input, content };
  const preflight = await dependencies.unitOfWork.run(async (tx) => ({
    email: await requireMutableDraft(tx, normalizedInput),
    references: await requireDraftReferences(tx, input.accountId, content),
  }));
  requireImmutableReplyTarget(preflight.email, preflight.references);
  const messageId = preflight.email.messageId;
  if (messageId === null) {
    throw new MailCoreError('BLOB_INTEGRITY', { entityId: input.emailId });
  }
  const attachments = await loadDraftAttachments(dependencies, preflight.references.attachments);
  const replyHeaders = draftReplyHeaders(preflight.references.reply);
  const nextRevision = input.expectedRevision + 1;
  const raw = renderDraft({
    emailId: input.emailId,
    revision: nextRevision,
    messageId,
    date: preflight.email.receivedAt,
    identity: preflight.references.identity,
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
  const now = dependencies.clock.now();
  return {
    input: normalizedInput,
    content,
    preflight,
    messageId,
    nextRevision,
    raw,
    parsed,
    prepared,
    now,
  };
}

export async function updateDraftInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  preparedUpdate: PreparedDraftUpdate,
  committedObjectKeys: string[],
  validated?: ValidatedDraftUpdate,
): Promise<DraftResult> {
  const { input, content, messageId, nextRevision, raw, parsed, now } = preparedUpdate;
  const checked =
    validated ?? (await validateDraftUpdateInTransaction(dependencies, tx, preparedUpdate));
  const { current, references, revision } = checked;
  await insertDraftRevisionBlobs(tx, revision);
  const nextContent = draftEmailContent(dependencies, {
    content,
    references,
    revision,
    raw,
    parsed,
    draftRevision: nextRevision,
    messageId,
  });
  const updated = await tx.emails.update(input.accountId, input.emailId, {
    ...nextContent,
    updatedAt: now,
  });
  await tx.emails.publishSearchDocument(
    input.accountId,
    input.emailId,
    createEmailSearchDocument({
      subject: content.subject,
      addresses: [
        ...updated.sender,
        ...updated.from,
        ...updated.replyTo,
        ...updated.to,
        ...updated.cc,
        ...updated.bcc,
      ],
      textBody: content.textBody,
      htmlBody: content.htmlBody,
    }),
  );
  await commitDraftRevisionBlobs(
    dependencies,
    tx,
    input.accountId,
    revision,
    now,
    committedObjectKeys,
  );
  const normalizedSubjectChanged = await updateOwnedThreadSubject(
    tx,
    current,
    content.subject,
    now,
  );
  const aggregateChanges = await applyEmailAggregateDelta(tx, {
    accountId: input.accountId,
    before: current,
    after: updated,
    now,
  });
  const aggregateThreadChange = aggregateChanges.find(
    ({ collection, entityId }) => collection === 'thread' && entityId === current.threadId,
  );
  const threadChange = normalizedSubjectChanged
    ? {
        collection: 'thread' as const,
        entityId: current.threadId,
        changeType: 'updated' as const,
        changedProperties: [
          ...new Set(['normalizedSubject', ...(aggregateThreadChange?.changedProperties ?? [])]),
        ],
      }
    : aggregateThreadChange;
  const stateVersion = await recordChanges(tx, {
    accountId: input.accountId,
    changes: [
      {
        collection: 'email',
        entityId: current.id,
        changeType: 'updated',
        changedProperties: changedDraftProperties(current, updated),
      },
      ...(threadChange === undefined ? [] : [threadChange]),
      ...aggregateChanges.filter(
        ({ collection, entityId }) => !(collection === 'thread' && entityId === current.threadId),
      ),
    ],
    createdAt: now,
  });
  return { ...updated, stateVersion };
}

export async function validateDraftUpdateInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  preparedUpdate: PreparedDraftUpdate,
): Promise<ValidatedDraftUpdate> {
  const { input, content, preflight, messageId, prepared, now } = preparedUpdate;
  const current = await requireMutableDraft(tx, input);
  const references = await requireDraftReferences(tx, input.accountId, content);
  requireStableReferences(preflight.references, references);
  requireImmutableReplyTarget(current, references);
  if (
    current.messageId !== messageId ||
    current.receivedAt.getTime() !== preflight.email.receivedAt.getTime()
  ) {
    throw new MailCoreError('DRAFT_REVISION_CONFLICT', { entityId: input.emailId });
  }
  const revision = await allocateDraftRevisionBlobs(
    dependencies,
    tx,
    input.accountId,
    prepared,
    now,
  );
  await requireDraftQuota(tx, {
    accountId: input.accountId,
    excludeEmailId: input.emailId,
    revisionBlobs: revision,
  });
  return { current, references, revision };
}

export async function updateDraft(
  dependencies: MailCoreDependencies,
  input: UpdateDraftInput,
): Promise<DraftResult> {
  const preparedUpdate = await prepareDraftUpdate(dependencies, input);
  const committedObjectKeys: string[] = [];
  let operationCompleted = false;
  try {
    return await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const result = await updateDraftInTransaction(
        dependencies,
        tx,
        preparedUpdate,
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
    await discardTemporaryBlobs(dependencies.blobStore, preparedUpdate.prepared.all);
  }
}
