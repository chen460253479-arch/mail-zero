import {
  access,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { constants } from 'node:fs';

import {
  MailCoreError,
  type BlobCommitReceipt,
  type BlobStore,
  type BlobStoreListKind,
} from '@zero/mail-core';

import {
  buildObjectKey,
  buildObjectPrefix,
  buildTemporaryKey,
  buildTemporaryPrefix,
  bytesEqual,
  calculateSha256,
  copyBytes,
  requireObjectKeyForAccount,
  parseTemporaryKey,
  requireTemporaryKeyForAccount,
} from './blob-key';

type BlobListCursor = {
  version: 1;
  userId: string;
  accountId: string;
  kind: BlobStoreListKind;
  after: string;
};

const nodeErrorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const blobStoreFailure = (): MailCoreError => new MailCoreError('BLOB_STORE_FAILURE');
const blobNotFound = (): MailCoreError => new MailCoreError('BLOB_NOT_FOUND');

const parseCursor = (
  cursor: string,
  userId: string,
  accountId: string,
  kind: BlobStoreListKind,
): BlobListCursor => {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      (value as Record<string, unknown>).version !== 1 ||
      (value as Record<string, unknown>).userId !== userId ||
      (value as Record<string, unknown>).accountId !== accountId ||
      (value as Record<string, unknown>).kind !== kind ||
      typeof (value as Record<string, unknown>).after !== 'string'
    ) {
      throw new Error('invalid cursor');
    }
    return value as BlobListCursor;
  } catch {
    throw new MailCoreError('INVALID_BLOB_KEY');
  }
};

const encodeCursor = (cursor: BlobListCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

const listFiles = async (directory: string): Promise<string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return listFiles(path);
        return entry.isFile() ? [path] : [];
      }),
    );
    return nested.flat();
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return [];
    throw blobStoreFailure();
  }
};

export class LocalBlobStore implements BlobStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    if (!isAbsolute(rootDirectory)) {
      throw blobStoreFailure();
    }
    this.rootDirectory = resolve(rootDirectory);
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(this.rootDirectory, { recursive: true });
      await access(this.rootDirectory, constants.R_OK | constants.W_OK);
    } catch {
      throw blobStoreFailure();
    }
  }

  async putTemporary(
    input: Parameters<BlobStore['putTemporary']>[0],
  ): ReturnType<BlobStore['putTemporary']> {
    const temporaryKey = buildTemporaryKey(input.userId, input.accountId, input.kind);
    const path = this.pathForKey(temporaryKey);
    const bytes = copyBytes(input.bytes);
    const sha256 = await calculateSha256(bytes);
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    } catch {
      throw blobStoreFailure();
    }
    return { temporaryKey, sha256, size: BigInt(bytes.byteLength) };
  }

  async commitTemporary(
    input: Parameters<BlobStore['commitTemporary']>[0],
  ): Promise<BlobCommitReceipt> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    const target = requireObjectKeyForAccount(input.accountId, input.objectKey);
    const temporary = parseTemporaryKey(input.temporaryKey);
    if (temporary.userId !== target.userId || temporary.kind !== target.kind) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }
    const temporaryPath = this.pathForKey(input.temporaryKey);
    const objectPath = this.pathForKey(input.objectKey);
    let bytes: Uint8Array;
    try {
      bytes = await this.readPath(temporaryPath);
    } catch (error) {
      if (!(error instanceof MailCoreError) || error.code !== 'BLOB_NOT_FOUND') throw error;
      const committed = await this.readPath(objectPath);
      if ((await calculateSha256(committed)) !== target.sha256) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
      return { objectKey: input.objectKey, created: true };
    }

    const sha256 = await calculateSha256(bytes);
    if (
      sha256 !== target.sha256 ||
      input.objectKey !== buildObjectKey(target.userId, target.accountId, target.kind, sha256)
    ) {
      throw new MailCoreError('BLOB_INTEGRITY');
    }

    try {
      await mkdir(dirname(objectPath), { recursive: true });
      await link(temporaryPath, objectPath);
    } catch (error) {
      if (nodeErrorCode(error) !== 'EEXIST') {
        throw blobStoreFailure();
      }
      const existing = await this.readPath(objectPath);
      if (!bytesEqual(existing, bytes)) {
        throw new MailCoreError('BLOB_INTEGRITY');
      }
    }

    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw blobStoreFailure();
    }
    return { objectKey: input.objectKey, created: true };
  }

  async deleteTemporary(input: Parameters<BlobStore['deleteTemporary']>[0]): Promise<void> {
    requireTemporaryKeyForAccount(input.accountId, input.temporaryKey);
    await this.deletePath(this.pathForKey(input.temporaryKey));
  }

  async get(input: Parameters<BlobStore['get']>[0]): Promise<Uint8Array> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    return this.readPath(this.pathForKey(input.objectKey));
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
    const path = this.pathForKey(input.objectKey);
    let file: Awaited<ReturnType<typeof open>>;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') throw blobNotFound();
      throw blobStoreFailure();
    }
    try {
      const buffer = Buffer.alloc(input.length);
      const { bytesRead } = await file.read(buffer, 0, input.length, input.offset);
      return copyBytes(buffer.subarray(0, bytesRead));
    } catch {
      throw blobStoreFailure();
    } finally {
      await file.close().catch(() => undefined);
    }
  }

  async delete(input: Parameters<BlobStore['delete']>[0]): Promise<void> {
    requireObjectKeyForAccount(input.accountId, input.objectKey);
    await this.deletePath(this.pathForKey(input.objectKey));
  }

  async list(input: Parameters<BlobStore['list']>[0]): ReturnType<BlobStore['list']> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw blobStoreFailure();
    }
    const prefix =
      input.kind === 'temporary'
        ? buildTemporaryPrefix(input.userId, input.accountId)
        : buildObjectPrefix(input.userId, input.accountId, input.kind);
    const cursor =
      input.cursor === null
        ? null
        : parseCursor(input.cursor, input.userId, input.accountId, input.kind);
    const files = await listFiles(this.pathForPrefix(prefix));
    const keys = files
      .map((path) => relative(this.rootDirectory, path).split(sep).join('/'))
      .filter((key) => cursor === null || key > cursor.after)
      .sort((left, right) => left.localeCompare(right));
    const pageKeys = keys.slice(0, input.limit);
    const entries = await Promise.all(
      pageKeys.map(async (key) => {
        if (input.kind !== 'temporary') {
          requireObjectKeyForAccount(input.accountId, key);
        } else {
          requireTemporaryKeyForAccount(input.accountId, key);
        }
        try {
          const details = await stat(this.pathForKey(key));
          return {
            key,
            uploadedAt: details.mtime,
            sizeBytes: BigInt(details.size),
          };
        } catch {
          throw blobStoreFailure();
        }
      }),
    );
    const nextCursor =
      keys.length > pageKeys.length && pageKeys.length > 0
        ? encodeCursor({
            version: 1,
            userId: input.userId,
            accountId: input.accountId,
            kind: input.kind,
            after: pageKeys.at(-1)!,
          })
        : null;
    return { entries, cursor: nextCursor };
  }

  private pathForKey(key: string): string {
    const path = resolve(this.rootDirectory, ...key.split('/'));
    const child = relative(this.rootDirectory, path);
    if (child.length === 0 || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new MailCoreError('INVALID_BLOB_KEY');
    }
    return path;
  }

  private pathForPrefix(prefix: string): string {
    return this.pathForKey(prefix.slice(0, -1));
  }

  private async readPath(path: string): Promise<Uint8Array> {
    try {
      return copyBytes(await readFile(path));
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') throw blobNotFound();
      throw blobStoreFailure();
    }
  }

  private async deletePath(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw blobStoreFailure();
    }
  }
}
