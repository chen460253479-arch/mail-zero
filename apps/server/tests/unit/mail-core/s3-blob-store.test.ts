import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { MailAccountId } from '@zero/mail-core';

import {
  S3BlobStore,
  S3ObjectNotFoundError,
  type S3ObjectClient,
  type S3ObjectMetadata,
} from '../../../src/modules/mail/blob/s3-blob-store';

const accountId = '01S3ACCOUNT' as MailAccountId;
const userId = '01S3USER';
const otherAccountId = '01S3OTHER' as MailAccountId;
const otherUserId = '01S3OTHERUSER';
const bytes = new TextEncoder().encode('persistent S3 blob');
const digest = createHash('sha256').update(bytes).digest('hex');
const objectKey = `mail/users/${userId}/accounts/${accountId}/messages/sha256/${digest.slice(0, 2)}/${digest}`;

type StoredObject = S3ObjectMetadata & {
  bytes: Uint8Array;
  contentType: string;
};

class FakeS3ObjectClient implements S3ObjectClient {
  readonly objects = new Map<string, StoredObject>();
  readonly calls: Array<{ operation: string; key?: string; range?: string }> = [];
  failOperation: string | null = null;
  private tick = 0;

  async headBucket(): Promise<void> {
    this.calls.push({ operation: 'headBucket' });
    this.failIfRequested('headBucket');
  }

  close(): void {
    this.calls.push({ operation: 'close' });
  }

  async putObject(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<void> {
    this.calls.push({ operation: 'putObject', key: input.key });
    this.failIfRequested('putObject');
    this.tick += 1;
    this.objects.set(input.key, {
      bytes: Uint8Array.from(input.bytes),
      contentType: input.contentType,
      sha256: input.sha256,
      sizeBytes: BigInt(input.bytes.byteLength),
      uploadedAt: new Date(`2026-01-01T00:00:${this.tick.toString().padStart(2, '0')}.000Z`),
    });
  }

  async headObject(key: string): Promise<S3ObjectMetadata | null> {
    this.calls.push({ operation: 'headObject', key });
    this.failIfRequested('headObject');
    const object = this.objects.get(key);
    return object === undefined
      ? null
      : {
          sha256: object.sha256,
          sizeBytes: object.sizeBytes,
          uploadedAt: new Date(object.uploadedAt),
        };
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    this.calls.push({ operation: 'copyObject', key: targetKey });
    this.failIfRequested('copyObject');
    const source = this.objects.get(sourceKey);
    if (source === undefined) throw new S3ObjectNotFoundError();
    this.tick += 1;
    this.objects.set(targetKey, {
      ...source,
      bytes: Uint8Array.from(source.bytes),
      uploadedAt: new Date(`2026-01-01T00:00:${this.tick.toString().padStart(2, '0')}.000Z`),
    });
  }

  async getObject(key: string, range?: { offset: number; length: number }): Promise<Uint8Array> {
    const rangeHeader =
      range === undefined ? undefined : `bytes=${range.offset}-${range.offset + range.length - 1}`;
    this.calls.push({ operation: 'getObject', key, range: rangeHeader });
    this.failIfRequested('getObject');
    const object = this.objects.get(key);
    if (object === undefined) throw new S3ObjectNotFoundError();
    return range === undefined
      ? Uint8Array.from(object.bytes)
      : object.bytes.slice(range.offset, range.offset + range.length);
  }

  async deleteObject(key: string): Promise<void> {
    this.calls.push({ operation: 'deleteObject', key });
    this.failIfRequested('deleteObject');
    this.objects.delete(key);
  }

  async listObjects(input: {
    prefix: string;
    continuationToken: string | null;
    limit: number;
  }): Promise<{
    entries: Array<{ key: string; uploadedAt: Date; sizeBytes: bigint }>;
    continuationToken: string | null;
  }> {
    this.calls.push({ operation: 'listObjects', key: input.prefix });
    this.failIfRequested('listObjects');
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(input.prefix))
      .sort((left, right) => left.localeCompare(right));
    const offset = input.continuationToken === null ? 0 : Number(input.continuationToken);
    const page = keys.slice(offset, offset + input.limit);
    const nextOffset = offset + page.length;
    return {
      entries: page.map((key) => {
        const object = this.objects.get(key)!;
        return {
          key,
          uploadedAt: new Date(object.uploadedAt),
          sizeBytes: object.sizeBytes,
        };
      }),
      continuationToken: nextOffset < keys.length ? String(nextOffset) : null,
    };
  }

  private failIfRequested(operation: string): void {
    if (this.failOperation === operation) throw new Error(`${operation} failed`);
  }
}

describe('S3BlobStore', () => {
  let client: FakeS3ObjectClient;
  let store: S3BlobStore;

  beforeEach(() => {
    client = new FakeS3ObjectClient();
    store = new S3BlobStore({ client, prefix: 'mail' });
  });

  it('closes its S3 client', () => {
    store.close();

    expect(client.calls).toEqual([{ operation: 'close' }]);
  });

  it('probes bucket write, full read, range read, and delete without leaving an object', async () => {
    await store.initialize();

    expect(client.calls.map(({ operation }) => operation)).toEqual([
      'headBucket',
      'putObject',
      'getObject',
      'getObject',
      'deleteObject',
    ]);
    expect(client.objects).toHaveLength(0);
  });

  it('stores a private temporary object without retaining the caller buffer', async () => {
    const input = Uint8Array.from(bytes);
    const pending = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes: input,
      contentType: 'message/rfc822',
    });
    input[0] = 0;

    expect(pending).toMatchObject({ sha256: digest, size: BigInt(bytes.byteLength) });
    expect(pending.temporaryKey).toMatch(
      new RegExp(`^mail/users/${userId}/accounts/${accountId}/temporary/message_mime/`, 'u'),
    );
    expect([...client.objects.keys()]).toEqual([pending.temporaryKey]);
    expect(client.objects.get(pending.temporaryKey)?.bytes).toEqual(bytes);
  });

  it('copies a temporary object to its content address and commits idempotently', async () => {
    const first = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'message/rfc822',
    });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: first.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });
    expect(client.objects.has(first.temporaryKey)).toBe(false);
    await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);

    const second = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'application/octet-stream',
    });
    await expect(
      store.commitTemporary({ accountId, temporaryKey: second.temporaryKey, objectKey }),
    ).resolves.toEqual({ objectKey, created: true });
    expect(client.objects.has(second.temporaryKey)).toBe(false);
    await expect(store.get({ accountId, objectKey })).resolves.toEqual(bytes);
  });

  it('rejects a target whose content metadata conflicts with its content-addressed key', async () => {
    client.objects.set(objectKey, {
      bytes: new TextEncoder().encode('corrupt'),
      contentType: 'message/rfc822',
      sha256: '0'.repeat(64),
      sizeBytes: 7n,
      uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const pending = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'message/rfc822',
    });

    await expect(
      store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey }),
    ).rejects.toMatchObject({ code: 'BLOB_INTEGRITY' });
  });

  it('returns exact byte ranges and maps a missing object to BLOB_NOT_FOUND', async () => {
    const pending = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'message/rfc822',
    });
    await store.commitTemporary({ accountId, temporaryKey: pending.temporaryKey, objectKey });

    await expect(store.getRange({ accountId, objectKey, offset: 3, length: 7 })).resolves.toEqual(
      bytes.slice(3, 10),
    );
    expect(client.calls.at(-1)).toMatchObject({
      operation: 'getObject',
      range: 'bytes=3-9',
    });
    const missingDigest = 'f'.repeat(64);
    await expect(
      store.get({
        accountId,
        objectKey: `mail/users/${userId}/accounts/${accountId}/messages/sha256/${missingDigest.slice(0, 2)}/${missingDigest}`,
      }),
    ).rejects.toMatchObject({ code: 'BLOB_NOT_FOUND' });
  });

  it('lists only account-owned logical keys with an account-bound opaque cursor', async () => {
    await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes: new TextEncoder().encode('first'),
      contentType: 'text/plain',
    });
    await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes: new TextEncoder().encode('second'),
      contentType: 'text/plain',
    });
    await store.putTemporary({
      userId: otherUserId,
      accountId: otherAccountId,
      kind: 'message_mime',
      bytes: new TextEncoder().encode('other'),
      contentType: 'text/plain',
    });

    const firstPage = await store.list({
      userId,
      accountId,
      kind: 'temporary',
      cursor: null,
      limit: 1,
    });
    const secondPage = await store.list({
      userId,
      accountId,
      kind: 'temporary',
      cursor: firstPage.cursor,
      limit: 1,
    });

    expect([...firstPage.entries, ...secondPage.entries]).toHaveLength(2);
    expect(
      [...firstPage.entries, ...secondPage.entries].every(({ key }) =>
        key.startsWith(`mail/users/${userId}/accounts/${accountId}/temporary/message_mime/`),
      ),
    ).toBe(true);
    expect(firstPage.cursor).not.toBeNull();
    expect(secondPage.cursor).toBeNull();
    await expect(
      store.list({
        userId: otherUserId,
        accountId: otherAccountId,
        kind: 'temporary',
        cursor: firstPage.cursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
  });

  it('deletes temporary and permanent objects idempotently and hides client failures', async () => {
    const temporary = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'message/rfc822',
    });
    await store.deleteTemporary({ accountId, temporaryKey: temporary.temporaryKey });
    await expect(
      store.deleteTemporary({ accountId, temporaryKey: temporary.temporaryKey }),
    ).resolves.toBeUndefined();

    const committed = await store.putTemporary({
      userId,
      accountId,
      kind: 'message_mime',
      bytes,
      contentType: 'message/rfc822',
    });
    await store.commitTemporary({
      accountId,
      temporaryKey: committed.temporaryKey,
      objectKey,
    });
    await store.delete({ accountId, objectKey });
    await expect(store.delete({ accountId, objectKey })).resolves.toBeUndefined();

    client.failOperation = 'putObject';
    await expect(
      store.putTemporary({
        userId,
        accountId,
        kind: 'message_mime',
        bytes,
        contentType: 'message/rfc822',
      }),
    ).rejects.toMatchObject({ code: 'BLOB_STORE_FAILURE', details: {} });
  });

  it('rejects malformed and cross-account keys before calling S3', async () => {
    const before = client.calls.length;
    await expect(
      store.get({
        accountId: otherAccountId,
        objectKey,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
    await expect(
      store.get({
        accountId,
        objectKey: `mail/users/${userId}/accounts/${accountId}/messages/sha256/00/${digest}`,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BLOB_KEY' });
    expect(client.calls).toHaveLength(before);
  });
});
