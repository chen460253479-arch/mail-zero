import type { MailOutboundUnitOfWork } from '../postgres/unit-of-work';
import type { OutboundWakeupPort } from '../domain/ports';

export type RecoverExpiredLeaseDependencies = {
  unitOfWork: MailOutboundUnitOfWork;
  wakeup: OutboundWakeupPort;
};

export const recoverExpiredOutboundLeases = async (
  input: { now: Date; limit: number },
  dependencies: RecoverExpiredLeaseDependencies,
): Promise<string[]> => {
  const recovered = await dependencies.unitOfWork.run((tx) =>
    tx.outbound.recoverExpiredLeases(input),
  );
  for (const deliveryId of recovered) {
    await dependencies.wakeup.enqueue({
      type: 'reconcile',
      deliveryId,
    });
  }
  return recovered;
};
