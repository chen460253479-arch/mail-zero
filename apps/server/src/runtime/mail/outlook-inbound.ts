import { and, eq } from 'drizzle-orm';

import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { createMailTaskQueuePortForDatabase, type MailTaskQueuePort } from './task-queue';
import { handleOutlookWebhookRequest } from '../../mail-channel/outlook/inbound/webhook';
import { decryptCredential } from '../../infrastructure/security/credential-encryption';
import { inboundSync } from '../../db/schema';
import type { ZeroEnv } from '../../env';
import { createDb } from '../../db';

const sameSecret = async (left: string, right: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  for (let index = 0; index < Math.max(leftBytes.byteLength, rightBytes.byteLength); index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
};

const isMessageResource = (resource: string): boolean => {
  const normalized = resource.toLocaleLowerCase('en-US');
  return normalized.includes('/messages/') || normalized.endsWith('/messages');
};

export const handleOutlookWebhookForEnvironment = async (
  runtimeEnv: ZeroEnv,
  request: Request,
  injectedTaskQueue?: MailTaskQueuePort,
): Promise<Response> => {
  const { db, conn } = createDb(runtimeEnv.HYPERDRIVE.connectionString);
  try {
    const repository = createPostgresMailSyncRepository(db);
    const taskQueue = injectedTaskQueue ?? createMailTaskQueuePortForDatabase(db);
    return await handleOutlookWebhookRequest(request, {
      verifySubscription: async ({ subscriptionId, clientState, resource }) => {
        if (!isMessageResource(resource)) return false;
        const record = await db.query.inboundSync.findFirst({
          where: and(
            eq(inboundSync.provider, 'outlook'),
            eq(inboundSync.status, 'active'),
            eq(inboundSync.subscriptionExternalId, subscriptionId),
          ),
          columns: {
            encryptedSubscriptionSecret: true,
          },
        });
        if (!record?.encryptedSubscriptionSecret) return false;
        try {
          const expected = await decryptCredential<unknown>(
            record.encryptedSubscriptionSecret,
            runtimeEnv.CREDENTIAL_ENCRYPTION_KEY,
          );
          return typeof expected === 'string' && (await sameSecret(expected, clientState));
        } catch {
          return false;
        }
      },
      recordSubscriptionSignal: (signal) => repository.recordSubscriptionSignal(signal),
      enqueueDiscover: (syncId) => taskQueue.enqueueIngress({ type: 'discover', syncId }),
    });
  } finally {
    await conn.end();
  }
};
