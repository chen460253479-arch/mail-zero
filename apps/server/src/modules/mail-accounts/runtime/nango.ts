import {
  createSystemIntegrationRepository,
  type SystemIntegrationRepository,
} from '../../../integrations/core/repository';
import {
  createNangoCredentialRepository,
  type NangoCredentialResolverOptions,
} from '../credentials/nango';
import { getNangoServiceForEnvironment } from '../../../integrations/nango/runtime';
import type { NangoClient } from '../../../integrations/nango/client';
import { createDb } from '../../../db';

export type NangoRuntimeConfig = {
  databaseUrl: string;
  NANGO_BASE_URL?: string;
  NANGO_SECRET_KEY?: string;
};

export type NangoRuntime = {
  client: Pick<NangoClient, 'listConnections' | 'getConnection'>;
  integrationRepository: SystemIntegrationRepository;
  credentialRepository: NangoCredentialResolverOptions['repository'];
};

export const withNangoRuntime = async <T>(
  config: NangoRuntimeConfig,
  run: (runtime: NangoRuntime) => Promise<T>,
): Promise<T> => {
  const { db, conn } = createDb(config.databaseUrl);
  try {
    const integrationRepository = createSystemIntegrationRepository(db);
    const integrationService = getNangoServiceForEnvironment(config);
    await integrationService.initialize();
    return await run({
      client: integrationService,
      integrationRepository,
      credentialRepository: createNangoCredentialRepository(db),
    });
  } finally {
    await conn.end();
  }
};

export const withNangoCredentialResolver = async <T>(
  config: NangoRuntimeConfig,
  run: (options: NangoCredentialResolverOptions) => Promise<T>,
): Promise<T> =>
  await withNangoRuntime(config, async ({ client, credentialRepository }) =>
    run({ client, repository: credentialRepository }),
  );
