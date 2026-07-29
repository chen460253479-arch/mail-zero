import { getUserWorkspace } from '../../lib/server-utils';
import { shortcutSchema } from '../../lib/shortcuts';
import { privateProcedure, router } from '../trpc';
import { z } from 'zod';

export const shortcutRouter = router({
  update: privateProcedure
    .input(
      z.object({
        shortcuts: z.array(shortcutSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionUser } = ctx;
      const { shortcuts } = input;
      const db = getUserWorkspace(sessionUser.id);
      await db.insertUserHotkeys(shortcuts as any);
    }),
});
