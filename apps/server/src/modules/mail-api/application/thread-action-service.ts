import {
  MailCoreError,
  type EmailId,
  type Keyword,
  type MailAccountId,
  type MailboxId,
  type MailCore,
  type ThreadId,
} from '@zero/mail-core';
import type { z } from 'zod';

import {
  snoozeThreadsInputSchema,
  destroyThreadsInputSchema,
  unsnoozeThreadsInputSchema,
  updateThreadsInputSchema,
} from '../contracts/action';
import type { MailSnoozeRuntime } from '../../mail-snooze/runtime/create-mail-snooze';
import { mapSetError, mapSetErrors } from './dto';

export const createThreadActionService = (core: Pick<MailCore, 'updateThreadEmails'>) => ({
  async updateThreads(input: z.infer<typeof updateThreadsInputSchema>) {
    const result = await core.updateThreadEmails({
      accountId: input.accountId as MailAccountId,
      threadIds: input.threadIds as ThreadId[],
      ifInState: input.ifInState,
      addMailboxIds: input.addMailboxIds as MailboxId[],
      removeMailboxIds: input.removeMailboxIds as MailboxId[],
      addKeywords: input.addKeywords as Keyword[],
      removeKeywords: input.removeKeywords as Keyword[],
    });
    return {
      accountId: input.accountId,
      clientMutationId: input.clientMutationId,
      ...result,
      failed: mapSetErrors(result.failed),
    };
  },
});

export const createSnoozeActionService = (
  snooze: Pick<MailSnoozeRuntime, 'snooze' | 'unsnooze'>,
) => ({
  async snoozeThreads(input: z.infer<typeof snoozeThreadsInputSchema>) {
    return {
      accountId: input.accountId,
      clientMutationId: input.clientMutationId,
      ...(await snooze.snooze({
        accountId: input.accountId,
        threadIds: input.threadIds,
        wakeAt: new Date(input.wakeAt),
      })),
    };
  },
  async unsnoozeThreads(input: z.infer<typeof unsnoozeThreadsInputSchema>) {
    return {
      accountId: input.accountId,
      clientMutationId: input.clientMutationId,
      ...(await snooze.unsnooze({
        accountId: input.accountId,
        threadIds: input.threadIds,
      })),
    };
  },
});

export const createDestroyThreadsService = (core: Pick<MailCore, 'getThread' | 'setEmails'>) => ({
  async destroyThreads(input: z.infer<typeof destroyThreadsInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const threadEmails = new Map<string, EmailId[]>();
    const failed: Record<string, ReturnType<typeof mapSetError>> = {};
    for (const threadId of [...new Set(input.threadIds)]) {
      try {
        const thread = await core.getThread({
          accountId,
          threadId: threadId as ThreadId,
        });
        threadEmails.set(threadId, thread.emailIds);
      } catch (error) {
        if (!(error instanceof MailCoreError)) throw error;
        failed[threadId] = mapSetError(error);
      }
    }

    const result = await core.setEmails({
      accountId,
      ifInState: input.ifInState,
      create: {},
      update: {},
      destroy: [...threadEmails.values()].flat(),
    });
    const destroyed = new Set(result.destroyed);
    for (const [threadId, emailIds] of threadEmails) {
      const emailFailure = emailIds.find((emailId) => result.notDestroyed[emailId] !== undefined);
      if (emailFailure) {
        failed[threadId] = mapSetError(result.notDestroyed[emailFailure]!);
      }
    }

    return {
      accountId: input.accountId,
      clientMutationId: input.clientMutationId,
      oldState: result.oldState,
      newState: result.newState,
      destroyedThreadIds: [...threadEmails]
        .filter(([, emailIds]) => emailIds.every((emailId) => destroyed.has(emailId)))
        .map(([threadId]) => threadId),
      failed,
    };
  },
});
