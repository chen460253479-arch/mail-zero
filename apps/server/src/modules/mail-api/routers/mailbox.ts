import {
  mailboxChangesInputSchema,
  mailboxGetResultSchema,
  mailboxGetInputSchema,
  mailboxSetInputSchema,
  mailboxSetResultSchema,
} from '../contracts/mailbox';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createMailboxService } from '../application/mailbox-service';
import { changesResultSchema } from '../contracts/common';
import { router } from '../../../trpc/trpc';

export const mailboxRouter = router({
  get: mailAccountProcedure
    .input(mailboxGetInputSchema)
    .output(mailboxGetResultSchema)
    .query(({ ctx, input }) => createMailboxService(ctx.mailApi.core).get(input)),
  set: mailAccountProcedure
    .input(mailboxSetInputSchema)
    .output(mailboxSetResultSchema)
    .mutation(({ ctx, input }) => createMailboxService(ctx.mailApi.core).set(input)),
  changes: mailAccountProcedure
    .input(mailboxChangesInputSchema)
    .output(changesResultSchema)
    .query(({ ctx, input }) => createMailboxService(ctx.mailApi.core).changes(input)),
});
