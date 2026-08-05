import { hashPassword } from 'better-auth/crypto';
import { randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import { Hono } from 'hono';

import {
  createPostgresExternalCustomerMarkerRepository,
  createPostgresExternalAccessRepository,
  createPostgresExternalMessageRepository,
} from '../postgres/repository';
import {
  disconnectExternalNangoConnection,
  type ExternalNangoDisconnectInput,
  type ExternalNangoDisconnectResult,
} from '../application/disconnect-nango-connection';
import {
  connectNangoMailbox,
  type ConnectNangoMailboxInput,
} from '../../mail-accounts/application/connect-nango-mailbox';
import {
  createExternalCustomerMarkerWriter,
  type ExternalCustomerMarkerWriter,
} from '../application/set-customer-marker';
import {
  provisionManagedUser,
  type ProvisionManagedUserDependencies,
} from '../application/provision-managed-user';
import {
  createExternalMessageReader,
  type ExternalMessageReader,
} from '../application/read-message';
import { createPostgresConnectionRepository } from '../../mail-accounts/postgres/connection-repository';
import { createMailboxLifecycleForDatabase } from '../../mail-accounts/runtime/lifecycle-environment';
import { createPostgresManagedUserRepository } from '../postgres/managed-user-repository';
import { NangoBindingError } from '../../mail-accounts/application/bind-nango-mailbox';
import { accessGrantInputSchema, type AccessGrantInput } from '../contracts/access';
import { defaultMailChannelRegistry } from '../../../mail-channel/registry';
import { handleExternalLaunch, type ConsumeManagedLaunch } from './launch';
import { createMailCoreForEnvironment } from '../../../runtime/mail/core';
import { externalDisconnectInputSchema } from '../contracts/disconnect';
import { createAccessGrant } from '../application/create-access-grant';
import type { RuntimeServices } from '../../../runtime/node/services';
import { requireIntegrationServiceToken } from '../service-auth';
import { externalBindInputSchema } from '../contracts/bind';
import { ExternalIntegrationError } from '../errors';
import { registerExternalMailRoutes } from './mail';

export type ExternalIntegrationRouterDependencies = {
  provisionManagedUser(
    input: { externalUserId: string },
    services: RuntimeServices,
  ): Promise<{ userId: string; created: boolean }>;
  connect(input: ConnectNangoMailboxInput, services: RuntimeServices): Promise<{ id: string }>;
  disconnectNango(
    input: ExternalNangoDisconnectInput,
    services: RuntimeServices,
  ): Promise<ExternalNangoDisconnectResult>;
  createMessageReader(services: RuntimeServices): ExternalMessageReader;
  createCustomerMarkerWriter(services: RuntimeServices): ExternalCustomerMarkerWriter;
  createAccessGrant(
    input: AccessGrantInput,
    services: RuntimeServices,
  ): Promise<{ launchCode: string }>;
  consumeManagedLaunch: ConsumeManagedLaunch;
};

const defaultDependencies: ExternalIntegrationRouterDependencies = {
  provisionManagedUser: async (input, services) => {
    const dependencies: ProvisionManagedUserDependencies = {
      repository: createPostgresManagedUserRepository(services.database.db),
      hashPassword,
      now: () => new Date(),
      newId: () => ulid(),
    };
    return await provisionManagedUser(input, dependencies);
  },
  connect: connectNangoMailbox,
  disconnectNango: async (input, services) => {
    const managedUsers = createPostgresManagedUserRepository(services.database.db);
    const connections = createPostgresConnectionRepository(services.database.db);
    const lifecycle = createMailboxLifecycleForDatabase(services.database.db, services);
    return await disconnectExternalNangoConnection(input, {
      findManagedUser: (externalUserId) => managedUsers.findByExternalUserId(externalUserId),
      findNangoMailbox: (channelId, connectionId) =>
        connections.findByNangoConnectionId(channelId, connectionId),
      disconnect: async (disconnectInput) => {
        if (
          await connections.deletePendingNangoConnection(
            disconnectInput.userId,
            disconnectInput.connectionId,
          )
        ) {
          return { status: 'deleted' };
        }
        return await lifecycle.disconnect(disconnectInput);
      },
    });
  },
  createMessageReader: (services) =>
    createExternalMessageReader({
      repository: createPostgresExternalMessageRepository(services.database.db),
      core: createMailCoreForEnvironment(services.database.db, {
        blobStore: services.blobStore,
        cursorSigningKey: services.config.betterAuthSecret,
      }),
    }),
  createCustomerMarkerWriter: (services) =>
    createExternalCustomerMarkerWriter({
      repository: createPostgresExternalCustomerMarkerRepository(services.database.db),
    }),
  createAccessGrant: async (input, services) =>
    await createAccessGrant(input, {
      repository: createPostgresExternalAccessRepository(services.database.db),
      clock: { now: () => new Date() },
      nextId: () => ulid(),
      randomBytes,
    }),
  consumeManagedLaunch: async (input, services) =>
    await services.auth.api.consumeManagedLaunch({
      body: input,
      asResponse: true,
    }),
};

const bindingStatus = (error: NangoBindingError): 400 | 409 | 412 => {
  if (error.code === 'CHANNEL_EXTERNAL_DATA_INVALID') return 400;
  const conflicts = new Set(['MAILBOX_ALREADY_CONNECTED', 'NANGO_CONNECTION_ALREADY_BOUND']);
  return conflicts.has(error.code) ? 409 : 412;
};

const parseExternalData = (channelId: ConnectNangoMailboxInput['channelId'], value: unknown) => {
  const channel = defaultMailChannelRegistry.get(channelId);
  if (value === undefined) return undefined;
  if (channel.parseExternalData === undefined) {
    throw new Error('CHANNEL_EXTERNAL_DATA_UNSUPPORTED');
  }
  return channel.parseExternalData(value);
};

export const createExternalIntegrationRouter = (
  services: RuntimeServices,
  dependencyOverrides: Partial<ExternalIntegrationRouterDependencies> = {},
) => {
  const dependencies = {
    ...defaultDependencies,
    ...dependencyOverrides,
  };
  const authorize = async (authorizationHeader: string | undefined): Promise<null | Response> => {
    try {
      requireIntegrationServiceToken(
        services.config.externalIntegration.apiToken,
        authorizationHeader,
      );
    } catch {
      return Response.json({ error: 'INTEGRATION_UNAUTHORIZED' }, { status: 401 });
    }
    return null;
  };

  const app = new Hono().post('/nango/connections/bind', async (context) => {
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
    let externalData;
    try {
      externalData = parseExternalData(parsed.data.channelId, parsed.data.externalData);
    } catch {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }

    try {
      const managedUser = await dependencies.provisionManagedUser(
        { externalUserId: parsed.data.externalUserId },
        services,
      );
      return context.json(
        await dependencies.connect(
          {
            userId: managedUser.userId,
            channelId: parsed.data.channelId,
            connectionId: parsed.data.connectionId,
            ...(externalData === undefined ? {} : { externalData }),
          },
          services,
        ),
        200,
      );
    } catch (error) {
      if (error instanceof NangoBindingError) {
        return context.json({ error: error.code }, bindingStatus(error));
      }
      if (error instanceof ExternalIntegrationError && error.code === 'EXTERNAL_USER_INVALID') {
        return context.json({ error: error.code }, 409);
      }
      throw error;
    }
  });

  app.post('/nango/connections/disconnect', async (context) => {
    const unauthorized = await authorize(context.req.header('Authorization'));
    if (unauthorized !== null) return unauthorized;
    const body = await context.req.json().catch(() => null);
    const parsed = externalDisconnectInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }
    return context.json(await dependencies.disconnectNango(parsed.data, services), 200);
  });

  app.post('/access-grants', async (context) => {
    try {
      requireIntegrationServiceToken(
        services.config.externalIntegration.apiToken,
        context.req.header('Authorization'),
      );
    } catch {
      return context.json({ error: 'INTEGRATION_UNAUTHORIZED' }, 401);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = accessGrantInputSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'INVALID_REQUEST' }, 400);
    }
    try {
      return context.json(await dependencies.createAccessGrant(parsed.data, services), 201);
    } catch (error) {
      if (
        error instanceof ExternalIntegrationError &&
        (error.code === 'EXTERNAL_USER_NOT_FOUND' || error.code === 'ACTIVE_MAILBOX_NOT_FOUND')
      ) {
        return context.json(
          { error: error.code },
          error.code === 'EXTERNAL_USER_NOT_FOUND' ? 404 : 412,
        );
      }
      throw error;
    }
  });

  app.post(
    '/launch',
    async (context) =>
      await handleExternalLaunch(context, services, dependencies.consumeManagedLaunch),
  );

  registerExternalMailRoutes(app, {
    authorize: async (context) => await authorize(context.req.header('Authorization')),
    createReader: () => dependencies.createMessageReader(services),
    createCustomerMarkerWriter: () => dependencies.createCustomerMarkerWriter(services),
  });
  return app;
};
