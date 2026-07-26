import type { Keyword, MailAccountId, MailboxId, MailCore, ThreadId } from '@zero/mail-core';
import type { z } from 'zod';

import {
  snoozeThreadsInputSchema,
  unsnoozeThreadsInputSchema,
  updateThreadsInputSchema,
} from '../contracts/action';
import type { MailSnoozeRuntime } from '../../mail-snooze/runtime/create-mail-snooze';
import { mapSetErrors } from './dto';

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
