import { describe, expect, it } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import type { MailAccountId } from '../../src';

describe('memory blob store', () => {
  it('keeps stored content isolated from caller byte mutations', async () => {
    const deps = createMemoryMailCoreDependencies();
    const input = new Uint8Array([1, 2, 3]);
    const pending = await deps.blobStore.putTemporary({
      accountId: 'account-1' as MailAccountId,
      bytes: input,
      contentType: 'application/octet-stream',
    });
    input[0] = 9;

    await deps.blobStore.commitTemporary({
      temporaryKey: pending.temporaryKey,
      objectKey: 'objects/blob-1',
    });
    const firstRead = await deps.blobStore.get('objects/blob-1');
    expect(firstRead).toEqual(new Uint8Array([1, 2, 3]));
    firstRead[1] = 8;

    await expect(deps.blobStore.get('objects/blob-1')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('returns a Web Crypto SHA-256 digest and byte size', async () => {
    const deps = createMemoryMailCoreDependencies();

    await expect(
      deps.blobStore.putTemporary({
        accountId: 'account-1' as MailAccountId,
        bytes: new TextEncoder().encode('abc'),
        contentType: 'text/plain',
      }),
    ).resolves.toMatchObject({
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      size: 3n,
    });
  });
});
