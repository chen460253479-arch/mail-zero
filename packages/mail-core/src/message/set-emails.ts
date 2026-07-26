import {
  applyPreparedEmailStateInTransaction,
  prepareEmailStateReplacementInTransaction,
  updateEmailInTransaction,
  type PreparedEmailStateMutation,
} from './update-email';
import {
  prepareDraftUpdate,
  updateDraftInTransaction,
  validateDraftUpdateInTransaction,
  type PreparedDraftUpdate,
} from './update-draft';
import {
  createDraftInTransaction,
  prepareDraftCreate,
  validateDraftCreateInTransaction,
  type PreparedDraftCreate,
} from './create-draft';
import {
  MailCoreError,
  type EmailId,
  type Keyword,
  type MailAccountId,
  type MailboxId,
  type MailCoreErrorCode,
} from '../types';
import { discardCommittedBlobs, discardTemporaryBlobs } from '../blob/blob-lifecycle';
import type { EmailRecord, MailCoreDependencies } from '../store';
import { assertState, type MailCoreSetError } from '../changes';
import type { DraftContent, DraftResult } from './draft-types';
import { destroyEmailInTransaction } from './destroy-email';

export type EmailSetPatch = {
  mailboxIds?: MailboxId[];
  keywords?: Keyword[];
  addMailboxIds?: MailboxId[];
  removeMailboxIds?: MailboxId[];
  addKeywords?: Keyword[];
  removeKeywords?: Keyword[];
  content?: DraftContent;
  ifDraftRevision?: number;
};

export type SetEmailsInput = {
  accountId: MailAccountId;
  ifInState?: string;
  create: Record<string, DraftContent>;
  update: Record<EmailId, EmailSetPatch>;
  destroy: EmailId[];
};

export type SetEmailsResult = {
  oldState: string;
  newState: string;
  created: Record<string, EmailRecord>;
  updated: Record<string, EmailRecord>;
  destroyed: EmailId[];
  notCreated: Record<string, MailCoreSetError>;
  notUpdated: Record<string, MailCoreSetError>;
  notDestroyed: Record<string, MailCoreSetError>;
};

const itemErrorCodes = new Set<MailCoreErrorCode>([
  'INVALID_EMAIL',
  'INVALID_PATCH',
  'MAILBOX_NOT_FOUND',
  'EMAIL_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'BLOB_NOT_FOUND',
  'IDENTITY_NOT_FOUND',
  'CROSS_ACCOUNT_REFERENCE',
  'EMAIL_MUST_HAVE_MAILBOX',
  'DRAFT_REVISION_CONFLICT',
  'EMAIL_CONTENT_IMMUTABLE',
  'OVER_QUOTA',
]);

const asItemError = (error: unknown): MailCoreSetError | null =>
  error instanceof MailCoreError && itemErrorCodes.has(error.code)
    ? { code: error.code, details: error.details }
    : null;

const withoutStateVersion = (result: DraftResult): EmailRecord => {
  const { stateVersion: _stateVersion, ...email } = result;
  return email;
};

const hasMetadataPatch = (patch: EmailSetPatch): boolean =>
  patch.mailboxIds !== undefined ||
  patch.keywords !== undefined ||
  patch.addMailboxIds !== undefined ||
  patch.removeMailboxIds !== undefined ||
  patch.addKeywords !== undefined ||
  patch.removeKeywords !== undefined;

const validateDraftPatch = (emailId: EmailId, patch: EmailSetPatch): void => {
  if (
    (patch.content === undefined && patch.ifDraftRevision !== undefined) ||
    (patch.content !== undefined && patch.ifDraftRevision === undefined)
  ) {
    throw new MailCoreError('INVALID_PATCH', { entityId: emailId });
  }
  if (
    (patch.mailboxIds !== undefined &&
      (patch.addMailboxIds !== undefined || patch.removeMailboxIds !== undefined)) ||
    (patch.keywords !== undefined &&
      (patch.addKeywords !== undefined || patch.removeKeywords !== undefined))
  ) {
    throw new MailCoreError('INVALID_PATCH', { entityId: emailId });
  }
};

export async function setEmails(
  dependencies: MailCoreDependencies,
  input: SetEmailsInput,
): Promise<SetEmailsResult> {
  if (input.ifInState !== undefined) {
    await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      await assertState(tx, input.accountId, input.ifInState);
    });
  }

  const preparedCreates = new Map<string, PreparedDraftCreate>();
  const preparedUpdates = new Map<EmailId, PreparedDraftUpdate>();
  const preparationNotCreated: Record<string, MailCoreSetError> = {};
  const preparationNotUpdated: Record<string, MailCoreSetError> = {};

  for (const [creationId, content] of Object.entries(input.create)) {
    try {
      preparedCreates.set(
        creationId,
        await prepareDraftCreate(dependencies, {
          accountId: input.accountId,
          ...content,
        }),
      );
    } catch (error) {
      const itemError = asItemError(error);
      if (itemError === null) throw error;
      preparationNotCreated[creationId] = itemError;
    }
  }

  for (const [rawEmailId, patch] of Object.entries(input.update)) {
    const emailId = rawEmailId as EmailId;
    try {
      validateDraftPatch(emailId, patch);
      if (patch.content !== undefined && patch.ifDraftRevision !== undefined) {
        preparedUpdates.set(
          emailId,
          await prepareDraftUpdate(dependencies, {
            accountId: input.accountId,
            emailId,
            expectedRevision: patch.ifDraftRevision,
            content: patch.content,
          }),
        );
      }
    } catch (error) {
      const itemError = asItemError(error);
      if (itemError === null) throw error;
      preparationNotUpdated[emailId] = itemError;
    }
  }

  const allPrepared = [
    ...[...preparedCreates.values()].flatMap(({ prepared }) => prepared.all),
    ...[...preparedUpdates.values()].flatMap(({ prepared }) => prepared.all),
  ];
  const committedObjectKeys: string[] = [];
  let operationCompleted = false;

  try {
    return await dependencies.unitOfWork.run(async (tx) => {
      await tx.lockAccount(input.accountId);
      const oldState = await assertState(tx, input.accountId, input.ifInState);
      const created: Record<string, EmailRecord> = {};
      const updated: Record<string, EmailRecord> = {};
      const destroyed: EmailId[] = [];
      const notCreated = { ...preparationNotCreated };
      const notUpdated = { ...preparationNotUpdated };
      const notDestroyed: Record<string, MailCoreSetError> = {};

      for (const [creationId, prepared] of preparedCreates) {
        try {
          const validated = await validateDraftCreateInTransaction(dependencies, tx, prepared);
          created[creationId] = withoutStateVersion(
            await createDraftInTransaction(
              dependencies,
              tx,
              prepared,
              committedObjectKeys,
              validated,
            ),
          );
        } catch (error) {
          const itemError = asItemError(error);
          if (itemError === null) throw error;
          notCreated[creationId] = itemError;
        }
      }

      for (const [rawEmailId, patch] of Object.entries(input.update)) {
        const emailId = rawEmailId as EmailId;
        if (notUpdated[emailId] !== undefined) continue;
        try {
          const usesReplacement = patch.mailboxIds !== undefined || patch.keywords !== undefined;
          const preparedMetadata: PreparedEmailStateMutation | null =
            hasMetadataPatch(patch) && usesReplacement
              ? await prepareEmailStateReplacementInTransaction(dependencies, tx, {
                  accountId: input.accountId,
                  emailId,
                  mailboxIds: patch.mailboxIds,
                  keywords: patch.keywords,
                })
              : null;
          const preparedDraft = preparedUpdates.get(emailId);
          const validatedDraft =
            preparedDraft === undefined
              ? null
              : await validateDraftUpdateInTransaction(dependencies, tx, preparedDraft);

          let current: EmailRecord | null = null;
          if (preparedDraft !== undefined && validatedDraft !== null) {
            current = withoutStateVersion(
              await updateDraftInTransaction(
                dependencies,
                tx,
                preparedDraft,
                committedObjectKeys,
                validatedDraft,
              ),
            );
          }
          if (preparedMetadata !== null) {
            current = withoutStateVersion(
              await applyPreparedEmailStateInTransaction(tx, {
                ...preparedMetadata,
                email: current ?? preparedMetadata.email,
              }),
            );
          } else if (hasMetadataPatch(patch)) {
            current = withoutStateVersion(
              await updateEmailInTransaction(dependencies, tx, {
                accountId: input.accountId,
                emailId,
                addMailboxIds: patch.addMailboxIds,
                removeMailboxIds: patch.removeMailboxIds,
                addKeywords: patch.addKeywords,
                removeKeywords: patch.removeKeywords,
              }),
            );
          }
          if (current === null) {
            const email = await tx.emails.findById(input.accountId, emailId);
            if (email === null || email.destroyedAt !== null) {
              throw new MailCoreError('EMAIL_NOT_FOUND', { entityId: emailId });
            }
            current = email;
          }
          updated[emailId] = current;
        } catch (error) {
          const itemError = asItemError(error);
          if (itemError === null) throw error;
          notUpdated[emailId] = itemError;
        }
      }

      for (const emailId of input.destroy) {
        try {
          await destroyEmailInTransaction(dependencies, tx, {
            accountId: input.accountId,
            emailId,
          });
          destroyed.push(emailId);
        } catch (error) {
          const itemError = asItemError(error);
          if (itemError === null) throw error;
          notDestroyed[emailId] = itemError;
        }
      }

      const account = await tx.accounts.findById(input.accountId);
      if (account === null) {
        throw new MailCoreError('ACCOUNT_NOT_FOUND', { entityId: input.accountId });
      }
      operationCompleted = true;
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
  } catch (error) {
    if (!operationCompleted) {
      await discardCommittedBlobs(dependencies.blobStore, input.accountId, committedObjectKeys);
    }
    throw error;
  } finally {
    await discardTemporaryBlobs(dependencies.blobStore, allPrepared);
  }
}
