import { finalizeSubmissionSentInTransaction, type MailCoreDependencies } from '@zero/mail-core';

import type { OutboundAcceptedResult } from '../../../mail-channel/contracts';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { ClaimedDelivery } from '../domain/delivery';

export type FinalizeAcceptedInput = {
  claimed: ClaimedDelivery;
  provider: string;
  accepted: OutboundAcceptedResult;
};

export const finalizeAcceptedDelivery = async (
  input: FinalizeAcceptedInput,
  dependencies: {
    unitOfWork: MailOutboundUnitOfWork;
    mailCoreDependencies: MailCoreDependencies;
  },
): Promise<void> => {
  await dependencies.unitOfWork.run(async (tx) => {
    await finalizeSubmissionSentInTransaction(dependencies.mailCoreDependencies, tx.mail, {
      accountId: input.claimed.delivery.mailAccountId as never,
      submissionId: input.claimed.delivery.submissionId as never,
      provider: input.provider,
      remoteMessageId: input.accepted.remoteMessageId,
      remoteThreadId: input.accepted.remoteThreadId,
      acceptedAt: input.accepted.acceptedAt,
    });
    await tx.outbound.markCompleted({
      deliveryId: input.claimed.delivery.id,
      leaseToken: input.claimed.delivery.leaseToken,
      completedAt: input.accepted.acceptedAt,
      remoteMessageId: input.accepted.remoteMessageId,
      remoteThreadId: input.accepted.remoteThreadId,
      providerCode: input.accepted.providerCode,
    });
  });
};
