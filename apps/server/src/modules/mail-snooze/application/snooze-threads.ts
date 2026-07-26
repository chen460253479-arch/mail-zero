import type { MailAccountId, MailCore, MailboxId, ThreadId } from '@zero/mail-core';

import type { MailSnoozeRepository } from '../domain/snooze';

export type SnoozeThreadsInput = {
  accountId: string;
  threadIds: string[];
  wakeAt: Date;
};

export type MailSnoozeDependencies = {
  core: Pick<MailCore, 'getEmail' | 'getThread' | 'listMailboxes' | 'updateThreadEmails'>;
  repository: MailSnoozeRepository;
  clock: { now(): Date };
};

export async function snoozeThreads(
  input: SnoozeThreadsInput,
  dependencies: MailSnoozeDependencies,
) {
  const now = dependencies.clock.now();
  if (!Number.isFinite(input.wakeAt.getTime()) || input.wakeAt <= now) {
    throw new Error('INVALID_SNOOZE_TIME');
  }
  const accountId = input.accountId as MailAccountId;
  const mailboxes = await dependencies.core.listMailboxes({ accountId });
  const inbox = mailboxes.find(({ role }) => role === 'inbox');
  const archive = mailboxes.find(({ role }) => role === 'archive');
  if (inbox === undefined) throw new Error('INBOX_NOT_FOUND');
  if (archive === undefined) throw new Error('ARCHIVE_NOT_FOUND');
  const restoreByThread = new Map<string, MailboxId[]>();
  for (const rawThreadId of [...new Set(input.threadIds)]) {
    const thread = await dependencies.core.getThread({
      accountId,
      threadId: rawThreadId as ThreadId,
    });
    const emails = await Promise.all(
      thread.emailIds.map((emailId) => dependencies.core.getEmail({ accountId, emailId })),
    );
    restoreByThread.set(rawThreadId, [
      ...new Set(
        emails.flatMap(({ mailboxIds }) => (mailboxIds.includes(inbox.id) ? mailboxIds : [])),
      ),
    ]);
  }
  const eligibleThreadIds = [...restoreByThread.entries()]
    .filter(([, restore]) => restore.length > 0)
    .map(([threadId]) => threadId);
  const skipped = Object.fromEntries(
    [...restoreByThread.entries()]
      .filter(([, restore]) => restore.length === 0)
      .map(([threadId]) => [threadId, { code: 'THREAD_NOT_IN_INBOX' }]),
  );
  const changed = await dependencies.core.updateThreadEmails({
    accountId,
    threadIds: eligibleThreadIds as ThreadId[],
    addMailboxIds: [archive.id],
    removeMailboxIds: [inbox.id],
    addKeywords: [],
    removeKeywords: [],
  });
  const scheduled: string[] = [];
  const failed: Record<string, unknown> = { ...skipped, ...changed.failed };
  for (const threadId of changed.updatedThreadIds) {
    try {
      await dependencies.repository.schedule({
        accountId: input.accountId,
        threadId,
        wakeAt: input.wakeAt,
        restoreMailboxIds: restoreByThread.get(threadId) ?? [],
        now,
      });
      scheduled.push(threadId);
    } catch {
      failed[threadId] = { code: 'STORAGE_FAILURE' };
      const restoreMailboxIds = restoreByThread.get(threadId) ?? [];
      if (restoreMailboxIds.length > 0) {
        await dependencies.core.updateThreadEmails({
          accountId,
          threadIds: [threadId],
          addMailboxIds: restoreMailboxIds,
          removeMailboxIds: [archive.id],
          addKeywords: [],
          removeKeywords: [],
        });
      }
    }
  }
  return { scheduled, failed };
}
