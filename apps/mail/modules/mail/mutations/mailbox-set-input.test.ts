import { describe, expect, it } from 'vitest';

import {
  buildCreateMailboxInput,
  buildDestroyMailboxInput,
  buildUpdateMailboxInput,
} from './mailbox-set-input';

describe('mailbox set input', () => {
  it('creates a local label mailbox with a client creation id', () => {
    expect(
      buildCreateMailboxInput({
        accountId: 'account-1',
        state: 'state-1',
        clientId: 'create-1',
        name: 'Customer',
      }),
    ).toEqual({
      accountId: 'account-1',
      ifInState: 'state-1',
      create: {
        'create-1': {
          name: 'Customer',
          kind: 'label',
          role: null,
          parentId: null,
        },
      },
      update: {},
      destroy: [],
    });
  });

  it('updates and destroys only the requested local mailbox', () => {
    expect(
      buildUpdateMailboxInput({
        accountId: 'account-1',
        state: 'state-2',
        mailboxId: 'label-1',
        name: 'VIP',
        color: '#ff0000',
      }),
    ).toMatchObject({
      accountId: 'account-1',
      ifInState: 'state-2',
      update: {
        'label-1': {
          name: 'VIP',
          color: '#ff0000',
        },
      },
    });
    expect(
      buildDestroyMailboxInput({
        accountId: 'account-1',
        mailboxId: 'label-1',
      }),
    ).toMatchObject({
      accountId: 'account-1',
      destroy: ['label-1'],
    });
  });
});
