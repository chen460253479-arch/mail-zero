import {
  submissionChangesInputSchema,
  submissionGetInputSchema,
  submissionQueryInputSchema,
  submissionSetInputSchema,
} from '../contracts/submission';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createSubmissionService } from '../application/submission-service';
import { router } from '../../../trpc/trpc';

export const submissionRouter = router({
  get: mailAccountProcedure
    .input(submissionGetInputSchema)
    .query(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).get(input),
    ),
  query: mailAccountProcedure
    .input(submissionQueryInputSchema)
    .query(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).query(input),
    ),
  set: mailAccountProcedure
    .input(submissionSetInputSchema)
    .mutation(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).set(input),
    ),
  changes: mailAccountProcedure
    .input(submissionChangesInputSchema)
    .query(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).changes(input),
    ),
});
