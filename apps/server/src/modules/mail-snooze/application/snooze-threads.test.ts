import { describe, expect, it, vi } from 'vitest';

import { snoozeThreads } from './snooze-threads';

describe('snoozeThreads', () => {
  it('delegates the command to the atomic PostgreSQL boundary', async () => {
    const result = { scheduled: ['thread-1'], failed: {} };
    const snooze = vi.fn(async () => result);
    const input = {
      accountId: 'account-1',
      threadIds: ['thread-1'],
      wakeAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    await expect(snoozeThreads(input, { commands: { snooze } as never })).resolves.toEqual(result);
    expect(snooze).toHaveBeenCalledWith(input);
  });
});
