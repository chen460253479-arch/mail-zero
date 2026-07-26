import {
  snoozeThreadsInputSchema,
  snoozeThreadsResultSchema,
  unsnoozeThreadsResultSchema,
  unsnoozeThreadsInputSchema,
  updateThreadsResultSchema,
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
    .output(updateThreadsResultSchema)
    .mutation(({ ctx, input }) => createThreadActionService(ctx.mailApi.core).updateThreads(input)),
  snoozeThreads: mailAccountProcedure
    .input(snoozeThreadsInputSchema)
    .output(snoozeThreadsResultSchema)
    .mutation(({ ctx, input }) =>
      createSnoozeActionService(ctx.mailApi.snooze).snoozeThreads(input),
    ),
  unsnoozeThreads: mailAccountProcedure
    .input(unsnoozeThreadsInputSchema)
    .output(unsnoozeThreadsResultSchema)
    .mutation(({ ctx, input }) =>
      createSnoozeActionService(ctx.mailApi.snooze).unsnoozeThreads(input),
    ),
});
