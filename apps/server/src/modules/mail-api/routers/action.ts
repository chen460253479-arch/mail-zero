import {
  snoozeThreadsInputSchema,
  unsnoozeThreadsInputSchema,
  updateThreadsInputSchema,
} from '../contracts/action';
import {
  createSnoozeActionService,
  createThreadActionService,
} from '../application/thread-action-service';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { router } from '../../../trpc/trpc';

export const actionRouter = router({
  updateThreads: mailAccountProcedure
    .input(updateThreadsInputSchema)
    .mutation(({ ctx, input }) => createThreadActionService(ctx.mailApi.core).updateThreads(input)),
  snoozeThreads: mailAccountProcedure
    .input(snoozeThreadsInputSchema)
    .mutation(({ ctx, input }) =>
      createSnoozeActionService(ctx.mailApi.snooze).snoozeThreads(input),
    ),
  unsnoozeThreads: mailAccountProcedure
    .input(unsnoozeThreadsInputSchema)
    .mutation(({ ctx, input }) =>
      createSnoozeActionService(ctx.mailApi.snooze).unsnoozeThreads(input),
    ),
});
