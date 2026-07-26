import {
  mailboxChangesInputSchema,
  mailboxGetInputSchema,
  mailboxSetInputSchema,
} from '../contracts/mailbox';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createMailboxService } from '../application/mailbox-service';
import { router } from '../../../trpc/trpc';

export const mailboxRouter = router({
  get: mailAccountProcedure
    .input(mailboxGetInputSchema)
    .query(({ ctx, input }) => createMailboxService(ctx.mailApi.core).get(input)),
  set: mailAccountProcedure
    .input(mailboxSetInputSchema)
    .mutation(({ ctx, input }) => createMailboxService(ctx.mailApi.core).set(input)),
  changes: mailAccountProcedure
    .input(mailboxChangesInputSchema)
    .query(({ ctx, input }) => createMailboxService(ctx.mailApi.core).changes(input)),
});
