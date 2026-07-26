import {
  MailCoreError,
  applyPreparedEmailStateInTransaction,
  prepareEmailStateReplacementInTransaction,
  type MailAccountId,
  type MailCoreDependencies,
  type MailCoreSetError,
  type MailboxId,
  type PreparedEmailStateMutation,
  type ThreadId,
} from '@zero/mail-core';

import { runPostgresMailTransaction } from '../../mail/postgres/postgres-unit-of-work';
import { createPostgresMailSnoozeTransactionRepository } from './repository';
import type { SnoozeEmailRestore, SnoozeRecord } from '../domain/snooze';
import type { DB } from '../../../db';

type SnoozeInput = { accountId: string; threadIds: string[]; wakeAt: Date };
type UnsnoozeInput = { accountId: string; threadIds: string[] };

const itemFailure = (code: string): MailCoreSetError => ({ code: code as never, details: {} });

const requireSystemMailboxes = async (
  tx: Parameters<Parameters<typeof runPostgresMailTransaction>[1]>[0],
  accountId: MailAccountId,
) => {
  const mailboxes = await tx.mailboxes.listByAccount(accountId);
  const inbox = mailboxes.find(({ role }) => role === 'inbox');
  const archive = mailboxes.find(({ role }) => role === 'archive');
  if (inbox === undefined || archive === undefined) {
    throw new MailCoreError('MAILBOX_NOT_FOUND');
  }
  return { inbox: inbox.id, archive: archive.id };
};

const prepareRestore = async (
  dependencies: MailCoreDependencies,
  tx: Parameters<Parameters<typeof runPostgresMailTransaction>[1]>[0],
  accountId: MailAccountId,
  plan: SnoozeEmailRestore[],
): Promise<PreparedEmailStateMutation[]> => {
  const prepared: PreparedEmailStateMutation[] = [];
  for (const item of plan) {
    const email = await tx.emails.findById(accountId, item.emailId as never);
    if (email === null || email.destroyedAt !== null) continue;
    const mailboxIds = new Set(email.mailboxIds);
    item.removeMailboxIds.forEach((id) => mailboxIds.delete(id as MailboxId));
    item.addMailboxIds.forEach((id) => mailboxIds.add(id as MailboxId));
    prepared.push(
      await prepareEmailStateReplacementInTransaction(dependencies, tx, {
        accountId,
        emailId: email.id,
        mailboxIds: [...mailboxIds],
      }),
    );
  }
  return prepared;
};

export const createPostgresMailSnoozeCommands = (dependencies: {
  db: DB;
  mailCoreDependencies: MailCoreDependencies;
  clock: { now(): Date };
}) => ({
  async snooze(input: SnoozeInput) {
    const now = dependencies.clock.now();
    if (!Number.isFinite(input.wakeAt.getTime()) || input.wakeAt <= now) {
      throw new MailCoreError('INVALID_QUERY');
    }
    const accountId = input.accountId as MailAccountId;
    return runPostgresMailTransaction(dependencies.db, async (tx, database) => {
      await tx.lockAccount(accountId);
      const { inbox, archive } = await requireSystemMailboxes(tx, accountId);
      const repository = createPostgresMailSnoozeTransactionRepository(database);
      const scheduled: string[] = [];
      const failed: Record<string, MailCoreSetError> = {};

      for (const rawThreadId of [...new Set(input.threadIds)]) {
        const threadId = rawThreadId as ThreadId;
        const existing = await repository.find(input.accountId, rawThreadId);
        if (existing !== null && existing.status === 'scheduled') {
          await repository.schedule({
            accountId: input.accountId,
            threadId: rawThreadId,
            wakeAt: input.wakeAt,
            restorePlan: existing.restorePlan,
            now,
          });
          scheduled.push(rawThreadId);
          continue;
        }

        const thread = await tx.threads.findById(accountId, threadId);
        if (thread === null) {
          failed[rawThreadId] = itemFailure(
            (await tx.threads.existsOutsideAccount(accountId, threadId))
              ? 'CROSS_ACCOUNT_REFERENCE'
              : 'THREAD_NOT_FOUND',
          );
          continue;
        }
        const emails = (await tx.emails.listByThread(accountId, threadId)).filter(
          ({ destroyedAt, mailboxIds }) => destroyedAt === null && mailboxIds.includes(inbox),
        );
        if (emails.length === 0) {
          failed[rawThreadId] = itemFailure('THREAD_NOT_IN_INBOX');
          continue;
        }

        const restorePlan: SnoozeEmailRestore[] = [];
        const prepared: PreparedEmailStateMutation[] = [];
        for (const email of emails) {
          const hadArchive = email.mailboxIds.includes(archive);
          const mailboxIds = new Set(email.mailboxIds);
          mailboxIds.delete(inbox);
          mailboxIds.add(archive);
          prepared.push(
            await prepareEmailStateReplacementInTransaction(dependencies.mailCoreDependencies, tx, {
              accountId,
              emailId: email.id,
              mailboxIds: [...mailboxIds],
            }),
          );
          restorePlan.push({
            emailId: email.id,
            addMailboxIds: [inbox],
            removeMailboxIds: hadArchive ? [] : [archive],
          });
        }

        await repository.schedule({
          accountId: input.accountId,
          threadId: rawThreadId,
          wakeAt: input.wakeAt,
          restorePlan,
          now,
        });
        for (const mutation of prepared) {
          await applyPreparedEmailStateInTransaction(tx, mutation);
        }
        scheduled.push(rawThreadId);
      }
      return { scheduled, failed };
    });
  },

  async unsnooze(input: UnsnoozeInput) {
    const now = dependencies.clock.now();
    const accountId = input.accountId as MailAccountId;
    return runPostgresMailTransaction(dependencies.db, async (tx, database) => {
      await tx.lockAccount(accountId);
      const repository = createPostgresMailSnoozeTransactionRepository(database);
      const restored: string[] = [];
      const notFound: string[] = [];
      for (const threadId of [...new Set(input.threadIds)]) {
        const record = await repository.find(input.accountId, threadId);
        if (record === null || !['scheduled', 'waking'].includes(record.status)) {
          notFound.push(threadId);
          continue;
        }
        const prepared = await prepareRestore(
          dependencies.mailCoreDependencies,
          tx,
          accountId,
          record.restorePlan,
        );
        for (const mutation of prepared) {
          await applyPreparedEmailStateInTransaction(tx, mutation);
        }
        await repository.cancel({ accountId: input.accountId, threadId, now });
        restored.push(threadId);
      }
      return { restored, notFound };
    });
  },

  async wakeClaimed(record: SnoozeRecord, leaseOwner: string, now: Date): Promise<boolean> {
    const accountId = record.accountId as MailAccountId;
    return runPostgresMailTransaction(dependencies.db, async (tx, database) => {
      await tx.lockAccount(accountId);
      const repository = createPostgresMailSnoozeTransactionRepository(database);
      const current = await repository.find(record.accountId, record.threadId);
      if (current === null || current.status !== 'waking' || current.leaseOwner !== leaseOwner) {
        return false;
      }
      const prepared = await prepareRestore(
        dependencies.mailCoreDependencies,
        tx,
        accountId,
        current.restorePlan,
      );
      for (const mutation of prepared) {
        await applyPreparedEmailStateInTransaction(tx, mutation);
      }
      await repository.complete({
        accountId: record.accountId,
        threadId: record.threadId,
        leaseOwner,
        now,
      });
      return true;
    });
  },
});

export type PostgresMailSnoozeCommands = ReturnType<typeof createPostgresMailSnoozeCommands>;
