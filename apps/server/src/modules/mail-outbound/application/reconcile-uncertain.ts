import type { OutboundConnectionStatePort, OutboundCredentialResolver } from '../domain/ports';
import type { MailChannelRegistry } from '../../../mail-channel/registry';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import { nextOutboundRetryAt } from '../domain/retry-policy';
import type { FinalizeAcceptedInput } from './finalize-sent';

export type ReconcileUncertainDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  credentialResolver: OutboundCredentialResolver;
  registry: Pick<MailChannelRegistry, 'getOutbound'>;
  connectionState?: OutboundConnectionStatePort;
  clock: { now(): Date };
  jitter(): number;
  finalizeAccepted(input: FinalizeAcceptedInput): Promise<void>;
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
  const claimed = await dependencies.unitOfWork.run((tx) =>
    tx.outbound.claimById({
      ...input,
      attemptKind: 'reconcile',
      now,
    }),
  );
  if (claimed === null) {
    return 'not_found';
  }
  const snapshot = await dependencies.unitOfWork.run((tx) =>
    tx.outbound.loadMessage({
      deliveryId: claimed.delivery.id,
      leaseToken: claimed.delivery.leaseToken,
    }),
  );
  const credential = await dependencies.credentialResolver.resolve(snapshot.delivery.connectionId);
  const adapter = await dependencies.registry.getOutbound(snapshot.channelId).createAdapter({
    connectionId: snapshot.delivery.connectionId,
    credential,
  });
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
      tx.outbound.scheduleReconciliation({
        deliveryId: claimed.delivery.id,
        leaseToken: claimed.delivery.leaseToken,
        availableAt: retryAt,
        now,
        outcome: 'uncertain',
      }),
    );
    return 'retry_wait';
  }

  if (result.status === 'found') {
    await dependencies.finalizeAccepted({
      claimed,
      provider: adapter.provider,
      accepted: result.result,
    });
    return 'sent';
  }
  if (result.status === 'not_found') {
    if (claimed.delivery.reconciliationCount >= 3) {
      await dependencies.unitOfWork.run((tx) =>
        tx.outbound.scheduleResend({
          deliveryId: claimed.delivery.id,
          leaseToken: claimed.delivery.leaseToken,
          availableAt: now,
          now,
        }),
      );
      return 'not_found';
    }
    const retryAt = reconciliationRetryAt(
      now,
      claimed.delivery.reconciliationCount,
      null,
      dependencies.jitter,
    );
    await dependencies.unitOfWork.run((tx) =>
      tx.outbound.scheduleReconciliation({
        deliveryId: claimed.delivery.id,
        leaseToken: claimed.delivery.leaseToken,
        availableAt: retryAt,
        now,
        outcome: 'not_found',
      }),
    );
    return 'retry_wait';
  }

  const retryAt = reconciliationRetryAt(
    now,
    claimed.delivery.reconciliationCount,
    result.retryAfter,
    dependencies.jitter,
  );
  await dependencies.unitOfWork.run((tx) =>
    tx.outbound.scheduleReconciliation({
      deliveryId: claimed.delivery.id,
      leaseToken: claimed.delivery.leaseToken,
      availableAt: retryAt,
      now,
      outcome: 'uncertain',
    }),
  );
  return 'retry_wait';
};
