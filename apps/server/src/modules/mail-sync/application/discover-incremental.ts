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
  persistDiscoveryPage(input: {
    syncId: string;
    owner: string;
    events: IngressMessageAdded[];
    checkpoint: VersionedProviderState;
  }): Promise<{ inserted: number }>;
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
    let pageToken: string | null = null;
    try {
      do {
        const page = await adapter.discover({
          scope: sync.scope,
          checkpoint,
          pageToken,
        });
        const persisted = await dependencies.repository.persistDiscoveryPage({
          syncId: sync.id,
          owner: input.owner,
          events: page.events,
          checkpoint: page.checkpoint,
        });
        inserted += persisted.inserted;
        checkpoint = page.checkpoint;
        pageToken = page.nextPageToken;
      } while (pageToken !== null);
      return { status: 'completed', inserted };
    } catch (error) {
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
