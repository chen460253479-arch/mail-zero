import { createNangoCredentialRepository, type NangoCredentialResolverOptions } from './nango';
import { NangoClient } from '../nango/client';
import { createDb } from '../../db';

export type NangoRuntimeConfig = {
  baseUrl?: string;
  secretKey?: string;
  databaseUrl: string;
};

export const withNangoCredentialResolver = async <T>(
  config: NangoRuntimeConfig,
  run: (options: NangoCredentialResolverOptions) => Promise<T>,
): Promise<T> => {
  if (!config.baseUrl || !config.secretKey) {
    throw new Error('Nango credential resolver is not configured');
  }

  const { db, conn } = createDb(config.databaseUrl);
  try {
    return await run({
      client: new NangoClient({
        baseUrl: config.baseUrl,
        secretKey: config.secretKey,
        fetch,
      }),
      repository: createNangoCredentialRepository(db),
    });
  } finally {
    await conn.end();
  }
};
