import { describe, expect, it } from 'vitest';

import {
  createPostgresMailTaskRepository,
  parseClaimedMailTaskCommand,
} from '../../../src/modules/mail-tasks';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

const now = new Date('2026-07-29T00:00:00.000Z');

const createRepository = (db: Parameters<typeof createPostgresMailTaskRepository>[0]) => {
  let nextId = 1;
  return createPostgresMailTaskRepository(db, {
    nextId: () => `task-${String(nextId++).padStart(4, '0')}`,
  });
};

describe('PostgresMailTaskRepository', () => {
  it('persists commands and deduplicates only matching live work', async () => {
    await withMailTestDatabase(async ({ db }) => {
      const repository = createRepository(db);
      const first = await repository.enqueue({
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-1' },
        dedupeKey: 'ingress:discover:sync-1',
        runAt: now,
      });
      const duplicate = await repository.enqueue({
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-1' },
        dedupeKey: 'ingress:discover:sync-1',
        runAt: new Date(now.getTime() + 60_000),
      });
      const independent = await repository.enqueue({
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-2' },
        dedupeKey: 'ingress:discover:sync-2',
        runAt: now,
      });

      expect(first).toEqual({ id: 'task-0001', created: true });
      expect(duplicate).toEqual({ id: 'task-0001', created: false });
      expect(independent).toEqual({ id: 'task-0003', created: true });
    });
  });

  it('uses skip-locked claims without selecting future work twice', async () => {
    await withMailTestDatabase(async ({ db }) => {
      const repository = createRepository(db);
      await repository.enqueue({
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-ready-1' },
        dedupeKey: 'ready-1',
        runAt: now,
      });
      await repository.enqueue({
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-ready-2' },
        dedupeKey: 'ready-2',
        runAt: now,
      });
      await repository.enqueue({
        queue: 'ingress',
        command: { type: 'discover', syncId: 'sync-future' },
        dedupeKey: 'future',
        runAt: new Date(now.getTime() + 60_000),
      });

      const [first, second] = await Promise.all([
        repository.claim({
          owner: 'owner-a',
          queues: ['ingress'],
          now,
          limit: 1,
          leaseForMs: 30_000,
        }),
        repository.claim({
          owner: 'owner-b',
          queues: ['ingress'],
          now,
          limit: 1,
          leaseForMs: 30_000,
        }),
      ]);
      const third = await repository.claim({
        owner: 'owner-c',
        queues: ['ingress'],
        now,
        limit: 1,
        leaseForMs: 30_000,
      });

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(new Set([first[0]!.id, second[0]!.id]).size).toBe(2);
      expect(first[0]!.attempts).toBe(1);
      expect(second[0]!.attempts).toBe(1);
      expect(third).toEqual([]);
    });
  });

  it('requires the active lease owner to complete or fail work', async () => {
    await withMailTestDatabase(async ({ db }) => {
      const repository = createRepository(db);
      await repository.enqueue({
        queue: 'outbound',
        command: { type: 'deliver', deliveryId: 'delivery-1' },
        dedupeKey: 'outbound:deliver:delivery-1',
        runAt: now,
      });
      const [task] = await repository.claim({
        owner: 'owner-a',
        queues: ['outbound'],
        now,
        limit: 1,
        leaseForMs: 30_000,
      });

      await expect(repository.complete({ id: task!.id, owner: 'owner-b', now })).resolves.toBe(
        false,
      );
      await expect(
        repository.failPermanently({
          id: task!.id,
          owner: 'owner-b',
          now,
          errorCode: 'WRONG_OWNER',
          errorMessage: 'wrong owner',
        }),
      ).resolves.toBe(false);
      await expect(repository.complete({ id: task!.id, owner: 'owner-a', now })).resolves.toBe(
        true,
      );
    });
  });

  it('retries with a due time and moves exhausted work to dead', async () => {
    await withMailTestDatabase(async ({ db }) => {
      const repository = createRepository(db);
      await repository.enqueue({
        queue: 'ingress',
        command: { type: 'import', syncId: 'sync-1' },
        dedupeKey: 'ingress:import:sync-1',
        runAt: now,
        maxAttempts: 2,
      });
      const [first] = await repository.claim({
        owner: 'owner-a',
        queues: ['ingress'],
        now,
        limit: 1,
        leaseForMs: 30_000,
      });
      const retryAt = new Date(now.getTime() + 10_000);

      await expect(
        repository.retry({
          id: first!.id,
          owner: 'owner-a',
          now,
          runAt: retryAt,
          errorCode: 'TEMPORARY',
          errorMessage: 'retry later',
        }),
      ).resolves.toBe('retry');
      await expect(
        repository.claim({
          owner: 'too-early',
          queues: ['ingress'],
          now,
          limit: 1,
          leaseForMs: 30_000,
        }),
      ).resolves.toEqual([]);

      const [second] = await repository.claim({
        owner: 'owner-b',
        queues: ['ingress'],
        now: retryAt,
        limit: 1,
        leaseForMs: 30_000,
      });
      expect(second!.attempts).toBe(2);
      await expect(
        repository.retry({
          id: second!.id,
          owner: 'owner-b',
          now: retryAt,
          runAt: new Date(retryAt.getTime() + 10_000),
          errorCode: 'STILL_TEMPORARY',
          errorMessage: 'attempts exhausted',
        }),
      ).resolves.toBe('dead');
      await expect(
        repository.claim({
          owner: 'owner-c',
          queues: ['ingress'],
          now: new Date(retryAt.getTime() + 60_000),
          limit: 1,
          leaseForMs: 30_000,
        }),
      ).resolves.toEqual([]);
    });
  });

  it('recovers expired leases for another owner', async () => {
    await withMailTestDatabase(async ({ db }) => {
      const repository = createRepository(db);
      await repository.enqueue({
        queue: 'outbound',
        command: { type: 'reconcile', deliveryId: 'delivery-1' },
        dedupeKey: 'outbound:reconcile:delivery-1',
        runAt: now,
      });
      await repository.claim({
        owner: 'crashed-owner',
        queues: ['outbound'],
        now,
        limit: 1,
        leaseForMs: 1_000,
      });
      const afterExpiry = new Date(now.getTime() + 1_001);

      await expect(repository.recoverExpired({ now: afterExpiry, limit: 10 })).resolves.toBe(1);
      const [recovered] = await repository.claim({
        owner: 'replacement-owner',
        queues: ['outbound'],
        now: afterExpiry,
        limit: 1,
        leaseForMs: 30_000,
      });

      expect(recovered).toMatchObject({
        queue: 'outbound',
        attempts: 2,
        leaseOwner: 'replacement-owner',
      });
      expect(parseClaimedMailTaskCommand(recovered!)).toEqual({
        type: 'reconcile',
        deliveryId: 'delivery-1',
      });
    });
  });
});
