import { threadDetailInputSchema, threadPageInputSchema } from '../contracts/view';
import { createThreadViewService } from '../application/thread-view-service';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createPostgresMailViewProjection } from '../projections/postgres';
import { router } from '../../../trpc/trpc';

export const viewRouter = router({
  threadPage: mailAccountProcedure
    .input(threadPageInputSchema)
    .query(({ ctx, input }) =>
      createThreadViewService(
        ctx.mailApi.core,
        createPostgresMailViewProjection(ctx.mailApi.db),
      ).threadPage(input),
    ),
  threadDetail: mailAccountProcedure
    .input(threadDetailInputSchema)
    .query(({ ctx, input }) =>
      createThreadViewService(
        ctx.mailApi.core,
        createPostgresMailViewProjection(ctx.mailApi.db),
      ).threadDetail(input),
    ),
});
