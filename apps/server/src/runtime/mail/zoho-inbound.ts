import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  decryptCredential,
  encryptCredential,
} from '../../infrastructure/security/credential-encryption';
import { authorizationBinding, connection, inboundSync, mailAccount } from '../../db/schema';
import { handleZohoMailWebhookRequest } from '../../mail-channel/zoho-mail/inbound/webhook';
import type { MailInboundRuntimeResources } from './inbound';
import type { DB } from '../../db';

export const handleZohoMailWebhookForEnvironment = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  request: Request,
): Promise<Response> =>
  await handleZohoMailWebhookRequest(request, {
    resolveTarget: async ({ folderId }) => {
      const matches = await db
        .select({
          syncId: inboundSync.id,
          accountId: inboundSync.accountId,
        })
        .from(inboundSync)
        .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
        .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
        .innerJoin(authorizationBinding, eq(authorizationBinding.connectionId, connection.id))
        .where(
          and(
            eq(inboundSync.provider, 'zoho_mail'),
            eq(inboundSync.status, 'active'),
            eq(connection.status, 'connected'),
            sql`${inboundSync.scope}->'externalData'->'folderIds' @> ${JSON.stringify([folderId])}::jsonb`,
            sql`${authorizationBinding.externalData}->>'accountId' = ${inboundSync.scope}->'externalData'->>'accountId'`,
          ),
        );
      const accountIds = [...new Set(matches.map(({ accountId }) => accountId))];
      if (matches.length === 0 || accountIds.length !== 1 || accountIds[0] === undefined) {
        return null;
      }

      const existing = await db.query.inboundSync.findFirst({
        where: and(
          eq(inboundSync.accountId, accountIds[0]),
          eq(inboundSync.provider, 'zoho_mail'),
          eq(inboundSync.status, 'active'),
          isNotNull(inboundSync.encryptedSubscriptionSecret),
        ),
        columns: { encryptedSubscriptionSecret: true },
      });
      let secret: string | null = null;
      if (existing?.encryptedSubscriptionSecret) {
        try {
          const decrypted = await decryptCredential<unknown>(
            existing.encryptedSubscriptionSecret,
            resources.environment.CREDENTIAL_ENCRYPTION_KEY,
          );
          if (typeof decrypted !== 'string' || decrypted.length === 0) return null;
          secret = decrypted;
        } catch {
          return null;
        }
      }
      return {
        targetId: accountIds[0],
        syncIds: matches.map(({ syncId }) => syncId),
        secret,
      };
    },
    storeSecret: async (accountId, secret) => {
      const encryptedSecret = await encryptCredential(
        secret,
        resources.environment.CREDENTIAL_ENCRYPTION_KEY,
      );
      await db
        .update(inboundSync)
        .set({
          encryptedSubscriptionSecret: encryptedSecret,
          subscriptionEndpointTokenHash: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(inboundSync.accountId, accountId),
            eq(inboundSync.provider, 'zoho_mail'),
            eq(inboundSync.status, 'active'),
            isNull(inboundSync.encryptedSubscriptionSecret),
          ),
        );
    },
    recordSignal: async (syncIds) => {
      const rows = await db
        .update(inboundSync)
        .set({
          requestedGeneration: sql`${inboundSync.requestedGeneration} + 1`,
          lastSignalAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(inboundSync.id, syncIds),
            eq(inboundSync.provider, 'zoho_mail'),
            eq(inboundSync.status, 'active'),
          ),
        )
        .returning({ id: inboundSync.id });
      return rows.map(({ id }) => id);
    },
    enqueueDiscover: (syncId) => resources.taskQueue.enqueueIngress({ type: 'discover', syncId }),
  });
