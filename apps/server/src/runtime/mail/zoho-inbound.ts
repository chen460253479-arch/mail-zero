import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import {
  decryptCredential,
  encryptCredential,
} from '../../infrastructure/security/credential-encryption';
import { authorizationBinding, connection, inboundSync, mailAccount } from '../../db/schema';
import { handleZohoMailWebhookRequest } from '../../mail-channel/zoho-mail/inbound/webhook';
import type { MailInboundRuntimeResources } from './inbound';
import type { DB } from '../../db';

const MAX_PENDING_SECRETS = 32;

const parseStoredSecrets = (value: unknown): { secrets: string[]; secretBound: boolean } | null => {
  if (typeof value === 'string' && value.length > 0) {
    return { secrets: [value], secretBound: true };
  }
  if (
    Array.isArray(value) &&
    value.length <= MAX_PENDING_SECRETS &&
    value.every((secret) => typeof secret === 'string' && secret.length > 0)
  ) {
    return { secrets: [...new Set(value)], secretBound: false };
  }
  return null;
};

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
      let stored = { secrets: [] as string[], secretBound: false };
      if (existing?.encryptedSubscriptionSecret) {
        try {
          const decrypted = await decryptCredential<unknown>(
            existing.encryptedSubscriptionSecret,
            resources.environment.CREDENTIAL_ENCRYPTION_KEY,
          );
          const parsed = parseStoredSecrets(decrypted);
          if (parsed === null) return null;
          stored = parsed;
        } catch {
          return null;
        }
      }
      return {
        targetId: accountIds[0],
        syncIds: matches.map(({ syncId }) => syncId),
        ...stored,
      };
    },
    storeRegistrationSecret: async (secret) => {
      const rows = await db
        .select({
          accountId: inboundSync.accountId,
          encryptedSecret: inboundSync.encryptedSubscriptionSecret,
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
            sql`jsonb_typeof(${authorizationBinding.externalData}) = 'object'`,
            sql`jsonb_typeof(${authorizationBinding.externalData}->'accountId') = 'string'`,
            sql`jsonb_typeof(${authorizationBinding.externalData}->'folderIds') = 'array'`,
            sql`${authorizationBinding.externalData}->'folderIds' <> '[]'::jsonb`,
          ),
        );
      const byAccount = new Map<string, string | null>();
      for (const row of rows) {
        const existing = byAccount.get(row.accountId);
        if (existing === undefined || (existing === null && row.encryptedSecret !== null)) {
          byAccount.set(row.accountId, row.encryptedSecret);
        }
      }

      let accepted = false;
      for (const [accountId, encryptedSecret] of byAccount) {
        let pending: string[] = [];
        if (encryptedSecret !== null) {
          try {
            const decrypted = await decryptCredential<unknown>(
              encryptedSecret,
              resources.environment.CREDENTIAL_ENCRYPTION_KEY,
            );
            const parsed = parseStoredSecrets(decrypted);
            if (parsed === null) continue;
            if (parsed.secretBound) {
              if (parsed.secrets[0] === secret) accepted = true;
              continue;
            }
            pending = parsed.secrets;
          } catch {
            continue;
          }
        }
        if (pending.includes(secret)) {
          accepted = true;
          continue;
        }
        if (pending.length >= MAX_PENDING_SECRETS) continue;
        const encryptedPending = await encryptCredential(
          [...pending, secret],
          resources.environment.CREDENTIAL_ENCRYPTION_KEY,
        );
        await db
          .update(inboundSync)
          .set({
            encryptedSubscriptionSecret: encryptedPending,
            subscriptionEndpointTokenHash: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(inboundSync.accountId, accountId),
              eq(inboundSync.provider, 'zoho_mail'),
              eq(inboundSync.status, 'active'),
            ),
          );
        accepted = true;
      }
      return accepted;
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
