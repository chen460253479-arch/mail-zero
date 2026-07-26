import type { Keyword, MailAccountId, MailboxId, MailCore, ThreadId } from '@zero/mail-core';
import type { z } from 'zod';

import { updateThreadsInputSchema } from '../contracts/action';
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
