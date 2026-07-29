import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { createMailTaskQueuePortForDatabase, type MailTaskQueuePort } from './task-queue';
import { handleZohoMailWebhookRequest } from '../../mail-channel/zoho-mail/inbound/webhook';
import type { ZeroEnv } from '../../env';
import { createDb } from '../../db';

const digestHex = async (value: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const handleZohoMailWebhookForEnvironment = async (
  runtimeEnv: ZeroEnv,
  request: Request,
  endpointToken: string,
  injectedTaskQueue?: MailTaskQueuePort,
): Promise<Response> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const repository = createPostgresMailSyncRepository(db);
    const taskQueue = injectedTaskQueue ?? createMailTaskQueuePortForDatabase(db);
    const endpointTokenHash = await digestHex(endpointToken);
    return await handleZohoMailWebhookRequest(request, endpointToken, {
      recordEndpointSignal: async () =>
        await repository.recordEndpointSignal({
          provider: 'zoho_mail',
          endpointTokenHash,
        }),
      enqueueDiscover: (syncId) => taskQueue.enqueueIngress({ type: 'discover', syncId }),
    });
  } finally {
    await conn.end();
  }
};
