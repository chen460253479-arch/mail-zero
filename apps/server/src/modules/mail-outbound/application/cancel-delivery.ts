import {
  transitionSubmissionInTransaction,
  type CancelSubmissionInput,
  type MailCoreDependencies,
  type SubmissionRecord,
} from '@zero/mail-core';

import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundDeliveryRecord } from '../domain/delivery';
import { MailOutboundError } from '../domain/errors';

export type CancelPendingDeliveryResult = {
  submission: SubmissionRecord;
  delivery: OutboundDeliveryRecord;
};

export const cancelPendingDelivery = async (
  input: CancelSubmissionInput,
  dependencies: {
    unitOfWork: MailOutboundUnitOfWork;
    mailCoreDependencies: MailCoreDependencies;
    clock: { now(): Date };
  },
): Promise<CancelPendingDeliveryResult> =>
  await dependencies.unitOfWork.run(async (tx) => {
    const delivery = await tx.outbound.cancelPending({
      mailAccountId: input.accountId,
      submissionId: input.submissionId,
      now: dependencies.clock.now(),
    });
    if (delivery === null) {
      const existing = await tx.outbound.findBySubmission(input.accountId, input.submissionId);
      throw new MailOutboundError(
        existing === null ? 'DELIVERY_NOT_FOUND' : 'INVALID_DELIVERY_TRANSITION',
        'permanent',
        input.submissionId,
      );
    }
    const submission = await transitionSubmissionInTransaction(
      dependencies.mailCoreDependencies,
      tx.mail,
      {
        ...input,
        to: 'canceled',
        outcome: null,
      },
    );
    return { submission, delivery };
  });
