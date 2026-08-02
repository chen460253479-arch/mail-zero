import {
  MailCoreError,
  type MailAccountId,
  type MailboxId,
  type MailboxRole,
  type MailCoreErrorCode,
  type ThreadId,
} from '../types';
import {
  applyPreparedEmailStateInTransaction,
  prepareEmailStateReplacementInTransaction,
  type PreparedEmailStateMutation,
} from '../message/update-email';
import { assertState, type MailCoreSetError } from '../changes';
import type { MailCoreDependencies, MailTransaction } from '../store';

export type MoveThreadEmailsInput = {
  accountId: MailAccountId;
  threadIds: ThreadId[];
  destinationMailboxId: MailboxId;
  ifInState?: string;
};

export type MoveThreadEmailsResult = {
  oldState: string;
  newState: string;
  movedThreadIds: ThreadId[];
  failed: Record<string, MailCoreSetError>;
};

const organizationalRoles = new Set<MailboxRole>(['inbox', 'archive', 'junk', 'trash']);

const itemErrorCodes = new Set<MailCoreErrorCode>([
  'INVALID_PATCH',
  'MAILBOX_NOT_FOUND',
  'EMAIL_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'CROSS_ACCOUNT_REFERENCE',
  'EMAIL_MUST_HAVE_MAILBOX',
]);

const asItemError = (error: unknown): MailCoreSetError | null =>
  error instanceof MailCoreError && itemErrorCodes.has(error.code)
    ? { code: error.code, details: error.details }
    : null;

const requireDestination = async (
  tx: MailTransaction,
  accountId: MailAccountId,
  destinationMailboxId: MailboxId,
) => {
  const destination = await tx.mailboxes.findById(accountId, destinationMailboxId);
  if (destination === null || destination.deletedAt !== null) {
    if (await tx.mailboxes.existsOutsideAccount(accountId, destinationMailboxId)) {
      throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: destinationMailboxId });
    }
    throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: destinationMailboxId });
  }
  if (destination.kind === 'label') {
    throw new MailCoreError('INVALID_PATCH', { entityId: destinationMailboxId });
  }
  if (
    destination.kind === 'system' &&
    (destination.role === null || !organizationalRoles.has(destination.role))
  ) {
    throw new MailCoreError('MAILBOX_ROLE_CONFLICT', { entityId: destinationMailboxId });
  }
  return destination;
};

const prepareThreadMove = async (
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: Pick<MoveThreadEmailsInput, 'accountId' | 'destinationMailboxId'> & {
    threadId: ThreadId;
  },
): Promise<PreparedEmailStateMutation[]> => {
  const thread = await tx.threads.findById(input.accountId, input.threadId);
  if (thread === null) {
    if (await tx.threads.existsOutsideAccount(input.accountId, input.threadId)) {
      throw new MailCoreError('CROSS_ACCOUNT_REFERENCE', { entityId: input.threadId });
    }
    throw new MailCoreError('THREAD_NOT_FOUND', { entityId: input.threadId });
  }

  const prepared: PreparedEmailStateMutation[] = [];
  const emails = (await tx.emails.listByThread(input.accountId, input.threadId)).filter(
    (email) => email.destroyedAt === null,
  );
  for (const email of emails) {
    if (email.lifecycle !== 'received') continue;

    const retainedMailboxIds = new Set<MailboxId>();
    let hasOrganizationalMailbox = false;
    for (const mailboxId of email.mailboxIds) {
      const mailbox = await tx.mailboxes.findById(input.accountId, mailboxId);
      if (mailbox === null || mailbox.deletedAt !== null) {
        throw new MailCoreError('MAILBOX_NOT_FOUND', { entityId: mailboxId });
      }
      const isOrganizational =
        mailbox.kind === 'folder' ||
        (mailbox.kind === 'system' &&
          mailbox.role !== null &&
          organizationalRoles.has(mailbox.role));
      if (isOrganizational) {
        hasOrganizationalMailbox = true;
      } else {
        retainedMailboxIds.add(mailbox.id);
      }
    }
    if (!hasOrganizationalMailbox) continue;

    retainedMailboxIds.add(input.destinationMailboxId);
    prepared.push(
      await prepareEmailStateReplacementInTransaction(dependencies, tx, {
        accountId: input.accountId,
        emailId: email.id,
        mailboxIds: [...retainedMailboxIds],
      }),
    );
  }
  return prepared;
};

export async function moveThreadEmails(
  dependencies: MailCoreDependencies,
  input: MoveThreadEmailsInput,
): Promise<MoveThreadEmailsResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    await requireDestination(tx, input.accountId, input.destinationMailboxId);

    const movedThreadIds: ThreadId[] = [];
    const failed: Record<string, MailCoreSetError> = {};
    for (const threadId of [...new Set(input.threadIds)]) {
      try {
        const prepared = await prepareThreadMove(dependencies, tx, {
          accountId: input.accountId,
          threadId,
          destinationMailboxId: input.destinationMailboxId,
        });
        for (const mutation of prepared) {
          await applyPreparedEmailStateInTransaction(tx, mutation);
        }
        if (prepared.some(({ next }) => next.changedProperties.includes('mailboxIds'))) {
          movedThreadIds.push(threadId);
        }
      } catch (error) {
        const mapped = asItemError(error);
        if (mapped === null) throw error;
        failed[threadId] = mapped;
      }
    }

    const account = await tx.accounts.findById(input.accountId);
    if (account === null) throw new MailCoreError('ACCOUNT_NOT_FOUND');
    return {
      oldState,
      newState: account.stateVersion.toString(),
      movedThreadIds,
      failed,
    };
  });
}
