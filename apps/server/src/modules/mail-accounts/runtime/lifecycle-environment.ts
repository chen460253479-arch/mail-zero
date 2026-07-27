import { GoogleGmailOAuthGateway } from '../../../mail-channel/gmail/auth/google-oauth-gateway';
import { createGmailCredentialContext } from '../../../runtime/mail/gmail-credential-context';
import { createPostgresMailSyncRepository } from '../../mail-sync/postgres/sync-repository';
import { createSystemIntegrationRepository } from '../../../integrations/core/repository';
import { createPostgresConnectionRepository } from '../postgres/connection-repository';
import { stopGmailWatchForConnection } from '../../../runtime/mail/gmail-inbound';
import { readGmailOAuthRuntimeConfig } from '../application/connect-gmail-oauth';
import { createMailboxLifecycleRuntime } from './lifecycle';
import type { ZeroEnv } from '../../../env';
import type { DB } from '../../../db';

const R2_DELETE_BATCH_SIZE = 1_000;

const deleteBlobObjects = async (bucket: R2Bucket, objectKeys: string[]): Promise<void> => {
  for (let offset = 0; offset < objectKeys.length; offset += R2_DELETE_BATCH_SIZE) {
    await bucket.delete(objectKeys.slice(offset, offset + R2_DELETE_BATCH_SIZE));
  }
};

const safeErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError';

export const createMailboxLifecycleForDatabase = (db: DB, runtimeEnv: ZeroEnv) => {
  const repository = createPostgresConnectionRepository(db);
  const syncRepository = createPostgresMailSyncRepository(db);

  return createMailboxLifecycleRuntime({
    repository,
    pauseConnectionSyncs: (input) => syncRepository.pauseConnectionSyncs(input),
    stopGmailWatch: (connectionId) => stopGmailWatchForConnection(db, runtimeEnv, connectionId),
    revokeZeroOAuth: async (connectionId) => {
      const credential = await (
        await createGmailCredentialContext(db, runtimeEnv, connectionId)
      ).resolveCredential(false);
      if (credential.type !== 'oauth2') {
        throw new Error('Gmail Zero OAuth credential is not OAuth2');
      }
      const config = await readGmailOAuthRuntimeConfig({
        repository: createSystemIntegrationRepository(db),
        encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
        redirectUri: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/gmail/connect/callback`,
      });
      await new GoogleGmailOAuthGateway().revokeToken(
        config,
        credential.refreshToken ?? credential.accessToken,
      );
    },
    deleteBlobObjects: (objectKeys) => deleteBlobObjects(runtimeEnv.THREADS_BUCKET, objectKeys),
    recordDiagnostic: (code, connectionId, error) => {
      console.warn(code, {
        connectionId,
        errorName: safeErrorName(error),
      });
    },
    now: () => new Date(),
  });
};
