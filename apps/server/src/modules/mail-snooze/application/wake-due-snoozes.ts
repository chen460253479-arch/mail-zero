import type { MailAccountId, MailCore, MailboxId, ThreadId } from '@zero/mail-core';

import type { MailSnoozeRepository } from '../domain/snooze';

export async function wakeDueSnoozes(
  input: { now: Date; limit: number; leaseOwner: string; leaseForMs: number },
  dependencies: {
    core: Pick<MailCore, 'listMailboxes' | 'updateThreadEmails'>;
    repository: MailSnoozeRepository;
  },
) {
  const claimed = await dependencies.repository.claimDue(input);
  let completed = 0;
  for (const snooze of claimed) {
    try {
      const archive = (
        await dependencies.core.listMailboxes({
          accountId: snooze.accountId as MailAccountId,
        })
      ).find(({ role }) => role === 'archive');
      const result = await dependencies.core.updateThreadEmails({
        accountId: snooze.accountId as MailAccountId,
        threadIds: [snooze.threadId as ThreadId],
        addMailboxIds: snooze.restoreMailboxIds as MailboxId[],
        removeMailboxIds: archive === undefined ? [] : [archive.id],
        addKeywords: [],
        removeKeywords: [],
      });
      if (result.updatedThreadIds.length === 0) throw new Error('SNOOZE_WAKE_FAILED');
      await dependencies.repository.complete({
        accountId: snooze.accountId,
        threadId: snooze.threadId,
        leaseOwner: input.leaseOwner,
        now: input.now,
      });
      completed += 1;
    } catch {
      await dependencies.repository.release({
        accountId: snooze.accountId,
        threadId: snooze.threadId,
        leaseOwner: input.leaseOwner,
        now: input.now,
      });
    }
  }
  return { claimed: claimed.length, completed };
}
