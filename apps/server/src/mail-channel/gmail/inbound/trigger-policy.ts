import type { VersionedProviderState } from '../../../modules/mail-sync/domain/sync-state';
import type { GmailChannelConfig } from '../config';

export type GmailInboundTriggerPolicy = {
  subscriptionTarget: VersionedProviderState | null;
  reconcileBefore: Date;
  renewalBefore: Date;
  reconcileAfterMs: number;
};

export const resolveGmailInboundTriggerPolicy = (
  config: GmailChannelConfig,
  now: Date,
): GmailInboundTriggerPolicy => ({
  subscriptionTarget: config.inboxWatchEnabled
    ? {
        version: 1,
        topicName: config.providerConfig.topicName,
      }
    : null,
  reconcileBefore: config.scheduledSyncEnabled ? now : new Date(0),
  renewalBefore: config.inboxWatchEnabled
    ? new Date(now.getTime() + 24 * 60 * 60_000)
    : new Date(0),
  reconcileAfterMs: config.syncIntervalMinutes * 60_000,
});
