import type { OAuth2Credential, ResolvedCredential } from '../../mail-channel/contracts';
import type { GmailApiExecutor } from '../../mail-channel/gmail/shared/api-transport';

export type GmailCredentialExecutorDependencies = {
  resolveCredential(forceRefresh: boolean): Promise<ResolvedCredential>;
  createClient(credential: OAuth2Credential): GmailApiExecutor;
  invalidateCredential(): Promise<void>;
  markReconnectRequired(): Promise<void>;
  isUnauthorized(error: unknown): boolean;
};

const requireOAuth2 = (credential: ResolvedCredential): OAuth2Credential => {
  if (credential.type !== 'oauth2') {
    throw new Error('Gmail requires an OAuth2 credential');
  }
  return credential;
};

export const createCredentialAwareGmailExecutor = (
  dependencies: GmailCredentialExecutorDependencies,
): GmailApiExecutor => ({
  runGmailApi: async (operation) => {
    const initialCredential = requireOAuth2(await dependencies.resolveCredential(false));
    try {
      return await dependencies.createClient(initialCredential).runGmailApi(operation);
    } catch (error) {
      if (!dependencies.isUnauthorized(error)) throw error;
    }

    await dependencies.invalidateCredential();
    const refreshedCredential = requireOAuth2(await dependencies.resolveCredential(true));
    try {
      return await dependencies.createClient(refreshedCredential).runGmailApi(operation);
    } catch (error) {
      if (dependencies.isUnauthorized(error)) {
        await dependencies.markReconnectRequired();
      }
      throw error;
    }
  },
});
