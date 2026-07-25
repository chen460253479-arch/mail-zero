import { normalizeMailboxName, requireMailboxParent } from './create-mailbox';
import type { MailboxRecord, MailCoreDependencies } from '../store';
import type { UpdateMailboxInput } from './types';
import { MailCoreError } from '../types';

export async function updateMailbox(
  dependencies: MailCoreDependencies,
  input: UpdateMailboxInput,
): Promise<MailboxRecord> {
  const now = dependencies.clock.now();

  return dependencies.unitOfWork.run(async (tx) => {
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
  });
}
