import type { EmailId, MailAccountId, MailCore } from '@zero/mail-core';
import type { z } from 'zod';

import { threadDetailInputSchema, threadPageInputSchema } from '../contracts/view';
import type { MailViewProjection } from '../projections/port';
import { MailApiError } from '../errors/mail-api-error';
import { toEmailDto } from './email-dto';

export const createThreadViewService = (
  core: Pick<MailCore, 'getEmails' | 'getState' | 'readBlob' | 'readBlobRange'>,
  projection: MailViewProjection,
) => ({
  async threadPage(input: z.infer<typeof threadPageInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    return {
      accountId: input.accountId,
      queryState: await core.getState({ accountId, collection: 'thread' }),
      ...(await projection.threadPage(input)),
    };
  },
  async threadDetail(input: z.infer<typeof threadDetailInputSchema>) {
    const accountId = input.accountId as MailAccountId;
    const detail = await projection.threadDetail(input);
    if (detail === null) {
      throw new MailApiError({
        code: 'NOT_FOUND',
        retryable: false,
        requestId: crypto.randomUUID(),
      });
    }
    const records = await core.getEmails({
      accountId,
      emailIds: detail.emailIds as EmailId[],
    });
    const bodyReadBudget = { remainingBytes: 8_000_000 };
    const emails = await Promise.all(
      records.map((email) => toEmailDto(core, accountId, email, { ...input, bodyReadBudget })),
    );
    return {
      accountId: input.accountId,
      state: await core.getState({ accountId, collection: 'email' }),
      thread: { id: detail.threadId, emailIds: detail.emailIds },
      emails,
    };
  },
});
