import { transitionSubmissionInTransaction, type MailCoreDependencies } from '@zero/mail-core';

import type { OutboundErrorClassification } from '../../../mail-channel/contracts';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { ClaimedDelivery } from '../domain/delivery';

export type FinalizeFailedInput = {
  claimed: ClaimedDelivery;
  classification: OutboundErrorClassification;
  failedAt: Date;
};

export const finalizeFailedDelivery = async (
  input: FinalizeFailedInput,
  dependencies: {
    unitOfWork: MailOutboundUnitOfWork;
    mailCoreDependencies: MailCoreDependencies;
  },
): Promise<void> => {
  await dependencies.unitOfWork.run(async (tx) => {
    await transitionSubmissionInTransaction(dependencies.mailCoreDependencies, tx.mail, {
      accountId: input.claimed.delivery.mailAccountId as never,
      submissionId: input.claimed.delivery.submissionId as never,
      to: 'failed',
      outcome: {
        type: 'failure',
        retryable: false,
        providerCode: input.classification.providerCode,
        safeResponse: input.classification.safeResponse as never,
      },
    });
    await tx.outbound.markFailed({
      deliveryId: input.claimed.delivery.id,
      leaseToken: input.claimed.delivery.leaseToken,
      now: input.failedAt,
      error: input.classification,
    });
    await tx.submissionStatusNotifications.enqueueForMailSubmission({
      eventId: dependencies.mailCoreDependencies.idFactory.next<'MailNotification'>(),
      accountId: input.claimed.delivery.mailAccountId,
      mailSubmissionId: input.claimed.delivery.submissionId,
      status: 'failed',
      occurredAt: input.failedAt,
    });
  });
};
