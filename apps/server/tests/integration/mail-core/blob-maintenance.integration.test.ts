import { reconcileBlobStorage, type BlobId } from '@zero/mail-core';
import { describe, expect, it } from 'vitest';

import { createPostgresMailTestHarness } from '../../helpers/mail-core/harness';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('PostgreSQL Blob maintenance', () => {
  it('persists a lifecycle-valid orphan reservation before deleting storage', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'blob-maintenance');
      const pending = await harness.blobStore.putTemporary({
        accountId: harness.accountId,
        bytes: new TextEncoder().encode('postgres orphan'),
        contentType: 'text/plain',
      });
      const objectKey = `mail/${harness.accountId}/sha256/${pending.sha256.slice(0, 2)}/${pending.sha256}`;
      await harness.blobStore.commitTemporary({
        accountId: harness.accountId,
        temporaryKey: pending.temporaryKey,
        objectKey,
      });

      await expect(
        reconcileBlobStorage(harness.dependencies, {
          accountId: harness.accountId,
          olderThan: new Date('2100-01-01T00:00:00.000Z'),
          limit: 100,
        }),
      ).resolves.toEqual({
        deletedObjectCount: 1,
        deletedTemporaryCount: 0,
        cursor: {
          object: { value: null, exhausted: false },
          temporary: { value: null, exhausted: true },
        },
      });

      expect(harness.blobStore.snapshot().has(objectKey)).toBe(false);
      await expect(
        unitOfWork.run((tx) => tx.blobs.listByAccount(harness.accountId)),
      ).resolves.toEqual([]);
    }));

  it('cancels a reservation instead of deleting an object with an ordinary owner', () =>
    withMailTestDatabase(async ({ db, unitOfWork }) => {
      const harness = await createPostgresMailTestHarness(db, unitOfWork, 'blob-owner-conflict');
      const pending = await harness.blobStore.putTemporary({
        accountId: harness.accountId,
        bytes: new TextEncoder().encode('owned postgres object'),
        contentType: 'text/plain',
      });
      const objectKey = `mail/${harness.accountId}/sha256/${pending.sha256.slice(0, 2)}/${pending.sha256}`;
      await harness.blobStore.commitTemporary({
        accountId: harness.accountId,
        temporaryKey: pending.temporaryKey,
        objectKey,
      });
      const ownerId = harness.dependencies.idFactory.next<'Blob'>() as BlobId;
      const now = harness.dependencies.clock.now();
      await unitOfWork.run(async (tx) => {
        await tx.blobs.insert({
          id: ownerId,
          accountId: harness.accountId,
          sha256: pending.sha256,
          sizeBytes: pending.size + 1n,
          contentType: 'text/plain',
          objectKey,
          status: 'ready',
          createdAt: now,
          readyAt: now,
          deletedAt: null,
        });
        await tx.blobs.insert({
          id: harness.dependencies.idFactory.next<'Blob'>() as BlobId,
          accountId: harness.accountId,
          sha256: pending.sha256,
          sizeBytes: pending.size,
          contentType: 'application/x-zero-orphan-reservation',
          objectKey,
          status: 'deleting',
          createdAt: now,
          readyAt: now,
          deletedAt: now,
        });
      });

      const result = await reconcileBlobStorage(harness.dependencies, {
        accountId: harness.accountId,
        olderThan: new Date('2100-01-01T00:00:00.000Z'),
        limit: 1,
      });

      expect(result.deletedObjectCount).toBe(0);
      expect(harness.blobStore.snapshot().has(objectKey)).toBe(true);
      await expect(
        unitOfWork.run((tx) => tx.blobs.listByAccount(harness.accountId)),
      ).resolves.toEqual([expect.objectContaining({ id: ownerId, status: 'ready' })]);
    }));
});
