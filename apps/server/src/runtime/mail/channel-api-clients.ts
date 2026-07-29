import {
  createMicrosoftGraphTransport,
  type MicrosoftGraphRequest,
} from '../../mail-channel/outlook/shared/graph-transport';
import {
  createZohoMailTransport,
  type ZohoMailRequest,
} from '../../mail-channel/zoho-mail/shared/zoho-transport';
import { readChannelOAuthProviderConfig } from '../../modules/mail-accounts/application/channel-oauth-provider-config';
import {
  createZohoMailClient,
  resolveZohoMailBaseUrl,
} from '../../mail-channel/zoho-mail/shared/zoho-client';
import { createMicrosoftGraphClient } from '../../mail-channel/outlook/shared/graph-client';
import { zohoMailErrorStatus } from '../../mail-channel/zoho-mail/shared/errors';
import type { MailChannelCredentialContext } from './channel-credential-context';
import { outlookErrorStatus } from '../../mail-channel/outlook/shared/errors';
import type { DB } from '../../db';

const withCredentialRetry = async <T>(
  context: MailChannelCredentialContext,
  operation: (forceRefresh: boolean) => Promise<T>,
  statusOf: (error: unknown) => number | null,
): Promise<T> => {
  try {
    return await operation(false);
  } catch (error) {
    if (statusOf(error) !== 401) throw error;
  }
  await context.invalidateCredential();
  try {
    return await operation(true);
  } catch (error) {
    if (statusOf(error) === 401) await context.markReconnectRequired();
    throw error;
  }
};

export const createCredentialAwareOutlookClient = (context: MailChannelCredentialContext) =>
  createMicrosoftGraphClient({
    request: async (request: MicrosoftGraphRequest) =>
      await withCredentialRetry(
        context,
        async (forceRefresh) =>
          await createMicrosoftGraphTransport(
            await context.resolveCredential(forceRefresh),
          ).request(request),
        outlookErrorStatus,
      ),
  });

export const createCredentialAwareZohoMailClient = async (
  db: DB,
  context: MailChannelCredentialContext,
) => {
  const providerConfig = await readChannelOAuthProviderConfig(db, 'zoho_mail');
  const dataCenter =
    typeof providerConfig.dataCenter === 'string' ? providerConfig.dataCenter : 'com';
  return createZohoMailClient({
    request: async (request: ZohoMailRequest) =>
      await withCredentialRetry(
        context,
        async (forceRefresh) =>
          await createZohoMailTransport(
            await context.resolveCredential(forceRefresh),
            resolveZohoMailBaseUrl(dataCenter),
          ).request(request),
        zohoMailErrorStatus,
      ),
  });
};
