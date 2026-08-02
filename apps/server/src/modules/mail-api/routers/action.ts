import {
  snoozeThreadsInputSchema,
  destroyThreadsInputSchema,
  destroyThreadsResultSchema,
  snoozeThreadsResultSchema,
  unsnoozeThreadsResultSchema,
  unsnoozeThreadsInputSchema,
  updateThreadsResultSchema,
  updateThreadsInputSchema,
  moveThreadsInputSchema,
  moveThreadsResultSchema,
  restoreArchivedThreadsInputSchema,
  archiveSnoozedThreadsInputSchema,
  archiveSnoozedThreadsResultSchema,
} from '../contracts/action';
import {
  createSnoozeActionService,
  createDestroyThreadsService,
  createThreadActionService,
} from '../application/thread-action-service';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { router } from '../../../trpc/trpc';

export const actionRouter = router({
  destroyThreads: mailAccountProcedure
    .input(destroyThreadsInputSchema)
    .output(destroyThreadsResultSchema)
    .mutation(({ ctx, input }) =>
      createDestroyThreadsService(ctx.mailApi.core).destroyThreads(input),
    ),
  updateThreads: mailAccountProcedure
    .input(updateThreadsInputSchema)
    .output(updateThreadsResultSchema)
    .mutation(({ ctx, input }) => createThreadActionService(ctx.mailApi.core).updateThreads(input)),
  moveThreads: mailAccountProcedure
    .input(moveThreadsInputSchema)
    .output(moveThreadsResultSchema)
    .mutation(({ ctx, input }) => createThreadActionService(ctx.mailApi.core).moveThreads(input)),
  restoreArchivedThreads: mailAccountProcedure
    .input(restoreArchivedThreadsInputSchema)
    .output(moveThreadsResultSchema)
    .mutation(({ ctx, input }) =>
      createThreadActionService(ctx.mailApi.core).restoreArchivedThreads(input),
    ),
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
  archiveSnoozedThreads: mailAccountProcedure
    .input(archiveSnoozedThreadsInputSchema)
    .output(archiveSnoozedThreadsResultSchema)
    .mutation(({ ctx, input }) =>
      createSnoozeActionService(ctx.mailApi.snooze).archiveSnoozedThreads(input),
    ),
});
