import type { MailAccountId, MailCore, ThreadId } from '@zero/mail-core';
import type { z } from 'zod';

import { threadChangesInputSchema, threadSchema } from '../contracts/thread';
import { MailCoreError } from '@zero/mail-core';

export const createThreadService = (
  core: Pick<MailCore, 'getChanges' | 'getState' | 'getThread'>,
) => ({
  async get(input: { accountId: string; ids: string[] }) {
    const accountId = input.accountId as MailAccountId;
    const state = await core.getState({ accountId, collection: 'thread' });
    const settled = await Promise.allSettled(
      input.ids.map((threadId) => core.getThread({ accountId, threadId: threadId as ThreadId })),
    );
    for (const result of settled) {
      if (
        result.status === 'rejected' &&
        !(
          result.reason instanceof MailCoreError &&
          ['THREAD_NOT_FOUND', 'CROSS_ACCOUNT_REFERENCE'].includes(result.reason.code)
        )
      ) {
        throw result.reason;
      }
    }
    return {
      accountId: input.accountId,
      state,
      list: settled.flatMap((result) =>
        result.status === 'fulfilled'
          ? [threadSchema.parse({ id: result.value.id, emailIds: result.value.emailIds })]
          : [],
      ),
      notFound: input.ids.filter((_, index) => settled[index]?.status === 'rejected'),
    };
  },
  changes(input: z.infer<typeof threadChangesInputSchema>) {
    return core.getChanges({
      ...input,
      accountId: input.accountId as MailAccountId,
      collection: 'thread',
    });
  },
});
