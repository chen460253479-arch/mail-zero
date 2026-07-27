import { describe, expect, it, vi } from 'vitest';

import { drainChanges } from './changes-reconciler';

describe('changes reconciler', () => {
  it('drains every page and advances to the final state', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        oldState: 's1',
        newState: 's2',
        hasMoreChanges: true,
        created: ['thread-1'],
        updated: [],
        destroyed: [],
      })
      .mockResolvedValueOnce({
        oldState: 's2',
        newState: 's3',
        hasMoreChanges: false,
        created: [],
        updated: ['thread-2'],
        destroyed: ['thread-3'],
      });

    await expect(drainChanges('s1', fetchPage)).resolves.toEqual({
      newState: 's3',
      created: ['thread-1'],
      updated: ['thread-2'],
      destroyed: ['thread-3'],
    });
    expect(fetchPage).toHaveBeenNthCalledWith(1, 's1');
    expect(fetchPage).toHaveBeenNthCalledWith(2, 's2');
  });

  it('stops an invalid server loop', async () => {
    const fetchPage = vi.fn(async (state: string) => ({
      oldState: state,
      newState: state,
      hasMoreChanges: true,
      created: [],
      updated: [],
      destroyed: [],
    }));

    await expect(drainChanges('s1', fetchPage)).rejects.toThrow('MAIL_CHANGES_DID_NOT_ADVANCE');
  });
});
