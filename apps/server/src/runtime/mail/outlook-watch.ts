import { and, eq } from 'drizzle-orm';

import { createMailChannelCredentialContext } from './channel-credential-context';
import { createCredentialAwareOutlookClient } from './channel-api-clients';
import { inboundSync, mailAccount } from '../../db/schema';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

export const stopOutlookWatchForConnection = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  connectionId: string,
): Promise<void> => {
  const subscriptions = await db
    .select({ externalId: inboundSync.subscriptionExternalId })
    .from(inboundSync)
    .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
    .where(and(eq(mailAccount.connectionId, connectionId), eq(inboundSync.provider, 'outlook')));
  const externalIds = subscriptions.flatMap(({ externalId }) => (externalId ? [externalId] : []));
  if (externalIds.length === 0) return;
  const context = await createMailChannelCredentialContext(db, runtimeEnv, connectionId);
  const client = createCredentialAwareOutlookClient(context);
  await Promise.all(externalIds.map((externalId) => client.deleteSubscription(externalId)));
};
