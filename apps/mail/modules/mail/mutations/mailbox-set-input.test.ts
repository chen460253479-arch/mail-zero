import { describe, expect, it } from 'vitest';

import {
  buildCreateMailboxInput,
  buildDestroyMailboxInput,
  buildUpdateMailboxInput,
} from './mailbox-set-input';

describe('mailbox set input', () => {
  it('creates an explicit local folder or label with a client creation id', () => {
    expect(
      buildCreateMailboxInput({
        accountId: 'account-1',
        state: 'state-1',
        clientId: 'create-1',
        name: 'Projects',
        kind: 'folder',
        parentId: 'folder-parent',
      }),
    ).toEqual({
      accountId: 'account-1',
      ifInState: 'state-1',
      create: {
        'create-1': {
          name: 'Projects',
          kind: 'folder',
          role: null,
          parentId: 'folder-parent',
        },
      },
      update: {},
      destroy: [],
    });
  });

  it('updates every mutable local mailbox field and destroys only the requested mailbox', () => {
    expect(
      buildUpdateMailboxInput({
        accountId: 'account-1',
        state: 'state-2',
        mailboxId: 'label-1',
        name: 'VIP',
        color: '#ff0000',
        parentId: 'label-parent',
        sortOrder: 20,
        isSubscribed: false,
      }),
    ).toMatchObject({
      accountId: 'account-1',
      ifInState: 'state-2',
      update: {
        'label-1': {
          name: 'VIP',
          color: '#ff0000',
          parentId: 'label-parent',
          sortOrder: 20,
          isSubscribed: false,
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
