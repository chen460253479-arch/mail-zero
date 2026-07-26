import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundWakeupPort } from '../domain/ports';

export type DispatchDueReconciliationsDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  wakeup: OutboundWakeupPort;
};

export const dispatchDueReconciliations = async (
  input: { now: Date; limit: number },
  dependencies: DispatchDueReconciliationsDependencies,
): Promise<string[]> => {
  const deliveryIds = await dependencies.unitOfWork.run((tx) =>
    tx.outbound.listDueUncertain(input),
  );
  for (const deliveryId of deliveryIds) {
    await dependencies.wakeup.enqueue({ type: 'reconcile', deliveryId });
  }
  return deliveryIds;
};
