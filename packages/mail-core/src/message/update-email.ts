import {
  MailCoreError,
  normalizeKeyword,
  type EmailId,
  type Keyword,
  type MailAccountId,
  type MailboxId,
} from '../types';
import type { EmailRecord, MailCoreDependencies, MailTransaction } from '../store';
import { applyEmailAggregateDelta } from './email-aggregates';
import { recordChanges } from '../changes';

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

type DerivedEmailState = {
  mailboxIds: MailboxId[];
  keywords: Keyword[];
  restoreMailboxIds: MailboxId[];
  changedProperties: string[];
};

export type PreparedEmailStateMutation = {
  input: EmailStateInput;
  email: EmailRecord;
  next: DerivedEmailState;
  now: Date;
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
    return applyEmailStateInTransaction(tx, input, now, derive);
  });
};

const applyEmailStateInTransaction = async (
  tx: MailTransaction,
  input: EmailStateInput,
  now: Date,
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
  const aggregateChanges = await applyEmailAggregateDelta(tx, {
    accountId: input.accountId,
    before: email,
    after: updated,
    now,
  });
  const stateVersion = await recordChanges(tx, {
    accountId: input.accountId,
    changes: [
      {
        collection: 'email',
        entityId: email.id,
        changeType: 'updated',
        changedProperties: next.changedProperties,
      },
      ...aggregateChanges,
    ],
    createdAt: now,
  });
  return withStateVersion(updated, stateVersion);
};

const deriveEmailState = async (
  tx: MailTransaction,
  input: EmailStateInput,
  email: EmailRecord,
  patch: NormalizedPatch,
): Promise<DerivedEmailState> => {
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
  const drafts = await tx.mailboxes.findByRole(input.accountId, 'drafts');
  if (drafts === null) {
    throw new MailCoreError('MAILBOX_NOT_FOUND');
  }
  const hasDraftKeyword = nextKeywords.includes('$draft');
  const hasDraftMailbox = nextMailboxIds.includes(drafts.id);
  if (
    (email.lifecycle === 'draft' && (!hasDraftKeyword || !hasDraftMailbox)) ||
    (email.lifecycle !== 'draft' && (hasDraftKeyword || hasDraftMailbox))
  ) {
    throw new MailCoreError('INVALID_PATCH', { entityId: email.id });
  }
  const trash = await tx.mailboxes.findByRole(input.accountId, 'trash');
  if (trash === null) {
    throw new MailCoreError('MAILBOX_NOT_FOUND');
  }
  let nextRestoreMailboxIds = sortStrings(email.restoreMailboxIds);
  if (!email.mailboxIds.includes(trash.id) && nextMailboxIds.includes(trash.id)) {
    nextRestoreMailboxIds = sortStrings(
      email.mailboxIds.filter((mailboxId) => mailboxId !== trash.id),
    );
  } else if (email.mailboxIds.includes(trash.id)) {
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
  if (nextMailboxIds.length === 0) {
    throw new MailCoreError('EMAIL_MUST_HAVE_MAILBOX', {
      entityId: input.emailId,
    });
  }
  const mailboxStateChanged =
    nextMailboxIds.join('\u0000') !== sortStrings(email.mailboxIds).join('\u0000') ||
    nextRestoreMailboxIds.join('\u0000') !== sortStrings(email.restoreMailboxIds).join('\u0000');
  return {
    mailboxIds: nextMailboxIds,
    keywords: nextKeywords,
    restoreMailboxIds: nextRestoreMailboxIds,
    changedProperties: [
      ...(mailboxStateChanged ? ['mailboxIds'] : []),
      ...(nextKeywords.join('\u0000') === sortStrings(email.keywords).join('\u0000')
        ? []
        : ['keywords']),
    ],
  };
};

export async function applyPreparedEmailStateInTransaction(
  tx: MailTransaction,
  prepared: PreparedEmailStateMutation,
): Promise<EmailStateResult> {
  const { input, email, next, now } = prepared;
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
  const aggregateChanges = await applyEmailAggregateDelta(tx, {
    accountId: input.accountId,
    before: email,
    after: updated,
    now,
  });
  const stateVersion = await recordChanges(tx, {
    accountId: input.accountId,
    changes: [
      {
        collection: 'email',
        entityId: email.id,
        changeType: 'updated',
        changedProperties: next.changedProperties,
      },
      ...aggregateChanges,
    ],
    createdAt: now,
  });
  return withStateVersion(updated, stateVersion);
}

export async function updateEmail(
  dependencies: MailCoreDependencies,
  input: UpdateEmailInput,
): Promise<EmailStateResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return updateEmailInTransaction(dependencies, tx, input);
  });
}

export async function updateEmailInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: UpdateEmailInput,
): Promise<EmailStateResult> {
  const patch = normalizePatch(input);
  const email = await requireEmail(tx, input);
  const next = await deriveEmailState(tx, input, email, patch);
  return applyPreparedEmailStateInTransaction(tx, {
    input,
    email,
    next,
    now: dependencies.clock.now(),
  });
}

export async function prepareEmailStateReplacementInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: EmailStateInput & {
    mailboxIds?: MailboxId[];
    keywords?: Keyword[];
  },
): Promise<PreparedEmailStateMutation> {
  const email = await requireEmail(tx, input);
  const requestedMailboxIds =
    input.mailboxIds === undefined ? email.mailboxIds : normalizeMailboxIds(input.mailboxIds);
  const requestedKeywords =
    input.keywords === undefined ? email.keywords : normalizeKeywords(input.keywords);
  const patchInput: UpdateEmailInput = {
    accountId: input.accountId,
    emailId: input.emailId,
    addMailboxIds: requestedMailboxIds.filter((id) => !email.mailboxIds.includes(id)),
    removeMailboxIds: email.mailboxIds.filter((id) => !requestedMailboxIds.includes(id)),
    addKeywords: requestedKeywords.filter((keyword) => !email.keywords.includes(keyword)),
    removeKeywords: email.keywords.filter((keyword) => !requestedKeywords.includes(keyword)),
  };
  const next = await deriveEmailState(tx, input, email, normalizePatch(patchInput));
  return {
    input,
    email,
    next,
    now: dependencies.clock.now(),
  };
}

export async function replaceEmailStateInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: EmailStateInput & {
    mailboxIds?: MailboxId[];
    keywords?: Keyword[];
  },
): Promise<EmailStateResult> {
  return applyPreparedEmailStateInTransaction(
    tx,
    await prepareEmailStateReplacementInTransaction(dependencies, tx, input),
  );
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
