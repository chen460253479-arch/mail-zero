import {
  MailCoreError,
  type BlobCommitReceipt,
  type BlobStore,
  type MailAccountId,
} from '@zero/mail-core';

import {
  buildObjectPrefix,
  buildTemporaryKey,
  buildTemporaryPrefix,
  bytesEqual,
  calculateSha256,
  copyBytes,
  requireObjectKeyForAccount,
  requireTemporaryKeyForAccount,
} from './blob-key';

export type S3ObjectMetadata = {
  sha256: string | null;
  sizeBytes: bigint;
  uploadedAt: Date;
};

export interface S3ObjectClient {
  close(): void;
  headBucket(): Promise<void>;
  putObject(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<void>;
  headObject(key: string): Promise<S3ObjectMetadata | null>;
  copyObject(sourceKey: string, targetKey: string): Promise<void>;
  getObject(key: string, range?: { offset: number; length: number }): Promise<Uint8Array>;
  deleteObject(key: string): Promise<void>;
  listObjects(input: {
    prefix: string;
    continuationToken: string | null;
    limit: number;
  }): Promise<{
    entries: Array<{ key: string; uploadedAt: Date; sizeBytes: bigint }>;
    continuationToken: string | null;
  }>;
}

export class S3ObjectNotFoundError extends Error {
  constructor() {
    super('S3 object not found');
    this.name = 'S3ObjectNotFoundError';
  }
}

type S3ListCursor = {
  version: 1;
  accountId: string;
  kind: 'object' | 'temporary';
  continuationToken: string;
};

const blobStoreFailure = (): MailCoreError => new MailCoreError('BLOB_STORE_FAILURE');
const blobNotFound = (): MailCoreError => new MailCoreError('BLOB_NOT_FOUND');

const safeClientCall = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MailCoreError) throw error;
    if (error instanceof S3ObjectNotFoundError) throw blobNotFound();
    throw blobStoreFailure();
  }
};

const normalizePrefix = (value: string): string => {
  const prefix = value.trim().replace(/^\/+|\/+$/gu, '');
  if (
    prefix.length === 0 ||
    prefix.length > 512 ||
    prefix.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    /[\u0000-\u001f\u007f\\]/u.test(prefix)
  ) {
    throw blobStoreFailure();
  }
  return prefix;
};

const encodeCursor = (cursor: S3ListCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const parseCursor = (
  cursor: string,
  accountId: string,
  kind: 'object' | 'temporary',
): S3ListCursor => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).version !== 1 ||
      (value as Record<string, unknown>).accountId !== accountId ||
      (value as Record<string, unknown>).kind !== kind ||
      typeof (value as Record<string, unknown>).continuationToken !== 'string' ||
      (value as Record<string, unknown>).continuationToken === ''
    ) {
      throw new Error('invalid cursor');
    }
    return value as S3ListCursor;
  } catch {
    throw new MailCoreError('INVALID_BLOB_KEY');
  }
};

const requireMatchingObject = (
  metadata: S3ObjectMetadata,
  expectedSha256: string,
  expectedSize: bigint | null,
): void => {
  if (
    metadata.sha256 !== expectedSha256 ||
    metadata.sizeBytes < 0n ||
    (expectedSize !== null && metadata.sizeBytes !== expectedSize)
  ) {
    throw new MailCoreError('BLOB_INTEGRITY');
  }
};

export class S3BlobStore implements BlobStore {
  private readonly client: S3ObjectClient;
  private readonly prefix: string;

  constructor(input: { client: S3ObjectClient; prefix: string }) {
    this.client = input.client;
    this.prefix = normalizePrefix(input.prefix);
  }

  close(): void {
    this.client.close();
  }

  async initialize(): Promise<void> {
    await safeClientCall(() => this.client.headBucket());
    const accountId = 'startup-probe' as MailAccountId;
    const logicalKey = buildTemporaryKey(accountId);
    const physicalKey = this.physicalKey(logicalKey);
    const bytes = new TextEncoder().encode('zero-mail-s3-probe');
    const sha256 = await calculateSha256(bytes);
    try {
      await safeClientCall(() =>
        this.client.putObject({
          key: physicalKey,
          bytes,
          contentType: 'application/octet-stream',
          sha256,
        }),
      );
      const full = await safeClientCall(() => this.client.getObject(physicalKey));
      const range = await safeClientCall(() =>
        this.client.getObject(physicalKey, { offset: 2, length: 5 }),
      );
      if (!bytesEqual(full, bytes) || !bytesEqual(range, bytes.slice(2, 7))) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
    } finally {
      await safeClientCall(() => this.client.deleteObject(physicalKey));
    }
  }

  async putTemporary(
    input: Parameters<BlobStore['putTemporary']>[0],
  ): ReturnType<BlobStore['putTemporary']> {
    const temporaryKey = buildTemporaryKey(input.accountId);
    const stored = copyBytes(input.bytes);
    const sha256 = await calculateSha256(stored);
    await safeClientCall(() =>
      this.client.putObject({
        key: this.physicalKey(temporaryKey),
        bytes: stored,
        contentType: input.contentType,
        sha256,
      }),
    );
    return { temporaryKey, sha256, size: BigInt(stored.byteLength) };
  }

  async commitTemporary(
    input: Parameters<BlobStore['commitTemporary']>[0],
  ): Promise<BlobCommitReceipt> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    const target = requireObjectKeyForAccount(input.accountId, input.objectKey);
    const temporaryKey = this.physicalKey(input.temporaryKey);
    const objectKey = this.physicalKey(input.objectKey);
    const temporary = await safeClientCall(() => this.client.headObject(temporaryKey));

    if (temporary === null) {
      const committed = await safeClientCall(() => this.client.headObject(objectKey));
      if (committed === null) throw blobNotFound();
      requireMatchingObject(committed, target.sha256, null);
      return { objectKey: input.objectKey, created: true };
    }
    requireMatchingObject(temporary, target.sha256, null);

    const existing = await safeClientCall(() => this.client.headObject(objectKey));
    if (existing !== null) {
      requireMatchingObject(existing, target.sha256, temporary.sizeBytes);
      await this.deleteCommittedTemporary(temporaryKey);
      return { objectKey: input.objectKey, created: true };
    }

    await safeClientCall(() => this.client.copyObject(temporaryKey, objectKey));
    const committed = await safeClientCall(() => this.client.headObject(objectKey));
    if (committed === null) throw blobStoreFailure();
    requireMatchingObject(committed, target.sha256, temporary.sizeBytes);
    await this.deleteCommittedTemporary(temporaryKey);
    return { objectKey: input.objectKey, created: true };
  }

  async deleteTemporary(input: Parameters<BlobStore['deleteTemporary']>[0]): Promise<void> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    await safeClientCall(() => this.client.deleteObject(this.physicalKey(input.temporaryKey)));
  }

  async get(input: Parameters<BlobStore['get']>[0]): Promise<Uint8Array> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    return copyBytes(
      await safeClientCall(() => this.client.getObject(this.physicalKey(input.objectKey))),
    );
  }

  async getRange(input: Parameters<BlobStore['getRange']>[0]): Promise<Uint8Array> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    if (
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      !Number.isSafeInteger(input.length) ||
      input.length < 0
    ) {
      throw blobStoreFailure();
    }
    const key = this.physicalKey(input.objectKey);
    if (input.length === 0) {
      const metadata = await safeClientCall(() => this.client.headObject(key));
      if (metadata === null) throw blobNotFound();
      return new Uint8Array();
    }
    return copyBytes(
      await safeClientCall(() =>
        this.client.getObject(key, { offset: input.offset, length: input.length }),
      ),
    );
  }

  async delete(input: Parameters<BlobStore['delete']>[0]): Promise<void> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    await safeClientCall(() => this.client.deleteObject(this.physicalKey(input.objectKey)));
  }

  async list(input: Parameters<BlobStore['list']>[0]): ReturnType<BlobStore['list']> {
    if (!Number.isInteger(input.limit) || input.limit < 1) throw blobStoreFailure();
    const logicalPrefix =
      input.kind === 'object'
        ? buildObjectPrefix(input.accountId)
        : buildTemporaryPrefix(input.accountId);
    const cursor =
      input.cursor === null ? null : parseCursor(input.cursor, input.accountId, input.kind);
    const page = await safeClientCall(() =>
      this.client.listObjects({
        prefix: this.physicalKey(logicalPrefix),
        continuationToken: cursor?.continuationToken ?? null,
        limit: input.limit,
      }),
    );
    const entries = page.entries.map((entry) => {
      const key = this.logicalKey(entry.key);
      if (input.kind === 'object') {
        requireObjectKeyForAccount(input.accountId, key);
      } else {
        requireTemporaryKeyForAccount(input.accountId, key);
      }
      return {
        key,
        uploadedAt: new Date(entry.uploadedAt),
        sizeBytes: entry.sizeBytes,
      };
    });
    return {
      entries,
      cursor:
        page.continuationToken === null
          ? null
          : encodeCursor({
              version: 1,
              accountId: input.accountId,
              kind: input.kind,
              continuationToken: page.continuationToken,
            }),
    };
  }

  private physicalKey(logicalKey: string): string {
    if (!logicalKey.startsWith('mail/')) throw new MailCoreError('INVALID_BLOB_KEY');
    return `${this.prefix}/${logicalKey.slice('mail/'.length)}`;
  }

  private logicalKey(physicalKey: string): string {
    const prefix = `${this.prefix}/`;
    if (!physicalKey.startsWith(prefix)) throw new MailCoreError('INVALID_BLOB_KEY');
    return `mail/${physicalKey.slice(prefix.length)}`;
  }

  private async deleteCommittedTemporary(physicalKey: string): Promise<void> {
    // A verified permanent object is the commit point. Temporary cleanup may be
    // retried by storage reconciliation and must not turn a successful commit
    // into an ambiguous failure.
    await this.client.deleteObject(physicalKey).catch(() => undefined);
  }
}
