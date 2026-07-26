import { readGmailOAuthRuntimeConfig, type GmailOAuthRuntimeConfig } from './gmail-oauth-service';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import { createDb } from '../../db';

export const loadGmailOAuthRuntimeConfig = async (input: {
  databaseUrl: string;
  encryptionKey: string;
  redirectUri: string;
}): Promise<GmailOAuthRuntimeConfig> => {
  const { db, conn } = createDb(input.databaseUrl);
  try {
    return await readGmailOAuthRuntimeConfig({
      repository: createSystemIntegrationRepository(db),
      encryptionKey: input.encryptionKey,
      redirectUri: input.redirectUri,
    });
  } finally {
    await conn.end();
  }
};
