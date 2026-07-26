import { threadChangesInputSchema, threadGetInputSchema } from '../contracts/thread';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createThreadService } from '../application/thread-service';
import { router } from '../../../trpc/trpc';

export const threadRouter = router({
  get: mailAccountProcedure
    .input(threadGetInputSchema)
    .query(({ ctx, input }) => createThreadService(ctx.mailApi.core).get(input)),
  changes: mailAccountProcedure
    .input(threadChangesInputSchema)
    .query(({ ctx, input }) => createThreadService(ctx.mailApi.core).changes(input)),
});
