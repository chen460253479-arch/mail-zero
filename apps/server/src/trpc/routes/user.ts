import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authenticatedProcedure, privateProcedure, router } from '../trpc';

export const userRouter = router({
  changePassword: authenticatedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(12),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (
        ctx.sessionUser.username !== null &&
        ctx.sessionUser.username !== undefined &&
        input.newPassword === ctx.sessionUser.username
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'PASSWORD_MUST_DIFFER_FROM_USERNAME',
        });
      }
      if (input.newPassword === input.currentPassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'PASSWORD_MUST_CHANGE',
        });
      }
      await ctx.c.var.auth.api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: false,
        },
        headers: ctx.c.req.raw.headers,
      });
      await ctx.c.var.services!.userWorkspace.forUser(ctx.sessionUser.id).updateUser({
        mustChangePassword: false,
        updatedAt: new Date(),
      });
      return { success: true };
    }),
  delete: privateProcedure.mutation(async ({ ctx }) => {
    const { success, message } = await ctx.c.var.auth.api.deleteUser({
      body: {},
      headers: ctx.c.req.raw.headers,
      request: ctx.c.req.raw,
    });
    return { success, message };
  }),
});
