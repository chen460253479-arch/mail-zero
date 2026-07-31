import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

import {
  S3ObjectNotFoundError,
  type S3ObjectClient,
  type S3ObjectMetadata,
} from './s3-blob-store';

export interface S3CommandSender {
  send(command: object): Promise<unknown>;
  destroy(): void;
}

export type S3ConnectionConfig = {
  region: string;
  endpoint: string | null;
  forcePathStyle: boolean;
  accessKeyId: string | null;
  secretAccessKey: string | null;
};

export type CreateAwsS3ObjectClientInput = S3ConnectionConfig & {
  bucket: string;
};

const isNotFound = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const metadata =
    '$metadata' in error && typeof error.$metadata === 'object' && error.$metadata !== null
      ? (error.$metadata as { httpStatusCode?: unknown })
      : null;
  return (
    error.name === 'NoSuchKey' ||
    error.name === 'NotFound' ||
    metadata?.httpStatusCode === 404
  );
};

const requireNonnegativeInteger = (value: unknown, message: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(message);
  return value as number;
};

const requireDate = (value: unknown, message: string): Date => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error(message);
  return new Date(value);
};

const readBody = async (body: unknown): Promise<Uint8Array> => {
  if (
    body !== null &&
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    return Uint8Array.from(await body.transformToByteArray());
  }
  throw new Error('Invalid S3 GetObject response');
};

const copySource = (bucket: string, key: string): string =>
  `${encodeURIComponent(bucket)}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;

export const createS3ClientConfig = (input: S3ConnectionConfig): S3ClientConfig => {
  if (
    input.region.trim() === '' ||
    (input.accessKeyId === null) !== (input.secretAccessKey === null)
  ) {
    throw new Error('Invalid S3 client configuration');
  }
  return {
    region: input.region,
    ...(input.endpoint === null ? {} : { endpoint: input.endpoint }),
    forcePathStyle: input.forcePathStyle,
    ...(input.accessKeyId === null
      ? {}
      : {
          credentials: {
            accessKeyId: input.accessKeyId,
            secretAccessKey: input.secretAccessKey!,
          },
        }),
  };
};

export class AwsS3ObjectClient implements S3ObjectClient {
  private readonly sender: S3CommandSender;
  private readonly bucket: string;

  constructor(input: { sender: S3CommandSender; bucket: string }) {
    if (input.bucket.trim() === '') throw new Error('Invalid S3 bucket');
    this.sender = input.sender;
    this.bucket = input.bucket;
  }

  close(): void {
    this.sender.destroy();
  }

  async headBucket(): Promise<void> {
    await this.sender.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async putObject(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<void> {
    const bytes = Uint8Array.from(input.bytes);
    await this.sender.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: input.contentType,
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: Buffer.from(input.sha256, 'hex').toString('base64'),
        Metadata: { 'zero-sha256': input.sha256 },
      }),
    );
  }

  async headObject(key: string): Promise<S3ObjectMetadata | null> {
    let result: unknown;
    try {
      result = await this.sender.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ChecksumMode: 'ENABLED',
        }),
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (result === null || typeof result !== 'object') {
      throw new Error('Invalid S3 HeadObject response');
    }
    const response = result as {
      ContentLength?: unknown;
      LastModified?: unknown;
      Metadata?: Record<string, string>;
    };
    return {
      sha256: response.Metadata?.['zero-sha256'] ?? null,
      sizeBytes: BigInt(
        requireNonnegativeInteger(response.ContentLength, 'Invalid S3 HeadObject response'),
      ),
      uploadedAt: requireDate(response.LastModified, 'Invalid S3 HeadObject response'),
    };
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<void> {
    try {
      await this.sender.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: targetKey,
          CopySource: copySource(this.bucket, sourceKey),
          MetadataDirective: 'COPY',
          ChecksumAlgorithm: 'SHA256',
        }),
      );
    } catch (error) {
      if (isNotFound(error)) throw new S3ObjectNotFoundError();
      throw error;
    }
  }

  async getObject(
    key: string,
    range?: { offset: number; length: number },
  ): Promise<Uint8Array> {
    let result: unknown;
    try {
      result = await this.sender.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(range === undefined
            ? {}
            : { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` }),
        }),
      );
    } catch (error) {
      if (isNotFound(error)) throw new S3ObjectNotFoundError();
      throw error;
    }
    if (result === null || typeof result !== 'object' || !('Body' in result)) {
      throw new Error('Invalid S3 GetObject response');
    }
    return readBody((result as { Body?: unknown }).Body);
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.sender.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  async listObjects(input: {
    prefix: string;
    continuationToken: string | null;
    limit: number;
  }): Promise<{
    entries: Array<{ key: string; uploadedAt: Date; sizeBytes: bigint }>;
    continuationToken: string | null;
  }> {
    const result = await this.sender.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: input.prefix,
        ...(input.continuationToken === null
          ? {}
          : { ContinuationToken: input.continuationToken }),
        MaxKeys: input.limit,
      }),
    );
    if (result === null || typeof result !== 'object') {
      throw new Error('Invalid S3 ListObjects response');
    }
    const response = result as {
      Contents?: Array<{ Key?: unknown; LastModified?: unknown; Size?: unknown }>;
      NextContinuationToken?: unknown;
    };
    const entries = (response.Contents ?? []).map((entry) => {
      if (typeof entry.Key !== 'string' || entry.Key === '') {
        throw new Error('Invalid S3 ListObjects response');
      }
      return {
        key: entry.Key,
        uploadedAt: requireDate(entry.LastModified, 'Invalid S3 ListObjects response'),
        sizeBytes: BigInt(
          requireNonnegativeInteger(entry.Size, 'Invalid S3 ListObjects response'),
        ),
      };
    });
    if (
      response.NextContinuationToken !== undefined &&
      typeof response.NextContinuationToken !== 'string'
    ) {
      throw new Error('Invalid S3 ListObjects response');
    }
    return {
      entries,
      continuationToken: response.NextContinuationToken ?? null,
    };
  }
}

export const createAwsS3ObjectClient = (
  input: CreateAwsS3ObjectClientInput,
): AwsS3ObjectClient => {
  const client = new S3Client(createS3ClientConfig(input));
  return new AwsS3ObjectClient({
    sender: client as unknown as S3CommandSender,
    bucket: input.bucket,
  });
};
