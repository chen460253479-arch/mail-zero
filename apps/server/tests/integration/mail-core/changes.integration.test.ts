import { describe, expect, it } from 'vitest';
import { getChanges } from '@zero/mail-core';
import { eq } from 'drizzle-orm';

import { mailAccount } from '../../../src/modules/mail/postgres/schema';
import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('PostgreSQL Changes integration', () => {
  it('expands only the cutoff state group and observes the account boundary consistently', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork);
      await unitOfWork.run(async (tx) => {
        const stateVersion = await tx.nextStateVersion(harness.accountId);
        expect(stateVersion).toBe(2n);
        for (const entityId of ['email-b', 'email-a']) {
          await tx.changes.recordChange({
            accountId: harness.accountId,
            stateVersion,
            collection: 'email',
            entityId,
            changeType: 'created',
            changedProperties: null,
            createdAt: harness.dependencies.clock.now(),
          });
        }
      });
      await unitOfWork.run(async (tx) => {
        const stateVersion = await tx.nextStateVersion(harness.accountId);
        expect(stateVersion).toBe(3n);
        await tx.changes.recordChange({
          accountId: harness.accountId,
          stateVersion,
          collection: 'email',
          entityId: 'email-c',
          changeType: 'created',
          changedProperties: null,
          createdAt: harness.dependencies.clock.now(),
        });
      });

      const first = await getChanges(harness.dependencies, {
        accountId: harness.accountId,
        collection: 'email',
        sinceState: '1',
        maxChanges: 1,
      });
      expect(first).toEqual({
        oldState: '1',
        newState: '2',
        hasMoreChanges: true,
        created: ['email-a', 'email-b'],
        updated: [],
        destroyed: [],
      });
      await expect(
        getChanges(harness.dependencies, {
          accountId: harness.accountId,
          collection: 'email',
          sinceState: '2',
          maxChanges: 1,
        }),
      ).resolves.toMatchObject({
        newState: '3',
        hasMoreChanges: false,
        created: ['email-c'],
      });

      await db
        .update(mailAccount)
        .set({ oldestRetainedState: 2n })
        .where(eq(mailAccount.id, harness.accountId));
      await expect(
        getChanges(harness.dependencies, {
          accountId: harness.accountId,
          collection: 'email',
          sinceState: '1',
          maxChanges: 10,
        }),
      ).rejects.toMatchObject({ code: 'STATE_MISMATCH', details: {} });
    }));
});
