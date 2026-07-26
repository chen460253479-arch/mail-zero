import { MailCoreError, type MailboxId, type MailCoreErrorCode } from '../types';
import type { CreateMailboxData, UpdateMailboxPatch } from './types';
import type { MailboxRecord, MailCoreDependencies } from '../store';
import { destroyMailboxInTransaction } from './destroy-mailbox';
import { assertState, type MailCoreSetError } from '../changes';
import { updateMailboxInTransaction } from './update-mailbox';
import { createMailboxInTransaction } from './create-mailbox';

export type { MailCoreSetError } from '../changes';

export type SetMailboxesInput = {
  accountId: MailboxRecord['accountId'];
  ifInState?: string;
  create: Record<string, CreateMailboxData>;
  update: Record<string, UpdateMailboxPatch>;
  destroy: MailboxId[];
};

export type SetMailboxesResult = {
  oldState: string;
  newState: string;
  created: Record<string, MailboxRecord>;
  updated: Record<string, MailboxRecord>;
  destroyed: string[];
  notCreated: Record<string, MailCoreSetError>;
  notUpdated: Record<string, MailCoreSetError>;
  notDestroyed: Record<string, MailCoreSetError>;
};

const itemErrorCodes = new Set<MailCoreErrorCode>([
  'INVALID_PATCH',
  'MAILBOX_NOT_FOUND',
  'MAILBOX_ROLE_CONFLICT',
  'MAILBOX_NAME_CONFLICT',
  'CROSS_ACCOUNT_REFERENCE',
  'MAILBOX_HAS_CHILD',
  'MAILBOX_HAS_EMAIL',
  'MAILBOX_PARENT_CYCLE',
]);

const asItemError = (error: unknown): MailCoreSetError | null =>
  error instanceof MailCoreError && itemErrorCodes.has(error.code)
    ? { code: error.code, details: error.details }
    : null;

export async function setMailboxes(
  dependencies: MailCoreDependencies,
  input: SetMailboxesInput,
): Promise<SetMailboxesResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    const created: Record<string, MailboxRecord> = {};
    const updated: Record<string, MailboxRecord> = {};
    const destroyed: string[] = [];
    const notCreated: Record<string, MailCoreSetError> = {};
    const notUpdated: Record<string, MailCoreSetError> = {};
    const notDestroyed: Record<string, MailCoreSetError> = {};

    for (const [creationId, data] of Object.entries(input.create)) {
      try {
        created[creationId] = await createMailboxInTransaction(dependencies, tx, {
          accountId: input.accountId,
          ...data,
        });
      } catch (error) {
        const itemError = asItemError(error);
        if (itemError === null) {
          throw error;
        }
        notCreated[creationId] = itemError;
      }
    }

    for (const [mailboxId, patch] of Object.entries(input.update)) {
      try {
        updated[mailboxId] = await updateMailboxInTransaction(dependencies, tx, {
          accountId: input.accountId,
          mailboxId: mailboxId as MailboxId,
          ...patch,
        });
      } catch (error) {
        const itemError = asItemError(error);
        if (itemError === null) {
          throw error;
        }
        notUpdated[mailboxId] = itemError;
      }
    }

    for (const mailboxId of input.destroy) {
      try {
        await destroyMailboxInTransaction(dependencies, tx, {
          accountId: input.accountId,
          mailboxId,
        });
        destroyed.push(mailboxId);
      } catch (error) {
        const itemError = asItemError(error);
        if (itemError === null) {
          throw error;
        }
        notDestroyed[mailboxId] = itemError;
      }
    }

    const account = await tx.accounts.findById(input.accountId);
    if (account === null) {
      throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
    }
    return {
      oldState,
      newState: account.stateVersion.toString(),
      created,
      updated,
      destroyed,
      notCreated,
      notUpdated,
      notDestroyed,
    };
  });
}
