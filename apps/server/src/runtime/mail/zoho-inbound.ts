import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { handleZohoMailWebhookRequest } from '../../mail-channel/zoho-mail/inbound/webhook';
import type { MailInboundRuntimeResources } from './inbound';
import type { DB } from '../../db';

const digestHex = async (value: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const handleZohoMailWebhookForEnvironment = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  request: Request,
  endpointToken: string,
): Promise<Response> => {
  const repository = createPostgresMailSyncRepository(db);
  const endpointTokenHash = await digestHex(endpointToken);
  return await handleZohoMailWebhookRequest(request, endpointToken, {
    recordEndpointSignal: async () =>
      await repository.recordEndpointSignal({
        provider: 'zoho_mail',
        endpointTokenHash,
      }),
    enqueueDiscover: (syncId) => resources.taskQueue.enqueueIngress({ type: 'discover', syncId }),
  });
};
