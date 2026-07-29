import { readGmailOAuthRuntimeConfig } from '../../modules/mail-accounts/application/connect-gmail-oauth';
import { createGoogleGmailApiExecutor } from '../../mail-channel/gmail/shared/google-api';
import { createSystemIntegrationRepository } from '../../integrations/core/repository';
import type { GmailApiExecutor } from '../../mail-channel/gmail/shared/api-transport';
import { createMailChannelCredentialContext } from './channel-credential-context';
import type { MailChannelCredentialContext } from './channel-credential-context';
import { createCredentialAwareGmailExecutor } from './gmail-api-executor';
import type { ResolvedCredential } from '../../mail-channel/contracts';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

export type GmailCredentialContext = {
  resolveCredential(forceRefresh: boolean): Promise<ResolvedCredential>;
  executor: GmailApiExecutor;
  markReconnectRequired(): Promise<void>;
};

const getAuthErrorCode = (error: unknown): string => {
  const candidate = error as {
    code?: string | number;
    response?: { status?: string | number };
  };
  return String(candidate.code ?? candidate.response?.status ?? '');
};

export const createGmailCredentialContext = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  connectionId: string,
  channelContext?: MailChannelCredentialContext,
): Promise<GmailCredentialContext> => {
  const context =
    channelContext ?? (await createMailChannelCredentialContext(db, runtimeEnv, connectionId));
  if (context.channelId !== 'gmail') {
    throw new Error(`Connection channel ${context.channelId} is not Gmail`);
  }
  const zeroOAuth =
    context.authSource === 'zero_oauth'
      ? await readGmailOAuthRuntimeConfig({
          repository: createSystemIntegrationRepository(db),
          encryptionKey: runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
          redirectUri: `${runtimeEnv.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/u, '')}/api/integrations/gmail/connect/callback`,
        })
      : undefined;
  const executor = createCredentialAwareGmailExecutor({
    resolveCredential: context.resolveCredential,
    createClient: (credential) => createGoogleGmailApiExecutor(credential, zeroOAuth),
    invalidateCredential: context.invalidateCredential,
    markReconnectRequired: context.markReconnectRequired,
    isUnauthorized: (error) => getAuthErrorCode(error) === '401',
  });

  return {
    resolveCredential: context.resolveCredential,
    executor,
    markReconnectRequired: context.markReconnectRequired,
  };
};
