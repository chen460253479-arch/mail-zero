import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createMailAccount,
  destroyEmail,
  garbageCollectBlobs,
  importEmail,
  type BlobId,
} from '../../src';
import { createSeededEmailHarness } from '../helpers/email-harness';

const DAY = 24 * 60 * 60 * 1000;

describe('garbageCollectBlobs', () => {
  it('collects only old unreferenced Blobs in one bounded batch', async () => {
    const h = await createSeededEmailHarness();
    const referenced = await h.inspect.rawBlob(h.emailId);
    const oldFirst = await h.inspect.seedOrphanBlob({ ageMs: 3 * DAY });
    const oldSecond = await h.inspect.seedOrphanBlob({ ageMs: 2 * DAY });
    const recent = await h.inspect.seedOrphanBlob({ ageMs: 60 * 1000 });

    const result = await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 1,
    });

    expect(result.collectedBlobIds).toEqual([oldFirst.id]);
    expect(await h.inspect.blob(oldFirst.id)).toBeNull();
    expect(h.inspect.objectExists(oldFirst.objectKey)).toBe(false);
    expect(await h.inspect.blob(oldSecond.id)).not.toBeNull();
    expect(await h.inspect.blob(recent.id)).not.toBeNull();
    expect(await h.inspect.blob(referenced.id)).not.toBeNull();
  });

  it('does not collect an unreferenced Blob created exactly at the cutoff', async () => {
    const h = await createSeededEmailHarness();
    const atCutoff = await h.inspect.seedOrphanBlob({ ageMs: DAY });

    await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    });

    expect(await h.inspect.blob(atCutoff.id)).not.toBeNull();
    expect(h.inspect.objectExists(atCutoff.objectKey)).toBe(true);
  });

  it('restores ready metadata after object deletion failure so a later run retries', async () => {
    const h = await createSeededEmailHarness();
    const orphan = await h.inspect.seedOrphanBlob({ ageMs: 2 * DAY });
    h.inspect.failNextBlobDelete(orphan.id);
    const input = {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    };

    await expect(garbageCollectBlobs(h.deps, input)).rejects.toMatchObject({
      code: 'BLOB_STORE_FAILURE',
    });
    expect(await h.inspect.blob(orphan.id)).toMatchObject({ status: 'ready' });
    expect(h.inspect.objectExists(orphan.objectKey)).toBe(true);

    await expect(garbageCollectBlobs(h.deps, input)).resolves.toEqual({
      collectedBlobIds: [orphan.id],
    });
    expect(await h.inspect.blob(orphan.id)).toBeNull();
  });

  it('serializes collection with a same-content import so collected bytes cannot be reused', async () => {
    const h = await createSeededEmailHarness();
    const rawBlob = await h.inspect.rawBlob(h.emailId);
    await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    h.clock.set(new Date(h.clock.now().getTime() + 2 * DAY));
    const input = {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    };
    const originalDelete = h.deps.blobStore.delete.bind(h.deps.blobStore);
    let deleteCalls = 0;
    let releaseFirstDelete!: () => void;
    const firstDeleteMayFinish = new Promise<void>((resolve) => {
      releaseFirstDelete = resolve;
    });
    let markFirstDeleteStarted!: () => void;
    const firstDeleteStarted = new Promise<void>((resolve) => {
      markFirstDeleteStarted = resolve;
    });
    let markConcurrentDeleteStarted!: () => void;
    const concurrentDeleteStarted = new Promise<void>((resolve) => {
      markConcurrentDeleteStarted = resolve;
    });
    h.deps.blobStore.failNextDelete(rawBlob.objectKey);
    h.deps.blobStore.delete = async (objectKey: string) => {
      if (objectKey === rawBlob.objectKey) {
        deleteCalls += 1;
        if (deleteCalls === 1) {
          markFirstDeleteStarted();
          await firstDeleteMayFinish;
        } else {
          markConcurrentDeleteStarted();
        }
      }
      await originalDelete(objectKey);
    };

    const firstCollection = garbageCollectBlobs(h.deps, input).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    await firstDeleteStarted;
    const secondCollection = garbageCollectBlobs(h.deps, input).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );
    const concurrentDeleteWasReached = await Promise.race([
      concurrentDeleteStarted.then(() => true),
      new Promise<false>((resolve) => setImmediate(() => resolve(false))),
    ]);

    let imported;
    if (concurrentDeleteWasReached) {
      await secondCollection;
      imported = await importEmail(h.deps, {
        accountId: h.accountId,
        provider: 'fixture',
        remoteEmailId: 'gc-race-reimport',
        remoteThreadId: null,
        raw: h.raw,
        mailboxIds: [h.inboxId],
        keywords: [],
        receivedAt: h.clock.now(),
      });
      releaseFirstDelete();
      await firstCollection;
    } else {
      const pendingImport = importEmail(h.deps, {
        accountId: h.accountId,
        provider: 'fixture',
        remoteEmailId: 'gc-race-reimport',
        remoteThreadId: null,
        raw: h.raw,
        mailboxIds: [h.inboxId],
        keywords: [],
        receivedAt: h.clock.now(),
      });
      releaseFirstDelete();
      await firstCollection;
      await secondCollection;
      imported = await pendingImport;
    }

    await expect(h.deps.inspect.rawBytes(imported.emailId)).resolves.toEqual(h.raw);
  });

  it('maps BlobStore deletion failures to a safe retryable error', async () => {
    const h = await createSeededEmailHarness();
    const orphan = await h.inspect.seedOrphanBlob({ ageMs: 2 * DAY });
    const privateMessage = `delete failed for signed key ${orphan.objectKey}?secret=private`;
    h.deps.blobStore.delete = async () => {
      throw new Error(privateMessage);
    };

    const failure = await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'BLOB_STORE_FAILURE' });
    expect(String(failure)).not.toContain('secret=private');
    expect(JSON.stringify(failure)).not.toContain('secret=private');
    expect(await h.inspect.blob(orphan.id)).toMatchObject({ status: 'ready' });
    expect(h.inspect.objectExists(orphan.objectKey)).toBe(true);
  });

  it('collects content only after permanent destruction removes every reference', async () => {
    const h = await createSeededEmailHarness();
    const raw = await h.inspect.rawBlob(h.emailId);
    h.clock.set(new Date(h.clock.now().getTime() + 2 * DAY));

    await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    });
    expect(await h.inspect.blob(raw.id)).not.toBeNull();

    await destroyEmail(h.deps, {
      accountId: h.accountId,
      emailId: h.emailId,
    });
    await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    });
    expect(await h.inspect.blob(raw.id)).toBeNull();
  });

  it('is account scoped and never deletes an object through a non-canonical key', async () => {
    const h = await createSeededEmailHarness();
    const other = await createMailAccount(h.deps, {
      userId: 'gc-other-user',
      connectionId: 'gc-other-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const otherOrphan = await h.inspect.seedOrphanBlob({
      accountId: other.id,
      ageMs: 2 * DAY,
    });
    const malicious = await h.inspect.seedOrphanBlob({ ageMs: 2 * DAY });
    await h.deps.unitOfWork.run((tx) =>
      tx.blobs.update(h.accountId, malicious.id, {
        objectKey: otherOrphan.objectKey,
      }),
    );

    await garbageCollectBlobs(h.deps, {
      accountId: h.accountId,
      olderThan: new Date(h.clock.now().getTime() - DAY),
      limit: 100,
    });

    expect(await h.inspect.blob(otherOrphan.id)).not.toBeNull();
    expect(h.inspect.objectExists(otherOrphan.objectKey)).toBe(true);
    expect(await h.inspect.blob(malicious.id)).toMatchObject({
      status: 'ready',
    });
  });

  it.each([0, -1, 1001])('rejects an unsafe batch limit of %s', async (limit) => {
    const h = await createSeededEmailHarness();
    await expect(
      garbageCollectBlobs(h.deps, {
        accountId: h.accountId,
        olderThan: new Date(h.clock.now().getTime() - DAY),
        limit,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_GC_REQUEST' });
  });

  it('does not expose any caller-supplied object key in its input type', () => {
    type Input = Parameters<typeof garbageCollectBlobs>[1];
    expectTypeOf<Input>().not.toHaveProperty('objectKey');
    expectTypeOf<Input>().not.toHaveProperty('blobIds');
    expectTypeOf<BlobId>().toBeString();
  });
});
