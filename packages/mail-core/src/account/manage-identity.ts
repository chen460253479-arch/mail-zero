import type { CreateIdentityInput, DestroyIdentityInput, UpdateIdentityInput } from './types';
import type { IdentityRecord, MailCoreDependencies, MailTransaction } from '../store';
import type { IdentityId } from '../types';
import { MailCoreError } from '../types';
import { z } from 'zod';

const identityEmailSchema = z.string().email();

const normalizeEmail = (email: string): string => {
  const normalized = email.trim().normalize('NFC').toLocaleLowerCase('und');
  if (!identityEmailSchema.safeParse(normalized).success) {
    throw new MailCoreError('INVALID_EMAIL');
  }
  return normalized;
};

export async function createIdentityInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: CreateIdentityInput,
): Promise<IdentityRecord> {
  const id = dependencies.idFactory.next<'Identity'>() as IdentityId;
  const email = normalizeEmail(input.email);
  const replyTo = input.replyTo === null ? null : normalizeEmail(input.replyTo);
  const now = dependencies.clock.now();
  if ((await tx.accounts.findById(input.accountId)) === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', {
      entityId: input.accountId,
    });
  }
  const identities = await tx.identities.listByAccount(input.accountId);
  const isDefault = input.makeDefault || identities.length === 0;
  const clearedDefaults: IdentityRecord[] = [];
  if (isDefault) {
    for (const identity of identities) {
      if (identity.isDefault) {
        await tx.identities.update(input.accountId, identity.id, {
          isDefault: false,
          updatedAt: now,
        });
        clearedDefaults.push(identity);
      }
    }
  }

  const identity = await tx.identities.insert({
    id,
    accountId: input.accountId,
    name: input.name,
    email,
    replyTo,
    isDefault,
    createdAt: now,
    updatedAt: now,
  });
  const stateVersion = await tx.nextStateVersion(input.accountId);
  for (const clearedDefault of clearedDefaults) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'identity',
      entityId: clearedDefault.id,
      changeType: 'updated',
      changedProperties: ['isDefault'],
      createdAt: now,
    });
  }
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'identity',
    entityId: identity.id,
    changeType: 'created',
    changedProperties: null,
    createdAt: now,
  });
  return identity;
}

export async function createIdentity(
  dependencies: MailCoreDependencies,
  input: CreateIdentityInput,
): Promise<IdentityRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return createIdentityInTransaction(dependencies, tx, input);
  });
}

export async function updateIdentityInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: UpdateIdentityInput,
): Promise<IdentityRecord> {
  const email = input.email === undefined ? undefined : normalizeEmail(input.email);
  const replyTo =
    input.replyTo === undefined
      ? undefined
      : input.replyTo === null
        ? null
        : normalizeEmail(input.replyTo);
  const now = dependencies.clock.now();
  const identity = await tx.identities.findById(input.accountId, input.identityId);
  if (identity === null) {
    throw new MailCoreError('IDENTITY_NOT_FOUND', {
      entityId: input.identityId,
    });
  }
  const nextName = input.name === undefined ? identity.name : input.name;
  const nextEmail = email === undefined ? identity.email : email;
  const nextReplyTo = replyTo === undefined ? identity.replyTo : replyTo;
  const shouldBecomeDefault = input.makeDefault === true && !identity.isDefault;
  const changedProperties = [
    ...(nextName !== identity.name ? ['name'] : []),
    ...(nextEmail !== identity.email ? ['email'] : []),
    ...(nextReplyTo !== identity.replyTo ? ['replyTo'] : []),
    ...(shouldBecomeDefault ? ['isDefault'] : []),
  ];
  if (changedProperties.length === 0) {
    return identity;
  }

  const clearedDefaults: IdentityRecord[] = [];
  if (shouldBecomeDefault) {
    for (const candidate of await tx.identities.listByAccount(input.accountId)) {
      if (candidate.id !== identity.id && candidate.isDefault) {
        await tx.identities.update(input.accountId, candidate.id, {
          isDefault: false,
          updatedAt: now,
        });
        clearedDefaults.push(candidate);
      }
    }
  }
  const updated = await tx.identities.update(input.accountId, input.identityId, {
    name: nextName,
    email: nextEmail,
    replyTo: nextReplyTo,
    isDefault: shouldBecomeDefault ? true : identity.isDefault,
    updatedAt: now,
  });
  const stateVersion = await tx.nextStateVersion(input.accountId);
  for (const clearedDefault of clearedDefaults) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'identity',
      entityId: clearedDefault.id,
      changeType: 'updated',
      changedProperties: ['isDefault'],
      createdAt: now,
    });
  }
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'identity',
    entityId: updated.id,
    changeType: 'updated',
    changedProperties,
    createdAt: now,
  });
  return updated;
}

export async function updateIdentity(
  dependencies: MailCoreDependencies,
  input: UpdateIdentityInput,
): Promise<IdentityRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return updateIdentityInTransaction(dependencies, tx, input);
  });
}

const nonterminalSubmissionStatuses = new Set(['scheduled', 'queued']);

export async function destroyIdentityInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: DestroyIdentityInput,
): Promise<void> {
  const now = dependencies.clock.now();
  const identity = await tx.identities.findById(input.accountId, input.identityId);
  if (identity === null) {
    throw new MailCoreError('IDENTITY_NOT_FOUND', {
      entityId: input.identityId,
    });
  }
  const submissions = await tx.submissions.listByIdentity(input.accountId, input.identityId);
  if (submissions.some(({ status }) => nonterminalSubmissionStatuses.has(status))) {
    throw new MailCoreError('IDENTITY_IN_USE', {
      entityId: input.identityId,
    });
  }

  const replacement = identity.isDefault
    ? (await tx.identities.listByAccount(input.accountId)).find(
        (candidate) => candidate.id !== identity.id,
      )
    : undefined;
  await tx.identities.delete(input.accountId, identity.id);
  if (replacement !== undefined) {
    await tx.identities.update(input.accountId, replacement.id, {
      isDefault: true,
      updatedAt: now,
    });
  }
  const stateVersion = await tx.nextStateVersion(input.accountId);
  if (replacement !== undefined) {
    await tx.changes.recordChange({
      accountId: input.accountId,
      stateVersion,
      collection: 'identity',
      entityId: replacement.id,
      changeType: 'updated',
      changedProperties: ['isDefault'],
      createdAt: now,
    });
  }
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'identity',
    entityId: identity.id,
    changeType: 'destroyed',
    changedProperties: null,
    createdAt: now,
  });
}

export async function destroyIdentity(
  dependencies: MailCoreDependencies,
  input: DestroyIdentityInput,
): Promise<void> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return destroyIdentityInTransaction(dependencies, tx, input);
  });
}
