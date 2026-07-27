import { describe, expect, it } from 'vitest';

import { selectDeliveryIdentity, toMailAddresses } from './delivery-input';

const identities = [
  {
    id: 'identity-default',
    name: 'Default',
    email: 'default@example.com',
    replyTo: null,
    isDefault: true,
  },
  {
    id: 'identity-alias',
    name: 'Alias',
    email: 'alias@example.com',
    replyTo: null,
    isDefault: false,
  },
];

describe('delivery input', () => {
  it('selects an explicit RFC-style From identity without provider semantics', () => {
    expect(selectDeliveryIdentity(identities, 'Alias Name <alias@example.com>')?.id).toBe(
      'identity-alias',
    );
  });

  it('falls back to the local default identity', () => {
    expect(selectDeliveryIdentity(identities, undefined)?.id).toBe('identity-default');
  });

  it('converts composer recipients to local mail addresses', () => {
    expect(toMailAddresses(['person@example.com'])).toEqual([
      { email: 'person@example.com', name: 'person' },
    ]);
  });
});
