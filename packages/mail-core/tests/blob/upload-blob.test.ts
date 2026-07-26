import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailCoreDependencies, MailTransaction } from '../../src';
import { createMailAccount, createMailCore } from '../../src';

const bytes = new TextEncoder().encode('blob');

const createHarness = async (storageQuotaBytes: bigint | null = null) => {
  const dependencies = createMemoryMailCoreDependencies();
  const account = await createMailAccount(dependencies, {
    userId: 'user-1',
    connectionId: 'connection-1',
    timezone: 'UTC',
    storageQuotaBytes,
  });
  return {
    dependencies,
    account,
    core: createMailCore(dependencies),
  };
};

describe('Blob upload', () => {
  it('stores ready account-scoped metadata and immutable bytes without changing mail state', async () => {
    const h = await createHarness();
    const input = Uint8Array.from(bytes);
    const stateBefore = await h.dependencies.inspect.stateVersion(h.account.id);

    const result = await h.core.uploadBlob({
      accountId: h.account.id,
      contentType: 'text/plain',
      bytes: input,
    });
    input[0] = 0;

    expect(result).toMatchObject({
      deduplicated: false,
      blob: {
        accountId: h.account.id,
        contentType: 'text/plain',
        status: 'ready',
        sizeBytes: 4n,
        readyAt: h.dependencies.clock.now(),
        deletedAt: null,
      },
    });
    expect(result.blob.objectKey).toBe(
      `mail/${h.account.id}/sha256/${result.blob.sha256.slice(0, 2)}/${result.blob.sha256}`,
    );
    await expect(
      h.dependencies.blobStore.get({
        accountId: h.account.id,
        objectKey: result.blob.objectKey,
      }),
    ).resolves.toEqual(bytes);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
    expect(await h.dependencies.inspect.stateVersion(h.account.id)).toBe(stateBefore);
  });

  it('deduplicates equal uploads within one account and keeps accounts isolated', async () => {
    const h = await createHarness();
    const first = await h.core.uploadBlob({
      accountId: h.account.id,
      contentType: 'text/plain',
      bytes,
    });
    const second = await h.core.uploadBlob({
      accountId: h.account.id,
      contentType: 'application/octet-stream',
      bytes,
    });
    const other = await createMailAccount(h.dependencies, {
      userId: 'user-2',
      connectionId: 'connection-2',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const foreign = await h.core.uploadBlob({
      accountId: other.id,
      contentType: 'text/plain',
      bytes,
    });

    expect(second).toEqual({ blob: first.blob, deduplicated: true });
    expect(foreign.deduplicated).toBe(false);
    expect(foreign.blob.id).not.toBe(first.blob.id);
    expect(foreign.blob.objectKey).not.toBe(first.blob.objectKey);
    expect(await h.dependencies.inspect.blobs(h.account.id)).toHaveLength(1);
    expect(await h.dependencies.inspect.blobs(other.id)).toHaveLength(1);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
  });

  it('serializes concurrent equal uploads into one metadata row', async () => {
    const h = await createHarness();

    const results = await Promise.all([
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ]);

    expect(new Set(results.map(({ blob }) => blob.id))).toHaveLength(1);
    expect(results.map(({ deduplicated }) => deduplicated).sort()).toEqual([false, true]);
    expect(await h.dependencies.inspect.blobs(h.account.id)).toHaveLength(1);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
  });

  it('counts ready upload metadata against account quota', async () => {
    const h = await createHarness(5n);
    await h.core.uploadBlob({
      accountId: h.account.id,
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('123'),
    });

    await expect(
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes: new TextEncoder().encode('456'),
      }),
    ).rejects.toMatchObject({ code: 'OVER_QUOTA' });
    expect(await h.dependencies.inspect.blobs(h.account.id)).toHaveLength(1);
    expect(h.dependencies.blobStore.snapshot().size).toBe(1);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
  });

  it('rejects missing and inactive accounts after cleaning the temporary object', async () => {
    const h = await createHarness();
    await h.dependencies.unitOfWork.run((tx) =>
      tx.accounts.update(h.account.id, { status: 'suspended' }),
    );

    await expect(
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_ACTIVE' });
    await expect(
      h.core.uploadBlob({
        accountId: 'missing-account' as typeof h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
    expect(h.dependencies.blobStore.snapshot().size).toBe(0);
  });

  it('removes temporary and committed objects when promotion integrity fails', async () => {
    const dependencies = createMemoryMailCoreDependencies({ corruptBlobOnCommit: 'sha256' });
    const account = await createMailAccount(dependencies, {
      userId: 'user-1',
      connectionId: 'connection-1',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });

    await expect(
      createMailCore(dependencies).uploadBlob({
        accountId: account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' });
    expect(await dependencies.inspect.blobs(account.id)).toEqual([]);
    expect(dependencies.blobStore.temporarySnapshot().size).toBe(0);
    expect(dependencies.blobStore.snapshot().size).toBe(0);
  });

  it('removes the temporary object when storage promotion fails', async () => {
    const h = await createHarness();
    h.dependencies.blobStore.setFailCommit(true);

    await expect(
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE' });
    expect(await h.dependencies.inspect.blobs(h.account.id)).toEqual([]);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
    expect(h.dependencies.blobStore.snapshot().size).toBe(0);
  });

  it('compensates the promoted object when the ready metadata update fails', async () => {
    const h = await createHarness();
    const baseUnitOfWork = h.dependencies.unitOfWork;
    let failReadyUpdate = true;
    const dependencies: MailCoreDependencies = {
      ...h.dependencies,
      unitOfWork: {
        run: <Result>(operation: (tx: MailTransaction) => Promise<Result>) =>
          baseUnitOfWork.run((tx) =>
            operation({
              ...tx,
              blobs: {
                ...tx.blobs,
                update: async (...arguments_) => {
                  if (failReadyUpdate) {
                    failReadyUpdate = false;
                    throw new Error('metadata update failed');
                  }
                  return tx.blobs.update(...arguments_);
                },
              },
            }),
          ),
      },
    };

    await expect(
      createMailCore(dependencies).uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).rejects.toThrow('metadata update failed');
    expect(await h.dependencies.inspect.blobs(h.account.id)).toEqual([]);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);
    expect(h.dependencies.blobStore.snapshot().size).toBe(0);
  });

  it('retains a committed upload after an unknown transaction acknowledgement and deduplicates retry', async () => {
    const h = await createHarness();
    h.dependencies.unitOfWork.failCommitAcknowledgementAfter(1);

    await expect(
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).rejects.toThrow('transaction commit outcome unknown');
    expect(await h.dependencies.inspect.blobs(h.account.id)).toHaveLength(1);
    expect(h.dependencies.blobStore.snapshot().size).toBe(1);
    expect(h.dependencies.blobStore.temporarySnapshot().size).toBe(0);

    await expect(
      h.core.uploadBlob({
        accountId: h.account.id,
        contentType: 'text/plain',
        bytes,
      }),
    ).resolves.toMatchObject({ deduplicated: true });
    expect(await h.dependencies.inspect.blobs(h.account.id)).toHaveLength(1);
  });
});
