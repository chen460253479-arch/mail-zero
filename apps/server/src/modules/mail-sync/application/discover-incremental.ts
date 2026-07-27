import type {
  InboundMailAdapterFactory,
  IngressScope,
  VersionedProviderState,
} from '../domain/ingress-adapter';
import type { IngressMessageAdded } from '../domain/ingress-event';
import { MailSyncError } from '../domain/errors';

export type DiscoverySyncRecord = {
  id: string;
  accountId: string;
  provider: string;
  scope: IngressScope;
  checkpoint: VersionedProviderState | null;
  requestedGeneration: number;
  completedGeneration: number;
  pendingCursorHint: string | null;
};

type FailureTransitionInput = {
  syncId: string;
  owner: string;
  errorCode: string;
  errorMessage: string;
};

type DiscoveryRepository = {
  acquireSyncLease(input: {
    syncId: string;
    owner: string;
    leaseForMs: number;
  }): Promise<DiscoverySyncRecord | null>;
  renewSyncLease(input: { syncId: string; owner: string; leaseForMs: number }): Promise<boolean>;
  persistDiscoveryPage(input: {
    syncId: string;
    owner: string;
    events: IngressMessageAdded[];
  }): Promise<{ inserted: number }>;
  completeDiscoveryRun(input: {
    syncId: string;
    owner: string;
    completedGeneration: number;
    checkpoint: VersionedProviderState;
    reconcileAfterMs: number;
  }): Promise<{
    requestedGeneration: number;
    completedGeneration: number;
    checkpoint: VersionedProviderState;
  }>;
  releaseSyncLease(input: { syncId: string; owner: string }): Promise<void>;
  pauseSync(input: FailureTransitionInput): Promise<void>;
  markAuthError(input: FailureTransitionInput): Promise<void>;
};

const errorDetails = (error: unknown): { errorCode: string; errorMessage: string } => ({
  errorCode: error instanceof MailSyncError ? error.code : 'MAIL_SYNC_DISCOVERY_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error),
});

export type DiscoverIncrementalResult = {
  status: 'busy' | 'completed' | 'paused' | 'auth_error';
  inserted: number;
};

export const discoverIncremental = async (
  input: {
    syncId: string;
    owner: string;
    leaseForMs: number;
    reconcileAfterMs?: number;
  },
  dependencies: {
    repository: DiscoveryRepository;
    getAdapterFactory(provider: string): InboundMailAdapterFactory;
    resolveConnectionId(accountId: string): Promise<string>;
  },
): Promise<DiscoverIncrementalResult> => {
  const sync = await dependencies.repository.acquireSyncLease(input);
  if (sync === null) {
    return { status: 'busy', inserted: 0 };
  }

  let inserted = 0;
  try {
    if (sync.checkpoint === null) {
      throw new MailSyncError('MAIL_SYNC_DISCOVERY_CHECKPOINT_MISSING', 'permanent');
    }
    const connectionId = await dependencies.resolveConnectionId(sync.accountId);
    const adapter = await dependencies.getAdapterFactory(sync.provider).create(connectionId);
    if (adapter.provider !== sync.provider) {
      throw new MailSyncError('MAIL_SYNC_PROVIDER_MISMATCH', 'permanent');
    }

    let checkpoint = sync.checkpoint;
    let targetGeneration = sync.requestedGeneration;
    const reconcileAfterMs = input.reconcileAfterMs ?? 5 * 60_000;
    const renewLease = async (): Promise<void> => {
      const renewed = await dependencies.repository.renewSyncLease({
        syncId: sync.id,
        owner: input.owner,
        leaseForMs: input.leaseForMs,
      });
      if (!renewed) {
        throw new MailSyncError('MAIL_SYNC_LEASE_LOST', 'retryable');
      }
    };

    try {
      do {
        let pageToken: string | null = null;
        let finalCheckpoint = checkpoint;
        do {
          await renewLease();
          const page = await adapter.discover({
            scope: sync.scope,
            checkpoint,
            pageToken,
          });
          await renewLease();
          const persisted = await dependencies.repository.persistDiscoveryPage({
            syncId: sync.id,
            owner: input.owner,
            events: page.events,
          });
          inserted += persisted.inserted;
          finalCheckpoint = page.checkpoint;
          pageToken = page.nextPageToken;
        } while (pageToken !== null);

        await renewLease();
        const completed = await dependencies.repository.completeDiscoveryRun({
          syncId: sync.id,
          owner: input.owner,
          completedGeneration: targetGeneration,
          checkpoint: finalCheckpoint,
          reconcileAfterMs,
        });
        checkpoint = completed.checkpoint;
        if (completed.requestedGeneration <= completed.completedGeneration) {
          break;
        }
        targetGeneration = completed.requestedGeneration;
      } while (true);
      return { status: 'completed', inserted };
    } catch (error) {
      if (error instanceof MailSyncError && error.code.startsWith('MAIL_SYNC_')) {
        throw error;
      }
      const classification = adapter.classifyError(error);
      const details = errorDetails(error);
      if (classification === 'authentication') {
        await dependencies.repository.markAuthError({
          syncId: sync.id,
          owner: input.owner,
          ...details,
        });
        return { status: 'auth_error', inserted };
      }
      if (classification === 'permanent') {
        await dependencies.repository.pauseSync({
          syncId: sync.id,
          owner: input.owner,
          ...details,
        });
        return { status: 'paused', inserted };
      }
      throw error;
    }
  } finally {
    await dependencies.repository.releaseSyncLease({
      syncId: sync.id,
      owner: input.owner,
    });
  }
};
