import { and, eq } from 'drizzle-orm';

import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { handleOutlookWebhookRequest } from '../../mail-channel/outlook/inbound/webhook';
import { decryptCredential } from '../../infrastructure/security/credential-encryption';
import type { MailInboundRuntimeResources } from './inbound';
import { inboundSync } from '../../db/schema';
import type { DB } from '../../db';

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
  db: DB,
  resources: MailInboundRuntimeResources,
  request: Request,
): Promise<Response> => {
  const repository = createPostgresMailSyncRepository(db);
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
          resources.environment.CREDENTIAL_ENCRYPTION_KEY,
        );
        return typeof expected === 'string' && (await sameSecret(expected, clientState));
      } catch {
        return false;
      }
    },
    recordSubscriptionSignal: (signal) => repository.recordSubscriptionSignal(signal),
    enqueueDiscover: (syncId) => resources.taskQueue.enqueueIngress({ type: 'discover', syncId }),
  });
};
