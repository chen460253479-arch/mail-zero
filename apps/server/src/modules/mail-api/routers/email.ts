import {
  emailChangesInputSchema,
  emailGetInputSchema,
  emailQueryInputSchema,
  emailSetInputSchema,
} from '../contracts/email';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createEmailService } from '../application/email-service';
import { router } from '../../../trpc/trpc';

export const emailRouter = router({
  get: mailAccountProcedure
    .input(emailGetInputSchema)
    .query(({ ctx, input }) => createEmailService(ctx.mailApi.core).get(input)),
  query: mailAccountProcedure
    .input(emailQueryInputSchema)
    .query(({ ctx, input }) => createEmailService(ctx.mailApi.core).query(input)),
  set: mailAccountProcedure
    .input(emailSetInputSchema)
    .mutation(({ ctx, input }) => createEmailService(ctx.mailApi.core).set(input)),
  changes: mailAccountProcedure
    .input(emailChangesInputSchema)
    .query(({ ctx, input }) => createEmailService(ctx.mailApi.core).changes(input)),
});
