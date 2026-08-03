import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { refreshMailboxConnectionQueries } from './refresh-mailbox-queries';

describe('mailbox connection query refresh', () => {
  it('invalidates the connection, default connection, and local account caches together', async () => {
    const queryClient = new QueryClient();
    const queryKeys = {
      connectionList: ['connections', 'list'] as const,
      defaultConnection: ['connections', 'default'] as const,
      mailAccountList: ['mail', 'account', 'list'] as const,
    };

    for (const queryKey of Object.values(queryKeys)) {
      queryClient.setQueryData(queryKey, { cached: true });
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }

    await refreshMailboxConnectionQueries(queryClient, queryKeys);

    for (const queryKey of Object.values(queryKeys)) {
      expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
  });

  it('clears the cached default connection before refreshing after a disconnect', async () => {
    const queryClient = new QueryClient();
    const queryKeys = {
      connectionList: ['connections', 'list'] as const,
      defaultConnection: ['connections', 'default'] as const,
      mailAccountList: ['mail', 'account', 'list'] as const,
    };
    queryClient.setQueryData(queryKeys.defaultConnection, {
      id: 'disconnected-connection',
      status: 'connected',
    });

    await refreshMailboxConnectionQueries(queryClient, queryKeys, {
      clearDefaultConnection: true,
    });

    expect(queryClient.getQueryData(queryKeys.defaultConnection)).toBeNull();
  });
});
