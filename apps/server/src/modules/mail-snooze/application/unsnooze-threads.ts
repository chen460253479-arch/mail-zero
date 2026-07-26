import type { MailAccountId, MailCore, MailboxId, ThreadId } from '@zero/mail-core';

import type { MailSnoozeRepository } from '../domain/snooze';

export async function unsnoozeThreads(
  input: { accountId: string; threadIds: string[] },
  dependencies: {
    core: Pick<MailCore, 'listMailboxes' | 'updateThreadEmails'>;
    repository: MailSnoozeRepository;
    clock: { now(): Date };
  },
) {
  const archive = (
    await dependencies.core.listMailboxes({
      accountId: input.accountId as MailAccountId,
    })
  ).find(({ role }) => role === 'archive');
  const restored: string[] = [];
  const notFound: string[] = [];
  for (const threadId of [...new Set(input.threadIds)]) {
    const snooze = await dependencies.repository.find(input.accountId, threadId);
    if (snooze === null || !['scheduled', 'waking'].includes(snooze.status)) {
      notFound.push(threadId);
      continue;
    }
    const result = await dependencies.core.updateThreadEmails({
      accountId: input.accountId as MailAccountId,
      threadIds: [threadId as ThreadId],
      addMailboxIds: snooze.restoreMailboxIds as MailboxId[],
      removeMailboxIds: archive === undefined ? [] : [archive.id],
      addKeywords: [],
      removeKeywords: [],
    });
    if (result.updatedThreadIds.length === 0) {
      notFound.push(threadId);
      continue;
    }
    await dependencies.repository.cancel({
      accountId: input.accountId,
      threadId,
      now: dependencies.clock.now(),
    });
    restored.push(threadId);
  }
  return { restored, notFound };
}
