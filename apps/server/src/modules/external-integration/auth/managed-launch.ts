import { createAuthEndpoint, APIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { BetterAuthPlugin } from 'better-auth';

import { launchCodeInputSchema } from '../contracts/access';

export type ManagedLaunchOptions = {
  consumeLaunchCode(input: { launchCode: string }): Promise<{ userId: string }>;
  publicAppUrl: string;
};

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

export const managedLaunch = (options: ManagedLaunchOptions) =>
  ({
    id: 'managed-launch',
    endpoints: {
      consumeManagedLaunch: createAuthEndpoint(
        '/managed-launch',
        {
          method: 'POST',
          body: launchCodeInputSchema,
        },
        async (ctx) => {
          let target: { userId: string };
          try {
            target = await options.consumeLaunchCode(ctx.body);
          } catch (error) {
            if (hasCode(error, 'LAUNCH_CODE_INVALID')) {
              throw new APIError('BAD_REQUEST', {
                code: 'LAUNCH_CODE_INVALID',
                message: 'LAUNCH_CODE_INVALID',
              });
            }
            throw error;
          }

          const user = await ctx.context.internalAdapter.findUserById(target.userId);
          if (user === null) {
            throw new APIError('BAD_REQUEST', {
              code: 'LAUNCH_CODE_INVALID',
              message: 'LAUNCH_CODE_INVALID',
            });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id, ctx, false, {
            authMethod: 'launch',
          });
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'SESSION_CREATE_FAILED',
            });
          }
          await setSessionCookie(ctx, { session, user }, false);
          return new Response(null, {
            status: 303,
            headers: {
              Location: new URL('/mail/inbox', options.publicAppUrl).toString(),
            },
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
