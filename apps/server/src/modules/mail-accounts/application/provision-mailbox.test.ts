import { describe, expect, it } from 'vitest';

import { provisionMailbox } from './provision-mailbox';

type Account = {
  id: string;
  userId: string;
  connectionId: string;
};

type Identity = {
  id: string;
  email: string;
  isDefault: boolean;
};

const createHarness = () => {
  const accounts = new Map<string, Account>();
  const identities = new Map<string, Identity[]>();
  const events: string[] = [];
  let failActivation = false;

  return {
    events,
    accounts,
    identities,
    failNextActivation() {
      failActivation = true;
    },
    dependencies: {
      findAccountByConnectionId: async (connectionId: string) => accounts.get(connectionId) ?? null,
      createAccount: async (input: {
        userId: string;
        connectionId: string;
        timezone: string;
        storageQuotaBytes: bigint | null;
      }) => {
        events.push('createAccount');
        const account = {
          id: `account-${accounts.size + 1}`,
          userId: input.userId,
          connectionId: input.connectionId,
        };
        accounts.set(input.connectionId, account);
        return account;
      },
      listIdentities: async (accountId: string) => identities.get(accountId) ?? [],
      createIdentity: async (input: {
        accountId: string;
        name: string | null;
        email: string;
        replyTo: null;
        makeDefault: boolean;
      }) => {
        events.push('createIdentity');
        const identity = {
          id: `identity-${identities.size + 1}`,
          email: input.email,
          isDefault: input.makeDefault,
        };
        identities.set(input.accountId, [...(identities.get(input.accountId) ?? []), identity]);
        return identity;
      },
      activateInbound: async (input: { connectionId: string; accountId: string }) => {
        events.push(`activateInbound:${input.connectionId}:${input.accountId}`);
        if (failActivation) throw new Error('watch failed');
      },
      markReconnectRequired: async (connectionId: string) => {
        events.push(`markReconnectRequired:${connectionId}`);
      },
    },
  };
};

const input = {
  userId: 'user-1',
  connectionId: 'connection-1',
  identity: {
    email: 'owner@example.com',
    name: 'Owner',
  },
};

describe('mailbox provisioning', () => {
  it('creates the local account and default identity before activating inbound sync', async () => {
    const harness = createHarness();

    const result = await provisionMailbox(input, harness.dependencies);

    expect(result).toEqual({
      accountId: 'account-1',
      identityId: 'identity-1',
    });
    expect(harness.events).toEqual([
      'createAccount',
      'createIdentity',
      'activateInbound:connection-1:account-1',
    ]);
  });

  it('reuses an existing local account and provider identity on retry', async () => {
    const harness = createHarness();

    const first = await provisionMailbox(input, harness.dependencies);
    harness.events.length = 0;
    const second = await provisionMailbox(input, harness.dependencies);

    expect(second).toEqual(first);
    expect(harness.events).toEqual(['activateInbound:connection-1:account-1']);
    expect(harness.identities.get('account-1')).toHaveLength(1);
  });

  it('marks the connection reconnect_required when inbound activation fails', async () => {
    const harness = createHarness();
    harness.failNextActivation();

    await expect(provisionMailbox(input, harness.dependencies)).rejects.toThrow('watch failed');
    expect(harness.events).toEqual([
      'createAccount',
      'createIdentity',
      'activateInbound:connection-1:account-1',
      'markReconnectRequired:connection-1',
    ]);
  });
});
