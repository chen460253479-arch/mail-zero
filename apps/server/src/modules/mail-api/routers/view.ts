import {
  threadDetailInputSchema,
  threadDetailResultSchema,
  threadPageInputSchema,
  threadPageResultSchema,
} from '../contracts/view';
import { createThreadViewService } from '../application/thread-view-service';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createPostgresMailViewProjection } from '../projections/postgres';
import { router } from '../../../trpc/trpc';

export const viewRouter = router({
  threadPage: mailAccountProcedure
    .input(threadPageInputSchema)
    .output(threadPageResultSchema)
    .query(({ ctx, input }) =>
      createThreadViewService(
        ctx.mailApi.core,
        createPostgresMailViewProjection(ctx.mailApi.db, ctx.mailApi.cursorSigningKey),
      ).threadPage(input),
    ),
  threadDetail: mailAccountProcedure
    .input(threadDetailInputSchema)
    .output(threadDetailResultSchema)
    .query(async ({ ctx, input }) =>
      threadDetailResultSchema.parse(
        await createThreadViewService(
          ctx.mailApi.core,
          createPostgresMailViewProjection(ctx.mailApi.db, ctx.mailApi.cursorSigningKey),
        ).threadDetail(input),
      ),
    ),
});
