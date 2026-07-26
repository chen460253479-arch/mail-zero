import type { MailboxRecord, MailCoreDependencies, MailTransaction } from '../store';
import { normalizeMailboxName, requireMailboxParent } from './create-mailbox';
import type { UpdateMailboxInput } from './types';
import { MailCoreError } from '../types';

export async function updateMailbox(
  dependencies: MailCoreDependencies,
  input: UpdateMailboxInput,
): Promise<MailboxRecord> {
  return dependencies.unitOfWork.run(async (tx) => {
    await tx.lockAccount(input.accountId);
    return updateMailboxInTransaction(dependencies, tx, input);
  });
}

export async function updateMailboxInTransaction(
  dependencies: MailCoreDependencies,
  tx: MailTransaction,
  input: UpdateMailboxInput,
): Promise<MailboxRecord> {
  const now = dependencies.clock.now();
  const mailbox = await tx.mailboxes.findById(input.accountId, input.mailboxId);
  if (mailbox === null) {
    throw new MailCoreError('MAILBOX_NOT_FOUND', {
      entityId: input.mailboxId,
    });
  }
  const nextName = input.name === undefined ? mailbox.name : input.name.trim().normalize('NFC');
  const nextNormalizedName =
    input.name === undefined ? mailbox.normalizedName : normalizeMailboxName(input.name);
  const nextParentId = input.parentId === undefined ? mailbox.parentId : input.parentId;
  const nextRole = input.role === undefined ? mailbox.role : input.role;
  const nextColor = input.color === undefined ? mailbox.color : input.color;
  const nextSortOrder = input.sortOrder === undefined ? mailbox.sortOrder : input.sortOrder;
  const nextIsSubscribed =
    input.isSubscribed === undefined ? mailbox.isSubscribed : input.isSubscribed;

  if (
    mailbox.kind === 'system' &&
    (nextName !== mailbox.name || nextParentId !== mailbox.parentId || nextRole !== mailbox.role)
  ) {
    throw new MailCoreError('MAILBOX_ROLE_CONFLICT');
  }
  if (mailbox.kind !== 'system' && nextRole !== null) {
    throw new MailCoreError('MAILBOX_ROLE_CONFLICT');
  }
  const changedProperties = [
    ...(nextName !== mailbox.name ? ['name'] : []),
    ...(nextParentId !== mailbox.parentId ? ['parentId'] : []),
    ...(nextRole !== mailbox.role ? ['role'] : []),
    ...(nextColor !== mailbox.color ? ['color'] : []),
    ...(nextSortOrder !== mailbox.sortOrder ? ['sortOrder'] : []),
    ...(nextIsSubscribed !== mailbox.isSubscribed ? ['isSubscribed'] : []),
  ];
  if (changedProperties.length === 0) {
    return mailbox;
  }
  await requireMailboxParent(tx, input.accountId, nextParentId);
  let ancestorId = nextParentId;
  while (ancestorId !== null) {
    if (ancestorId === mailbox.id) {
      throw new MailCoreError('MAILBOX_PARENT_CYCLE', {
        entityId: mailbox.id,
      });
    }
    const ancestor = await tx.mailboxes.findById(input.accountId, ancestorId);
    ancestorId = ancestor?.parentId ?? null;
  }
  const conflict = await tx.mailboxes.findByNormalizedName(
    input.accountId,
    nextParentId,
    nextNormalizedName,
  );
  if (conflict !== null && conflict.id !== mailbox.id) {
    throw new MailCoreError('MAILBOX_NAME_CONFLICT');
  }

  const updated = await tx.mailboxes.update(input.accountId, input.mailboxId, {
    name: nextName,
    normalizedName: nextNormalizedName,
    parentId: nextParentId,
    role: nextRole,
    color: nextColor,
    sortOrder: nextSortOrder,
    isSubscribed: nextIsSubscribed,
    updatedAt: now,
  });
  const stateVersion = await tx.nextStateVersion(input.accountId);
  await tx.changes.recordChange({
    accountId: input.accountId,
    stateVersion,
    collection: 'mailbox',
    entityId: mailbox.id,
    changeType: 'updated',
    changedProperties,
    createdAt: now,
  });
  return updated;
}
