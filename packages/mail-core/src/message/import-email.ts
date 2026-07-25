import {
  calculateSha256,
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
import { calculateThreadDecision, normalizeMessageId, normalizeSubject } from '../thread';
import type { ImportEmailInput, ImportEmailResult, ParsedEmail } from './types';
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

const currentReferencedBlobBytes = async (
  tx: MailTransaction,
  accountId: ImportEmailInput['accountId'],
  emails: EmailRecord[],
): Promise<bigint> => {
  let total = 0n;
  for (const blobId of referencedBlobIds(emails)) {
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
  const existingReferencedIds = referencedBlobIds(existingEmails);
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
        objectKey: `mail/${input.accountId}/blobs/${blobId}`,
        status: 'pending',
        createdAt: now,
        readyAt: null,
        deletedAt: null,
      },
    });
  }

  const existingBytes = await currentReferencedBlobBytes(tx, input.accountId, existingEmails);
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

const isUnread = (email: Pick<EmailRecord, 'keywords'>): boolean =>
  !email.keywords.includes('$seen');

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
  existingEmails: EmailRecord[],
  now: Date,
): Promise<{
  threadId: ThreadId;
  changeType: 'created' | 'updated';
  destroyedThreadIds: ThreadId[];
  movedEmailIds: EmailId[];
}> => {
  const normalizedSubject = normalizeSubject(parsed.subject);
  const referenceIds = Array.from(
    new Set([...parsed.inReplyTo, ...parsed.references].map(normalizeMessageId)),
  );
  const referenceIdSet = new Set(referenceIds);
  const threads = await tx.threads.listByAccount(input.accountId);
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const candidates = existingEmails.flatMap((email) => {
    if (email.messageId === null) {
      return [];
    }
    const messageId = normalizeMessageId(email.messageId);
    const thread = threadById.get(email.threadId);
    return thread === undefined || !referenceIdSet.has(messageId)
      ? []
      : [
          {
            threadId: email.threadId,
            normalizedSubject: thread.normalizedSubject,
            matchedReference: messageId,
          },
        ];
  });
  const decision = calculateThreadDecision({
    normalizedSubject,
    referenceIds,
    candidates,
  });

  if (decision.type === 'create') {
    const threadId = dependencies.idFactory.next<'Thread'>() as ThreadId;
    await tx.threads.insert(buildThreadRecord(threadId, input, parsed, now));
    return {
      threadId,
      changeType: 'created',
      destroyedThreadIds: [],
      movedEmailIds: [],
    };
  }

  if (decision.type === 'use') {
    return {
      threadId: decision.threadId,
      changeType: 'updated',
      destroyedThreadIds: [],
      movedEmailIds: [],
    };
  }

  const movedEmailIds: EmailId[] = [];
  for (const loserThreadId of decision.loserThreadIds) {
    for (const email of existingEmails.filter(({ threadId }) => threadId === loserThreadId)) {
      await tx.emails.update(input.accountId, email.id, {
        threadId: decision.winnerThreadId,
        updatedAt: now,
      });
      movedEmailIds.push(email.id);
    }
    await tx.threads.delete(input.accountId, loserThreadId);
  }
  return {
    threadId: decision.winnerThreadId,
    changeType: 'updated',
    destroyedThreadIds: decision.loserThreadIds,
    movedEmailIds,
  };
};

const updateThreadAggregate = async (
  tx: MailTransaction,
  input: ImportEmailInput,
  threadId: ThreadId,
  now: Date,
): Promise<void> => {
  const emails = (await tx.emails.listByThread(input.accountId, threadId)).filter(
    ({ destroyedAt, mailboxIds }) => destroyedAt === null && mailboxIds.length > 0,
  );
  const latest = emails.reduce((current, email) =>
    email.receivedAt > current.receivedAt ? email : current,
  );
  await tx.threads.update(input.accountId, threadId, {
    latestReceivedAt: latest.receivedAt,
    emailCount: emails.length,
    unreadCount: emails.filter(isUnread).length,
    hasAttachment: emails.some(({ hasAttachment }) => hasAttachment),
    participantSummary:
      participantSummaryFrom({
        from: latest.from,
        to: latest.to,
        cc: latest.cc,
      }) ?? null,
    preview: latest.preview,
    updatedAt: now,
  });
};

const updateMailboxAggregates = async (
  tx: MailTransaction,
  input: ImportEmailInput,
  now: Date,
): Promise<MailboxId[]> => {
  const changedMailboxIds: MailboxId[] = [];
  const emails = await tx.emails.listByAccount(input.accountId);
  for (const mailbox of await tx.mailboxes.listByAccount(input.accountId)) {
    const mailboxEmails = emails.filter(({ mailboxIds }) => mailboxIds.includes(mailbox.id));
    const totalEmails = mailboxEmails.length;
    const unreadEmails = mailboxEmails.filter(isUnread).length;
    const totalThreads = new Set(mailboxEmails.map(({ threadId }) => threadId)).size;
    const unreadThreads = new Set(mailboxEmails.filter(isUnread).map(({ threadId }) => threadId))
      .size;
    if (
      mailbox.totalEmails === totalEmails &&
      mailbox.unreadEmails === unreadEmails &&
      mailbox.totalThreads === totalThreads &&
      mailbox.unreadThreads === unreadThreads
    ) {
      continue;
    }
    await tx.mailboxes.update(input.accountId, mailbox.id, {
      totalEmails,
      unreadEmails,
      totalThreads,
      unreadThreads,
      updatedAt: now,
    });
    changedMailboxIds.push(mailbox.id);
  }
  return changedMailboxIds;
};

const buildEmailParts = (
  dependencies: MailCoreDependencies,
  parsed: ParsedEmail,
  attachmentBlobs: PreparedBlob[],
  blobIdByDigest: Map<string, BlobId>,
): EmailPartRecord[] =>
  parsed.attachments.map((attachment, index) => ({
    id: dependencies.idFactory.next<'EmailPart'>(),
    parentPartId: null,
    partPath: (index + 1).toString(),
    contentType: attachment.contentType,
    charset: null,
    disposition: attachment.disposition,
    filename: attachment.filename,
    contentId: attachment.contentId,
    blobId: blobIdByDigest.get(digestKey(attachmentBlobs[index]!))!,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
  }));

const recordImportChanges = async (
  tx: MailTransaction,
  input: ImportEmailInput,
  emailId: EmailId,
  thread: {
    threadId: ThreadId;
    changeType: 'created' | 'updated';
    destroyedThreadIds: ThreadId[];
    movedEmailIds: EmailId[];
  },
  mailboxIds: MailboxId[],
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
    changedProperties:
      thread.changeType === 'created'
        ? null
        : [
            'latestReceivedAt',
            'emailCount',
            'unreadCount',
            'hasAttachment',
            'participantSummary',
            'preview',
          ],
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
  for (const mailboxId of mailboxIds) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'mailbox',
      entityId: mailboxId,
      changeType: 'updated',
      changedProperties: ['totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads'],
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
  const attachmentBlobs: PreparedBlob[] = [];
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
    for (const attachment of parsed.attachments) {
      const attachmentBlob = await prepareBlob(dependencies.blobStore, {
        accountId: input.accountId,
        bytes: attachment.bytes,
        contentType: attachment.contentType,
      });
      prepared.push(attachmentBlob);
      attachmentBlobs.push(attachmentBlob);
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

      const thread = await decideThread(dependencies, tx, input, parsed, existingEmails, now);
      const emailId = dependencies.idFactory.next<'Email'>() as EmailId;
      const rawBlobId = blobIdByDigest.get(digestKey(rawBlob!))!;
      await tx.emails.insert({
        id: emailId,
        accountId: input.accountId,
        threadId: thread.threadId,
        blobId: rawBlobId,
        messageId: parsed.messageId,
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
        parts: buildEmailParts(dependencies, parsed, attachmentBlobs, blobIdByDigest),
        mailboxIds: validation.mailboxIds,
        restoreMailboxIds: [],
        keywords: validation.keywords,
      });
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
      await updateThreadAggregate(tx, input, thread.threadId, now);
      const changedMailboxIds = await updateMailboxAggregates(tx, input, now);

      for (const { blobId, prepared: pending, record } of newBlobs) {
        const receipt = await commitPreparedBlob(dependencies.blobStore, pending, record.objectKey);
        committedObjectKeys.push(receipt.objectKey);
        await verifyPreparedBlob(dependencies.blobStore, pending, receipt.objectKey);
        await tx.blobs.update(input.accountId, blobId, {
          status: 'ready',
          readyAt: now,
        });
      }
      await recordImportChanges(tx, input, emailId, thread, changedMailboxIds, now);
      importOperationCompleted = true;
      return { created: true, emailId };
    });

    return result;
  } catch (error) {
    if (!importOperationCompleted) {
      await discardCommittedBlobs(dependencies.blobStore, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, prepared);
  }
}
