import { describe, expect, it } from 'vitest';

import { createMailAccount, createMailbox, destroyMailbox, updateMailbox } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailCoreDependencies, MailTransaction } from '../../src';

describe('Mailbox commands', () => {
  it('enforces role, name, parent, child, content, and system invariants', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;

    await expect(
      createMailbox(deps, {
        accountId: account.id,
        name: 'Second inbox',
        kind: 'system',
        role: 'inbox',
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    await expect(
      updateMailbox(deps, {
        accountId: account.id,
        mailboxId: inbox.id,
        name: 'Renamed inbox',
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });

    const parent = await createMailbox(deps, {
      accountId: account.id,
      name: 'Projects',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    await createMailbox(deps, {
      accountId: account.id,
      name: 'Zero',
      kind: 'folder',
      role: null,
      parentId: parent.id,
    });
    await expect(
      createMailbox(deps, {
        accountId: account.id,
        name: ' projects ',
        kind: 'folder',
        role: null,
        parentId: null,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_NAME_CONFLICT' });

    const other = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-2',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    await expect(
      createMailbox(deps, {
        accountId: other.id,
        name: 'Cross account',
        kind: 'folder',
        role: null,
        parentId: parent.id,
      }),
    ).rejects.toMatchObject({ code: 'CROSS_ACCOUNT_REFERENCE' });

    await expect(
      destroyMailbox(deps, {
        accountId: account.id,
        mailboxId: parent.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_HAS_CHILD' });
    const mailboxWithEmail = await createMailbox(deps, {
      accountId: account.id,
      name: 'With email',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    await deps.inspect.seedMailboxEmail(mailboxWithEmail.id);
    await expect(
      destroyMailbox(deps, {
        accountId: account.id,
        mailboxId: mailboxWithEmail.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_HAS_EMAIL' });
  });

  it('rejects destroying an empty system Mailbox', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const archive = (await deps.inspect.mailboxes(account.id)).find(
      ({ role }) => role === 'archive',
    )!;

    await expect(
      destroyMailbox(deps, {
        accountId: account.id,
        mailboxId: archive.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    expect(await deps.inspect.mailbox(archive.id)).not.toBeNull();
    expect(await deps.inspect.stateVersion(account.id)).toBe(1n);
  });

  it('renames and reparents custom folders and labels within one account', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const firstParent = await createMailbox(deps, {
      accountId: account.id,
      name: 'First',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const secondParent = await createMailbox(deps, {
      accountId: account.id,
      name: 'Second',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const label = await createMailbox(deps, {
      accountId: account.id,
      name: 'Cafe\u0301',
      kind: 'label',
      role: null,
      parentId: firstParent.id,
    });
    await expect(
      createMailbox(deps, {
        accountId: account.id,
        name: 'CAF\u00C9',
        kind: 'folder',
        role: null,
        parentId: firstParent.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_NAME_CONFLICT' });

    const updated = await updateMailbox(deps, {
      accountId: account.id,
      mailboxId: label.id,
      name: '  Important  ',
      parentId: secondParent.id,
    });
    expect(updated).toMatchObject({
      name: 'Important',
      normalizedName: 'important',
      parentId: secondParent.id,
      kind: 'label',
      role: null,
    });
    const versionAfterChange = await deps.inspect.stateVersion(account.id);

    await updateMailbox(deps, {
      accountId: account.id,
      mailboxId: label.id,
      name: 'Important',
      parentId: secondParent.id,
    });
    expect(await deps.inspect.stateVersion(account.id)).toBe(versionAfterChange);

    await expect(
      createMailbox(deps, {
        accountId: account.id,
        name: 'IMPORTANT',
        kind: 'folder',
        role: null,
        parentId: secondParent.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_NAME_CONFLICT' });
    await createMailbox(deps, {
      accountId: account.id,
      name: 'important',
      kind: 'folder',
      role: null,
      parentId: firstParent.id,
    });
  });

  it('protects every system Mailbox role, name, and parent field', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const inbox = (await deps.inspect.mailboxes(account.id)).find(({ role }) => role === 'inbox')!;
    const parent = await createMailbox(deps, {
      accountId: account.id,
      name: 'Parent',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const versionBeforeFailures = await deps.inspect.stateVersion(account.id);

    await expect(
      updateMailbox(deps, {
        accountId: account.id,
        mailboxId: inbox.id,
        role: null,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    await expect(
      updateMailbox(deps, {
        accountId: account.id,
        mailboxId: inbox.id,
        parentId: parent.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_ROLE_CONFLICT' });
    await updateMailbox(deps, {
      accountId: account.id,
      mailboxId: inbox.id,
      name: inbox.name,
      role: inbox.role,
      parentId: inbox.parentId,
    });

    expect(await deps.inspect.stateVersion(account.id)).toBe(versionBeforeFailures);
  });

  it('rejects parent cycles and destroys empty custom Mailboxes', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const parent = await createMailbox(deps, {
      accountId: account.id,
      name: 'Parent',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const child = await createMailbox(deps, {
      accountId: account.id,
      name: 'Child',
      kind: 'folder',
      role: null,
      parentId: parent.id,
    });

    await expect(
      updateMailbox(deps, {
        accountId: account.id,
        mailboxId: parent.id,
        parentId: child.id,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_PARENT_CYCLE' });

    await destroyMailbox(deps, {
      accountId: account.id,
      mailboxId: child.id,
    });
    await destroyMailbox(deps, {
      accountId: account.id,
      mailboxId: parent.id,
    });
    expect(await deps.inspect.mailbox(child.id)).toBeNull();
    expect(await deps.inspect.mailbox(parent.id)).toBeNull();
  });

  it('locks the account before checking references and deleting a Mailbox', async () => {
    const deps = createMemoryMailCoreDependencies();
    const account = await createMailAccount(deps, {
      userId: 'lock-user',
      connectionId: 'lock-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const mailbox = await createMailbox(deps, {
      accountId: account.id,
      name: 'Delete me',
      kind: 'folder',
      role: null,
      parentId: null,
    });
    const trace: string[] = [];
    const tracedDependencies: MailCoreDependencies = {
      ...deps,
      unitOfWork: {
        run: (operation) =>
          deps.unitOfWork.run((tx) => {
            const traced: MailTransaction = {
              ...tx,
              lockAccount: async (accountId) => {
                trace.push('lock');
                await tx.lockAccount(accountId);
              },
              mailboxes: {
                ...tx.mailboxes,
                findById: async (...args) => {
                  trace.push('find-mailbox');
                  return tx.mailboxes.findById(...args);
                },
                listByAccount: async (...args) => {
                  trace.push('read-mailbox-references');
                  return tx.mailboxes.listByAccount(...args);
                },
                delete: async (...args) => {
                  trace.push('delete-mailbox');
                  return tx.mailboxes.delete(...args);
                },
              },
              emails: {
                ...tx.emails,
                listByAccount: async (...args) => {
                  trace.push('read-email-references');
                  return tx.emails.listByAccount(...args);
                },
              },
            };
            return operation(traced);
          }),
      },
    };

    await destroyMailbox(tracedDependencies, {
      accountId: account.id,
      mailboxId: mailbox.id,
    });

    expect(await deps.inspect.mailbox(mailbox.id)).toBeNull();
    expect(trace).toEqual([
      'lock',
      'find-mailbox',
      'read-mailbox-references',
      'read-email-references',
      'delete-mailbox',
    ]);
  });
});
