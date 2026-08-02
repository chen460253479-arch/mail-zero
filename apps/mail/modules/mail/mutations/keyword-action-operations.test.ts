import { describe, expect, it } from 'vitest';

import { createKeywordActionOperations } from './keyword-action-operations';

describe('createKeywordActionOperations', () => {
  it('uses the requested state for execute and the opposite state for revert', async () => {
    const calls: Array<{ threadIds: string[]; keyword: string; enabled: boolean }> = [];
    const operations = createKeywordActionOperations({
      accountId: 'account-1',
      threadIds: ['thread-1'],
      keyword: '$important',
      enabled: false,
      updateKeyword: async (threadIds, keyword, enabled) => {
        calls.push({ threadIds, keyword, enabled });
      },
    });

    await operations.execute();
    await operations.revert();

    expect(operations.queueKey).toBe('account-1:$important');
    expect(calls).toEqual([
      { threadIds: ['thread-1'], keyword: '$important', enabled: false },
      { threadIds: ['thread-1'], keyword: '$important', enabled: true },
    ]);
  });
});
