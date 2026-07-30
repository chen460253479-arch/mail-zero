import { describe, expect, it, vi } from 'vitest';

import { digestExternalSecret } from '../../../../../src/modules/external-integration/application/create-access-grant';
import { consumeLaunchCode } from '../../../../../src/modules/external-integration/application/consume-launch-code';

const now = new Date('2026-07-30T10:00:00.000Z');
const launchCode = 'one-time-launch-code';

describe('consumeLaunchCode', () => {
  it('atomically consumes a launch code once and returns only the target user', async () => {
    let consumed = false;
    const consumeGrant = vi.fn(async () => {
      if (consumed) return null;
      consumed = true;
      return { userId: 'managed-user-1' };
    });
    const dependencies = {
      repository: { consumeGrant },
      clock: { now: () => now },
    };

    await expect(consumeLaunchCode({ launchCode }, dependencies)).resolves.toEqual({
      userId: 'managed-user-1',
    });
    expect(consumeGrant).toHaveBeenCalledWith({
      codeDigest: digestExternalSecret(launchCode),
      now,
    });

    await expect(consumeLaunchCode({ launchCode }, dependencies)).rejects.toMatchObject({
      code: 'LAUNCH_CODE_INVALID',
    });
  });

  it('rejects an expired launch code reported by the repository', async () => {
    const dependencies = {
      repository: {
        consumeGrant: vi.fn(async () => null),
      },
      clock: { now: () => now },
    };

    await expect(consumeLaunchCode({ launchCode }, dependencies)).rejects.toMatchObject({
      code: 'LAUNCH_CODE_INVALID',
    });
  });
});
