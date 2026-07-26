import {
  MailCoreError,
  createSubmissionInTransaction,
  type CreateSubmissionInput,
  type MailCoreDependencies,
  type SubmissionRecord,
} from '@zero/mail-core';

import type { MailOutboundTransaction, MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundDeliveryRecord } from '../domain/delivery';
import type { OutboundWakeupPort } from '../domain/ports';

export type SubmitDraftForDeliveryInput = CreateSubmissionInput;

export type SubmitDraftForDeliveryResult = {
  submission: SubmissionRecord;
  delivery: OutboundDeliveryRecord;
};

export type EnqueueSubmissionDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  mailCoreDependencies: MailCoreDependencies;
  clock: { now(): Date };
  nextId(): string;
  wakeup: OutboundWakeupPort;
  onWakeupError?(error: unknown): void;
};

export type EnqueueSubmissionTransactionDependencies = Pick<
  EnqueueSubmissionDependencies,
  'clock' | 'mailCoreDependencies' | 'nextId'
>;

export const enqueueSubmissionInTransaction = async (
  input: SubmitDraftForDeliveryInput,
  dependencies: EnqueueSubmissionTransactionDependencies,
  tx: MailOutboundTransaction,
): Promise<SubmitDraftForDeliveryResult> => {
  const submission = await createSubmissionInTransaction(
    dependencies.mailCoreDependencies,
    tx.mail,
    input,
  );
  const existing = await tx.outbound.findBySubmission(input.accountId, submission.id);
  if (existing !== null) {
    return { submission, delivery: existing };
  }
  const account = await tx.mail.accounts.findById(input.accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', {
      entityId: input.accountId,
    });
  }
  const delivery = await tx.outbound.insert({
    id: dependencies.nextId(),
    mailAccountId: input.accountId,
    submissionId: submission.id,
    connectionId: account.connectionId,
    status: submission.status === 'scheduled' ? 'scheduled' : 'ready',
    availableAt: submission.sendAt,
    now: dependencies.clock.now(),
  });
  return { submission, delivery };
};

export const enqueueSubmission = async (
  input: SubmitDraftForDeliveryInput,
  dependencies: EnqueueSubmissionDependencies,
): Promise<SubmitDraftForDeliveryResult> => {
  const result = await dependencies.unitOfWork.run((tx) =>
    enqueueSubmissionInTransaction(input, dependencies, tx),
  );

  try {
    await dependencies.wakeup.enqueue({
      type: 'deliver',
      deliveryId: result.delivery.id,
    });
  } catch (error) {
    dependencies.onWakeupError?.(error);
  }
  return result;
};
