import { isDeepStrictEqual } from 'node:util';

import {
  allocateDraftRevisionBlobs,
  commitDraftRevisionBlobs,
  draftEmailContent,
  draftReplyHeaders,
  insertDraftRevisionBlobs,
  loadDraftAttachments,
  prepareDraftRevision,
  requireDraftQuota,
  requireDraftReferences,
  requireStableReferences,
  type DraftReferences,
} from './create-draft';
import type { EmailRecord, MailCoreDependencies, MailTransaction } from '../store';
import { discardCommittedBlobs, discardTemporaryBlobs } from './blob-lifecycle';
import { updateMailboxCounters, updateThreadCounters } from './update-email';
import type { DraftResult, UpdateDraftInput } from './draft-types';
import { renderDraft } from './render-draft';
import { normalizeSubject } from '../thread';
import { recordChanges } from '../changes';
import { MailCoreError } from '../types';

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
    'textBlobId',
    'htmlBlobId',
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

export async function updateDraft(
  dependencies: MailCoreDependencies,
  input: UpdateDraftInput,
): Promise<DraftResult> {
  const preflight = await dependencies.unitOfWork.run(async (tx) => ({
    email: await requireMutableDraft(tx, input),
    references: await requireDraftReferences(tx, input.accountId, input.content),
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
    content: input.content,
    ...replyHeaders,
    attachments,
  });
  const prepared = await prepareDraftRevision(dependencies, {
    accountId: input.accountId,
    raw,
    content: input.content,
  });
  const now = dependencies.clock.now();
  const revision = allocateDraftRevisionBlobs(dependencies, input.accountId, prepared, now);
  const committedObjectKeys: string[] = [];
  let operationCompleted = false;
  try {
    return await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const current = await requireMutableDraft(tx, input);
      const references: DraftReferences = await requireDraftReferences(
        tx,
        input.accountId,
        input.content,
      );
      requireStableReferences(preflight.references, references);
      requireImmutableReplyTarget(current, references);
      if (
        current.messageId !== messageId ||
        current.receivedAt.getTime() !== preflight.email.receivedAt.getTime()
      ) {
        throw new MailCoreError('DRAFT_REVISION_CONFLICT', { entityId: input.emailId });
      }
      await requireDraftQuota(tx, {
        accountId: input.accountId,
        excludeEmailId: input.emailId,
        revisionBlobs: revision,
        attachments: references.attachments,
      });
      await insertDraftRevisionBlobs(tx, revision);
      const nextContent = draftEmailContent(dependencies, {
        content: input.content,
        references,
        revision,
        raw,
        draftRevision: nextRevision,
        messageId,
      });
      const updated = await tx.emails.update(input.accountId, input.emailId, {
        ...nextContent,
        updatedAt: now,
      });
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
        input.content.subject,
        now,
      );
      const aggregateThreadChange = await updateThreadCounters(
        tx,
        input.accountId,
        current.threadId,
        now,
      );
      const threadChange = normalizedSubjectChanged
        ? {
            collection: 'thread' as const,
            entityId: current.threadId,
            changeType: 'updated' as const,
            changedProperties: [
              'normalizedSubject',
              ...(aggregateThreadChange?.changedProperties ?? []),
            ],
          }
        : aggregateThreadChange;
      const mailboxChanges = await updateMailboxCounters(tx, input.accountId, now);
      const stateVersion = await recordChanges(tx, {
        accountId: input.accountId,
        changes: [
          {
            collection: 'email',
            entityId: current.id,
            changeType: 'updated',
            changedProperties: changedDraftProperties(current, updated),
          },
          ...(threadChange === null ? [] : [threadChange]),
          ...mailboxChanges,
        ],
        createdAt: now,
      });
      operationCompleted = true;
      return { ...updated, stateVersion };
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
