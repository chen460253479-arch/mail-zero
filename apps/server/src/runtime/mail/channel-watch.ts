import { eq } from 'drizzle-orm';

import { createPostgresMailSyncRepository } from '../../modules/mail-sync/postgres/sync-repository';
import { connection, inboundSync, mailAccount } from '../../db/schema';
import type { MailChannelId } from '../../mail-channel/contracts';
import { stopOutlookWatchForConnection } from './outlook-watch';
import { stopGmailWatchForConnection } from './gmail-inbound';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

const remoteWatchStopper = (
  channelId: MailChannelId,
): ((db: DB, runtimeEnv: ZeroEnv, connectionId: string) => Promise<void>) | null => {
  if (channelId === 'gmail') return stopGmailWatchForConnection;
  if (channelId === 'outlook') return stopOutlookWatchForConnection;
  return null;
};

export const disableChannelSubscriptions = async (
  db: DB,
  runtimeEnv: ZeroEnv,
  channelId: MailChannelId,
): Promise<void> => {
  const rows = await db
    .select({ connectionId: connection.id })
    .from(inboundSync)
    .innerJoin(mailAccount, eq(mailAccount.id, inboundSync.accountId))
    .innerJoin(connection, eq(connection.id, mailAccount.connectionId))
    .where(eq(inboundSync.provider, channelId));
  const connectionIds = [...new Set(rows.map(({ connectionId }) => connectionId))];
  const stopRemoteWatch = remoteWatchStopper(channelId);
  if (stopRemoteWatch !== null) {
    const results = await Promise.allSettled(
      connectionIds.map((connectionId) => stopRemoteWatch(db, runtimeEnv, connectionId)),
    );
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        console.warn('MAIL_CHANNEL_WATCH_STOP_FAILED', {
          channelId,
          connectionId: connectionIds[index],
          errorName: result.reason instanceof Error ? result.reason.name : 'UnknownError',
        });
      }
    }
  }
  await createPostgresMailSyncRepository(db).disableSubscriptions({
    provider: channelId,
  });
};
