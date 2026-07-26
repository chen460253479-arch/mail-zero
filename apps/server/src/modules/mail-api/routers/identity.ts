import {
  identityChangesInputSchema,
  identityGetResultSchema,
  identityGetInputSchema,
  identitySetInputSchema,
  identitySetResultSchema,
} from '../contracts/identity';
import { mailAccountProcedure } from '../procedures/mail-account-procedure';
import { createIdentityService } from '../application/identity-service';
import { changesResultSchema } from '../contracts/common';
import { router } from '../../../trpc/trpc';

export const identityRouter = router({
  get: mailAccountProcedure
    .input(identityGetInputSchema)
    .output(identityGetResultSchema)
    .query(({ ctx, input }) => createIdentityService(ctx.mailApi.core).get(input)),
  set: mailAccountProcedure
    .input(identitySetInputSchema)
    .output(identitySetResultSchema)
    .mutation(({ ctx, input }) => createIdentityService(ctx.mailApi.core).set(input)),
  changes: mailAccountProcedure
    .input(identityChangesInputSchema)
    .output(changesResultSchema)
    .query(({ ctx, input }) => createIdentityService(ctx.mailApi.core).changes(input)),
});
