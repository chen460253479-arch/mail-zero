import {
  createIdentityInTransaction,
  destroyIdentityInTransaction,
  updateIdentityInTransaction,
} from './manage-identity';
import {
  MailCoreError,
  type IdentityId,
  type MailAccountId,
  type MailCoreErrorCode,
} from '../types';
import type { CreateIdentityInput, UpdateIdentityInput } from './types';
import type { IdentityRecord, MailCoreDependencies } from '../store';
import { assertState, type MailCoreSetError } from '../changes';

export type CreateIdentityData = Omit<CreateIdentityInput, 'accountId'>;
export type UpdateIdentityPatch = Omit<UpdateIdentityInput, 'accountId' | 'identityId'>;

export type SetIdentitiesInput = {
  accountId: MailAccountId;
  ifInState?: string;
  create: Record<string, CreateIdentityData>;
  update: Record<IdentityId, UpdateIdentityPatch>;
  destroy: IdentityId[];
};

export type SetIdentitiesResult = {
  oldState: string;
  newState: string;
  created: Record<string, IdentityRecord>;
  updated: Record<string, IdentityRecord>;
  destroyed: IdentityId[];
  notCreated: Record<string, MailCoreSetError>;
  notUpdated: Record<string, MailCoreSetError>;
  notDestroyed: Record<string, MailCoreSetError>;
};

const itemErrorCodes = new Set<MailCoreErrorCode>([
  'INVALID_EMAIL',
  'IDENTITY_NOT_FOUND',
  'IDENTITY_DEFAULT_CONFLICT',
  'IDENTITY_IN_USE',
]);

const asItemError = (error: unknown): MailCoreSetError | null =>
  error instanceof MailCoreError && itemErrorCodes.has(error.code)
    ? { code: error.code, details: error.details }
    : null;

export async function setIdentities(
  dependencies: MailCoreDependencies,
  input: SetIdentitiesInput,
): Promise<SetIdentitiesResult> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    const oldState = await assertState(tx, input.accountId, input.ifInState);
    const created: Record<string, IdentityRecord> = {};
    const updated: Record<string, IdentityRecord> = {};
    const destroyed: IdentityId[] = [];
    const notCreated: Record<string, MailCoreSetError> = {};
    const notUpdated: Record<string, MailCoreSetError> = {};
    const notDestroyed: Record<string, MailCoreSetError> = {};
    let defaultClaimed = false;

    for (const [creationId, data] of Object.entries(input.create)) {
      try {
        if (data.makeDefault && defaultClaimed) {
          throw new MailCoreError('IDENTITY_DEFAULT_CONFLICT');
        }
        created[creationId] = await createIdentityInTransaction(dependencies, tx, {
          accountId: input.accountId,
          ...data,
        });
        if (data.makeDefault) defaultClaimed = true;
      } catch (error) {
        const itemError = asItemError(error);
        if (itemError === null) throw error;
        notCreated[creationId] = itemError;
      }
    }

    for (const [rawIdentityId, patch] of Object.entries(input.update)) {
      const identityId = rawIdentityId as IdentityId;
      try {
        if (patch.makeDefault && defaultClaimed) {
          throw new MailCoreError('IDENTITY_DEFAULT_CONFLICT', { entityId: identityId });
        }
        updated[identityId] = await updateIdentityInTransaction(dependencies, tx, {
          accountId: input.accountId,
          identityId,
          ...patch,
        });
        if (patch.makeDefault) defaultClaimed = true;
      } catch (error) {
        const itemError = asItemError(error);
        if (itemError === null) throw error;
        notUpdated[identityId] = itemError;
      }
    }

    for (const identityId of input.destroy) {
      try {
        await destroyIdentityInTransaction(dependencies, tx, {
          accountId: input.accountId,
          identityId,
        });
        destroyed.push(identityId);
      } catch (error) {
        const itemError = asItemError(error);
        if (itemError === null) throw error;
        notDestroyed[identityId] = itemError;
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
