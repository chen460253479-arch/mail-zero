import { Hono } from 'hono';

import {
  connectNangoMailbox,
  type ConnectNangoMailboxInput,
} from '../../mail-accounts/application/connect-nango-mailbox';
import {
  createExternalMessageReader,
  type ExternalMessageReader,
} from '../application/read-message';
import { ensureExternalIntegrationPrincipal, type IntegrationPrincipal } from '../principal';
import { NangoBindingError } from '../../mail-accounts/application/bind-nango-mailbox';
import { createPostgresExternalMessageRepository } from '../postgres/repository';
import { createMailCoreForEnvironment } from '../../../runtime/mail/core';
import type { RuntimeServices } from '../../../runtime/node/services';
import { requireIntegrationServiceToken } from '../service-auth';
import { externalBindInputSchema } from '../contracts/bind';
import { registerExternalMailRoutes } from './mail';

export type ExternalIntegrationRouterDependencies = {
  ensurePrincipal(database: RuntimeServices['database']['db']): Promise<IntegrationPrincipal>;
  connect(input: ConnectNangoMailboxInput, services: RuntimeServices): Promise<{ id: string }>;
  createMessageReader(ownerUserId: string, services: RuntimeServices): ExternalMessageReader;
};

const defaultDependencies: ExternalIntegrationRouterDependencies = {
  ensurePrincipal: ensureExternalIntegrationPrincipal,
  connect: connectNangoMailbox,
  createMessageReader: (ownerUserId, services) =>
    createExternalMessageReader({
      ownerUserId,
      repository: createPostgresExternalMessageRepository(services.database.db),
      core: createMailCoreForEnvironment(services.database.db, {
        blobStore: services.blobStore,
        cursorSigningKey: services.config.betterAuthSecret,
      }),
    }),
};

const bindingStatus = (error: NangoBindingError): 409 | 412 => {
  const conflicts = new Set(['MAILBOX_ALREADY_CONNECTED', 'NANGO_CONNECTION_ALREADY_BOUND']);
  return conflicts.has(error.code) ? 409 : 412;
};

export const createExternalIntegrationRouter = (
  services: RuntimeServices,
  dependencyOverrides: Partial<ExternalIntegrationRouterDependencies> = {},
) => {
  const dependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };
  const authorize = async (
    authorizationHeader: string | undefined,
  ): Promise<IntegrationPrincipal | Response> => {
    try {
      requireIntegrationServiceToken(
        services.config.externalIntegration.apiToken,
        authorizationHeader,
      );
    } catch {
      return Response.json({ error: 'INTEGRATION_UNAUTHORIZED' }, { status: 401 });
    }
    return await dependencies.ensurePrincipal(services.database.db);
  };

  const app = new Hono().post('/nango/connections/bind', async (context) => {
    const authorization = await authorize(context.req.header('Authorization'));
    if (authorization instanceof Response) return authorization;
    const body = await context.req.json().catch(() => null);
    const parsed = externalBindInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }

    try {
      return context.json(
        await dependencies.connect(
          {
            userId: authorization.userId,
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

  registerExternalMailRoutes(app, {
    authorize: async (context) => await authorize(context.req.header('Authorization')),
    createReader: (ownerUserId) => dependencies.createMessageReader(ownerUserId, services),
  });
  return app;
};
