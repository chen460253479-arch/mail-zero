import type { OutboundConnectionStatePort, OutboundCredentialResolver } from '../domain/ports';
import type {
  OutboundErrorClassification,
  OutboundMailAdapter,
} from '../../../mail-channel/contracts';
import type { MailChannelRegistry } from '../../../mail-channel/registry';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundMessageSnapshot } from '../postgres/repository';
import type { FinalizeFailedInput } from './finalize-failed';
import type { FinalizeAcceptedInput } from './finalize-sent';
import type { ClaimedDelivery } from '../domain/delivery';
import { outboundFailureLogDetails } from './failure-log';

type ReconciliationLogger = {
  debug(event: string, fields: Readonly<Record<string, unknown>>): void;
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
  warn(event: string, fields: Readonly<Record<string, unknown>>): void;
  error(event: string, fields: Readonly<Record<string, unknown>>): void;
};

export type ReconcileUncertainDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  credentialResolver: OutboundCredentialResolver;
  registry: Pick<MailChannelRegistry, 'getOutbound'>;
  connectionState?: OutboundConnectionStatePort;
  clock: { now(): Date };
  jitter(): number;
  finalizeAccepted(input: FinalizeAcceptedInput): Promise<void>;
  finalizeFailed(input: FinalizeFailedInput): Promise<void>;
  logger?: ReconciliationLogger;
};

const terminalClassification = (providerCode: string): OutboundErrorClassification => ({
  kind: 'permanent_failure',
  providerCode,
  safeResponse: 'permanent_failure',
  retryAfter: null,
});

export const reconcileUncertainDelivery = async (
  input: { deliveryId: string; owner: string; leaseForMs: number },
  dependencies: ReconcileUncertainDependencies,
): Promise<'sent' | 'not_found' | 'failed'> => {
  const now = dependencies.clock.now();
  let stage = 'claiming';
  dependencies.logger?.info('mail.outbound.reconciliation_started', {
    deliveryId: input.deliveryId,
    startedAt: now,
  });
  let claimed: ClaimedDelivery | null;
  try {
    claimed = await dependencies.unitOfWork.run((tx) =>
      tx.outbound.claimById({
        ...input,
        attemptKind: 'reconcile',
        now,
      }),
    );
  } catch (error) {
    dependencies.logger?.error('mail.outbound.reconciliation_failed', {
      deliveryId: input.deliveryId,
      stage,
      ...outboundFailureLogDetails(error),
    });
    throw error;
  }
  if (claimed === null) {
    dependencies.logger?.debug('mail.outbound.reconciliation_skipped', {
      deliveryId: input.deliveryId,
      reason: 'not_claimable',
    });
    return 'not_found';
  }
  const baseFields = {
    accountId: claimed.delivery.mailAccountId,
    connectionId: claimed.delivery.connectionId,
    submissionId: claimed.delivery.submissionId,
    deliveryId: claimed.delivery.id,
    reconciliationCount: claimed.delivery.reconciliationCount,
  };
  let snapshot: OutboundMessageSnapshot;
  let adapter: OutboundMailAdapter;
  try {
    stage = 'loading_message';
    snapshot = await dependencies.unitOfWork.run((tx) =>
      tx.outbound.loadMessage({
        deliveryId: claimed.delivery.id,
        leaseToken: claimed.delivery.leaseToken,
      }),
    );
    stage = 'resolving_credentials';
    const credential = await dependencies.credentialResolver.resolve(
      snapshot.delivery.connectionId,
    );
    stage = 'creating_adapter';
    adapter = await dependencies.registry.getOutbound(snapshot.channelId).createAdapter({
      connectionId: snapshot.delivery.connectionId,
      credential,
    });
  } catch (error) {
    dependencies.logger?.error('mail.outbound.reconciliation_failed', {
      ...baseFields,
      stage,
      ...outboundFailureLogDetails(error),
    });
    await dependencies.finalizeFailed({
      claimed,
      classification: terminalClassification('RECONCILIATION_PREPARATION_FAILED'),
      failedAt: now,
    });
    return 'failed';
  }
  if (adapter.reconcile === undefined) {
    await dependencies.finalizeFailed({
      claimed,
      classification: terminalClassification('RECONCILIATION_UNSUPPORTED'),
      failedAt: now,
    });
    dependencies.logger?.warn('mail.outbound.reconciliation_unsupported', {
      ...baseFields,
      provider: adapter.provider,
      action: 'delivery_failed_no_retry',
    });
    return 'failed';
  }

  let result: Awaited<ReturnType<NonNullable<typeof adapter.reconcile>>>;
  try {
    result = await adapter.reconcile({
      accountId: snapshot.delivery.mailAccountId,
      connectionId: snapshot.delivery.connectionId,
      submissionId: snapshot.delivery.submissionId,
      deliveryId: snapshot.delivery.id,
      messageId: snapshot.messageId,
      remoteThreadId:
        snapshot.remoteThreadReferences.find(({ provider }) => provider === adapter.provider)
          ?.remoteThreadId ?? null,
    });
  } catch (error) {
    const classification = adapter.classifyError(error);
    if (
      classification.kind === 'authentication_required' &&
      dependencies.connectionState !== undefined
    ) {
      await dependencies.connectionState.markAuthenticationRequired(snapshot.delivery.connectionId);
    }
    await dependencies.finalizeFailed({ claimed, classification, failedAt: now });
    dependencies.logger?.error('mail.outbound.reconciliation_failed', {
      ...baseFields,
      provider: adapter.provider,
      classification: classification.kind,
      providerCode: classification.providerCode,
      safeResponse: classification.safeResponse,
      action: 'delivery_failed_no_retry',
      ...outboundFailureLogDetails(error),
    });
    return 'failed';
  }

  if (result.status === 'found') {
    await dependencies.finalizeAccepted({
      claimed,
      provider: adapter.provider,
      accepted: result.result,
    });
    dependencies.logger?.info('mail.outbound.reconciliation_succeeded', {
      ...baseFields,
      provider: adapter.provider,
      remoteMessageId: result.result.remoteMessageId,
      acceptedAt: result.result.acceptedAt,
    });
    return 'sent';
  }
  if (result.status === 'not_found') {
    await dependencies.finalizeFailed({
      claimed,
      classification: terminalClassification('RECONCILIATION_NOT_FOUND'),
      failedAt: now,
    });
    dependencies.logger?.warn('mail.outbound.reconciliation_not_found', {
      ...baseFields,
      provider: adapter.provider,
      action: 'delivery_failed_no_retry',
    });
    return 'failed';
  }

  await dependencies.finalizeFailed({
    claimed,
    classification: terminalClassification('RECONCILIATION_INCONCLUSIVE'),
    failedAt: now,
  });
  dependencies.logger?.error('mail.outbound.reconciliation_inconclusive', {
    ...baseFields,
    provider: adapter.provider,
    action: 'delivery_failed_no_retry',
  });
  return 'failed';
};
