import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundWakeupPort } from '../domain/ports';

export type DispatchDueDeliveriesDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  wakeup: OutboundWakeupPort;
};

export const dispatchDueDeliveries = async (
  input: { now: Date; limit: number },
  dependencies: DispatchDueDeliveriesDependencies,
): Promise<string[]> => {
  const deliveryIds = await dependencies.unitOfWork.run((tx) => tx.outbound.listDue(input));
  for (const deliveryId of deliveryIds) {
    await dependencies.wakeup.enqueue({ type: 'deliver', deliveryId });
  }
  return deliveryIds;
};
