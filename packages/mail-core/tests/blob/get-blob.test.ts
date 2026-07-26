import { describe, expect, it } from 'vitest';
import { createMailCore } from '../../src';

import { createSeededEmailHarness } from '../helpers/email-harness';

describe('getBlob', () => {
  it('returns only a retained ready Blob from the requested account', async () => {
    const h = await createSeededEmailHarness();
    const core = createMailCore(h.deps);
    const email = await core.getEmail({
      accountId: h.accountId,
      emailId: h.emailId,
    });

    await expect(
      core.getBlob({
        accountId: h.accountId,
        blobId: email.blobId!,
      }),
    ).resolves.toMatchObject({
      id: email.blobId,
      accountId: h.accountId,
      status: 'ready',
      contentType: 'message/rfc822',
    });
  });
});
