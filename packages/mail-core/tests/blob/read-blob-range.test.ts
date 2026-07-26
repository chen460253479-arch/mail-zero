import { describe, expect, it, vi } from 'vitest';

import { createMemoryMailCoreDependencies } from '../../src/testing/fakes';
import { createMailAccount, createMailCore } from '../../src';

describe('readBlobRange', () => {
  it('uses bounded storage reads for blobs larger than the requested preview', async () => {
    const dependencies = createMemoryMailCoreDependencies();
    const account = await createMailAccount(dependencies, {
      userId: 'range-user',
      connectionId: 'range-connection',
      timezone: 'UTC',
      storageQuotaBytes: null,
    });
    const core = createMailCore(dependencies);
    const uploaded = await core.uploadBlob({
      accountId: account.id,
      contentType: 'text/plain',
      bytes: new TextEncoder().encode('0123456789'),
    });
    const get = vi.spyOn(dependencies.blobStore, 'get');
    const getRange = vi
      .spyOn(dependencies.blobStore, 'getRange')
      .mockResolvedValue(new TextEncoder().encode('0123'));

    await expect(
      core.readBlobRange({
        accountId: account.id,
        blobId: uploaded.blob.id,
        maxBytes: 4,
      }),
    ).resolves.toEqual({
      bytes: new TextEncoder().encode('0123'),
      isTruncated: true,
    });
    expect(getRange).toHaveBeenCalledWith({
      accountId: account.id,
      objectKey: uploaded.blob.objectKey,
      offset: 0,
      length: 4,
    });
    expect(get).not.toHaveBeenCalled();
  });
});
