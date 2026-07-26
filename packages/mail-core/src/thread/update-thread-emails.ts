import {
  MailCoreError,
  normalizeKeyword,
  type Keyword,
  type MailAccountId,
  type MailboxId,
  type MailCoreErrorCode,
  type ThreadId,
} from '../types';
import {
  applyPreparedEmailStateInTransaction,
  prepareEmailStateReplacementInTransaction,
} from '../message/update-email';
import { assertState, type MailCoreSetError } from '../changes';
import type { MailCoreDependencies } from '../store';

export type UpdateThreadEmailsInput = {
  accountId: MailAccountId;
  threadIds: ThreadId[];
  ifInState?: string;
  addMailboxIds: MailboxId[];
  removeMailboxIds: MailboxId[];
  addKeywords: Keyword[];
  removeKeywords: Keyword[];
};

export type UpdateThreadEmailsResult = {
  oldState: string;
  newState: string;
  updatedThreadIds: ThreadId[];
  failed: Record<string, MailCoreSetError>;
};

const itemErrorCodes = new Set<MailCoreErrorCode>([
  'INVALID_KEYWORD',
  'INVALID_PATCH',
  'MAILBOX_NOT_FOUND',
  'EMAIL_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'CROSS_ACCOUNT_REFERENCE',
  'EMAIL_MUST_HAVE_MAILBOX',
]);

const itemError = (error: unknown): MailCoreSetError | null =>
  error instanceof MailCoreError && itemErrorCodes.has(error.code)
    ? { code: error.code, details: error.details }
    : null;

export async function updateThreadEmails(
  dependencies: MailCoreDependencies,
  input: UpdateThreadEmailsInput,
): Promise<UpdateThreadEmailsResult> {
  const normalizedAdds = input.addKeywords.map(normalizeKeyword);
  const normalizedRemoves = input.removeKeywords.map(normalizeKeyword);
  if (
    input.addMailboxIds.some((id) => input.removeMailboxIds.includes(id)) ||
    normalizedAdds.some((keyword) => normalizedRemoves.includes(keyword))
  ) {
    throw new MailCoreError('INVALID_PATCH');
  }
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    const updatedThreadIds: ThreadId[] = [];
    const failed: Record<string, MailCoreSetError> = {};
    for (const threadId of [...new Set(input.threadIds)]) {
      try {
        const thread = await tx.threads.findById(input.accountId, threadId);
        if (thread === null) {
          if (await tx.threads.existsOutsideAccount(input.accountId, threadId)) {
            throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: threadId });
          }
          throw new MailCoreError('THREAD_NOT_FOUND', { entityId: threadId });
        }
        const emails = (await tx.emails.listByThread(input.accountId, threadId)).filter(
          (email) => email.destroyedAt === null,
        );
        const prepared = [];
        for (const email of emails) {
          const mailboxIds = new Set(email.mailboxIds);
          input.removeMailboxIds.forEach((id) => mailboxIds.delete(id));
          input.addMailboxIds.forEach((id) => mailboxIds.add(id));
          const keywords = new Set(email.keywords.map(normalizeKeyword));
          input.removeKeywords.map(normalizeKeyword).forEach((value) => keywords.delete(value));
          input.addKeywords.map(normalizeKeyword).forEach((value) => keywords.add(value));
          prepared.push(
            await prepareEmailStateReplacementInTransaction(dependencies, tx, {
              accountId: input.accountId,
              emailId: email.id,
              mailboxIds: [...mailboxIds],
              keywords: [...keywords],
            }),
          );
        }
        for (const mutation of prepared) {
          await applyPreparedEmailStateInTransaction(tx, mutation);
        }
        updatedThreadIds.push(threadId);
      } catch (error) {
        const mapped = itemError(error);
        if (mapped === null) throw error;
        failed[threadId] = mapped;
      }
    }
    const account = await tx.accounts.findById(input.accountId);
    if (account === null) throw new MailCoreError('ACCOUNT_NOT_FOUND');
    return {
      oldState,
      newState: account.stateVersion.toString(),
      updatedThreadIds,
      failed,
    };
  });
}
