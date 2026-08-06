import { authorizationBinding, connection, inboundSync, mailAccount } from '../../db/schema';
import { handleZohoMailWebhookRequest } from '../../mail-channel/zoho-mail/inbound/webhook';
import type { MailInboundRuntimeResources } from './inbound';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../../db';

export const handleZohoMailWebhookForEnvironment = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  request: Request,
  requestId?: string,
): Promise<Response> =>
  await handleZohoMailWebhookRequest(request, {
    ...(resources.logger === undefined ? {} : { logger: resources.logger }),
    ...(requestId === undefined ? {} : { requestId }),
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
      return {
        targetId: accountIds[0],
        syncIds: matches.map(({ syncId }) => syncId),
      };
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
