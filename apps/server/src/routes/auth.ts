import { authProviders, customProviders, isProviderEnabled } from '../lib/auth-providers';
import {
  AdminProvisioningConflictError,
  provisionAdmin,
} from '../lib/admin-provisioning';
import type { HonoContext } from '../ctx';
import { Hono } from 'hono';

const publicRouter = new Hono<HonoContext>();

publicRouter.get('/providers', async (c) => {
  const env = c.env as unknown as Record<string, string>;
  const isProd = env.NODE_ENV === 'production';

  const authProviderStatus = authProviders(env).map((provider) => {
    const envVarStatus =
      provider.envVarInfo?.map((envVar) => {
        const envVarName = envVar.name as keyof typeof env;
        return {
          name: envVar.name,
          set: !!env[envVarName],
          source: envVar.source,
          defaultValue: envVar.defaultValue,
        };
      }) || [];

    return {
      id: provider.id,
      name: provider.name,
      enabled: isProviderEnabled(provider, env),
      required: provider.required,
      envVarInfo: provider.envVarInfo,
      envVarStatus,
    };
  });

  const customProviderStatus = customProviders.map((provider) => {
    return {
      id: provider.id,
      name: provider.name,
      enabled: true,
      isCustom: provider.isCustom,
      customRedirectPath: provider.customRedirectPath,
      envVarStatus: [],
    };
  });

  const allProviders = [...customProviderStatus, ...authProviderStatus];

  return c.json({
    allProviders,
    isProd,
  });
});

publicRouter.post('/bootstrap-admin', async (c) => {
  const configuredSecret = c.env.ZERO_ADMIN_BOOTSTRAP_SECRET;
  const suppliedSecret = c.req.header('x-zero-bootstrap-secret');

  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return c.json({ error: 'Invalid bootstrap secret' }, 401);
  }

  try {
    const result = await provisionAdmin(await c.req.json());
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
