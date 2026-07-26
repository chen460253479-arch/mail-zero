import { createThreadActionService } from '../application/thread-action-service';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { updateThreadsInputSchema } from '../contracts/action';
import { router } from '../../../trpc/trpc';

export const actionRouter = router({
  updateThreads: mailAccountProcedure
    .input(updateThreadsInputSchema)
    .mutation(({ ctx, input }) => createThreadActionService(ctx.mailApi.core).updateThreads(input)),
});
