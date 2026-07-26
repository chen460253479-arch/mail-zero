import type { BlobStore, MailAccountId } from '@zero/mail-core';

import type {
  OutboundAcceptedResult,
  OutboundErrorClassification,
} from '../../../mail-channel/contracts';
import type { OutboundConnectionStatePort, OutboundCredentialResolver } from '../domain/ports';
import type { MailChannelRegistry } from '../../../mail-channel/registry';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import { nextOutboundRetryAt } from '../domain/retry-policy';
import type { FinalizeFailedInput } from './finalize-failed';
import type { FinalizeAcceptedInput } from './finalize-sent';
import type { ClaimedDelivery } from '../domain/delivery';

export type DeliverDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  blobStore: Pick<BlobStore, 'get'>;
  credentialResolver: OutboundCredentialResolver;
  registry: Pick<MailChannelRegistry, 'getOutbound'>;
  connectionState: OutboundConnectionStatePort;
  clock: { now(): Date };
  jitter(): number;
  finalizeAccepted(input: FinalizeAcceptedInput): Promise<void>;
  finalizeFailed(input: FinalizeFailedInput): Promise<void>;
};

const retryableKinds = new Set<OutboundErrorClassification['kind']>([
  'rate_limited',
  'temporary_failure',
  'authentication_required',
  'quota_exceeded',
]);

export const deliverClaimed = async (
  claimed: ClaimedDelivery,
  dependencies: DeliverDependencies,
): Promise<'sent' | 'retry_wait' | 'uncertain' | 'failed'> => {
  const snapshot = await dependencies.unitOfWork.run((tx) =>
    tx.outbound.loadMessage({
      deliveryId: claimed.delivery.id,
      leaseToken: claimed.delivery.leaseToken,
    }),
  );
  const rawMime = await dependencies.blobStore.get({
    accountId: snapshot.delivery.mailAccountId as MailAccountId,
    objectKey: snapshot.raw.objectKey,
  });
  const credential = await dependencies.credentialResolver.resolve(snapshot.delivery.connectionId);
  const capability = dependencies.registry.getOutbound(snapshot.channelId);
  const adapter = await capability.createAdapter({
    connectionId: snapshot.delivery.connectionId,
    credential,
  });
  const remoteThreadId =
    snapshot.remoteThreadReferences.find((reference) => reference.provider === adapter.provider)
      ?.remoteThreadId ?? null;
  let accepted: OutboundAcceptedResult;
  try {
    accepted = await adapter.send({
      accountId: snapshot.delivery.mailAccountId,
      connectionId: snapshot.delivery.connectionId,
      submissionId: snapshot.delivery.submissionId,
      deliveryId: snapshot.delivery.id,
      envelope: snapshot.envelope,
      rawMime,
      messageId: snapshot.messageId,
      remoteThreadId,
    });
  } catch (error) {
    const classification = adapter.classifyError(error);
    const now = dependencies.clock.now();
    if (classification.kind === 'authentication_required') {
      await dependencies.connectionState.markAuthenticationRequired(snapshot.delivery.connectionId);
    }
    if (retryableKinds.has(classification.kind)) {
      const retryAt = nextOutboundRetryAt({
        now,
        attemptNumber: claimed.attemptNumber,
        kind: claimed.attemptKind,
        providerRetryAfter: classification.retryAfter,
        jitter: dependencies.jitter,
      });
      if (retryAt !== null) {
        await dependencies.unitOfWork.run((tx) =>
          tx.outbound.scheduleRetry({
            deliveryId: claimed.delivery.id,
            leaseToken: claimed.delivery.leaseToken,
            retryAt,
            now,
            error: classification,
          }),
        );
        return 'retry_wait';
      }
    }
    if (classification.kind === 'uncertain') {
      await dependencies.unitOfWork.run((tx) =>
        tx.outbound.markUncertain({
          deliveryId: claimed.delivery.id,
          leaseToken: claimed.delivery.leaseToken,
          now,
          error: classification,
        }),
      );
      return 'uncertain';
    }
    await dependencies.finalizeFailed({
      claimed,
      classification,
      failedAt: now,
    });
    return 'failed';
  }

  await dependencies.finalizeAccepted({
    claimed,
    provider: adapter.provider,
    accepted,
  });
  return 'sent';
};
