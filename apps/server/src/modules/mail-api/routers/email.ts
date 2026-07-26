import {
  emailChangesInputSchema,
  emailGetResultSchema,
  emailGetInputSchema,
  emailQueryInputSchema,
  emailQueryResultSchema,
  emailSetInputSchema,
  emailSetResultSchema,
} from '../contracts/email';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createEmailService } from '../application/email-service';
import { changesResultSchema } from '../contracts/common';
import { router } from '../../../trpc/trpc';

export const emailRouter = router({
  get: mailAccountProcedure
    .input(emailGetInputSchema)
    .output(emailGetResultSchema)
    .query(async ({ ctx, input }) =>
      emailGetResultSchema.parse(await createEmailService(ctx.mailApi.core).get(input)),
    ),
  query: mailAccountProcedure
    .input(emailQueryInputSchema)
    .output(emailQueryResultSchema)
    .query(({ ctx, input }) => createEmailService(ctx.mailApi.core).query(input)),
  set: mailAccountProcedure
    .input(emailSetInputSchema)
    .output(emailSetResultSchema)
    .mutation(({ ctx, input }) => createEmailService(ctx.mailApi.core).set(input)),
  changes: mailAccountProcedure
    .input(emailChangesInputSchema)
    .output(changesResultSchema)
    .query(({ ctx, input }) => createEmailService(ctx.mailApi.core).changes(input)),
});
