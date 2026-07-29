import {
  getNangoChannelServiceForEnvironment,
  getNangoServiceForEnvironment,
  type NangoEnvironment,
} from '../../../integrations/nango/runtime';
import {
  createNangoCredentialRepository,
  type NangoCredentialResolverOptions,
} from '../credentials/nango';
import type { NangoChannelIntegrationService } from '../../../integrations/nango/channels';
import type { NangoClient } from '../../../integrations/nango/client';
import { createDb } from '../../../db';

export type NangoRuntimeConfig = {
  databaseUrl: string;
} & NangoEnvironment;

export type NangoRuntime = {
  client: Pick<NangoClient, 'listConnections' | 'getConnection'>;
  channels: NangoChannelIntegrationService;
  credentialRepository: NangoCredentialResolverOptions['repository'];
};

export const withNangoRuntime = async <T>(
  config: NangoRuntimeConfig,
  run: (runtime: NangoRuntime) => Promise<T>,
): Promise<T> => {
  const { db, conn } = createDb(config.databaseUrl);
  try {
    const integrationService = getNangoServiceForEnvironment(config);
    await integrationService.initialize();
    return await run({
      client: integrationService,
      channels: getNangoChannelServiceForEnvironment(config),
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
