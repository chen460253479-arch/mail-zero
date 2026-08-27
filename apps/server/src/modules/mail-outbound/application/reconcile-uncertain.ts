import type { OutboundConnectionStatePort, OutboundCredentialResolver } from '../domain/ports';
import type { OutboundMailAdapter } from '../../../mail-channel/contracts';
import type { MailChannelRegistry } from '../../../mail-channel/registry';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundMessageSnapshot } from '../postgres/repository';
import { nextOutboundRetryAt } from '../domain/retry-policy';
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
  logger?: ReconciliationLogger;
};

const reconciliationRetryAt = (
  now: Date,
  count: number,
  retryAfter: Date | null,
  jitter: () => number,
): Date =>
  nextOutboundRetryAt({
    now,
    attemptNumber: Math.min(Math.max(count, 1), 3),
    kind: 'reconcile',
    providerRetryAfter: retryAfter,
    jitter,
  }) ?? new Date(now.getTime() + 600_000);

export const reconcileUncertainDelivery = async (
  input: { deliveryId: string; owner: string; leaseForMs: number },
  dependencies: ReconcileUncertainDependencies,
): Promise<'sent' | 'not_found' | 'retry_wait' | 'unsupported'> => {
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
    throw error;
  }
  if (adapter.reconcile === undefined) {
    await dependencies.unitOfWork.run((tx) =>
      tx.outbound.scheduleResend({
        deliveryId: claimed.delivery.id,
        leaseToken: claimed.delivery.leaseToken,
        availableAt: now,
        now,
        outcome: 'uncertain',
        reason: 'reconciliation_unsupported',
      }),
    );
    dependencies.logger?.warn('mail.outbound.reconciliation_unsupported', {
      ...baseFields,
      provider: adapter.provider,
      action: 'resend_scheduled',
      availableAt: now,
    });
    return 'unsupported';
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
    const retryAt = reconciliationRetryAt(
      now,
      claimed.delivery.reconciliationCount,
      classification.retryAfter,
      dependencies.jitter,
    );
    await dependencies.unitOfWork.run((tx) =>
      tx.outbound.scheduleResend({
        deliveryId: claimed.delivery.id,
        leaseToken: claimed.delivery.leaseToken,
        availableAt: retryAt,
        now,
        outcome: 'uncertain',
      }),
    );
    dependencies.logger?.error('mail.outbound.reconciliation_error_resend_scheduled', {
      ...baseFields,
      provider: adapter.provider,
      classification: classification.kind,
      providerCode: classification.providerCode,
      safeResponse: classification.safeResponse,
      action: 'resend_scheduled',
      retryAt,
      ...outboundFailureLogDetails(error),
    });
    return 'retry_wait';
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
    await dependencies.unitOfWork.run((tx) =>
      tx.outbound.scheduleResend({
        deliveryId: claimed.delivery.id,
        leaseToken: claimed.delivery.leaseToken,
        availableAt: now,
        now,
      }),
    );
    dependencies.logger?.warn('mail.outbound.reconciliation_not_found', {
      ...baseFields,
      provider: adapter.provider,
      action: 'resend_scheduled',
      availableAt: now,
    });
    return 'not_found';
  }

  const retryAt = reconciliationRetryAt(
    now,
    claimed.delivery.reconciliationCount,
    result.retryAfter,
    dependencies.jitter,
  );
  await dependencies.unitOfWork.run((tx) =>
    tx.outbound.scheduleResend({
      deliveryId: claimed.delivery.id,
      leaseToken: claimed.delivery.leaseToken,
      availableAt: retryAt,
      now,
      outcome: 'uncertain',
    }),
  );
  dependencies.logger?.error('mail.outbound.reconciliation_inconclusive', {
    ...baseFields,
    provider: adapter.provider,
    action: 'resend_scheduled',
    retryAt,
  });
  return 'retry_wait';
};
