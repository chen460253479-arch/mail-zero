import type {
  InboundMailAdapterFactory,
  IngressScope,
  VersionedProviderState,
} from '../domain/ingress-adapter';
import { MailSyncError } from '../domain/errors';

type RenewalSyncRecord = {
  id: string;
  accountId: string;
  provider: string;
  scope: IngressScope;
  checkpoint: VersionedProviderState | null;
  subscriptionExternalId: string | null;
  subscriptionEndpointTokenHash: string | null;
  encryptedSubscriptionSecret: string | null;
  subscriptionEstablishedAt: Date | null;
  subscriptionExpiresAt: Date | null;
};

type RenewalRepository = {
  acquireSyncLease(input: {
    syncId: string;
    owner: string;
    leaseForMs: number;
  }): Promise<RenewalSyncRecord | null>;
  updateSubscription(input: {
    syncId: string;
    owner: string;
    subscriptionExpiresAt: Date | null;
    subscriptionExternalId?: string | null;
    subscriptionEndpointTokenHash?: string | null;
    encryptedSubscriptionSecret?: string | null;
    subscriptionEstablishedAt?: Date | null;
    subscriptionWarning: { code: string; message: string } | null;
  }): Promise<void>;
  pauseSync(input: {
    syncId: string;
    owner: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  markAuthError(input: {
    syncId: string;
    owner: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  releaseSyncLease(input: { syncId: string; owner: string }): Promise<void>;
};

const errorDetails = (error: unknown): { errorCode: string; errorMessage: string } => ({
  errorCode: error instanceof MailSyncError ? error.code : 'MAIL_SYNC_RENEWAL_FAILED',
  errorMessage: error instanceof Error ? error.message : String(error),
});

export const renewInboundSubscription = async (
  input: {
    syncId: string;
    owner: string;
    leaseForMs: number;
    subscriptionTarget: VersionedProviderState;
  },
  dependencies: {
    repository: RenewalRepository;
    resolveConnectionId(accountId: string): Promise<string>;
    getAdapterFactory(provider: string): InboundMailAdapterFactory;
  },
): Promise<{ status: 'busy' | 'renewed' | 'warning' | 'paused' | 'auth_error' }> => {
  const sync = await dependencies.repository.acquireSyncLease(input);
  if (sync === null) {
    return { status: 'busy' };
  }
  let adapter: Awaited<ReturnType<InboundMailAdapterFactory['create']>> | null = null;
  try {
    if (sync.checkpoint === null) {
      throw new MailSyncError('MAIL_SYNC_RENEWAL_CHECKPOINT_MISSING', 'permanent');
    }
    const connectionId = await dependencies.resolveConnectionId(sync.accountId);
    adapter = await dependencies.getAdapterFactory(sync.provider).create(connectionId);
    if (adapter.provider !== sync.provider) {
      throw new MailSyncError('MAIL_SYNC_PROVIDER_MISMATCH', 'permanent');
    }
    if (adapter.subscribe === undefined) {
      await dependencies.repository.updateSubscription({
        syncId: sync.id,
        owner: input.owner,
        subscriptionExpiresAt: null,
        subscriptionWarning: {
          code: 'MAIL_SYNC_SUBSCRIPTION_UNSUPPORTED',
          message: 'MAIL_SYNC_SUBSCRIPTION_UNSUPPORTED',
        },
      });
      return { status: 'warning' };
    }
    let subscription: Awaited<ReturnType<NonNullable<typeof adapter.subscribe>>>;
    try {
      subscription = await adapter.subscribe({
        scope: sync.scope,
        checkpoint: sync.checkpoint,
        target: input.subscriptionTarget,
        currentSubscription: {
          externalId: sync.subscriptionExternalId,
          endpointTokenHash: sync.subscriptionEndpointTokenHash,
          encryptedSecret: sync.encryptedSubscriptionSecret,
          establishedAt: sync.subscriptionEstablishedAt,
          expiresAt: sync.subscriptionExpiresAt,
        },
      });
    } catch (error) {
      const classification =
        error instanceof MailSyncError ? error.classification : adapter.classifyError(error);
      if (classification === 'authentication') {
        await dependencies.repository.markAuthError({
          syncId: sync.id,
          owner: input.owner,
          ...errorDetails(error),
        });
        return { status: 'auth_error' };
      }
      if (classification === 'permanent') {
        const details = errorDetails(error);
        await dependencies.repository.updateSubscription({
          syncId: sync.id,
          owner: input.owner,
          subscriptionExpiresAt: null,
          subscriptionWarning: {
            code: details.errorCode,
            message: details.errorMessage,
          },
        });
        return { status: 'warning' };
      }
      throw error;
    }
    await dependencies.repository.updateSubscription({
      syncId: sync.id,
      owner: input.owner,
      subscriptionExpiresAt: subscription.expiresAt,
      subscriptionExternalId: subscription.externalId ?? null,
      subscriptionEndpointTokenHash: subscription.endpointTokenHash ?? null,
      encryptedSubscriptionSecret: subscription.encryptedSecret ?? null,
      subscriptionEstablishedAt: subscription.establishedAt ?? null,
      subscriptionWarning: null,
    });
    return { status: 'renewed' };
  } catch (error) {
    const classification =
      error instanceof MailSyncError ? error.classification : adapter?.classifyError(error);
    if (classification === 'authentication') {
      await dependencies.repository.markAuthError({
        syncId: sync.id,
        owner: input.owner,
        ...errorDetails(error),
      });
      return { status: 'auth_error' };
    }
    if (classification === 'permanent') {
      await dependencies.repository.pauseSync({
        syncId: sync.id,
        owner: input.owner,
        ...errorDetails(error),
      });
      return { status: 'paused' };
    }
    throw error;
  } finally {
    await dependencies.repository.releaseSyncLease({
      syncId: sync.id,
      owner: input.owner,
    });
  }
};
