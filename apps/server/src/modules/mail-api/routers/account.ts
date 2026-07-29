import {
  openMailApiRuntime,
  type MailApiEnvironment,
  type OpenMailApiRuntime,
} from '../runtime/create-mail-api';
import {
  accountGetInputSchema,
  accountGetResultSchema,
  accountListResultSchema,
} from '../contracts/account';
import { mailAccountProcedure, toMailApiTrpcError } from '../procedures/mail-account-procedure';
import { createAccountService } from '../application/account-service';
import { mailSessionProcedure, router } from '../../../trpc/trpc';

export type OpenMailSessionRuntime = (
  environment: MailApiEnvironment,
) => Promise<OpenMailApiRuntime>;

export const createAccountRouter = (openRuntime: OpenMailSessionRuntime = openMailApiRuntime) =>
  router({
    list: mailSessionProcedure.output(accountListResultSchema).query(async ({ ctx }) => {
      const runtime = await openRuntime(ctx.c.var.services!);
      try {
        try {
          const access = ctx.mailAccess;
          const result = await createAccountService(runtime.core).list({
            userId: access.kind === 'user' ? access.userId : access.ownerUserId,
          });
          if (access.kind === 'user') return result;
          const allowedAccountIds = new Set(
            access.scopes.map(({ mailAccountId }) => mailAccountId),
          );
          return {
            accounts: result.accounts.filter(({ id }) => allowedAccountIds.has(id)),
          };
        } catch (error) {
          throw toMailApiTrpcError(error);
        }
      } finally {
        await runtime.close();
      }
    }),
    get: mailAccountProcedure
      .input(accountGetInputSchema)
      .output(accountGetResultSchema)
      .query(({ ctx, input }) => createAccountService(ctx.mailApi.core).get(input)),
  });

export const accountRouter = createAccountRouter();
