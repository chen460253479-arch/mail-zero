import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { MailAccountProvider } from '../providers/mail-account-provider';
import { useMailIdentities } from './use-mail-identities';
import { useMailboxes } from './use-mailboxes';

const queryState = vi.hoisted(() => ({
  requests: [] as Array<{ input: unknown; resource: string }>,
}));

vi.mock('@/providers/query-provider', async () => {
  const { skipToken } = await import('@tanstack/react-query');

  const buildQueryOptions = (
    resource: string,
    input: unknown,
    options: Record<string, unknown>,
  ) => {
    const queryFn: typeof skipToken | (() => Promise<{ list: never[]; state: string }>) =
      input === skipToken
        ? skipToken
        : async () => {
            queryState.requests.push({ input, resource });
            return { list: [], state: 'state-1' };
          };

    return {
      ...options,
      queryKey: ['mail', resource, input],
      queryFn,
    };
  };

  return {
    useTRPC: () => ({
      mail: {
        identity: {
          get: {
            queryOptions: (input: unknown, options: Record<string, unknown>) =>
              buildQueryOptions('identity', input, options),
          },
        },
        mailbox: {
          get: {
            queryOptions: (input: unknown, options: Record<string, unknown>) =>
              buildQueryOptions('mailbox', input, options),
          },
        },
      },
    }),
  };
});

describe('account-scoped mail query guards', () => {
  beforeEach(() => {
    queryState.requests = [];
  });

  it('cannot request mailboxes before a local mail account is available', async () => {
    const queryClient = new QueryClient();
    let refetch: (() => Promise<{ error: unknown }>) | undefined;

    function Probe() {
      const query = useMailboxes();
      refetch = query.refetch;
      return null;
    }

    renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MailAccountProvider accounts={[]} activeConnectionId={null} isLoading={false}>
          <Probe />
        </MailAccountProvider>
      </QueryClientProvider>,
    );

    expect(refetch).toBeDefined();
    const result = await refetch?.();
    expect(queryState.requests).toEqual([]);
    expect(result?.error).toBeNull();

    queryClient.clear();
  });

  it('cannot request identities before a local mail account is available', async () => {
    const queryClient = new QueryClient();
    let refetch: (() => Promise<{ error: unknown }>) | undefined;

    function Probe() {
      const query = useMailIdentities();
      refetch = query.refetch;
      return null;
    }

    renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MailAccountProvider accounts={[]} activeConnectionId={null} isLoading={false}>
          <Probe />
        </MailAccountProvider>
      </QueryClientProvider>,
    );

    expect(refetch).toBeDefined();
    const result = await refetch?.();
    expect(queryState.requests).toEqual([]);
    expect(result?.error).toBeNull();

    queryClient.clear();
  });
});
