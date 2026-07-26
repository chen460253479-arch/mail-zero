import { describe, expect, it } from 'vitest';

import { createThreadReferenceKeys, hashThreadKey } from '../../src';

describe('Thread reference keys', () => {
  it('hashes normalized UTF-8 values as lowercase SHA-256', async () => {
    await expect(hashThreadKey('status')).resolves.toBe(
      '073c1634c496cdb649d1afe0a312bbb4b7e1741b271542e4a436c3b8824b1761',
    );
  });

  it('normalizes subjects and Message-IDs before hashing and removes duplicates', async () => {
    const keys = await createThreadReferenceKeys({
      subject: ' Re:  Status ',
      messageIds: [' <Case@EXAMPLE.TEST> ', 'Case@example.test', '   '],
    });

    expect(keys).toEqual([
      {
        normalizedSubjectHash:
          '073c1634c496cdb649d1afe0a312bbb4b7e1741b271542e4a436c3b8824b1761',
        messageIdHash: '00480d6521bbfb6ac7fed22abccae9094ec97f01c87c56489440557c40e239b2',
      },
    ]);
  });

  it('returns no keys when no usable Message-ID remains', async () => {
    await expect(
      createThreadReferenceKeys({
        subject: '[List] Fwd: Status',
        messageIds: ['', '  ', '< >'],
      }),
    ).resolves.toEqual([]);
  });
});
