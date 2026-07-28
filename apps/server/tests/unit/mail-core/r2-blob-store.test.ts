import { createHash } from 'node:crypto';

import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  createMailAccount,
  createMailCore,
  MailCoreError,
  type BlobStore,
  type MailAccountId,
} from '@zero/mail-core';
import { createMemoryMailCoreDependencies } from '../../../../../packages/mail-core/src/testing/fakes';
import { MemoryBlobStore, R2BlobStore, type R2BucketLike } from '../../../src/modules/mail';

type StoredObject = {
  bytes: Uint8Array;
  contentType?: string;
  uploaded: Date;
};

const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

class FakeR2Bucket implements R2BucketLike {
  readonly objects = new Map<string, StoredObject>();
  private failure: unknown | null = null;
  private deleteAcknowledgementFailure: Error | null = null;

  readonly put = vi.fn(
    async (
      key: string,
      value: Uint8Array | ArrayBuffer,
      options?: {
        httpMetadata?: { contentType?: string };
        onlyIf?: { etagDoesNotMatch?: string };
      },
    ) => {
      this.throwPendingFailure();
      if (options?.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) {
        return null;
      }
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      this.objects.set(key, {
        bytes: copyBytes(bytes),
        contentType: options?.httpMetadata?.contentType,
        uploaded: new Date('2026-01-01T00:00:00.000Z'),
      });
      return { key };
    },
  );

  readonly get = vi.fn(async (key: string) => {
    this.throwPendingFailure();
    const object = this.objects.get(key);
    if (object === undefined) return null;
    const bytes = copyBytes(object.bytes);
    return {
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      httpMetadata: { contentType: object.contentType },
    };
  });

  readonly delete = vi.fn(async (key: string) => {
    this.throwPendingFailure();
    this.objects.delete(key);
    const failure = this.deleteAcknowledgementFailure;
    this.deleteAcknowledgementFailure = null;
    if (failure !== null) throw failure;
  });

  readonly list = vi.fn(async (options?: { prefix?: string; cursor?: string; limit?: number }) => {
    const matching = [...this.objects.entries()]
      .filter(([key]) => options?.prefix === undefined || key.startsWith(options.prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    const offset = options?.cursor === undefined ? 0 : Number(options.cursor);
    const pageSize = Math.min(options?.limit ?? 1000, 1);
    const page = matching.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    return {
      objects: page.map(([key, object]) => ({
        key,
        uploaded: object.uploaded,
        size: object.bytes.byteLength,
      })),
      truncated: nextOffset < matching.length,
      cursor: nextOffset < matching.length ? String(nextOffset) : undefined,
    };
  });

  failNext(message: string): void {
    this.failure = new Error(message);
  }

  failNextWith(error: unknown): void {
    this.failure = error;
  }

  failDeleteAfterSideEffect(message: string): void {
    this.deleteAcknowledgementFailure = new Error(message);
  }

  private throwPendingFailure(): void {
    const failure = this.failure;
    this.failure = null;
    if (failure !== null) throw failure;
  }
}

const accountId = '01MAILACCOUNT' as MailAccountId;
const otherAccountId = '01OTHERACCOUNT' as MailAccountId;
const bytes = new TextEncoder().encode('blob');
const digest = createHash('sha256').update(bytes).digest('hex');
const objectKey = `mail/${accountId}/sha256/${digest.slice(0, 2)}/${digest}`;

const exerciseBlobStoreContract = (name: string, create: () => BlobStore): void => {
  describe(name, () => {
    it('promotes and retrieves bytes without retaining caller-owned buffers', async () => {
      const store = create();
      const input = copyBytes(bytes);
      const pending = await store.putTemporary({
        accountId,
        bytes: input,
        contentType: 'text/plain',
      });
      input[0] = 0;

      await store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey });
      const firstRead = await store.get({ accountId, objectKey });
      firstRead[0] = 0;

      await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);
    });

    it('rejects malformed and cross-account promotion keys', async () => {
      const store = create();
      const pending = await store.putTemporary({
        accountId,
        bytes,
        contentType: 'text/plain',
      });

      await expect(
        store.commitTemporary({
          accountId,
          temporaryKey: pending.temporaryKey,
          objectKey: `mail/${otherAccountId}/sha256/${digest.slice(0, 2)}/${digest}`,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
    });
  });
};

exerciseBlobStoreContract('MemoryBlobStore', () => new MemoryBlobStore());
exerciseBlobStoreContract('R2BlobStore', () => new R2BlobStore(new FakeR2Bucket()));

describe('R2BlobStore', () => {
  it('supports durable Mail Core upload and account-scoped deduplication', async () => {
    const bucket = new FakeR2Bucket();
    const blobStore = new R2BlobStore(bucket);
    const base = createMemoryMailCoreDependencies();
    const dependencies = { ...base, blobStore };
    const account = await createMailAccount(dependencies, {
      userId: 'r2-upload-user',
      connectionId: 'r2-upload-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const core = createMailCore(dependencies);

    const first = await core.uploadBlob({
      accountId: account.id,
      contentType: 'text/plain',
      bytes,
    });
    const second = await core.uploadBlob({
      accountId: account.id,
      contentType: 'application/octet-stream',
      bytes,
    });

    expect(second).toEqual({ blob: first.blob, deduplicated: true });
    expect([...bucket.objects.keys()]).toEqual([first.blob.objectKey]);
  });

  it('accepts the generated Cloudflare R2 bucket contract', () => {
    expectTypeOf<R2Bucket>().toMatchTypeOf<R2BucketLike>();
  });

  it('uses the exact account-scoped content-addressed key and idempotent conditional promotion', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const first = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });

    expect(first).toMatchObject({ sha256: digest, size: 4n });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: first.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });

    const second = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'application/octet-stream',
    });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: second.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });
    await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);
    expect(bucket.objects.get(objectKey)?.contentType).toBe('text/plain');
  });

  it('maps R2 list pagination to account-scoped BlobStore pages', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const first = await store.putTemporary({
      accountId,
      bytes: new TextEncoder().encode('first'),
      contentType: 'text/plain',
    });
    const second = await store.putTemporary({
      accountId,
      bytes: new TextEncoder().encode('second'),
      contentType: 'text/plain',
    });

    const firstPage = await store.list({
      accountId,
      kind: 'temporary',
      cursor: null,
      limit: 100,
    });
    const secondPage = await store.list({
      accountId,
      kind: 'temporary',
      cursor: firstPage.cursor,
      limit: 100,
    });

    expect(firstPage.entries).toHaveLength(1);
    expect(firstPage.cursor).not.toBeNull();
    expect(secondPage.entries).toHaveLength(1);
    expect(secondPage.cursor).toBeNull();
    expect([...firstPage.entries, ...secondPage.entries].map(({ key }) => key).sort()).toEqual(
      [first.temporaryKey, second.temporaryKey].sort(),
    );
    expect(bucket.list).toHaveBeenCalledTimes(2);
  });

  it('reports a missing temporary object without leaking its key', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const pending = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    await store.deleteTemporary({ accountId, temporaryKey: pending.temporaryKey });

    const failure = await store
      .commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'BLOB_NOT_FOUND', details: {} });
    expect(JSON.stringify(failure)).not.toContain(pending.temporaryKey);
  });

  it('retrieves bytes exactly and performs validated idempotent deletion', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const pending = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    await store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey });

    await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);
    await store.delete({ accountId, objectKey });
    await expect(store.delete({ accountId, objectKey })).resolves.toBeUndefined();
    await expect(store.get({ accountId, objectKey })).rejects.toMatchObject({
      code: 'BLOB_NOT_FOUND',
    });
  });

  it.each([
    '../escape',
    `mail/${accountId}/blobs/${digest}`,
    `mail/${accountId}/sha256/00/${digest}`,
    `mail/${accountId}/sha256/${digest.slice(0, 2)}/${digest.toUpperCase()}`,
    `mail/${accountId}/sha256/${digest.slice(0, 2)}/${digest}/extra`,
    `mail/../sha256/${digest.slice(0, 2)}/${digest}`,
  ])('rejects malformed object key %s', async (key) => {
    const store = new R2BlobStore(new FakeR2Bucket());
    await expect(store.get({ accountId, objectKey: key })).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
    await expect(store.delete({ accountId, objectKey: key })).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
  });

  it('rejects valid cross-account get, delete, and temporary deletion before bucket access', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const pending = await store.putTemporary({
      accountId: otherAccountId,
      bytes,
      contentType: 'text/plain',
    });
    const otherObjectKey = `mail/${otherAccountId}/sha256/${digest.slice(0, 2)}/${digest}`;
    await store.commitTemporary({
      accountId: otherAccountId,
      temporaryKey: pending.temporaryKey,
      objectKey: otherObjectKey,
    });
    const secondPending = await store.putTemporary({
      accountId: otherAccountId,
      bytes,
      contentType: 'text/plain',
    });
    const callsBefore = {
      get: bucket.get.mock.calls.length,
      delete: bucket.delete.mock.calls.length,
    };

    await expect(store.get({ accountId, objectKey: otherObjectKey })).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
    await expect(store.delete({ accountId, objectKey: otherObjectKey })).rejects.toMatchObject({
      code: 'INVALID_BLOB_KEY',
    });
    await expect(
      store.deleteTemporary({
        accountId,
        temporaryKey: secondPending.temporaryKey,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
    expect(bucket.get.mock.calls.length).toBe(callsBefore.get);
    expect(bucket.delete.mock.calls.length).toBe(callsBefore.delete);
    await expect(
      store.get({ accountId: otherAccountId, objectKey: otherObjectKey }),
    ).resolves.toEqual(bytes);
  });

  it('rejects invalid account IDs before writing temporary content', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);

    await expect(
      store.putTemporary({
        accountId: '../other' as MailAccountId,
        bytes,
        contentType: 'text/plain',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
    expect(bucket.objects.size).toBe(0);
  });

  it('rejects a validly shaped object key whose digest does not match temporary bytes', async () => {
    const store = new R2BlobStore(new FakeR2Bucket());
    const pending = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    const wrongDigest = '0'.repeat(64);

    await expect(
      store.commitTemporary({
        accountId,
        temporaryKey: pending.temporaryKey,
        objectKey: `mail/${accountId}/sha256/00/${wrongDigest}`,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' });
  });

  it('translates bucket failures without exposing credentials, keys, or object contents', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const privateMessage = `R2 credential=secret key=${objectKey} body=blob`;
    bucket.failNext(privateMessage);

    const failure = await store
      .putTemporary({ accountId, bytes, contentType: 'text/plain' })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'BLOB_STORE_FAILURE', details: {} });
    expect(String(failure)).not.toContain('credential=secret');
    expect(JSON.stringify(failure)).not.toContain(privateMessage);
  });

  it('retries promotion after temporary deletion succeeded but its acknowledgement was lost', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const pending = await store.putTemporary({
      accountId,
      bytes,
      contentType: 'text/plain',
    });
    bucket.failDeleteAfterSideEffect('delete acknowledgement contained credential=secret');

    await expect(
      store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE', details: {} });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });
    await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);
    expect(bucket.put).toHaveBeenCalledTimes(2);
  });

  it('sanitizes bucket-thrown MailCoreError details as an untrusted adapter failure', async () => {
    const bucket = new FakeR2Bucket();
    const store = new R2BlobStore(bucket);
    const privateValue = `credential=secret key=${objectKey}`;
    bucket.failNextWith(
      new MailCoreError('BLOB_STORE_FAILURE', {
        entityId: privateValue,
      }),
    );

    const failure = await store
      .putTemporary({ accountId, bytes, contentType: 'text/plain' })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: 'BLOB_STORE_FAILURE', details: {} });
    expect(String(failure)).not.toContain(privateValue);
    expect(JSON.stringify(failure)).not.toContain(privateValue);
  });
});
