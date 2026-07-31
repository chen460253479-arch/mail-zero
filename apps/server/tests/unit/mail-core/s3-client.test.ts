import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';

import {
  AwsS3ObjectClient,
  createS3ClientConfig,
  type S3CommandSender,
} from '../../../src/modules/mail/blob/s3-client';
import { S3ObjectNotFoundError } from '../../../src/modules/mail/blob/s3-blob-store';

class FakeCommandSender implements S3CommandSender {
  readonly commands: object[] = [];
  readonly results: unknown[] = [];
  destroyCalls = 0;

  async send(command: object): Promise<unknown> {
    this.commands.push(command);
    const result = this.results.shift();
    if (result instanceof Error) throw result;
    return result ?? {};
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

const notFound = () =>
  Object.assign(new Error('missing'), {
    name: 'NoSuchKey',
    $metadata: { httpStatusCode: 404 },
  });

describe('AWS S3 object client adapter', () => {
  it('destroys the underlying AWS client connection pool', () => {
    const sender = new FakeCommandSender();
    const client = new AwsS3ObjectClient({ sender, bucket: 'zero-mail' });

    client.close();

    expect(sender.destroyCalls).toBe(1);
  });

  it('builds custom endpoint, path-style, and explicit credential configuration', () => {
    expect(
      createS3ClientConfig({
        region: 'us-east-1',
        endpoint: 'http://minio:9000',
        forcePathStyle: true,
        accessKeyId: 'zero',
        secretAccessKey: 'secret',
      }),
    ).toEqual({
      region: 'us-east-1',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'zero',
        secretAccessKey: 'secret',
      },
    });
    expect(
      createS3ClientConfig({
        region: 'eu-west-1',
        endpoint: null,
        forcePathStyle: false,
        accessKeyId: null,
        secretAccessKey: null,
      }),
    ).toEqual({ region: 'eu-west-1', forcePathStyle: false });
  });

  it('maps bucket and object operations to AWS SDK commands', async () => {
    const sender = new FakeCommandSender();
    sender.results.push({}, {}, {}, {});
    const client = new AwsS3ObjectClient({ sender, bucket: 'zero-mail' });
    const bytes = new TextEncoder().encode('raw mime');
    const sha256 = 'a'.repeat(64);

    await client.headBucket();
    await client.putObject({
      key: 'mail/account/temporary/id',
      bytes,
      contentType: 'message/rfc822',
      sha256,
    });
    await client.copyObject('mail/account/temporary/id', 'mail/account/sha256/aa/target');
    await client.deleteObject('mail/account/temporary/id');

    expect(sender.commands[0]).toBeInstanceOf(HeadBucketCommand);
    expect((sender.commands[0] as HeadBucketCommand).input).toEqual({
      Bucket: 'zero-mail',
    });
    expect(sender.commands[1]).toBeInstanceOf(PutObjectCommand);
    expect((sender.commands[1] as PutObjectCommand).input).toMatchObject({
      Bucket: 'zero-mail',
      Key: 'mail/account/temporary/id',
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: 'message/rfc822',
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
      Metadata: { 'zero-sha256': sha256 },
    });
    expect(sender.commands[2]).toBeInstanceOf(CopyObjectCommand);
    expect((sender.commands[2] as CopyObjectCommand).input).toMatchObject({
      Bucket: 'zero-mail',
      Key: 'mail/account/sha256/aa/target',
      CopySource: 'zero-mail/mail/account/temporary/id',
      MetadataDirective: 'COPY',
      ChecksumAlgorithm: 'SHA256',
    });
    expect(sender.commands[3]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('reads metadata, full objects, exact ranges, and list pages', async () => {
    const sender = new FakeCommandSender();
    sender.results.push(
      {
        ContentLength: 8,
        LastModified: new Date('2026-01-01T00:00:00.000Z'),
        Metadata: { 'zero-sha256': 'b'.repeat(64) },
      },
      {
        Body: {
          transformToByteArray: async () => Uint8Array.from([1, 2, 3, 4]),
        },
      },
      {
        Body: {
          transformToByteArray: async () => Uint8Array.from([2, 3]),
        },
      },
      {
        Contents: [
          {
            Key: 'mail/account/sha256/bb/object',
            LastModified: new Date('2026-01-02T00:00:00.000Z'),
            Size: 8,
          },
        ],
        NextContinuationToken: 'next-page',
      },
    );
    const client = new AwsS3ObjectClient({ sender, bucket: 'zero-mail' });

    await expect(client.headObject('mail/account/sha256/bb/object')).resolves.toEqual({
      sha256: 'b'.repeat(64),
      sizeBytes: 8n,
      uploadedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await expect(client.getObject('mail/account/sha256/bb/object')).resolves.toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
    await expect(
      client.getObject('mail/account/sha256/bb/object', { offset: 1, length: 2 }),
    ).resolves.toEqual(Uint8Array.from([2, 3]));
    await expect(
      client.listObjects({
        prefix: 'mail/account/sha256/',
        continuationToken: 'current-page',
        limit: 25,
      }),
    ).resolves.toEqual({
      entries: [
        {
          key: 'mail/account/sha256/bb/object',
          uploadedAt: new Date('2026-01-02T00:00:00.000Z'),
          sizeBytes: 8n,
        },
      ],
      continuationToken: 'next-page',
    });

    expect(sender.commands[0]).toBeInstanceOf(HeadObjectCommand);
    expect(sender.commands[1]).toBeInstanceOf(GetObjectCommand);
    expect((sender.commands[2] as GetObjectCommand).input.Range).toBe('bytes=1-2');
    expect(sender.commands[3]).toBeInstanceOf(ListObjectsV2Command);
    expect((sender.commands[3] as ListObjectsV2Command).input).toMatchObject({
      Bucket: 'zero-mail',
      Prefix: 'mail/account/sha256/',
      ContinuationToken: 'current-page',
      MaxKeys: 25,
    });
  });

  it('normalizes missing objects while preserving other storage failures', async () => {
    const sender = new FakeCommandSender();
    sender.results.push(notFound(), notFound(), new Error('network unavailable'));
    const client = new AwsS3ObjectClient({ sender, bucket: 'zero-mail' });

    await expect(client.headObject('missing')).resolves.toBeNull();
    await expect(client.getObject('missing')).rejects.toBeInstanceOf(S3ObjectNotFoundError);
    await expect(client.deleteObject('mail/account/object')).rejects.toThrow(
      'network unavailable',
    );
  });

  it('rejects malformed SDK responses instead of returning partial metadata', async () => {
    const sender = new FakeCommandSender();
    sender.results.push(
      { ContentLength: 1, Metadata: { 'zero-sha256': 'a'.repeat(64) } },
      { Body: undefined },
      { Contents: [{ Key: 'mail/account/object', Size: 1 }] },
    );
    const client = new AwsS3ObjectClient({ sender, bucket: 'zero-mail' });

    await expect(client.headObject('mail/account/object')).rejects.toThrow(
      'Invalid S3 HeadObject response',
    );
    await expect(client.getObject('mail/account/object')).rejects.toThrow(
      'Invalid S3 GetObject response',
    );
    await expect(
      client.listObjects({ prefix: 'mail/account/', continuationToken: null, limit: 1 }),
    ).rejects.toThrow('Invalid S3 ListObjects response');
  });
});
