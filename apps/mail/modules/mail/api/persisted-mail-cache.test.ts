import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { revalidatePersistedMailCache } from './persisted-mail-cache';

const threadPageKey = [
  ['mail', 'view', 'threadPage'],
  { input: { accountId: 'account-1', mailboxId: 'inbox' }, type: 'infinite' },
];
const threadDetailKey = [
  ['mail', 'view', 'threadDetail'],
  { input: { accountId: 'account-1', threadId: 'thread-1' }, type: 'query' },
];
const mailboxKey = [
  ['mail', 'mailbox', 'get'],
  { input: { accountId: 'account-1' }, type: 'query' },
];
const unrelatedKey = [['integrations', 'gmail', 'status'], { type: 'query' }];

describe('revalidatePersistedMailCache', () => {
  it('invalidates restored thread pages, thread details, and mailbox statistics', async () => {
    const queryClient = new QueryClient();
    for (const key of [threadPageKey, threadDetailKey, mailboxKey, unrelatedKey]) {
      queryClient.setQueryData(key, { restored: true });
    }

    await revalidatePersistedMailCache(queryClient);

    expect(queryClient.getQueryState(threadPageKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(threadDetailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(mailboxKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });
});
