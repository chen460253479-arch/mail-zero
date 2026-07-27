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
};

export type CompleteDiscoveryRunInput = {
  syncId: string;
  owner: string;
  completedGeneration: number;
  checkpoint: VersionedProviderState;
  reconcileAfterMs: number;
};

export type ClaimDueDispatchesInput = {
  owner: string;
  limit: number;
  leaseForMs: number;
  reconcileBefore: Date;
  renewalBefore: Date;
  importBefore: Date;
};

export type ClaimedMailSyncDispatch = {
  syncId: string;
  discover: boolean;
  renew: boolean;
  importPending: boolean;
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
