import type { Context } from 'hono';

import type { RuntimeServices } from '../../../runtime/node/services';
import { launchCodeInputSchema } from '../contracts/access';

export type ConsumeManagedLaunch = (
  input: { launchCode: string },
  services: RuntimeServices,
) => Promise<Response>;

export const handleExternalLaunch = async (
  context: Context,
  services: RuntimeServices,
  consume: ConsumeManagedLaunch,
): Promise<Response> => {
  const body = await context.req.parseBody().catch(() => null);
  const parsed = launchCodeInputSchema.safeParse(body);
  if (!parsed.success) {
    return context.json({ error: 'INVALID_REQUEST' }, 400);
  }
  return await consume(parsed.data, services);
};
