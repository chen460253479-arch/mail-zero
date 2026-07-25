import {
  MailCoreError,
  normalizeKeyword,
  type EmailId,
  type Keyword,
  type MailAccountId,
  type MailboxId,
} from '../types';
import type {
  EmailRecord,
  MailboxRecord,
  MailCoreDependencies,
  MailTransaction,
  ThreadRecord,
} from '../store';
import { recordChanges, type PendingMailChange } from '../changes';

export type UpdateEmailInput = {
  accountId: MailAccountId;
  emailId: EmailId;
  addMailboxIds?: MailboxId[];
  removeMailboxIds?: MailboxId[];
  addKeywords?: Keyword[];
  removeKeywords?: Keyword[];
};

export type EmailStateInput = {
  accountId: MailAccountId;
  emailId: EmailId;
};

export type EmailStateResult = EmailRecord & {
  stateVersion: bigint;
};

type NormalizedPatch = {
  addMailboxIds: MailboxId[];
  removeMailboxIds: MailboxId[];
  addKeywords: Keyword[];
  removeKeywords: Keyword[];
};

const sortStrings = <Value extends string>(values: Iterable<Value>): Value[] =>
  [...values].sort((left, right) => left.localeCompare(right));

const normalizeMailboxIds = (mailboxIds: MailboxId[] | undefined): MailboxId[] =>
  sortStrings(new Set(mailboxIds ?? []));

const normalizeKeywords = (keywords: Keyword[] | undefined): Keyword[] =>
  sortStrings(new Set((keywords ?? []).map(normalizeKeyword)));

const intersects = <Value>(left: Value[], right: Value[]): boolean => {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
};

const normalizePatch = (input: UpdateEmailInput): NormalizedPatch => {
  const patch = {
    addMailboxIds: normalizeMailboxIds(input.addMailboxIds),
    removeMailboxIds: normalizeMailboxIds(input.removeMailboxIds),
    addKeywords: normalizeKeywords(input.addKeywords),
    removeKeywords: normalizeKeywords(input.removeKeywords),
  };
  if (
    intersects(patch.addMailboxIds, patch.removeMailboxIds) ||
    intersects(patch.addKeywords, patch.removeKeywords)
  ) {
    throw new MailCoreError('INVALID_PATCH');
  }
  return patch;
};

const currentStateVersion = async (
  tx: MailTransaction,
  accountId: MailAccountId,
): Promise<bigint> => {
  const account = await tx.accounts.findById(accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: accountId });
  }
  return account.stateVersion;
};

const requireEmail = async (tx: MailTransaction, input: EmailStateInput): Promise<EmailRecord> => {
  const email = await tx.emails.findById(input.accountId, input.emailId);
  if (email === null || email.destroyedAt !== null) {
    throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: input.emailId });
  }
  if ((await tx.threads.findById(input.accountId, email.threadId)) === null) {
    throw new MailCoreError('THREAD_NOT_FOUND', { entityId: email.threadId });
  }
  return email;
};

const requireMailboxReferences = async (
  tx: MailTransaction,
  accountId: MailAccountId,
  mailboxIds: MailboxId[],
): Promise<void> => {
  for (const mailboxId of mailboxIds) {
    const mailbox = await tx.mailboxes.findById(accountId, mailboxId);
    if (mailbox !== null && mailbox.deletedAt === null) {
      continue;
    }
    if (await tx.mailboxes.existsOutsideAccount(accountId, mailboxId)) {
      throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', {
        entityId: mailboxId,
      });
    }
    throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
  }
};

const visibleEmails = async (
  tx: MailTransaction,
  accountId: MailAccountId,
): Promise<EmailRecord[]> =>
  (await tx.emails.listByAccount(accountId)).filter(
    ({ destroyedAt, mailboxIds }) => destroyedAt === null && mailboxIds.length > 0,
  );

const isUnread = ({ keywords }: EmailRecord): boolean => !keywords.includes('$seen');

const mailboxCounterProperties = (
  mailbox: MailboxRecord,
  next: Pick<MailboxRecord, 'totalEmails' | 'unreadEmails' | 'totalThreads' | 'unreadThreads'>,
): string[] => [
  ...(mailbox.totalEmails === next.totalEmails ? [] : ['totalEmails']),
  ...(mailbox.unreadEmails === next.unreadEmails ? [] : ['unreadEmails']),
  ...(mailbox.totalThreads === next.totalThreads ? [] : ['totalThreads']),
  ...(mailbox.unreadThreads === next.unreadThreads ? [] : ['unreadThreads']),
];

export async function updateMailboxCounters(
  tx: MailTransaction,
  accountId: MailAccountId,
  now: Date,
): Promise<PendingMailChange[]> {
  const emails = await visibleEmails(tx, accountId);
  const changes: PendingMailChange[] = [];
  for (const mailbox of await tx.mailboxes.listByAccount(accountId)) {
    if (mailbox.deletedAt !== null) {
      continue;
    }
    const mailboxEmails = emails.filter(({ mailboxIds }) => mailboxIds.includes(mailbox.id));
    const unreadEmails = mailboxEmails.filter(isUnread);
    const next = {
      totalEmails: mailboxEmails.length,
      unreadEmails: unreadEmails.length,
      totalThreads: new Set(mailboxEmails.map(({ threadId }) => threadId)).size,
      unreadThreads: new Set(unreadEmails.map(({ threadId }) => threadId)).size,
    };
    const changedProperties = mailboxCounterProperties(mailbox, next);
    if (changedProperties.length === 0) {
      continue;
    }
    await tx.mailboxes.update(accountId, mailbox.id, {
      ...next,
      updatedAt: now,
    });
    changes.push({
      collection: 'mailbox',
      entityId: mailbox.id,
      changeType: 'updated',
      changedProperties,
    });
  }
  return changes;
}

const participantSummaryFrom = (email: Pick<EmailRecord, 'cc' | 'from' | 'to'>): string | null => {
  const participants = Array.from(
    new Set(
      [...email.from, ...email.to, ...email.cc].map(
        ({ email: address, name }) => name?.trim() || address,
      ),
    ),
  );
  return participants.length === 0 ? null : participants.slice(0, 3).join(', ');
};

const threadAggregateProperties = (
  thread: ThreadRecord,
  next: Pick<
    ThreadRecord,
    | 'latestReceivedAt'
    | 'emailCount'
    | 'unreadCount'
    | 'hasAttachment'
    | 'participantSummary'
    | 'preview'
  >,
): string[] => [
  ...(thread.latestReceivedAt.getTime() === next.latestReceivedAt.getTime()
    ? []
    : ['latestReceivedAt']),
  ...(thread.emailCount === next.emailCount ? [] : ['emailCount']),
  ...(thread.unreadCount === next.unreadCount ? [] : ['unreadCount']),
  ...(thread.hasAttachment === next.hasAttachment ? [] : ['hasAttachment']),
  ...(thread.participantSummary === next.participantSummary ? [] : ['participantSummary']),
  ...(thread.preview === next.preview ? [] : ['preview']),
];

export async function updateThreadCounters(
  tx: MailTransaction,
  accountId: MailAccountId,
  threadId: EmailRecord['threadId'],
  now: Date,
): Promise<PendingMailChange | null> {
  const thread = await tx.threads.findById(accountId, threadId);
  if (thread === null) {
    throw new MailCoreError('THREAD_NOT_FOUND', { entityId: threadId });
  }
  const emails = (await tx.emails.listByThread(accountId, threadId)).filter(
    ({ destroyedAt, mailboxIds }) => destroyedAt === null && mailboxIds.length > 0,
  );
  const latest = emails.reduce<EmailRecord | null>(
    (current, email) =>
      current === null ||
      email.receivedAt > current.receivedAt ||
      (email.receivedAt.getTime() === current.receivedAt.getTime() &&
        email.id.localeCompare(current.id) > 0)
        ? email
        : current,
    null,
  );
  const next = {
    latestReceivedAt: latest?.receivedAt ?? thread.latestReceivedAt,
    emailCount: emails.length,
    unreadCount: emails.filter(isUnread).length,
    hasAttachment: emails.some(({ hasAttachment }) => hasAttachment),
    participantSummary: latest === null ? null : participantSummaryFrom(latest),
    preview: latest?.preview ?? null,
  };
  const changedProperties = threadAggregateProperties(thread, next);
  if (changedProperties.length === 0) {
    return null;
  }
  await tx.threads.update(accountId, threadId, {
    ...next,
    updatedAt: now,
  });
  return {
    collection: 'thread',
    entityId: threadId,
    changeType: 'updated',
    changedProperties,
  };
}

const withStateVersion = (email: EmailRecord, stateVersion: bigint): EmailStateResult => ({
  ...email,
  stateVersion,
});

const applyEmailState = async (
  dependencies: MailCoreDependencies,
  input: EmailStateInput,
  derive: (
    tx: MailTransaction,
    email: EmailRecord,
  ) => Promise<{
    mailboxIds: MailboxId[];
    keywords: Keyword[];
    restoreMailboxIds: MailboxId[];
    changedProperties: string[];
  }>,
): Promise<EmailStateResult> => {
  const now = dependencies.clock.now();
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const email = await requireEmail(tx, input);
    const next = await derive(tx, email);
    if (next.mailboxIds.length === 0) {
      throw new MailCoreError('EMAIL_MUST_HAVE_MAILBOX', {
        entityId: input.emailId,
      });
    }
    if (next.changedProperties.length === 0) {
      return withStateVersion(email, await currentStateVersion(tx, input.accountId));
    }

    await tx.emails.update(input.accountId, input.emailId, {
      mailboxIds: next.mailboxIds,
      keywords: next.keywords,
      restoreMailboxIds: next.restoreMailboxIds,
      updatedAt: now,
    });
    const updated = (await tx.emails.findById(input.accountId, input.emailId))!;
    const mailboxChanges = await updateMailboxCounters(tx, input.accountId, now);
    const threadChange = await updateThreadCounters(tx, input.accountId, email.threadId, now);
    const stateVersion = await recordChanges(tx, {
      accountId: input.accountId,
      changes: [
        {
          collection: 'email',
          entityId: email.id,
          changeType: 'updated',
          changedProperties: next.changedProperties,
        },
        ...(threadChange === null ? [] : [threadChange]),
        ...mailboxChanges,
      ],
      createdAt: now,
    });
    return withStateVersion(updated, stateVersion);
  });
};

export async function updateEmail(
  dependencies: MailCoreDependencies,
  input: UpdateEmailInput,
): Promise<EmailStateResult> {
  const patch = normalizePatch(input);
  return applyEmailState(dependencies, input, async (tx, email) => {
    await requireMailboxReferences(tx, input.accountId, [
      ...patch.addMailboxIds,
      ...patch.removeMailboxIds,
    ]);
    const mailboxIds = new Set(email.mailboxIds);
    patch.removeMailboxIds.forEach((id) => mailboxIds.delete(id));
    patch.addMailboxIds.forEach((id) => mailboxIds.add(id));
    const keywords = new Set(email.keywords.map(normalizeKeyword));
    patch.removeKeywords.forEach((keyword) => keywords.delete(keyword));
    patch.addKeywords.forEach((keyword) => keywords.add(keyword));
    const nextMailboxIds = sortStrings(mailboxIds);
    const nextKeywords = sortStrings(keywords);
    const trash = await tx.mailboxes.findByRole(input.accountId, 'trash');
    if (trash === null) {
      throw new MailCoreError('MAILBOX_NOT_FOUND');
    }
    let nextRestoreMailboxIds = sortStrings(email.restoreMailboxIds);
    if (email.mailboxIds.includes(trash.id)) {
      if (nextMailboxIds.includes(trash.id)) {
        const restoreMailboxIds = new Set(email.restoreMailboxIds);
        patch.removeMailboxIds.forEach((id) => restoreMailboxIds.delete(id));
        patch.addMailboxIds
          .filter((id) => id !== trash.id)
          .forEach((id) => restoreMailboxIds.add(id));
        nextRestoreMailboxIds = sortStrings(restoreMailboxIds);
      } else {
        nextRestoreMailboxIds = [];
      }
    }
    const mailboxStateChanged =
      nextMailboxIds.join('\u0000') !== sortStrings(email.mailboxIds).join('\u0000') ||
      nextRestoreMailboxIds.join('\u0000') !== sortStrings(email.restoreMailboxIds).join('\u0000');
    const changedProperties = [
      ...(mailboxStateChanged ? ['mailboxIds'] : []),
      ...(nextKeywords.join('\u0000') === sortStrings(email.keywords).join('\u0000')
        ? []
        : ['keywords']),
    ];
    return {
      mailboxIds: nextMailboxIds,
      keywords: nextKeywords,
      restoreMailboxIds: nextRestoreMailboxIds,
      changedProperties,
    };
  });
}

export async function moveEmailToTrash(
  dependencies: MailCoreDependencies,
  input: EmailStateInput,
): Promise<EmailStateResult> {
  return applyEmailState(dependencies, input, async (tx, email) => {
    const trash = await tx.mailboxes.findByRole(input.accountId, 'trash');
    if (trash === null) {
      throw new MailCoreError('MAILBOX_NOT_FOUND');
    }
    const mailboxIds = new Set<MailboxId>([trash.id]);
    const restoreMailboxIds = new Set<MailboxId>();
    for (const mailboxId of email.mailboxIds) {
      const mailbox = await tx.mailboxes.findById(input.accountId, mailboxId);
      if (mailbox === null || mailbox.deletedAt !== null) {
        throw new MailCoreError('MAILBOX_NOT_FOUND', {
          entityId: mailboxId,
        });
      }
      if (mailbox.role !== 'trash') {
        restoreMailboxIds.add(mailboxId);
      }
      if (
        mailbox.role !== 'inbox' &&
        mailbox.role !== 'archive' &&
        mailbox.role !== 'junk' &&
        mailbox.role !== 'trash'
      ) {
        mailboxIds.add(mailboxId);
      }
    }
    for (const mailboxId of email.restoreMailboxIds) {
      const mailbox = await tx.mailboxes.findById(input.accountId, mailboxId);
      if (mailbox !== null && mailbox.deletedAt === null && mailbox.role !== 'trash') {
        restoreMailboxIds.add(mailboxId);
      }
    }
    const nextMailboxIds = sortStrings(mailboxIds);
    const nextRestoreMailboxIds = sortStrings(restoreMailboxIds);
    const mailboxStateChanged =
      nextMailboxIds.join('\u0000') !== sortStrings(email.mailboxIds).join('\u0000') ||
      nextRestoreMailboxIds.join('\u0000') !== sortStrings(email.restoreMailboxIds).join('\u0000');
    return {
      mailboxIds: nextMailboxIds,
      keywords: email.keywords,
      restoreMailboxIds: nextRestoreMailboxIds,
      changedProperties: mailboxStateChanged ? ['mailboxIds'] : [],
    };
  });
}

export async function restoreEmail(
  dependencies: MailCoreDependencies,
  input: EmailStateInput,
): Promise<EmailStateResult> {
  return applyEmailState(dependencies, input, async (tx, email) => {
    const trash = await tx.mailboxes.findByRole(input.accountId, 'trash');
    if (trash === null) {
      throw new MailCoreError('MAILBOX_NOT_FOUND');
    }
    if (!email.mailboxIds.includes(trash.id)) {
      return {
        mailboxIds: email.mailboxIds,
        keywords: email.keywords,
        restoreMailboxIds: email.restoreMailboxIds,
        changedProperties: [],
      };
    }
    const restoredIds = new Set(email.mailboxIds.filter((mailboxId) => mailboxId !== trash.id));
    for (const mailboxId of email.restoreMailboxIds) {
      const mailbox = await tx.mailboxes.findById(input.accountId, mailboxId);
      if (mailbox !== null && mailbox.deletedAt === null && mailbox.role !== 'trash') {
        restoredIds.add(mailboxId);
      }
    }
    if (restoredIds.size === 0) {
      const inbox = await tx.mailboxes.findByRole(input.accountId, 'inbox');
      if (inbox === null) {
        throw new MailCoreError('MAILBOX_NOT_FOUND');
      }
      restoredIds.add(inbox.id);
    }
    return {
      mailboxIds: sortStrings(restoredIds),
      keywords: email.keywords,
      restoreMailboxIds: [],
      changedProperties: ['mailboxIds'],
    };
  });
}
