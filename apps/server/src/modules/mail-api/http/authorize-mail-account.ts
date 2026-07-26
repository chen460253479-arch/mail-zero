import type { Context } from 'hono';

import { openOwnedMailApiRuntime } from '../runtime/create-mail-api';
import { mapMailCoreError } from '../errors/map-mail-core-error';
import type { HonoContext } from '../../../ctx';

export function mailHttpErrorResponse(c: Context<HonoContext>, error: unknown): Response {
  const mapped = mapMailCoreError(error);
  switch (mapped.code) {
    case 'ACCOUNT_NOT_FOUND':
    case 'NOT_FOUND':
      return c.json(mapped.toJSON(), 404);
    case 'ACCOUNT_NOT_ACTIVE':
    case 'FORBIDDEN':
      return c.json(mapped.toJSON(), 403);
    case 'OVER_QUOTA':
    case 'REQUEST_TOO_LARGE':
      return c.json(mapped.toJSON(), 413);
    case 'STORAGE_FAILURE':
      return c.json(mapped.toJSON(), 503);
    default:
      return c.json(mapped.toJSON(), 400);
  }
}

export async function authorizeMailAccount(c: Context<HonoContext>, accountId: string) {
  const user = c.var.sessionUser;
  if (user === undefined) {
    return { response: c.json({ code: 'UNAUTHORIZED' }, 401) } as const;
  }
  try {
    return {
      runtime: await openOwnedMailApiRuntime(user.id, accountId as never, c.env),
    } as const;
  } catch (error) {
    return { response: mailHttpErrorResponse(c, error) } as const;
  }
}
