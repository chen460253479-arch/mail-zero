import { describe, expect, it } from 'vitest';

import type { MailAccountId, MailCoreDependencies, MailTransaction } from '../../src';
import { createMailAccount, createMailCore, createMailbox, updateEmail } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import { createSeededEmailHarness } from '../helpers/email-harness';

const createHarness = async () => {
  const dependencies = createMemoryMailCoreDependencies();
  const account = await createMailAccount(dependencies, {
    userId: 'user-1',
    connectionId: 'connection-1',
    timezone: 'UTC',
    storageQuotaBytes: null,
  });
  const updated = await createMailbox(dependencies, {
    accountId: account.id,
    name: 'Update me',
    kind: 'folder',
    role: null,
    parentId: null,
  });
  const destroyed = await createMailbox(dependencies, {
    accountId: account.id,
    name: 'Destroy me',
    kind: 'folder',
    role: null,
    parentId: null,
  });
  const inbox = (await dependencies.inspect.mailboxes(account.id)).find(
    ({ role }) => role === 'inbox',
  )!;
  return {
    dependencies,
    account,
    updated,
    destroyed,
    inbox,
    core: createMailCore(dependencies),
  };
};

describe('Mailbox set', () => {
  it('aborts the full set when ifInState is stale or malformed', async () => {
    const h = await createHarness();
    const before = await h.dependencies.inspect.mailboxes(h.account.id);
    const state = await h.dependencies.inspect.stateVersion(h.account.id);
    const input = {
      accountId: h.account.id,
      create: {
        created: {
          name: 'Should not exist',
          kind: 'folder' as const,
          role: null,
          parentId: null,
        },
      },
      update: {},
      destroy: [],
    };

    await expect(h.core.setMailboxes({ ...input, ifInState: '0' })).rejects.toMatchObject({
      code: 'STATE_MISMATCH',
    });
    await expect(h.core.setMailboxes({ ...input, ifInState: '01' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(await h.dependencies.inspect.mailboxes(h.account.id)).toEqual(before);
    expect(await h.dependencies.inspect.stateVersion(h.account.id)).toBe(state);
  });

  it('keeps valid creates, updates, and destroys while reporting domain failures per item', async () => {
    const h = await createHarness();
    const oldState = await h.dependencies.inspect.stateVersion(h.account.id);

    const result = await h.core.setMailboxes({
      accountId: h.account.id,
      ifInState: oldState.toString(),
      create: {
        valid: {
          name: 'Created',
          kind: 'folder',
          role: null,
          parentId: null,
        },
        invalid: {
          name: 'Second Inbox',
          kind: 'system',
          role: 'inbox',
          parentId: null,
        },
      },
      update: {
        [h.updated.id]: {
          color: '#336699',
          sortOrder: 42,
          isSubscribed: false,
        },
        [h.inbox.id]: {
          name: 'Renamed Inbox',
        },
      },
      destroy: [h.destroyed.id, h.inbox.id],
    });

    expect(result.oldState).toBe(oldState.toString());
    expect(result.newState).toBe((oldState + 1n).toString());
    expect(result.created.valid).toMatchObject({
      name: 'Created',
      kind: 'folder',
      role: null,
    });
    expect(result.notCreated.invalid).toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    expect(result.updated[h.updated.id]).toMatchObject({
      color: '#336699',
      sortOrder: 42,
      isSubscribed: false,
    });
    expect(result.notUpdated[h.inbox.id]).toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    expect(result.destroyed).toEqual([h.destroyed.id]);
    expect(result.notDestroyed[h.inbox.id]).toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });

    const requestChanges = (await h.dependencies.inspect.changes(h.account.id)).filter(
      ({ stateVersion }) => stateVersion === oldState + 1n,
    );
    expect(requestChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'mailbox',
          entityId: result.created.valid!.id,
          changeType: 'created',
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.updated.id,
          changeType: 'updated',
          changedProperties: ['color', 'sortOrder', 'isSubscribed'],
        }),
        expect.objectContaining({
          collection: 'mailbox',
          entityId: h.destroyed.id,
          changeType: 'destroyed',
        }),
      ]),
    );
  });

  it('does not allocate state when every item fails or is a no-op', async () => {
    const h = await createHarness();
    const oldState = await h.dependencies.inspect.stateVersion(h.account.id);

    const result = await h.core.setMailboxes({
      accountId: h.account.id,
      create: {},
      update: {
        [h.updated.id]: {
          name: h.updated.name,
          color: h.updated.color,
          sortOrder: h.updated.sortOrder,
          isSubscribed: h.updated.isSubscribed,
        },
        [h.inbox.id]: { role: null },
      },
      destroy: [h.inbox.id],
    });

    expect(result).toMatchObject({
      oldState: oldState.toString(),
      newState: oldState.toString(),
      created: {},
      destroyed: [],
    });
    expect(result.updated[h.updated.id]).toEqual(h.updated);
    expect(result.notUpdated[h.inbox.id]).toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    expect(result.notDestroyed[h.inbox.id]).toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    expect(await h.dependencies.inspect.stateVersion(h.account.id)).toBe(oldState);
  });

  it('reports an attached leaf label as destroyed after detaching it from retained email', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const label = await createMailbox(h.deps, {
      accountId: h.accountId,
      name: 'Removable label',
      kind: 'label',
      role: null,
      parentId: null,
    });
    await updateEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
      addMailboxIds: [label.id],
    });

    const result = await core.setMailboxes({
      accountId: h.accountId,
      create: {},
      update: {},
      destroy: [label.id],
    });

    expect(result.destroyed).toEqual([label.id]);
    expect(result.notDestroyed).toEqual({});
    expect(await h.inspect.email(h.emailId)).toMatchObject({
      mailboxIds: [h.inboxId],
      destroyedAt: null,
    });
  });

  it('aborts and rolls back successful items when a storage operation fails', async () => {
    const h = await createHarness();
    const before = await h.dependencies.inspect.mailboxes(h.account.id);
    const state = await h.dependencies.inspect.stateVersion(h.account.id);
    const baseUnitOfWork = h.dependencies.unitOfWork;
    const dependencies: MailCoreDependencies = {
      ...h.dependencies,
      unitOfWork: {
        run: <Result>(operation: (tx: MailTransaction) => Promise<Result>) =>
          baseUnitOfWork.run((tx) =>
            operation({
              ...tx,
              mailboxes: {
                ...tx.mailboxes,
                update: async () => {
                  throw new Error('database write failed');
                },
              },
            }),
          ),
      },
    };

    await expect(
      createMailCore(dependencies).setMailboxes({
        accountId: h.account.id,
        create: {
          created: {
            name: 'Rolled back',
            kind: 'folder',
            role: null,
            parentId: null,
          },
        },
        update: {
          [h.updated.id]: { color: '#ffffff' },
        },
        destroy: [],
      }),
    ).rejects.toThrow('database write failed');
    expect(await h.dependencies.inspect.mailboxes(h.account.id)).toEqual(before);
    expect(await h.dependencies.inspect.stateVersion(h.account.id)).toBe(state);
  });

  it('rejects a missing account as a request-level failure', async () => {
    const core = createMailCore(createMemoryMailCoreDependencies());

    await expect(
      core.setMailboxes({
        accountId: 'missing-account' as MailAccountId,
        create: {},
        update: {},
        destroy: [],
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });
});
