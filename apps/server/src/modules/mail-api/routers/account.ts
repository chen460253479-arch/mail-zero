import {
  mailAccountProcedure,
  mailSessionProcedure,
  toMailApiTrpcError,
} from '../procedures/mail-account-procedure';
import {
  openMailApiRuntime,
  type MailApiEnvironment,
  type OpenMailApiRuntime,
} from '../runtime/create-mail-api';
import { createAccountService } from '../application/account-service';
import { accountGetInputSchema } from '../contracts/account';
import { router } from '../../../trpc/trpc';

export type OpenMailSessionRuntime = (
  environment: MailApiEnvironment,
) => Promise<OpenMailApiRuntime>;

export const createAccountRouter = (openRuntime: OpenMailSessionRuntime = openMailApiRuntime) =>
  router({
    list: mailSessionProcedure.query(async ({ ctx }) => {
      const runtime = await openRuntime(ctx.c.env);
      try {
        try {
          return await createAccountService(runtime.core).list({ userId: ctx.sessionUser.id });
        } catch (error) {
          throw toMailApiTrpcError(error);
        }
      } finally {
        await runtime.close();
      }
    }),
    get: mailAccountProcedure
      .input(accountGetInputSchema)
      .query(({ ctx, input }) => createAccountService(ctx.mailApi.core).get(input)),
  });

export const accountRouter = createAccountRouter();
