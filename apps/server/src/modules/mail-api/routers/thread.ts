import {
  threadChangesInputSchema,
  threadGetInputSchema,
  threadGetResultSchema,
} from '../contracts/thread';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createThreadService } from '../application/thread-service';
import { changesResultSchema } from '../contracts/common';
import { router } from '../../../trpc/trpc';

export const threadRouter = router({
  get: mailAccountProcedure
    .input(threadGetInputSchema)
    .output(threadGetResultSchema)
    .query(({ ctx, input }) => createThreadService(ctx.mailApi.core).get(input)),
  changes: mailAccountProcedure
    .input(threadChangesInputSchema)
    .output(changesResultSchema)
    .query(({ ctx, input }) => createThreadService(ctx.mailApi.core).changes(input)),
});
