import {
  submissionChangesInputSchema,
  submissionGetResultSchema,
  submissionGetInputSchema,
  submissionQueryInputSchema,
  submissionQueryResultSchema,
  submissionSetInputSchema,
  submissionSetResultSchema,
} from '../contracts/submission';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createSubmissionService } from '../application/submission-service';
import { changesResultSchema } from '../contracts/common';
import { router } from '../../../trpc/trpc';

export const submissionRouter = router({
  get: mailAccountProcedure
    .input(submissionGetInputSchema)
    .output(submissionGetResultSchema)
    .query(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).get(input),
    ),
  query: mailAccountProcedure
    .input(submissionQueryInputSchema)
    .output(submissionQueryResultSchema)
    .query(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).query(input),
    ),
  set: mailAccountProcedure
    .input(submissionSetInputSchema)
    .output(submissionSetResultSchema)
    .mutation(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).set(input),
    ),
  changes: mailAccountProcedure
    .input(submissionChangesInputSchema)
    .output(changesResultSchema)
    .query(({ ctx, input }) =>
      createSubmissionService(ctx.mailApi.core, ctx.mailApi.outbound).changes(input),
    ),
});
