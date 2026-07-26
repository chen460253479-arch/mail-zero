import { describe, expect, it } from 'vitest';

import { parseMailOutboundCommand } from './commands';

describe('parseMailOutboundCommand', () => {
  it.each([
    null,
    'deliver',
    {},
    { type: 'deliver' },
    { type: 'deliver', deliveryId: '' },
    { type: 'reconcile', deliveryId: 'delivery-a', extra: true },
    { type: 'unknown', deliveryId: 'delivery-a' },
  ])('rejects unknown command shape %#', (value) => {
    expect(() => parseMailOutboundCommand(value)).toThrowError(TypeError);
  });

  it('accepts the closed command union', () => {
    expect(parseMailOutboundCommand({ type: 'dispatch' })).toEqual({ type: 'dispatch' });
    expect(parseMailOutboundCommand({ type: 'deliver', deliveryId: 'delivery-a' })).toEqual({
      type: 'deliver',
      deliveryId: 'delivery-a',
    });
    expect(parseMailOutboundCommand({ type: 'reconcile', deliveryId: 'delivery-a' })).toEqual({
      type: 'reconcile',
      deliveryId: 'delivery-a',
    });
  });
});
