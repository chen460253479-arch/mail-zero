import type { MailOutboundCommand } from '../domain/ports';

export const parseMailOutboundCommand = (value: unknown): MailOutboundCommand => {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid mail outbound command');
  }
  const input = value as Record<string, unknown>;
  if (input.type === 'dispatch' && Object.keys(input).length === 1) {
    return { type: 'dispatch' };
  }
  if (
    (input.type === 'deliver' || input.type === 'reconcile') &&
    typeof input.deliveryId === 'string' &&
    input.deliveryId.length > 0 &&
    Object.keys(input).length === 2
  ) {
    return { type: input.type, deliveryId: input.deliveryId };
  }
  throw new TypeError('Invalid mail outbound command');
};
