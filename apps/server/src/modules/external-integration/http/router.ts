import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { Hono } from 'hono';

import {
  connectNangoMailbox,
  type ConnectNangoMailboxInput,
} from '../../mail-accounts/application/connect-nango-mailbox';
import {
  createPostgresExternalAccessRepository,
  createPostgresExternalMessageRepository,
} from '../postgres/repository';
import {
  createExternalMessageReader,
  type ExternalMessageReader,
} from '../application/read-message';
import { ensureExternalIntegrationPrincipal, type IntegrationPrincipal } from '../principal';
import { accessGrantInputSchema, type AccessGrantInput } from '../contracts/access';
import { NangoBindingError } from '../../mail-accounts/application/bind-nango-mailbox';
import { handleExternalLaunch, type ConsumeExternalLaunchCode } from './launch';
import { createMailCoreForEnvironment } from '../../../runtime/mail/core';
import { createAccessGrant } from '../application/create-access-grant';
import { consumeLaunchCode } from '../application/consume-launch-code';
import type { RuntimeServices } from '../../../runtime/node/services';
import { requireIntegrationServiceToken } from '../service-auth';
import { externalBindInputSchema } from '../contracts/bind';
import { ExternalIntegrationError } from '../errors';
import { registerExternalMailRoutes } from './mail';

export type ExternalIntegrationRouterDependencies = {
  ensurePrincipal(database: RuntimeServices['database']['db']): Promise<IntegrationPrincipal>;
  connect(input: ConnectNangoMailboxInput, services: RuntimeServices): Promise<{ id: string }>;
  createMessageReader(ownerUserId: string, services: RuntimeServices): ExternalMessageReader;
  createAccessGrant(
    input: AccessGrantInput,
    principal: IntegrationPrincipal,
    services: RuntimeServices,
  ): Promise<{ launchCode: string }>;
  consumeLaunchCode: ConsumeExternalLaunchCode;
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
  createAccessGrant: async (input, principal, services) =>
    await createAccessGrant(input, {
      ownerUserId: principal.userId,
      repository: createPostgresExternalAccessRepository(services.database.db),
      clock: { now: () => new Date() },
      nextId: () => ulid(),
      randomBytes,
    }),
  consumeLaunchCode: async (input, services) =>
    await consumeLaunchCode(input, {
      repository: createPostgresExternalAccessRepository(services.database.db),
      clock: { now: () => new Date() },
      nextId: () => ulid(),
      randomBytes,
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

  app.post('/access-grants', async (context) => {
    const authorization = await authorize(context.req.header('Authorization'));
    if (authorization instanceof Response) return authorization;
    const body = await context.req.json().catch(() => null);
    const parsed = accessGrantInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }
    try {
      return context.json(
        await dependencies.createAccessGrant(parsed.data, authorization, services),
        201,
      );
    } catch (error) {
      if (
        error instanceof ExternalIntegrationError &&
        error.code === 'NANGO_CONNECTION_NOT_BOUND'
      ) {
        return context.json({ error: error.code }, 412);
      }
      throw error;
    }
  });

  app.post(
    '/launch',
    async (context) =>
      await handleExternalLaunch(context, services, dependencies.consumeLaunchCode),
  );

  registerExternalMailRoutes(app, {
    authorize: async (context) => await authorize(context.req.header('Authorization')),
    createReader: (ownerUserId) => dependencies.createMessageReader(ownerUserId, services),
  });
  return app;
};
