import {
  identityChangesInputSchema,
  identityGetInputSchema,
  identitySetInputSchema,
} from '../contracts/identity';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createIdentityService } from '../application/identity-service';
import { router } from '../../../trpc/trpc';

export const identityRouter = router({
  get: mailAccountProcedure
    .input(identityGetInputSchema)
    .query(({ ctx, input }) => createIdentityService(ctx.mailApi.core).get(input)),
  set: mailAccountProcedure
    .input(identitySetInputSchema)
    .mutation(({ ctx, input }) => createIdentityService(ctx.mailApi.core).set(input)),
  changes: mailAccountProcedure
    .input(identityChangesInputSchema)
    .query(({ ctx, input }) => createIdentityService(ctx.mailApi.core).changes(input)),
});
