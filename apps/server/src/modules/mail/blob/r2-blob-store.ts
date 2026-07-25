import { MailCoreError, type BlobCommitReceipt, type BlobStore } from '@zero/mail-core';

import {
  buildObjectKey,
  buildObjectPrefix,
  buildTemporaryKey,
  buildTemporaryPrefix,
  bytesEqual,
  calculateSha256,
  copyBytes,
  requireObjectKeyForAccount,
  requireTemporaryKeyForAccount,
} from './blob-key';

export type R2ObjectLike = {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
};

export type R2ListedObjectLike = {
  key: string;
  uploaded: Date;
  size: number;
};

export type R2BucketLike = {
  put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string };
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ): Promise<unknown | null>;
  get(key: string): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: R2ListedObjectLike[];
    truncated: boolean;
    cursor?: string;
  }>;
};

const runBucket = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch {
    throw new MailCoreError('BLOB_STORE_FAILURE');
  }
};

const readObject = async (object: R2ObjectLike): Promise<Uint8Array> =>
  copyBytes(new Uint8Array(await runBucket(() => object.arrayBuffer())));

export class R2BlobStore implements BlobStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async putTemporary(
    input: Parameters<BlobStore['putTemporary']>[0],
  ): ReturnType<BlobStore['putTemporary']> {
    const temporaryKey = buildTemporaryKey(input.accountId);
    const bytes = copyBytes(input.bytes);
    const sha256 = await calculateSha256(bytes);
    const result = await runBucket(() =>
      this.bucket.put(temporaryKey, bytes, {
        httpMetadata: { contentType: input.contentType },
      }),
    );
    if (result === null) {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    return { temporaryKey, sha256, size: BigInt(bytes.byteLength) };
  }

  async commitTemporary(
    input: Parameters<BlobStore['commitTemporary']>[0],
  ): Promise<BlobCommitReceipt> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    const target = requireObjectKeyForAccount(input.accountId, input.objectKey);
    const pendingObject = await runBucket(() => this.bucket.get(input.temporaryKey));
    if (pendingObject === null) {
      const committedObject = await runBucket(() => this.bucket.get(input.objectKey));
      if (committedObject === null) {
        throw new MailCoreError('BLOB_NOT_FOUND');
      }
      const committedBytes = await readObject(committedObject);
      if ((await calculateSha256(committedBytes)) !== target.sha256) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
      return { objectKey: input.objectKey, created: true };
    }
    const bytes = await readObject(pendingObject);
    const sha256 = await calculateSha256(bytes);
    if (target.sha256 !== sha256 || input.objectKey !== buildObjectKey(target.accountId, sha256)) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }

    const promoted = await runBucket(() =>
      this.bucket.put(input.objectKey, bytes, {
        httpMetadata: { contentType: pendingObject.httpMetadata?.contentType },
        onlyIf: { etagDoesNotMatch: '*' },
      }),
    );
    if (promoted === null) {
      const existingObject = await runBucket(() => this.bucket.get(input.objectKey));
      if (existingObject === null || !bytesEqual(await readObject(existingObject), bytes)) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
    }
    await runBucket(() => this.bucket.delete(input.temporaryKey));
    return { objectKey: input.objectKey, created: true };
  }

  async deleteTemporary(input: Parameters<BlobStore['deleteTemporary']>[0]): Promise<void> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    await runBucket(() => this.bucket.delete(input.temporaryKey));
  }

  async get(input: Parameters<BlobStore['get']>[0]): Promise<Uint8Array> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    const object = await runBucket(() => this.bucket.get(input.objectKey));
    if (object === null) {
      throw new MailCoreError('BLOB_NOT_FOUND');
    }
    return readObject(object);
  }

  async delete(input: Parameters<BlobStore['delete']>[0]): Promise<void> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    await runBucket(() => this.bucket.delete(input.objectKey));
  }

  async list(input: Parameters<BlobStore['list']>[0]): ReturnType<BlobStore['list']> {
    const prefix =
      input.kind === 'object'
        ? buildObjectPrefix(input.accountId)
        : buildTemporaryPrefix(input.accountId);
    const result = await runBucket(() =>
      this.bucket.list({
        prefix,
        ...(input.cursor === null ? {} : { cursor: input.cursor }),
        limit: input.limit,
      }),
    );
    const entries = result.objects.map((object) => {
      if (input.kind === 'object') {
        requireObjectKeyForAccount(input.accountId, object.key);
      } else {
        requireTemporaryKeyForAccount(input.accountId, object.key);
      }
      return {
        key: object.key,
        uploadedAt: new Date(object.uploaded),
        sizeBytes: BigInt(object.size),
      };
    });
    if (result.truncated && (result.cursor === undefined || result.cursor.length === 0)) {
      throw new MailCoreError('BLOB_STORE_FAILURE');
    }
    return {
      entries,
      cursor: result.truncated ? result.cursor! : null,
    };
  }
}
