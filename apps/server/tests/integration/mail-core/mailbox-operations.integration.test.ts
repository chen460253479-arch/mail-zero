import {
  createMailCore,
  createMailbox,
  destroyMailbox,
  type MailCoreDependencies,
  type MailboxRecord,
  type MailTransaction,
} from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('PostgreSQL Mailbox integration', () => {
  it('applies one conditional batch state with partial domain failures', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'mailbox-set');
      const updated = await createMailbox(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Update me',
        kind: 'folder',
        role: null,
        parentId: null,
      });
      const destroyed = await createMailbox(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Destroy me',
        kind: 'folder',
        role: null,
        parentId: null,
      });
      const oldState = await unitOfWork.run(async (tx) =>
        (await tx.accounts.findById(harness.accountId))!.stateVersion.toString(),
      );

      const result = await createMailCore(harness.dependencies).setMailboxes({
        accountId: harness.accountId,
        ifInState: oldState,
        create: {
          created: {
            name: 'Created in batch',
            kind: 'folder',
            role: null,
            parentId: null,
          },
        },
        update: {
          [updated.id]: {
            color: '#123456',
            sortOrder: 9,
            isSubscribed: false,
          },
          [harness.inbox.id]: { name: 'Invalid Inbox rename' },
        },
        destroy: [destroyed.id],
      });

      expect(result).toMatchObject({
        oldState,
        newState: (BigInt(oldState) + 1n).toString(),
        destroyed: [destroyed.id],
        notUpdated: {
          [harness.inbox.id]: { code: 'MAILBOX_ROLE_CONFLICT' },
        },
      });
      await unitOfWork.run(async (tx) => {
        expect(await tx.mailboxes.findById(harness.accountId, result.created.created!.id)).toEqual(
          result.created.created,
        );
        expect(await tx.mailboxes.findById(harness.accountId, updated.id)).toMatchObject({
          color: '#123456',
          sortOrder: 9,
          isSubscribed: false,
        });
        expect(await tx.mailboxes.findById(harness.accountId, destroyed.id)).toBeNull();
        const requestChanges = await tx.changes.queryChanges({
          accountId: harness.accountId,
          collection: 'mailbox',
          afterState: BigInt(oldState),
        });
        expect(new Set(requestChanges.map(({ stateVersion }) => stateVersion))).toEqual(
          new Set([BigInt(result.newState)]),
        );
      });
    }));

  it('serializes child creation behind parent destruction', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'mailbox-parent-race');
      const parent = await createMailbox(harness.dependencies, {
        accountId: harness.accountId,
        name: 'Concurrent parent',
        kind: 'folder',
        role: null,
        parentId: null,
      });
      let parentValidated!: () => void;
      let releaseDestroy!: () => void;
      const validated = new Promise<void>((resolve) => {
        parentValidated = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseDestroy = resolve;
      });
      const destroyDependencies: MailCoreDependencies = {
        ...harness.dependencies,
        unitOfWork: {
          run: (operation) =>
            unitOfWork.run((tx) => {
              const traced: MailTransaction = {
                ...tx,
                mailboxes: {
                  ...tx.mailboxes,
                  hasChild: async (...args) => {
                    const result = await tx.mailboxes.hasChild(...args);
                    parentValidated();
                    await release;
                    return result;
                  },
                },
              };
              return operation(traced);
            }),
        },
      };
      const destroying = destroyMailbox(destroyDependencies, {
        accountId: harness.accountId,
        mailboxId: parent.id,
      });
      await validated;

      let createLockAttempted!: () => void;
      const lockAttempted = new Promise<void>((resolve) => {
        createLockAttempted = resolve;
      });
      const createDependencies: MailCoreDependencies = {
        ...harness.dependencies,
        unitOfWork: {
          run: (operation) =>
            unitOfWork.run((tx) => {
              const traced: MailTransaction = {
                ...tx,
                lockAccount: async (...args) => {
                  createLockAttempted();
                  await tx.lockAccount(...args);
                },
              };
              return operation(traced);
            }),
        },
      };
      const creating = createMailbox(createDependencies, {
        accountId: harness.accountId,
        name: 'Concurrent child',
        kind: 'folder',
        role: null,
        parentId: parent.id,
      });
      await lockAttempted;
      releaseDestroy();

      await expect(destroying).resolves.toBeUndefined();
      await expect(creating).rejects.toMatchObject({ code: 'MAILBOX_NOT_FOUND' });
      await unitOfWork.run(async (tx) => {
        expect(
          (await tx.mailboxes.listByAccount(harness.accountId)).filter(
            ({ parentId }) => parentId === parent.id,
          ),
        ).toEqual([]);
      });
    }));

  it('enforces active root/sibling uniqueness and releases names after soft delete', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork);
      const roots = await Promise.allSettled([
        createMailbox(harness.dependencies, {
          accountId: harness.accountId,
          name: 'Projects',
          kind: 'folder',
          role: null,
          parentId: null,
        }),
        createMailbox(harness.dependencies, {
          accountId: harness.accountId,
          name: ' projects ',
          kind: 'folder',
          role: null,
          parentId: null,
        }),
      ]);
      expect(roots.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(roots.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { code: 'MAILBOX_NAME_CONFLICT', details: {} },
      });
      const root = roots.find(
        (outcome): outcome is PromiseFulfilledResult<MailboxRecord> =>
          outcome.status === 'fulfilled',
      )!.value;
      const siblings = await Promise.allSettled([
        createMailbox(harness.dependencies, {
          accountId: harness.accountId,
          name: 'Child',
          kind: 'folder',
          role: null,
          parentId: root.id,
        }),
        createMailbox(harness.dependencies, {
          accountId: harness.accountId,
          name: 'child',
          kind: 'folder',
          role: null,
          parentId: root.id,
        }),
      ]);
      expect(siblings.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);

      const child = siblings.find(
        (outcome): outcome is PromiseFulfilledResult<MailboxRecord> =>
          outcome.status === 'fulfilled',
      )!.value;
      await destroyMailbox(harness.dependencies, {
        accountId: harness.accountId,
        mailboxId: child.id,
      });
      await expect(
        createMailbox(harness.dependencies, {
          accountId: harness.accountId,
          name: 'CHILD',
          kind: 'folder',
          role: null,
          parentId: root.id,
        }),
      ).resolves.toMatchObject({ normalizedName: 'child' });
    }));

  it('rejects a foreign parent without disclosing its row', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const primary = await createPostgresMailTestHarness(db, unitOfWork, 'mailbox-primary');
      const foreign = await createPostgresMailTestHarness(db, unitOfWork, 'mailbox-foreign');

      await expect(
        createMailbox(primary.dependencies, {
          accountId: primary.accountId,
          name: 'Invalid child',
          kind: 'folder',
          role: null,
          parentId: foreign.inbox.id,
        }),
      ).rejects.toMatchObject({
        code: 'CROSS_ACCOUNT_REFERENCE',
        details: { entityId: foreign.inbox.id },
      });
    }));

  it('allows exactly one concurrent active Mailbox for an account role', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'mailbox-role');
      await unitOfWork.run(async (tx) => {
        const archive = await tx.mailboxes.findByRole(harness.accountId, 'archive');
        expect(archive).not.toBeNull();
        await tx.mailboxes.update(harness.accountId, archive!.id, {
          deletedAt: harness.dependencies.clock.now(),
        });
      });

      const now = harness.dependencies.clock.now();
      const insertRole = (suffix: string) =>
        unitOfWork.run((tx) =>
          tx.mailboxes.insert({
            id: `mailbox-role-${suffix}` as typeof harness.inbox.id,
            accountId: harness.accountId,
            name: `Archive ${suffix}`,
            normalizedName: `archive ${suffix.toLocaleLowerCase('und')}`,
            parentId: null,
            kind: 'system',
            role: 'archive',
            color: null,
            sortOrder: 0,
            isSubscribed: true,
            totalEmails: 0,
            unreadEmails: 0,
            totalThreads: 0,
            unreadThreads: 0,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }),
        );
      const outcomes = await Promise.allSettled([insertRole('A'), insertRole('B')]);

      expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.find(({ status }) => status === 'rejected')).toMatchObject({
        reason: { code: 'MAILBOX_ROLE_CONFLICT', details: {} },
      });
    }));
});
