import {
  MailCoreError,
  createSubmissionInTransaction,
  prepareSubmission,
  type CreateSubmissionInput,
  type MailCoreDependencies,
  type SubmissionRecord,
  type PreparedSubmission,
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

const requireReadyAccount = async (
  accountId: SubmitDraftForDeliveryInput['accountId'],
  tx: MailOutboundTransaction,
) => {
  const account = await tx.mail.accounts.findById(accountId);
  if (account === null) {
    throw new MailCoreError('ACCOUNT_NOT_FOUND', {
      entityId: accountId,
    });
  }
  if (!(await tx.outbound.isConnectionReady(accountId, account.connectionId))) {
    throw new MailCoreError('ACCOUNT_NOT_ACTIVE', {
      entityId: accountId,
    });
  }
  return account;
};

export const enqueueSubmissionInTransaction = async (
  input: SubmitDraftForDeliveryInput,
  dependencies: EnqueueSubmissionTransactionDependencies,
  tx: MailOutboundTransaction,
  prepared: PreparedSubmission,
  committedObjectKeys: string[],
): Promise<SubmitDraftForDeliveryResult> => {
  await tx.mail.lockAccount(input.accountId);
  const priorSubmission = await tx.mail.submissions.findByIdempotencyKey(
    input.accountId,
    input.idempotencyKey,
  );
  const readyAccount =
    priorSubmission === null ? await requireReadyAccount(input.accountId, tx) : null;
  const submission = await createSubmissionInTransaction(
    dependencies.mailCoreDependencies,
    tx.mail,
    input,
    prepared,
    committedObjectKeys,
  );
  const existing = await tx.outbound.findBySubmission(input.accountId, submission.id);
  if (existing !== null) {
    return { submission, delivery: existing };
  }
  const account = readyAccount ?? (await requireReadyAccount(input.accountId, tx));
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
  const prepared = await prepareSubmission(dependencies.mailCoreDependencies, input);
  const committedObjectKeys: string[] = [];
  let callbackCompleted = false;
  let result: SubmitDraftForDeliveryResult;
  try {
    result = await dependencies.unitOfWork.run(async (tx) => {
      const queued = await enqueueSubmissionInTransaction(
        input,
        dependencies,
        tx,
        prepared,
        committedObjectKeys,
      );
      callbackCompleted = true;
      return queued;
    });
  } catch (error) {
    if (!callbackCompleted) {
      await Promise.allSettled(
        committedObjectKeys.map((objectKey) =>
          dependencies.mailCoreDependencies.blobStore.delete({
            accountId: input.accountId,
            objectKey,
          }),
        ),
      );
    }
    throw error;
  } finally {
    await dependencies.mailCoreDependencies.blobStore
      .deleteTemporary({
        accountId: input.accountId,
        temporaryKey: prepared.raw.temporaryKey,
      })
      .catch(() => undefined);
  }

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
