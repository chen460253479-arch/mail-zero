import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailAccountId } from '../../src';

describe('memory blob store', () => {
  const accountId = 'account-1' as MailAccountId;

  it('keeps stored content isolated from caller byte mutations', async () => {
    const deps = createMemoryMailCoreDependencies();
    const input = new Uint8Array([1, 2, 3]);
    const pending = await deps.blobStore.putTemporary({
      accountId,
      bytes: input,
      contentType: 'application/octet-stream',
    });
    input[0] = 9;

    await deps.blobStore.commitTemporary({
      accountId,
      temporaryKey: pending.temporaryKey,
      objectKey: 'objects/blob-1',
    });
    const firstRead = await deps.blobStore.get({ accountId, objectKey: 'objects/blob-1' });
    expect(firstRead).toEqual(new Uint8Array([1, 2, 3]));
    firstRead[1] = 8;

    await expect(deps.blobStore.get({ accountId, objectKey: 'objects/blob-1' })).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('returns a Web Crypto SHA-256 digest and byte size', async () => {
    const deps = createMemoryMailCoreDependencies();

    await expect(
      deps.blobStore.putTemporary({
        accountId,
        bytes: new TextEncoder().encode('abc'),
        contentType: 'text/plain',
      }),
    ).resolves.toMatchObject({
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      size: 3n,
    });
  });

  it('rejects a different blob for an occupied object key', async () => {
    const deps = createMemoryMailCoreDependencies();
    const first = await deps.blobStore.putTemporary({
      accountId,
      bytes: new Uint8Array([1]),
      contentType: 'application/octet-stream',
    });
    await deps.blobStore.commitTemporary({
      accountId,
      temporaryKey: first.temporaryKey,
      objectKey: 'objects/blob-1',
    });
    const second = await deps.blobStore.putTemporary({
      accountId,
      bytes: new Uint8Array([2]),
      contentType: 'application/octet-stream',
    });

    await expect(
      deps.blobStore.commitTemporary({
        accountId,
        temporaryKey: second.temporaryKey,
        objectKey: 'objects/blob-1',
      }),
    ).rejects.toThrow('blob object already exists');
    await expect(deps.blobStore.get({ accountId, objectKey: 'objects/blob-1' })).resolves.toEqual(
      new Uint8Array([1]),
    );
  });

  it('treats repeated deletion and deletion of a missing object as success', async () => {
    const deps = createMemoryMailCoreDependencies();
    const pending = await deps.blobStore.putTemporary({
      accountId,
      bytes: new Uint8Array([1]),
      contentType: 'application/octet-stream',
    });
    await deps.blobStore.commitTemporary({
      accountId,
      temporaryKey: pending.temporaryKey,
      objectKey: 'objects/blob-1',
    });

    await expect(
      deps.blobStore.delete({ accountId, objectKey: 'objects/blob-1' }),
    ).resolves.toBeUndefined();
    await expect(
      deps.blobStore.delete({ accountId, objectKey: 'objects/blob-1' }),
    ).resolves.toBeUndefined();
    await expect(
      deps.blobStore.delete({ accountId, objectKey: 'objects/missing' }),
    ).resolves.toBeUndefined();
  });

  it('enumerates account-scoped committed and temporary uploads with stable pagination', async () => {
    const deps = createMemoryMailCoreDependencies();
    const otherAccountId = 'account-2' as MailAccountId;
    const first = await deps.blobStore.putTemporary({
      accountId,
      bytes: new Uint8Array([1]),
      contentType: 'application/octet-stream',
    });
    const second = await deps.blobStore.putTemporary({
      accountId,
      bytes: new Uint8Array([2]),
      contentType: 'application/octet-stream',
    });
    await deps.blobStore.putTemporary({
      accountId: otherAccountId,
      bytes: new Uint8Array([3]),
      contentType: 'application/octet-stream',
    });
    await deps.blobStore.commitTemporary({
      accountId,
      temporaryKey: first.temporaryKey,
      objectKey: `mail/${accountId}/sha256/${first.sha256.slice(0, 2)}/${first.sha256}`,
    });

    const temporaryPage = await deps.blobStore.list({
      accountId,
      kind: 'temporary',
      cursor: null,
      limit: 1,
    });
    expect(temporaryPage.entries).toEqual([
      expect.objectContaining({
        key: second.temporaryKey,
        uploadedAt: deps.clock.now(),
      }),
    ]);
    expect(temporaryPage.cursor).toBeNull();
    await expect(
      deps.blobStore.list({
        accountId,
        kind: 'object',
        cursor: null,
        limit: 1,
      }),
    ).resolves.toEqual({
      entries: [
        expect.objectContaining({
          key: `mail/${accountId}/sha256/${first.sha256.slice(0, 2)}/${first.sha256}`,
          uploadedAt: deps.clock.now(),
        }),
      ],
      cursor: null,
    });
  });
});
