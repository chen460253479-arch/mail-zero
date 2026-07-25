import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createMailAccount, importEmail, readBlob, type BlobReadAuditEvent } from '../../src';
import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';

const raw = new Uint8Array(readFileSync(new URL('../fixtures/simple.eml', import.meta.url)));

const createHarness = async () => {
  const auditEvents: BlobReadAuditEvent[] = [];
  const audit = vi.fn(async (event: BlobReadAuditEvent) => {
    auditEvents.push(structuredClone(event));
  });
  const dependencies = createMemoryMailCoreDependencies({
    blobReadAuditSink: { record: audit },
  });
  const account = await createMailAccount(dependencies, {
    userId: 'blob-reader',
    connectionId: 'blob-reader-connection',
    timezone: 'UTC',
    storageQuotaBytes: null,
  });
  const inbox = (await dependencies.inspect.mailboxes(account.id)).find(
    ({ role }) => role === 'inbox',
  )!;
  const imported = await importEmail(dependencies, {
    accountId: account.id,
    provider: 'fixture',
    remoteEmailId: 'blob-read',
    remoteThreadId: null,
    raw,
    mailboxIds: [inbox.id],
    keywords: [],
    receivedAt: dependencies.clock.now(),
  });
  const email = (await dependencies.inspect.email(imported.emailId))!;
  const blob = await dependencies.inspect.blob(email.blobId!);
  return { dependencies, account, blob: blob!, audit, auditEvents };
};

describe('readBlob', () => {
  it('reads a ready account-scoped Blob once, verifies it, and audits the access', async () => {
    const h = await createHarness();
    const get = vi.spyOn(h.dependencies.blobStore, 'get');

    await expect(
      readBlob(h.dependencies, {
        accountId: h.account.id,
        blobId: h.blob.id,
      }),
    ).resolves.toEqual(raw);

    expect(get).toHaveBeenCalledOnce();
    expect(h.audit).toHaveBeenCalledOnce();
    expect(h.auditEvents).toEqual([
      {
        accountId: h.account.id,
        blobId: h.blob.id,
        sha256: h.blob.sha256,
        sizeBytes: h.blob.sizeBytes,
        outcome: 'success',
        occurredAt: h.dependencies.clock.now(),
      },
    ]);
  });

  it('does not hold a database transaction open during storage reads and hashing', async () => {
    const h = await createHarness();
    const originalGet = h.dependencies.blobStore.get.bind(h.dependencies.blobStore);
    let markGetStarted!: () => void;
    const getStarted = new Promise<void>((resolve) => {
      markGetStarted = resolve;
    });
    let releaseGet!: () => void;
    const getMayFinish = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    h.dependencies.blobStore.get = async (input) => {
      markGetStarted();
      await getMayFinish;
      return originalGet(input);
    };

    const read = readBlob(h.dependencies, {
      accountId: h.account.id,
      blobId: h.blob.id,
    });
    await getStarted;
    const transactionProgressed = await Promise.race([
      h.dependencies.unitOfWork
        .run(async (tx) => (await tx.accounts.findById(h.account.id)) !== null)
        .then(() => true),
      new Promise<false>((resolve) => setImmediate(() => resolve(false))),
    ]);
    expect(transactionProgressed).toBe(true);

    releaseGet();
    await expect(read).resolves.toEqual(raw);
  });

  it('revalidates ready metadata after the external read before returning bytes', async () => {
    const h = await createHarness();
    const originalGet = h.dependencies.blobStore.get.bind(h.dependencies.blobStore);
    let markGetStarted!: () => void;
    const getStarted = new Promise<void>((resolve) => {
      markGetStarted = resolve;
    });
    let releaseGet!: () => void;
    const getMayFinish = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    h.dependencies.blobStore.get = async (input) => {
      markGetStarted();
      await getMayFinish;
      return originalGet(input);
    };

    const read = readBlob(h.dependencies, {
      accountId: h.account.id,
      blobId: h.blob.id,
    });
    await getStarted;
    await h.dependencies.unitOfWork.run((tx) =>
      tx.blobs.update(h.account.id, h.blob.id, { status: 'deleting' }),
    );
    releaseGet();

    await expect(read).rejects.toMatchObject({
      code: 'BLOB_NOT_FOUND',
      details: { entityId: h.blob.id },
    });
    expect(h.audit).not.toHaveBeenCalled();
  });

  it('rejects cross-account and non-ready metadata before Blob storage access', async () => {
    const h = await createHarness();
    const get = vi.spyOn(h.dependencies.blobStore, 'get');
    const other = await createMailAccount(h.dependencies, {
      userId: 'other-reader',
      connectionId: 'other-reader-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });

    await expect(
      readBlob(h.dependencies, {
        accountId: other.id,
        blobId: h.blob.id,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_NOT_FOUND', details: { entityId: h.blob.id } });
    await h.dependencies.unitOfWork.run((tx) =>
      tx.blobs.update(h.account.id, h.blob.id, { status: 'deleting' }),
    );
    await expect(
      readBlob(h.dependencies, {
        accountId: h.account.id,
        blobId: h.blob.id,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_NOT_FOUND', details: { entityId: h.blob.id } });

    expect(get).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it.each(['sha256', 'size'] as const)(
    'returns BLOB_INTEGRITY and audits the anomaly when %s verification fails',
    async (corruption) => {
      const h = await createHarness();
      await h.dependencies.unitOfWork.run((tx) =>
        tx.blobs.update(h.account.id, h.blob.id, {
          ...(corruption === 'sha256' ? { sha256: '0'.repeat(64) } : { sizeBytes: 1n }),
        }),
      );
      const get = vi.spyOn(h.dependencies.blobStore, 'get');

      await expect(
        readBlob(h.dependencies, {
          accountId: h.account.id,
          blobId: h.blob.id,
        }),
      ).rejects.toMatchObject({ code: 'BLOB_INTEGRITY', details: {} });

      expect(get).toHaveBeenCalledOnce();
      expect(h.auditEvents).toEqual([
        {
          accountId: h.account.id,
          blobId: h.blob.id,
          sha256: corruption === 'sha256' ? '0'.repeat(64) : h.blob.sha256,
          sizeBytes: corruption === 'size' ? 1n : h.blob.sizeBytes,
          outcome: 'integrity_failure',
          occurredAt: h.dependencies.clock.now(),
        },
      ]);
    },
  );
});
