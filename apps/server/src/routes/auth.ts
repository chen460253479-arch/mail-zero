import { AdminProvisioningConflictError } from '../lib/admin-provisioning';
import type { HonoContext } from '../ctx';
import { Hono } from 'hono';

const publicRouter = new Hono<HonoContext>();

publicRouter.post('/bootstrap-admin', async (c) => {
  const configuredSecret = c.var.services?.config.admin.bootstrapSecret;
  const suppliedSecret = c.req.header('x-zero-bootstrap-secret');

  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return c.json({ error: 'Invalid bootstrap secret' }, 401);
  }

  try {
    const result = await c.var.services!.provisionAdmin(await c.req.json());
    return c.json(result, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof AdminProvisioningConflictError) {
      return c.json({ error: error.message }, 409);
    }
    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

export { publicRouter };
