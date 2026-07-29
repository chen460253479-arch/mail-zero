import { publicProcedure, router } from '../../../trpc/trpc';

export const externalAccessRouter = router({
  current: publicProcedure.query(({ ctx }) => {
    if (ctx.sessionUser !== undefined || ctx.externalSession === undefined) {
      return null;
    }
    return {
      mode: 'external' as const,
      sessionId: ctx.externalSession.id,
    };
  }),
});
