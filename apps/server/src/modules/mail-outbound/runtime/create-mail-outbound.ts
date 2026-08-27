import type {
  BlobStore,
  CancelSubmissionInput,
  CreateSubmissionInput,
  MailCoreDependencies,
} from '@zero/mail-core';

import {
  setOutboundSubmissions,
  type SetOutboundSubmissionsInput,
  type SetOutboundSubmissionsResult,
} from '../application/set-submissions';
import type {
  MailOutboundCommand,
  OutboundConnectionStatePort,
  OutboundCredentialResolver,
  OutboundWakeupPort,
} from '../domain/ports';
import {
  dispatchDueReconciliations,
  type DispatchDueReconciliationsDependencies,
} from '../application/dispatch-due-reconciliations';
import {
  recoverExpiredOutboundLeases,
  type RecoverExpiredLeaseDependencies,
} from '../application/recover-expired-leases';
import {
  dispatchDueDeliveries,
  type DispatchDueDeliveriesDependencies,
} from '../application/dispatch-due-deliveries';
import {
  reconcileUncertainDelivery,
  type ReconcileUncertainDependencies,
} from '../application/reconcile-uncertain';
import {
  enqueueSubmission,
  type SubmitDraftForDeliveryResult,
} from '../application/enqueue-submission';
import {
  cancelPendingDelivery,
  type CancelPendingDeliveryResult,
} from '../application/cancel-delivery';
import { finalizeAcceptedDelivery, type FinalizeAcceptedInput } from '../application/finalize-sent';
import { finalizeFailedDelivery, type FinalizeFailedInput } from '../application/finalize-failed';
import { deliverClaimed, type DeliverDependencies } from '../application/deliver';
import type { MailChannelRegistry } from '../../../mail-channel/registry';
import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { ClaimedDelivery } from '../domain/delivery';

type RuntimeOperations = {
  enqueueSubmission: typeof enqueueSubmission;
  deliverClaimed(
    claimed: ClaimedDelivery,
    dependencies: DeliverDependencies,
  ): ReturnType<typeof deliverClaimed>;
  reconcileUncertain: typeof reconcileUncertainDelivery;
  finalizeAccepted(input: FinalizeAcceptedInput): Promise<void>;
  finalizeFailed(input: FinalizeFailedInput): Promise<void>;
  cancelPending: typeof cancelPendingDelivery;
};

export type CreateMailOutboundRuntimeDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  mailCoreDependencies: MailCoreDependencies;
  blobStore: Pick<BlobStore, 'get'>;
  credentialResolver: OutboundCredentialResolver;
  registry: Pick<MailChannelRegistry, 'getOutbound'>;
  connectionState: OutboundConnectionStatePort;
  wakeup: OutboundWakeupPort;
  clock: { now(): Date };
  nextId(): string;
  newLeaseOwner(): string;
  leaseForMs: number;
  scanLimit: number;
  jitter(): number;
  logger?: ReconcileUncertainDependencies['logger'];
  onWakeupError?(error: unknown): void;
  operations?: Partial<RuntimeOperations>;
};

export interface MailOutboundRuntime {
  submit(input: CreateSubmissionInput): Promise<SubmitDraftForDeliveryResult>;
  cancel(input: CancelSubmissionInput): Promise<CancelPendingDeliveryResult>;
  set(input: SetOutboundSubmissionsInput): Promise<SetOutboundSubmissionsResult>;
  process(command: MailOutboundCommand): Promise<void>;
  enqueueDue(): Promise<{ due: number; expired: number; uncertain: number }>;
}

export const createMailOutboundRuntime = (
  dependencies: CreateMailOutboundRuntimeDependencies,
): MailOutboundRuntime => {
  const finalizeAccepted = async (input: FinalizeAcceptedInput): Promise<void> =>
    await (
      dependencies.operations?.finalizeAccepted ??
      ((value) =>
        finalizeAcceptedDelivery(value, {
          unitOfWork: dependencies.unitOfWork,
          mailCoreDependencies: dependencies.mailCoreDependencies,
        }))
    )(input);
  const finalizeFailed = async (input: FinalizeFailedInput): Promise<void> =>
    await (
      dependencies.operations?.finalizeFailed ??
      ((value) =>
        finalizeFailedDelivery(value, {
          unitOfWork: dependencies.unitOfWork,
          mailCoreDependencies: dependencies.mailCoreDependencies,
        }))
    )(input);

  const enqueueDue = async (): Promise<{
    due: number;
    expired: number;
    uncertain: number;
  }> => {
    const input = {
      now: dependencies.clock.now(),
      limit: dependencies.scanLimit,
    };
    const shared = {
      unitOfWork: dependencies.unitOfWork,
      wakeup: dependencies.wakeup,
    };
    const due = await dispatchDueDeliveries(
      input,
      shared satisfies DispatchDueDeliveriesDependencies,
    );
    const uncertain = await dispatchDueReconciliations(
      input,
      shared satisfies DispatchDueReconciliationsDependencies,
    );
    const expired = await recoverExpiredOutboundLeases(
      input,
      shared satisfies RecoverExpiredLeaseDependencies,
    );
    return {
      due: due.length,
      uncertain: uncertain.length,
      expired: expired.length,
    };
  };

  return {
    cancel: async (input) =>
      await (dependencies.operations?.cancelPending ?? cancelPendingDelivery)(input, {
        unitOfWork: dependencies.unitOfWork,
        mailCoreDependencies: dependencies.mailCoreDependencies,
        clock: dependencies.clock,
      }),
    submit: async (input) =>
      await (dependencies.operations?.enqueueSubmission ?? enqueueSubmission)(input, {
        unitOfWork: dependencies.unitOfWork,
        mailCoreDependencies: dependencies.mailCoreDependencies,
        clock: dependencies.clock,
        nextId: dependencies.nextId,
        wakeup: dependencies.wakeup,
        onWakeupError: dependencies.onWakeupError,
      }),
    set: async (input) =>
      await setOutboundSubmissions(input, {
        unitOfWork: dependencies.unitOfWork,
        mailCoreDependencies: dependencies.mailCoreDependencies,
        clock: dependencies.clock,
        nextId: dependencies.nextId,
        wakeup: dependencies.wakeup,
        onWakeupError: dependencies.onWakeupError,
      }),
    process: async (command) => {
      if (command.type === 'dispatch') {
        await enqueueDue();
        return;
      }
      if (command.type === 'reconcile') {
        await (dependencies.operations?.reconcileUncertain ?? reconcileUncertainDelivery)(
          {
            deliveryId: command.deliveryId,
            owner: dependencies.newLeaseOwner(),
            leaseForMs: dependencies.leaseForMs,
          },
          {
            unitOfWork: dependencies.unitOfWork,
            credentialResolver: dependencies.credentialResolver,
            registry: dependencies.registry,
            connectionState: dependencies.connectionState,
            clock: dependencies.clock,
            jitter: dependencies.jitter,
            finalizeAccepted,
            logger: dependencies.logger,
          } satisfies ReconcileUncertainDependencies,
        );
        return;
      }

      const claimed = await dependencies.unitOfWork.run((tx) =>
        tx.outbound.claimById({
          deliveryId: command.deliveryId,
          owner: dependencies.newLeaseOwner(),
          attemptKind: 'send',
          now: dependencies.clock.now(),
          leaseForMs: dependencies.leaseForMs,
        }),
      );
      if (claimed === null) return;
      await (dependencies.operations?.deliverClaimed ?? deliverClaimed)(claimed, {
        unitOfWork: dependencies.unitOfWork,
        blobStore: dependencies.blobStore,
        credentialResolver: dependencies.credentialResolver,
        registry: dependencies.registry,
        connectionState: dependencies.connectionState,
        clock: dependencies.clock,
        jitter: dependencies.jitter,
        logger: dependencies.logger,
        finalizeAccepted,
        finalizeFailed,
      });
    },
    enqueueDue,
  };
};
