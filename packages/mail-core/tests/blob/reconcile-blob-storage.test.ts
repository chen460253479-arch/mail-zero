import { describe, expect, it, vi } from 'vitest';

import {
  contentAddressedObjectKey,
  discardCommittedBlobs,
  discardTemporaryBlobs,
  type PreparedBlob,
} from '../../src/message/blob-lifecycle';
import {
  createMailAccount,
  reconcileBlobStorage,
  type BlobId,
  type MailAccountId,
} from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const putCommitted = async (
  dependencies: ReturnType<typeof createMemoryMailCoreDependencies>,
  accountId: MailAccountId,
  value: string,
) => {
  const bytes = new TextEncoder().encode(value);
  const pending = await dependencies.blobStore.putTemporary({
    accountId,
    bytes,
    contentType: 'text/plain',
  });
  const objectKey = contentAddressedObjectKey(accountId, pending.sha256);
  await dependencies.blobStore.commitTemporary({
    accountId,
    temporaryKey: pending.temporaryKey,
    objectKey,
  });
  return { ...pending, bytes, objectKey };
};

describe('reconcileBlobStorage', () => {
  it('deletes only old account-scoped objects without metadata and stale temporary uploads', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-user',
      connectionId: 'reconcile-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const foreign = await createMailAccount(dependencies, {
      userId: 'reconcile-foreign-user',
      connectionId: 'reconcile-foreign-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const retained = await putCommitted(dependencies, account.id, 'metadata-owned');
    const orphan = await putCommitted(dependencies, account.id, 'orphan');
    const staleTemporary = await dependencies.blobStore.putTemporary({
      accountId: account.id,
      bytes: new TextEncoder().encode('stale temporary'),
      contentType: 'text/plain',
    });
    const foreignOrphan = await putCommitted(dependencies, foreign.id, 'foreign orphan');
    await dependencies.unitOfWork.run((tx) =>
      tx.blobs.insert({
        id: dependencies.idFactory.next<'Blob'>() as BlobId,
        accountId: account.id,
        sha256: retained.sha256,
        sizeBytes: retained.size,
        contentType: 'text/plain',
        objectKey: retained.objectKey,
        status: 'ready',
        createdAt: dependencies.clock.now(),
        readyAt: dependencies.clock.now(),
        deletedAt: null,
      }),
    );
    dependencies.clock.set(new Date('2026-01-03T00:00:00.000Z'));
    const recent = await putCommitted(dependencies, account.id, 'recent orphan');
    const recentTemporary = await dependencies.blobStore.putTemporary({
      accountId: account.id,
      bytes: new TextEncoder().encode('recent temporary'),
      contentType: 'text/plain',
    });

    await expect(
      reconcileBlobStorage(dependencies, {
        accountId: account.id,
        olderThan: new Date('2026-01-02T00:00:00.000Z'),
        limit: 100,
      }),
    ).resolves.toEqual({
      deletedObjectCount: 1,
      deletedTemporaryCount: 1,
      cursor: {
        object: { value: null, exhausted: false },
        temporary: { value: null, exhausted: false },
      },
    });

    expect(dependencies.blobStore.snapshot().has(retained.objectKey)).toBe(true);
    expect(dependencies.blobStore.snapshot().has(orphan.objectKey)).toBe(false);
    expect(dependencies.blobStore.snapshot().has(recent.objectKey)).toBe(true);
    expect(dependencies.blobStore.snapshot().has(foreignOrphan.objectKey)).toBe(true);
    expect(dependencies.blobStore.temporarySnapshot().has(staleTemporary.temporaryKey)).toBe(false);
    expect(dependencies.blobStore.temporarySnapshot().has(recentTemporary.temporaryKey)).toBe(true);
  });

  it('reclaims committed and temporary orphans left by failed compensation', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'compensation-user',
      connectionId: 'compensation-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const committed = await putCommitted(dependencies, account.id, 'failed committed cleanup');
    const pending = await dependencies.blobStore.putTemporary({
      accountId: account.id,
      bytes: new TextEncoder().encode('failed temporary cleanup'),
      contentType: 'text/plain',
    });
    dependencies.blobStore.failNextDelete(committed.objectKey);
    dependencies.blobStore.failNextTemporaryDelete(pending.temporaryKey);
    await discardCommittedBlobs(dependencies.blobStore, account.id, [committed.objectKey]);
    await discardTemporaryBlobs(dependencies.blobStore, [
      {
        accountId: account.id,
        temporaryKey: pending.temporaryKey,
        sha256: pending.sha256,
        sizeBytes: pending.size,
        contentType: 'text/plain',
      } satisfies PreparedBlob,
    ]);
    expect(dependencies.blobStore.snapshot().has(committed.objectKey)).toBe(true);
    expect(dependencies.blobStore.temporarySnapshot().has(pending.temporaryKey)).toBe(true);

    dependencies.clock.set(new Date('2026-01-03T00:00:00.000Z'));
    await reconcileBlobStorage(dependencies, {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 100,
    });

    expect(dependencies.blobStore.snapshot().has(committed.objectKey)).toBe(false);
    expect(dependencies.blobStore.temporarySnapshot().has(pending.temporaryKey)).toBe(false);
  });

  it('does not hold a database transaction open during physical orphan deletion', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-transaction-user',
      connectionId: 'reconcile-transaction-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    await putCommitted(dependencies, account.id, 'old orphan');
    dependencies.clock.set(new Date('2026-01-03T00:00:00.000Z'));
    const originalDelete = dependencies.blobStore.delete.bind(dependencies.blobStore);
    let markDeleteStarted!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      markDeleteStarted = resolve;
    });
    let releaseDelete!: () => void;
    const deleteMayFinish = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    dependencies.blobStore.delete = async (input) => {
      markDeleteStarted();
      await deleteMayFinish;
      await originalDelete(input);
    };

    const reconciliation = reconcileBlobStorage(dependencies, {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 100,
    });
    await deleteStarted;
    const transactionProgressed = await Promise.race([
      dependencies.unitOfWork
        .run(async (tx) => (await tx.accounts.findById(account.id)) !== null)
        .then(() => true),
      new Promise<false>((resolve) => setImmediate(() => resolve(false))),
    ]);
    expect(transactionProgressed).toBe(true);

    releaseDelete();
    await expect(reconciliation).resolves.toEqual({
      deletedObjectCount: 1,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: null, exhausted: false },
        temporary: { value: null, exhausted: true },
      },
    });
  });

  it('persists an orphan reservation across deletion failure and retries it safely', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-retry-user',
      connectionId: 'reconcile-retry-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const orphan = await putCommitted(dependencies, account.id, 'retry orphan');
    dependencies.clock.set(new Date('2026-01-03T00:00:00.000Z'));
    dependencies.blobStore.failNextDelete(orphan.objectKey);
    const input = {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 100,
    };

    await expect(reconcileBlobStorage(dependencies, input)).rejects.toMatchObject({
      code: 'BLOB_STORE_FAILURE',
    });
    expect(dependencies.blobStore.snapshot().has(orphan.objectKey)).toBe(true);
    expect(await dependencies.inspect.blobs(account.id)).toEqual([
      expect.objectContaining({
        objectKey: orphan.objectKey,
        status: 'deleting',
        readyAt: dependencies.clock.now(),
        deletedAt: dependencies.clock.now(),
      }),
    ]);

    await expect(reconcileBlobStorage(dependencies, input)).resolves.toEqual({
      deletedObjectCount: 1,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: null, exhausted: false },
        temporary: { value: null, exhausted: true },
      },
    });
    expect(dependencies.blobStore.snapshot().has(orphan.objectKey)).toBe(false);
    expect(await dependencies.inspect.blobs(account.id)).toEqual([]);
  });

  it('does not delete external objects when the durable reservation cannot commit', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-claim-user',
      connectionId: 'reconcile-claim-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const orphan = await putCommitted(dependencies, account.id, 'unclaimed orphan');
    dependencies.clock.set(new Date('2026-01-03T00:00:00.000Z'));
    dependencies.unitOfWork.failCommitBeforePublishAfter(1);

    await expect(
      reconcileBlobStorage(dependencies, {
        accountId: account.id,
        olderThan: new Date('2026-01-02T00:00:00.000Z'),
        limit: 100,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE' });

    expect(dependencies.blobStore.snapshot().has(orphan.objectKey)).toBe(true);
    expect(await dependencies.inspect.blobs(account.id)).toEqual([]);
  });

  it('bounds each storage scan and resumes from the returned opaque cursor', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-cursor-user',
      connectionId: 'reconcile-cursor-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const objectCursors: Array<string | null> = [];
    const originalList = dependencies.blobStore.list.bind(dependencies.blobStore);
    dependencies.blobStore.list = vi.fn(async (input) => {
      if (input.kind === 'temporary') {
        return originalList(input);
      }
      objectCursors.push(input.cursor);
      const pageNumber = Number(input.cursor ?? '0') + 1;
      return {
        entries: [
          {
            key: `recent-${pageNumber}`,
            uploadedAt: new Date('2030-01-01T00:00:00.000Z'),
            sizeBytes: 1n,
          },
        ],
        cursor: String(pageNumber),
      };
    });

    const first = await reconcileBlobStorage(dependencies, {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 1,
    });
    expect(first).toEqual({
      deletedObjectCount: 0,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: '10', exhausted: false },
        temporary: { value: null, exhausted: true },
      },
    });
    expect(objectCursors).toEqual([null, '1', '2', '3', '4', '5', '6', '7', '8', '9']);

    const second = await reconcileBlobStorage(dependencies, {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 1,
      cursor: first.cursor,
    });
    expect(second.cursor.object).toEqual({ value: '20', exhausted: false });
    expect(objectCursors).toHaveLength(20);
    expect(objectCursors[10]).toBe('10');
  });

  it('does not let metadata-owned objects starve temporary cleanup', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-fairness-user',
      connectionId: 'reconcile-fairness-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const retained = await putCommitted(dependencies, account.id, 'metadata-owned');
    await dependencies.unitOfWork.run((tx) =>
      tx.blobs.insert({
        id: dependencies.idFactory.next<'Blob'>() as BlobId,
        accountId: account.id,
        sha256: retained.sha256,
        sizeBytes: retained.size,
        contentType: 'text/plain',
        objectKey: retained.objectKey,
        status: 'ready',
        createdAt: dependencies.clock.now(),
        readyAt: dependencies.clock.now(),
        deletedAt: null,
      }),
    );
    const staleTemporary = await dependencies.blobStore.putTemporary({
      accountId: account.id,
      bytes: new TextEncoder().encode('stale temporary'),
      contentType: 'text/plain',
    });

    await expect(
      reconcileBlobStorage(dependencies, {
        accountId: account.id,
        olderThan: new Date('2026-01-02T00:00:00.000Z'),
        limit: 1,
      }),
    ).resolves.toEqual({
      deletedObjectCount: 0,
      deletedTemporaryCount: 1,
      cursor: {
        object: { value: null, exhausted: true },
        temporary: { value: null, exhausted: false },
      },
    });
    expect(dependencies.blobStore.snapshot().has(retained.objectKey)).toBe(true);
    expect(dependencies.blobStore.temporarySnapshot().has(staleTemporary.temporaryKey)).toBe(false);
  });

  it('never deletes a metadata-owned object when its stored size is inconsistent', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-corrupt-metadata-user',
      connectionId: 'reconcile-corrupt-metadata-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const retained = await putCommitted(dependencies, account.id, 'metadata-owned');
    await dependencies.unitOfWork.run((tx) =>
      tx.blobs.insert({
        id: dependencies.idFactory.next<'Blob'>() as BlobId,
        accountId: account.id,
        sha256: retained.sha256,
        sizeBytes: retained.size + 1n,
        contentType: 'text/plain',
        objectKey: retained.objectKey,
        status: 'ready',
        createdAt: dependencies.clock.now(),
        readyAt: dependencies.clock.now(),
        deletedAt: null,
      }),
    );

    await expect(
      reconcileBlobStorage(dependencies, {
        accountId: account.id,
        olderThan: new Date('2026-01-02T00:00:00.000Z'),
        limit: 1,
      }),
    ).resolves.toEqual({
      deletedObjectCount: 0,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: null, exhausted: true },
        temporary: { value: null, exhausted: true },
      },
    });
    expect(dependencies.blobStore.snapshot().has(retained.objectKey)).toBe(true);
  });

  it('cancels a durable reservation when ordinary metadata later owns the object key', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-reservation-owner-user',
      connectionId: 'reconcile-reservation-owner-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const retained = await putCommitted(dependencies, account.id, 'metadata-owned');
    const ownerId = dependencies.idFactory.next<'Blob'>() as BlobId;
    await dependencies.unitOfWork.run(async (tx) => {
      await tx.blobs.insert({
        id: ownerId,
        accountId: account.id,
        sha256: retained.sha256,
        sizeBytes: retained.size + 1n,
        contentType: 'text/plain',
        objectKey: retained.objectKey,
        status: 'ready',
        createdAt: dependencies.clock.now(),
        readyAt: dependencies.clock.now(),
        deletedAt: null,
      });
      await tx.blobs.insert({
        id: dependencies.idFactory.next<'Blob'>() as BlobId,
        accountId: account.id,
        sha256: retained.sha256,
        sizeBytes: retained.size,
        contentType: 'application/x-zero-orphan-reservation',
        objectKey: retained.objectKey,
        status: 'deleting',
        createdAt: dependencies.clock.now(),
        readyAt: dependencies.clock.now(),
        deletedAt: dependencies.clock.now(),
      });
    });

    const result = await reconcileBlobStorage(dependencies, {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 1,
    });

    expect(result.deletedObjectCount).toBe(0);
    expect(dependencies.blobStore.snapshot().has(retained.objectKey)).toBe(true);
    expect(await dependencies.inspect.blobs(account.id)).toEqual([
      expect.objectContaining({ id: ownerId, status: 'ready' }),
    ]);
  });

  it('keeps an unselected candidate scan resumable when the batch limit is reached', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-unselected-user',
      connectionId: 'reconcile-unselected-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const orphan = await putCommitted(dependencies, account.id, 'older object orphan');
    dependencies.clock.set(new Date('2026-01-02T00:00:00.000Z'));
    const temporary = await dependencies.blobStore.putTemporary({
      accountId: account.id,
      bytes: new TextEncoder().encode('newer temporary orphan'),
      contentType: 'text/plain',
    });
    const input = {
      accountId: account.id,
      olderThan: new Date('2026-01-03T00:00:00.000Z'),
      limit: 1,
    };

    const first = await reconcileBlobStorage(dependencies, input);
    expect(first).toEqual({
      deletedObjectCount: 1,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: null, exhausted: false },
        temporary: { value: null, exhausted: false },
      },
    });
    expect(dependencies.blobStore.snapshot().has(orphan.objectKey)).toBe(false);
    expect(dependencies.blobStore.temporarySnapshot().has(temporary.temporaryKey)).toBe(true);

    const second = await reconcileBlobStorage(dependencies, {
      ...input,
      cursor: first.cursor,
    });
    expect(second).toEqual({
      deletedObjectCount: 0,
      deletedTemporaryCount: 1,
      cursor: {
        object: { value: null, exhausted: true },
        temporary: { value: null, exhausted: false },
      },
    });
    expect(dependencies.blobStore.temporarySnapshot().has(temporary.temporaryKey)).toBe(false);

    await expect(
      reconcileBlobStorage(dependencies, { ...input, cursor: second.cursor }),
    ).resolves.toEqual({
      deletedObjectCount: 0,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: null, exhausted: true },
        temporary: { value: null, exhausted: true },
      },
    });
  });

  it('restarts a positional cursor after deletion so later entries are not skipped', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'reconcile-mutating-cursor-user',
      connectionId: 'reconcile-mutating-cursor-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    for (const value of ['first', 'second', 'third']) {
      await dependencies.blobStore.putTemporary({
        accountId: account.id,
        bytes: new TextEncoder().encode(value),
        contentType: 'text/plain',
      });
    }
    const input = {
      accountId: account.id,
      olderThan: new Date('2026-01-02T00:00:00.000Z'),
      limit: 2,
    };

    const first = await reconcileBlobStorage(dependencies, input);
    expect(first.deletedTemporaryCount).toBe(2);
    expect(first.cursor.temporary).toEqual({ value: null, exhausted: false });
    expect(dependencies.blobStore.temporarySnapshot().size).toBe(1);

    const second = await reconcileBlobStorage(dependencies, {
      ...input,
      cursor: first.cursor,
    });
    expect(second.deletedTemporaryCount).toBe(1);
    expect(second.cursor.temporary).toEqual({ value: null, exhausted: false });
    expect(dependencies.blobStore.temporarySnapshot().size).toBe(0);

    await expect(
      reconcileBlobStorage(dependencies, { ...input, cursor: second.cursor }),
    ).resolves.toEqual({
      deletedObjectCount: 0,
      deletedTemporaryCount: 0,
      cursor: {
        object: { value: null, exhausted: true },
        temporary: { value: null, exhausted: true },
      },
    });
  });
});
