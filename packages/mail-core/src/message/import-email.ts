import {
  calculateSha256,
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
  MailCoreDependencies,
  MailTransaction,
  RemoteEmailRecord,
  ThreadRecord,
} from '../store';
import {
  MailCoreError,
  normalizeKeyword,
  type BlobId,
  type EmailId,
  type Keyword,
  type MailboxId,
  type ThreadId,
} from '../types';
import { calculateThreadDecision, createThreadReferenceKeys, normalizeSubject } from '../thread';
import type { ImportEmailInput, ImportEmailResult, ParsedEmail } from './types';
import { applyEmailAggregateDelta } from './email-aggregates';
import { createEmailSearchDocument } from './search-document';
import type { PendingMailChange } from '../changes';
import { parseRawEmail } from './mime';

type ImportValidation = {
  existing: RemoteEmailRecord | null;
  mailboxIds: MailboxId[];
  keywords: Keyword[];
};

type ResolvedBlob = {
  blobId: BlobId;
  prepared: PreparedBlob;
  record: BlobRecord;
};

const digestKey = (blob: Pick<PreparedBlob, 'sha256' | 'sizeBytes'>): string =>
  `${blob.sha256}:${blob.sizeBytes}`;

const requireImportReferences = async (
  tx: MailTransaction,
  input: ImportEmailInput,
  contentFingerprint: string,
): Promise<ImportValidation> => {
  if ((await tx.accounts.findById(input.accountId)) === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', {
      entityId: input.accountId,
    });
  }

  const existing = await tx.emails.findByRemoteId({
    accountId: input.accountId,
    provider: input.provider,
    remoteEmailId: input.remoteEmailId,
  });
  if (existing !== null) {
    if (existing.contentFingerprint !== contentFingerprint) {
      throw new MailCoreError('IDEMPOTENCY_CONFLICT', {
        entityId: existing.emailId,
      });
    }
    return { existing, mailboxIds: [], keywords: [] };
  }

  const mailboxIds = Array.from(new Set(input.mailboxIds));
  if (mailboxIds.length === 0) {
    throw new MailCoreError('EMAIL_MUST_HAVE_MAILBOX');
  }
  for (const mailboxId of mailboxIds) {
    const mailbox = await tx.mailboxes.findById(input.accountId, mailboxId);
    if (mailbox !== null && mailbox.deletedAt === null) {
      continue;
    }
    if (await tx.mailboxes.existsOutsideAccount(input.accountId, mailboxId)) {
      throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', {
        entityId: mailboxId,
      });
    }
    throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
  }

  return {
    existing: null,
    mailboxIds,
    keywords: Array.from(new Set(input.keywords.map(normalizeKeyword))),
  };
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

const quotaReferencedBlobIds = async (
  tx: MailTransaction,
  accountId: ImportEmailInput['accountId'],
  emails: EmailRecord[],
): Promise<Set<BlobId>> => {
  const referenced = referencedBlobIds(emails);
  for (const submission of await tx.submissions.listByAccount(accountId)) {
    for (const frozen of submission.frozenBlobs) {
      referenced.add(frozen.blobId);
    }
  }
  return referenced;
};

const currentReferencedBlobBytes = async (
  tx: MailTransaction,
  accountId: ImportEmailInput['accountId'],
  referencedBlobIds: Set<BlobId>,
): Promise<bigint> => {
  let total = 0n;
  for (const blobId of referencedBlobIds) {
    const blob = await tx.blobs.findById(accountId, blobId);
    if (blob !== null && (blob.status === 'ready' || blob.status === 'pending')) {
      total += blob.sizeBytes;
    }
  }
  return total;
};

const resolveBlobs = async (
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: ImportEmailInput,
  prepared: PreparedBlob[],
  existingEmails: EmailRecord[],
  now: Date,
): Promise<{
  blobIdByDigest: Map<string, BlobId>;
  newBlobs: ResolvedBlob[];
}> => {
  const account = await tx.accounts.findById(input.accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', {
      entityId: input.accountId,
    });
  }

  const blobIdByDigest = new Map<string, BlobId>();
  const newBlobs: ResolvedBlob[] = [];
  const existingReferencedIds = await quotaReferencedBlobIds(tx, input.accountId, existingEmails);
  let newlyReferencedExistingBytes = 0n;
  for (const candidate of prepared) {
    const key = digestKey(candidate);
    if (blobIdByDigest.has(key)) {
      continue;
    }
    const existing = await tx.blobs.findByDigest(
      input.accountId,
      candidate.sha256,
      candidate.sizeBytes,
    );
    if (existing !== null) {
      if (existing.status !== 'ready') {
        throw new MailCoreError('BLOB_INTEGRITY', {
          entityId: existing.id,
        });
      }
      await verifyPreparedBlob(dependencies.blobStore, candidate, existing.objectKey, true);
      blobIdByDigest.set(key, existing.id);
      if (!existingReferencedIds.has(existing.id)) {
        newlyReferencedExistingBytes += existing.sizeBytes;
      }
      continue;
    }

    const blobId = dependencies.idFactory.next<'Blob'>() as BlobId;
    blobIdByDigest.set(key, blobId);
    newBlobs.push({
      blobId,
      prepared: candidate,
      record: {
        id: blobId,
        accountId: input.accountId,
        sha256: candidate.sha256,
        sizeBytes: candidate.sizeBytes,
        contentType: candidate.contentType,
        objectKey: contentAddressedObjectKey(input.accountId, candidate.sha256),
        status: 'pending',
        createdAt: now,
        readyAt: null,
        deletedAt: null,
      },
    });
  }

  const existingBytes = await currentReferencedBlobBytes(
    tx,
    input.accountId,
    existingReferencedIds,
  );
  const newBytes = newBlobs.reduce((total, { prepared: blob }) => total + blob.sizeBytes, 0n);
  if (
    account.storageQuotaBytes !== null &&
    existingBytes + newlyReferencedExistingBytes + newBytes > account.storageQuotaBytes
  ) {
    throw new MailCoreError('OVER_QUOTA');
  }

  return { blobIdByDigest, newBlobs };
};

const previewFrom = (parsed: ParsedEmail): string => {
  const source = parsed.textBody || parsed.htmlBody.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ');
  return source.trim().slice(0, 256);
};

const participantSummaryFrom = (parsed: Pick<ParsedEmail, 'cc' | 'from' | 'to'>): string | null => {
  const participants = Array.from(
    new Set(
      [...parsed.from, ...parsed.to, ...parsed.cc].map(({ email, name }) => name?.trim() || email),
    ),
  );
  return participants.length === 0 ? null : participants.slice(0, 3).join(', ');
};

const buildThreadRecord = (
  id: ThreadId,
  input: ImportEmailInput,
  parsed: ParsedEmail,
  now: Date,
): ThreadRecord => ({
  id,
  accountId: input.accountId,
  normalizedSubject: normalizeSubject(parsed.subject),
  latestReceivedAt: input.receivedAt,
  emailCount: 0,
  unreadCount: 0,
  hasAttachment: false,
  participantSummary: participantSummaryFrom(parsed),
  preview: previewFrom(parsed),
  createdAt: now,
  updatedAt: now,
});

const decideThread = async (
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: ImportEmailInput,
  parsed: ParsedEmail,
  now: Date,
): Promise<{
  threadId: ThreadId;
  changeType: 'created' | 'updated';
  destroyedThreadIds: ThreadId[];
  retainedThreadIds: ThreadId[];
  movedEmailIds: EmailId[];
  movedEmails: { before: EmailRecord; after: EmailRecord }[];
}> => {
  const normalizedSubject = normalizeSubject(parsed.subject);
  const referenceKeys = await createThreadReferenceKeys({
    subject: parsed.subject,
    messageIds: [...parsed.inReplyTo, ...parsed.references],
  });
  const normalizedSubjectHash = referenceKeys[0]?.normalizedSubjectHash;
  const candidates =
    normalizedSubjectHash === undefined
      ? []
      : await tx.threadReferences.findCandidates({
          accountId: input.accountId,
          normalizedSubjectHash,
          messageIdHashes: referenceKeys.map(({ messageIdHash }) => messageIdHash),
        });
  const decision = calculateThreadDecision({
    normalizedSubject,
    referenceIds: referenceKeys.map(({ messageIdHash }) => messageIdHash),
    candidates: candidates.map(({ threadId, messageIdHash }) => ({
      threadId,
      normalizedSubject,
      matchedReference: messageIdHash,
    })),
  });

  if (decision.type === 'create') {
    const threadId = dependencies.idFactory.next<'Thread'>() as ThreadId;
    await tx.threads.insert(buildThreadRecord(threadId, input, parsed, now));
    return {
      threadId,
      changeType: 'created',
      destroyedThreadIds: [],
      retainedThreadIds: [],
      movedEmailIds: [],
      movedEmails: [],
    };
  }

  if (decision.type === 'use') {
    return {
      threadId: decision.threadId,
      changeType: 'updated',
      destroyedThreadIds: [],
      retainedThreadIds: [],
      movedEmailIds: [],
      movedEmails: [],
    };
  }

  const movedEmailIds: EmailId[] = [];
  const movedEmails: { before: EmailRecord; after: EmailRecord }[] = [];
  const destroyedThreadIds: ThreadId[] = [];
  const retainedThreadIds: ThreadId[] = [];
  for (const loserThreadId of decision.loserThreadIds) {
    const moved = await tx.emails.moveThread(
      input.accountId,
      loserThreadId,
      decision.winnerThreadId,
      now,
    );
    movedEmailIds.push(...moved);
    for (const emailId of moved) {
      const after = await tx.emails.findById(input.accountId, emailId);
      if (after === null) {
        throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: emailId });
      }
      movedEmails.push({
        before: { ...after, threadId: loserThreadId },
        after,
      });
    }
    await tx.threadReferences.moveThread(input.accountId, loserThreadId, decision.winnerThreadId);
    const ownsRetainedEmail = await tx.emails.hasRetainedEmailInThread(
      input.accountId,
      loserThreadId,
    );
    if (ownsRetainedEmail) {
      retainedThreadIds.push(loserThreadId);
    } else {
      destroyedThreadIds.push(loserThreadId);
    }
  }
  return {
    threadId: decision.winnerThreadId,
    changeType: 'updated',
    destroyedThreadIds,
    retainedThreadIds,
    movedEmailIds,
    movedEmails,
  };
};

const buildEmailParts = (
  dependencies: MailCoreDependencies,
  parsed: ParsedEmail,
  partBlobs: (PreparedBlob | null)[],
  blobIdByDigest: Map<string, BlobId>,
): EmailPartRecord[] => {
  const idByPath = new Map(
    parsed.parts.map((part) => [part.partPath, dependencies.idFactory.next<'EmailPart'>()]),
  );
  return parsed.parts.map((part, index) => {
    const prepared = partBlobs[index] ?? null;
    return {
      id: idByPath.get(part.partPath)!,
      parentPartId: part.parentPath === null ? null : idByPath.get(part.parentPath)!,
      partPath: part.partPath,
      contentType: part.contentType,
      charset: part.charset,
      disposition: part.disposition,
      filename: part.filename,
      contentId: part.contentId,
      blobId: prepared === null ? null : blobIdByDigest.get(digestKey(prepared))!,
      sizeBytes: part.sizeBytes,
      kind: part.kind,
    };
  });
};

const recordImportChanges = async (
  tx: MailTransaction,
  input: ImportEmailInput,
  emailId: EmailId,
  thread: {
    threadId: ThreadId;
    changeType: 'created' | 'updated';
    destroyedThreadIds: ThreadId[];
    retainedThreadIds: ThreadId[];
    movedEmailIds: EmailId[];
  },
  threadChangedProperties: string[],
  retainedThreadChanges: { threadId: ThreadId; changedProperties: string[] }[],
  mailboxChanges: { mailboxId: MailboxId; changedProperties: string[] }[],
  now: Date,
): Promise<void> => {
  const stateVersion = await tx.nextStateVersion(input.accountId);
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'email',
    entityId: emailId,
    changeType: 'created',
    changedProperties: null,
    createdAt: now,
  });
  for (const movedEmailId of thread.movedEmailIds) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'email',
      entityId: movedEmailId,
      changeType: 'updated',
      changedProperties: ['threadId'],
      createdAt: now,
    });
  }
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'thread',
    entityId: thread.threadId,
    changeType: thread.changeType,
    changedProperties: thread.changeType === 'created' ? null : threadChangedProperties,
    createdAt: now,
  });
  for (const threadId of thread.destroyedThreadIds) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'thread',
      entityId: threadId,
      changeType: 'destroyed',
      changedProperties: null,
      createdAt: now,
    });
  }
  for (const retainedThread of retainedThreadChanges) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'thread',
      entityId: retainedThread.threadId,
      changeType: 'updated',
      changedProperties: retainedThread.changedProperties,
      createdAt: now,
    });
  }
  for (const mailbox of mailboxChanges) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'mailbox',
      entityId: mailbox.mailboxId,
      changeType: 'updated',
      changedProperties: mailbox.changedProperties,
      createdAt: now,
    });
  }
};

const existingResult = (remote: RemoteEmailRecord): ImportEmailResult => ({
  created: false,
  emailId: remote.emailId,
});

export async function importEmail(
  dependencies: MailCoreDependencies,
  input: ImportEmailInput,
): Promise<ImportEmailResult> {
  const raw = Uint8Array.from(input.raw);
  const contentFingerprint = await calculateSha256(raw);
  const preflight = await dependencies.unitOfWork.run((tx) =>
    requireImportReferences(tx, input, contentFingerprint),
  );
  if (preflight.existing !== null) {
    return existingResult(preflight.existing);
  }

  const parsed = await parseRawEmail(raw, {
    sanitizeHtml: dependencies.sanitizeHtml,
  });
  const prepared: PreparedBlob[] = [];
  const partBlobs: (PreparedBlob | null)[] = [];
  const committedObjectKeys: string[] = [];
  let rawBlob: PreparedBlob | null = null;
  let textBlob: PreparedBlob | null = null;
  let htmlBlob: PreparedBlob | null = null;
  let importOperationCompleted = false;
  try {
    rawBlob = await prepareBlob(dependencies.blobStore, {
      accountId: input.accountId,
      bytes: raw,
      contentType: 'message/rfc822',
    });
    prepared.push(rawBlob);
    if (parsed.textBody.length > 0) {
      textBlob = await prepareBlob(dependencies.blobStore, {
        accountId: input.accountId,
        bytes: new TextEncoder().encode(parsed.textBody),
        contentType: 'text/plain; charset=utf-8',
      });
      prepared.push(textBlob);
    }
    if (parsed.htmlBody.length > 0) {
      htmlBlob = await prepareBlob(dependencies.blobStore, {
        accountId: input.accountId,
        bytes: new TextEncoder().encode(parsed.htmlBody),
        contentType: 'text/html; charset=utf-8',
      });
      prepared.push(htmlBlob);
    }
    for (const part of parsed.parts) {
      if (part.bytes.byteLength === 0) {
        partBlobs.push(null);
        continue;
      }
      const partBlob = await prepareBlob(dependencies.blobStore, {
        accountId: input.accountId,
        bytes: part.bytes,
        contentType: part.contentType,
      });
      prepared.push(partBlob);
      partBlobs.push(partBlob);
    }

    const result = await dependencies.unitOfWork.run(async (tx): Promise<ImportEmailResult> => {
      await tx.lockAccount(input.accountId);
      const validation = await requireImportReferences(tx, input, contentFingerprint);
      if (validation.existing !== null) {
        importOperationCompleted = true;
        return existingResult(validation.existing);
      }
      const now = dependencies.clock.now();
      const existingEmails = await tx.emails.listByAccount(input.accountId);
      const { blobIdByDigest, newBlobs } = await resolveBlobs(
        dependencies,
        tx,
        input,
        prepared,
        existingEmails,
        now,
      );
      for (const { record } of newBlobs) {
        await tx.blobs.insert(record);
      }

      const thread = await decideThread(dependencies, tx, input, parsed, now);
      const aggregateChanges: PendingMailChange[] = [];
      for (const moved of thread.movedEmails) {
        aggregateChanges.push(
          ...(await applyEmailAggregateDelta(tx, {
            accountId: input.accountId,
            before: moved.before,
            after: moved.after,
            now,
          })),
        );
      }
      for (const threadId of thread.destroyedThreadIds) {
        await tx.threads.delete(input.accountId, threadId);
      }
      const emailId = dependencies.idFactory.next<'Email'>() as EmailId;
      const rawBlobId = blobIdByDigest.get(digestKey(rawBlob!))!;
      const stored = await tx.emails.insert({
        id: emailId,
        accountId: input.accountId,
        identityId: null,
        threadId: thread.threadId,
        blobId: rawBlobId,
        messageId: parsed.messageId,
        replyToEmailId: null,
        inReplyTo: parsed.inReplyTo,
        references: parsed.references,
        subject: parsed.subject,
        preview: previewFrom(parsed),
        sentAt: parsed.sentAt,
        receivedAt: input.receivedAt,
        sizeBytes: BigInt(raw.byteLength),
        hasAttachment: parsed.hasAttachment,
        lifecycle: 'received',
        draftRevision: 0,
        createdAt: now,
        updatedAt: now,
        destroyedAt: null,
        sender: parsed.sender,
        from: parsed.from,
        replyTo: parsed.replyTo,
        to: parsed.to,
        cc: parsed.cc,
        bcc: parsed.bcc,
        textBlobId: textBlob === null ? null : blobIdByDigest.get(digestKey(textBlob))!,
        htmlBlobId: htmlBlob === null ? null : blobIdByDigest.get(digestKey(htmlBlob))!,
        parserVersion: 1,
        parseWarnings: [],
        parts: buildEmailParts(dependencies, parsed, partBlobs, blobIdByDigest),
        mailboxIds: validation.mailboxIds,
        restoreMailboxIds: [],
        keywords: validation.keywords,
      });
      aggregateChanges.push(
        ...(await applyEmailAggregateDelta(tx, {
          accountId: input.accountId,
          before: null,
          after: stored,
          now,
        })),
      );
      for (const reference of await createThreadReferenceKeys({
        subject: parsed.subject,
        messageIds: parsed.messageId === null ? [] : [parsed.messageId],
      })) {
        await tx.threadReferences.insert({
          accountId: input.accountId,
          normalizedSubjectHash: reference.normalizedSubjectHash,
          messageIdHash: reference.messageIdHash,
          emailId,
          threadId: thread.threadId,
          createdAt: now,
        });
      }
      await tx.emails.publishSearchDocument(
        input.accountId,
        emailId,
        createEmailSearchDocument({
          subject: parsed.subject,
          addresses: [
            ...parsed.sender,
            ...parsed.from,
            ...parsed.replyTo,
            ...parsed.to,
            ...parsed.cc,
            ...parsed.bcc,
          ],
          textBody: parsed.textBody,
          htmlBody: parsed.htmlBody,
        }),
      );
      await tx.emails.linkRemote({
        accountId: input.accountId,
        provider: input.provider,
        remoteEmailId: input.remoteEmailId,
        remoteThreadId: input.remoteThreadId,
        emailId,
        contentFingerprint,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      const propertiesByEntity = (collection: 'mailbox' | 'thread'): Map<string, string[]> => {
        const result = new Map<string, string[]>();
        for (const change of aggregateChanges) {
          if (change.collection !== collection) continue;
          result.set(change.entityId, [
            ...new Set([
              ...(result.get(change.entityId) ?? []),
              ...(change.changedProperties ?? []),
            ]),
          ]);
        }
        return result;
      };
      const threadProperties = propertiesByEntity('thread');
      const mailboxProperties = propertiesByEntity('mailbox');
      const threadChangedProperties = threadProperties.get(thread.threadId) ?? [];
      const retainedThreadChanges = thread.retainedThreadIds.flatMap((threadId) => {
        const changedProperties = threadProperties.get(threadId) ?? [];
        return changedProperties.length === 0 ? [] : [{ threadId, changedProperties }];
      });
      const mailboxChanges = [...mailboxProperties].map(([mailboxId, changedProperties]) => ({
        mailboxId: mailboxId as MailboxId,
        changedProperties,
      }));

      for (const { blobId, prepared: pending, record } of newBlobs) {
        const receipt = await commitPreparedBlob(dependencies.blobStore, pending, record.objectKey);
        committedObjectKeys.push(receipt.objectKey);
        await verifyPreparedBlob(dependencies.blobStore, pending, receipt.objectKey);
        await tx.blobs.update(input.accountId, blobId, {
          status: 'ready',
          readyAt: now,
        });
      }
      await recordImportChanges(
        tx,
        input,
        emailId,
        thread,
        threadChangedProperties,
        retainedThreadChanges,
        mailboxChanges,
        now,
      );
      await tx.notifications.enqueue({
        eventId: dependencies.idFactory.next<'MailNotification'>(),
        messageId: emailId,
        accountId: input.accountId,
        kind: 'received',
        createdAt: now,
      });
      importOperationCompleted = true;
      return { created: true, emailId };
    });

    return result;
  } catch (error) {
    if (!importOperationCompleted) {
      await discardCommittedBlobs(dependencies.blobStore, input.accountId, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, prepared);
  }
}
