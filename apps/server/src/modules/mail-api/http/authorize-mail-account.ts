import type { Context } from 'hono';

import { openOwnedMailApiRuntime } from '../runtime/create-mail-api';
import type { HonoContext } from '../../../ctx';

export async function authorizeMailAccount(c: Context<HonoContext>, accountId: string) {
  const user = c.var.sessionUser;
  if (user === undefined) {
    return { response: c.json({ code: 'UNAUTHORIZED' }, 401) } as const;
  }
  try {
    return {
      runtime: await openOwnedMailApiRuntime(user.id, accountId as never, c.env),
    } as const;
  } catch {
    return { response: c.json({ code: 'NOT_FOUND' }, 404) } as const;
  }
}
