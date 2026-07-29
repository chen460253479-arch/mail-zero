import { Hono } from 'hono';

import {
  connectNangoMailbox,
  type ConnectNangoMailboxInput,
} from '../../mail-accounts/application/connect-nango-mailbox';
import { ensureExternalIntegrationPrincipal, type IntegrationPrincipal } from '../principal';
import { NangoBindingError } from '../../mail-accounts/application/bind-nango-mailbox';
import type { RuntimeServices } from '../../../runtime/node/services';
import { requireIntegrationServiceToken } from '../service-auth';
import { externalBindInputSchema } from '../contracts/bind';

export type ExternalIntegrationRouterDependencies = {
  ensurePrincipal(database: RuntimeServices['database']['db']): Promise<IntegrationPrincipal>;
  connect(input: ConnectNangoMailboxInput, services: RuntimeServices): Promise<{ id: string }>;
};

const defaultDependencies: ExternalIntegrationRouterDependencies = {
  ensurePrincipal: ensureExternalIntegrationPrincipal,
  connect: connectNangoMailbox,
};

const bindingStatus = (error: NangoBindingError): 409 | 412 => {
  const conflicts = new Set(['MAILBOX_ALREADY_CONNECTED', 'NANGO_CONNECTION_ALREADY_BOUND']);
  return conflicts.has(error.code) ? 409 : 412;
};

export const createExternalIntegrationRouter = (
  services: RuntimeServices,
  dependencies: ExternalIntegrationRouterDependencies = defaultDependencies,
) =>
  new Hono().post('/nango/connections/bind', async (context) => {
    try {
      requireIntegrationServiceToken(
        services.config.externalIntegration.apiToken,
        context.req.header('Authorization'),
      );
    } catch {
      return context.json({ error: 'INTEGRATION_UNAUTHORIZED' }, 401);
    }

    const body = await context.req.json().catch(() => null);
    const parsed = externalBindInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }

    const principal = await dependencies.ensurePrincipal(services.database.db);
    try {
      return context.json(
        await dependencies.connect(
          {
            userId: principal.userId,
            ...parsed.data,
          },
          services,
        ),
        200,
      );
    } catch (error) {
      if (error instanceof NangoBindingError) {
        return context.json({ error: error.code }, bindingStatus(error));
      }
      throw error;
    }
  });
