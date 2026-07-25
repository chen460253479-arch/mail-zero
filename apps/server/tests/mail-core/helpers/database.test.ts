import { describe, expect, it, vi } from 'vitest';

import { runFailureIndependentCleanup } from './database';

describe('mail-core database cleanup', () => {
  it('attempts every cleanup action and preserves the first cleanup failure', async () => {
    const first = vi.fn().mockRejectedValue(new Error('isolated close failed'));
    const second = vi.fn().mockRejectedValue(new Error('drop failed'));
    const third = vi.fn().mockResolvedValue(undefined);

    await expect(runFailureIndependentCleanup([first, second, third], false)).rejects.toThrow(
      'isolated close failed',
    );
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
  });

  it('does not replace a primary test failure with cleanup failures', async () => {
    const actions = [
      vi.fn().mockRejectedValue(new Error('isolated close failed')),
      vi.fn().mockRejectedValue(new Error('drop failed')),
      vi.fn().mockRejectedValue(new Error('admin close failed')),
    ];

    await expect(runFailureIndependentCleanup(actions, true)).resolves.toBeUndefined();
    expect(actions.every((action) => action.mock.calls.length === 1)).toBe(true);
  });
});
