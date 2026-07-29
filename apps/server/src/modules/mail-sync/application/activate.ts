import type { IngressScope, VersionedProviderState } from '../domain/sync-state';
import type { InboundMailAdapterFactory } from '../domain/ingress-adapter';
import { MailSyncError } from '../domain/errors';

type ActivationSyncRecord = {
  id: string;
  status: 'activating' | 'active' | 'paused' | 'auth_error';
  checkpoint: VersionedProviderState | null;
  subscriptionExpiresAt?: Date | null;
};

type ActivationRepository = {
  createActivatingSync(input: {
    accountId: string;
    provider: string;
    scopeKey: string;
    scope: IngressScope;
  }): Promise<ActivationSyncRecord>;
  prepareActivation(input: { syncId: string }): Promise<ActivationSyncRecord>;
  storeActivationCheckpoint(input: {
    syncId: string;
    checkpoint: VersionedProviderState;
  }): Promise<ActivationSyncRecord>;
  activate(input: {
    syncId: string;
    subscriptionExpiresAt: Date | null;
    subscriptionExternalId?: string | null;
    subscriptionEndpointTokenHash?: string | null;
    encryptedSubscriptionSecret?: string | null;
    subscriptionEstablishedAt?: Date | null;
    subscriptionWarning: { code: string; message: string } | null;
  }): Promise<ActivationSyncRecord>;
};

export type ActivateInboundSyncInput = {
  accountId: string;
  connectionId: string;
  provider: string;
  scopeKey: string;
  scope: IngressScope;
  subscriptionTarget: VersionedProviderState | null;
};

export const activateInboundSync = async (
  input: ActivateInboundSyncInput,
  dependencies: {
    adapterFactory: InboundMailAdapterFactory;
    repository: ActivationRepository;
  },
): Promise<ActivationSyncRecord> => {
  let sync = await dependencies.repository.createActivatingSync({
    accountId: input.accountId,
    provider: input.provider,
    scopeKey: input.scopeKey,
    scope: input.scope,
  });
  if (sync.status === 'active') {
    return sync;
  }
  if (sync.status === 'paused' || sync.status === 'auth_error') {
    sync = await dependencies.repository.prepareActivation({ syncId: sync.id });
  }
  if (sync.status !== 'activating') {
    throw new MailSyncError('MAIL_SYNC_ACTIVATION_NOT_ALLOWED', 'permanent');
  }

  const adapter = await dependencies.adapterFactory.create(input.connectionId);
  if (adapter.provider !== input.provider) {
    throw new MailSyncError('MAIL_SYNC_PROVIDER_MISMATCH', 'permanent');
  }

  if (sync.checkpoint === null) {
    const checkpoint = await adapter.establishCheckpoint(input.scope);
    sync = await dependencies.repository.storeActivationCheckpoint({
      syncId: sync.id,
      checkpoint,
    });
  }
  if (sync.checkpoint === null) {
    throw new MailSyncError('MAIL_SYNC_ACTIVATION_CHECKPOINT_MISSING', 'permanent');
  }
  let subscriptionExpiresAt: Date | null = null;
  let subscriptionExternalId: string | null = null;
  let subscriptionEndpointTokenHash: string | null = null;
  let encryptedSubscriptionSecret: string | null = null;
  let subscriptionEstablishedAt: Date | null = null;
  let subscriptionWarning: { code: string; message: string } | null = null;
  if (input.subscriptionTarget !== null) {
    if (adapter.subscribe === undefined) {
      subscriptionWarning = {
        code: 'MAIL_SYNC_SUBSCRIPTION_UNSUPPORTED',
        message: 'MAIL_SYNC_SUBSCRIPTION_UNSUPPORTED',
      };
    } else {
      try {
        const subscription = await adapter.subscribe({
          scope: input.scope,
          checkpoint: sync.checkpoint,
          target: input.subscriptionTarget,
        });
        subscriptionExpiresAt = subscription.expiresAt;
        subscriptionExternalId = subscription.externalId ?? null;
        subscriptionEndpointTokenHash = subscription.endpointTokenHash ?? null;
        encryptedSubscriptionSecret = subscription.encryptedSecret ?? null;
        subscriptionEstablishedAt = subscription.establishedAt ?? null;
      } catch (error) {
        subscriptionWarning = {
          code: error instanceof MailSyncError ? error.code : 'MAIL_SYNC_SUBSCRIPTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  return dependencies.repository.activate({
    syncId: sync.id,
    subscriptionExpiresAt,
    subscriptionExternalId,
    subscriptionEndpointTokenHash,
    encryptedSubscriptionSecret,
    subscriptionEstablishedAt,
    subscriptionWarning,
  });
};
