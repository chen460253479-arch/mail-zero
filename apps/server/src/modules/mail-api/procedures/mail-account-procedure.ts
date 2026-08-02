import { MailCoreError, type MailAccountId } from '@zero/mail-core';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  openAccessibleMailApiRuntime,
  type MailApiEnvironment,
  type OwnedMailApiRuntime,
} from '../runtime/create-mail-api';
import { mapMailCoreError } from '../errors/map-mail-core-error';
import { mailAccountIdSchema } from '../contracts/common';
import { mailSessionProcedure } from '../../../trpc/trpc';
import { MailApiError } from '../errors/mail-api-error';

export type { OwnedMailApiRuntime } from '../runtime/create-mail-api';

export type OpenOwnedMailApiRuntime = (
  input: {
    actorUserId: string;
    isAdministrator: boolean;
    accountId: MailAccountId;
  },
  runtimeEnv: MailApiEnvironment,
) => Promise<OwnedMailApiRuntime>;

const trpcCode = (
  error: MailApiError,
): 'BAD_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR' => {
  if (error.code === 'NOT_FOUND' || error.code === 'ACCOUNT_NOT_FOUND') return 'NOT_FOUND';
  if (error.code === 'FORBIDDEN') return 'FORBIDDEN';
  if (error.code === 'STATE_MISMATCH' || error.code === 'REVISION_MISMATCH') return 'CONFLICT';
  if (error.code === 'STORAGE_FAILURE') return 'INTERNAL_SERVER_ERROR';
  return 'BAD_REQUEST';
};

export const toMailApiTrpcError = (error: unknown): TRPCError => {
  if (error instanceof TRPCError) {
    if (
      error.code !== 'INTERNAL_SERVER_ERROR' ||
      !(error.cause instanceof MailApiError || error.cause instanceof MailCoreError)
    ) {
      return error;
    }
    error = error.cause;
  }
  const mapped = error instanceof MailApiError ? error : mapMailCoreError(error);
  return new TRPCError({
    code: trpcCode(mapped),
    message: mapped.code,
    cause: mapped,
  });
};

export const createMailAccountProcedure = (
  openRuntime: OpenOwnedMailApiRuntime = openAccessibleMailApiRuntime,
) =>
  mailSessionProcedure
    .input(z.object({ accountId: mailAccountIdSchema }).passthrough())
    .use(async ({ ctx, input, next }) => {
      const access = ctx.mailAccess;
      let runtime: OwnedMailApiRuntime;
      try {
        runtime = await openRuntime(
          {
            actorUserId: access.userId,
            isAdministrator: access.isAdministrator,
            accountId: input.accountId as MailAccountId,
          },
          ctx.c.var.services!,
        );
      } catch (error) {
        throw toMailApiTrpcError(error);
      }
      try {
        try {
          const result = await next({ ctx: { ...ctx, mailApi: runtime } });
          if (!result.ok) throw result.error;
          return result;
        } catch (error) {
          throw toMailApiTrpcError(error);
        }
      } finally {
        await runtime.close();
      }
    });

export const mailAccountProcedure = createMailAccountProcedure();
