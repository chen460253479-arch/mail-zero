import type { IngressScope, VersionedProviderState } from '../domain/sync-state';
import type { IngressMessageAdded } from '../domain/ingress-event';
import type { inboundSync, inboundSyncItem } from './schema';

export type InboundSyncRecord = typeof inboundSync.$inferSelect;
export type InboundSyncItemRecord = typeof inboundSyncItem.$inferSelect;

export type CreateActivatingSyncInput = {
  accountId: string;
  provider: string;
  scopeKey: string;
  scope: IngressScope;
};

export type StoreActivationCheckpointInput = {
  syncId: string;
  checkpoint: VersionedProviderState;
};

export type ActivateSyncInput = {
  syncId: string;
  subscriptionExpiresAt: Date | null;
};

export type AcquireSyncLeaseInput = {
  syncId: string;
  owner: string;
  leaseForMs: number;
};

export type PersistDiscoveryPageInput = {
  syncId: string;
  owner: string;
  events: IngressMessageAdded[];
  checkpoint: VersionedProviderState;
};

export type ClaimPendingItemsInput = {
  syncId: string;
  owner: string;
  limit: number;
  leaseForMs: number;
};

type FinishItemInput = {
  itemId: string;
  owner: string;
  startedAt: Date;
};

export type MarkImportedInput = FinishItemInput & {
  localEmailId: string;
};

export type ScheduleRetryInput = FinishItemInput & {
  nextAttemptAt: Date;
  errorCode: string;
  errorMessage: string;
};

export type MarkFailedInput = FinishItemInput & {
  errorCode: string;
  errorMessage: string;
};
