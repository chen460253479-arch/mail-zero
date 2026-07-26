import {
  createSystemIntegrationRepository,
  type SystemIntegrationRepository,
} from '../../../integrations/core/repository';
import {
  createNangoCredentialRepository,
  type NangoCredentialResolverOptions,
} from '../credentials/nango';
import { NangoIntegrationService } from '../../../integrations/nango/service';
import { NangoClient } from '../../../integrations/nango/client';
import { createDb } from '../../../db';

export type NangoRuntimeConfig = {
  databaseUrl: string;
  encryptionKey: string;
};

export type NangoRuntime = {
  client: NangoClient;
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
    const integrationService = new NangoIntegrationService({
      repository: integrationRepository,
      encryptionKey: config.encryptionKey,
      createClient: (runtimeConfig) => new NangoClient({ ...runtimeConfig, fetch }),
      now: () => new Date(),
    });
    const runtimeConfig = await integrationService.getRuntimeConfig();
    return await run({
      client: new NangoClient({ ...runtimeConfig, fetch }),
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
