import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { MailAccountProvider } from '../providers/mail-account-provider';
import { useThread, useThreads } from '../../../hooks/use-threads';

const queryState = vi.hoisted(() => ({
  requests: [] as unknown[],
}));

vi.mock('@/providers/query-provider', async () => {
  const { skipToken } = await import('@tanstack/react-query');

  const buildQueryOptions = (input: unknown, options: Record<string, unknown>) => {
    const queryFn: typeof skipToken | (() => Promise<{ emails: never[] }>) =
      input === skipToken
        ? skipToken
        : async () => {
            queryState.requests.push(input);
            return { emails: [] };
          };

    return {
      ...options,
      queryKey: ['mail', 'view', 'threadDetail', input],
      queryFn,
    };
  };

  return {
    useTRPC: () => ({
      mail: {
        view: {
          threadPage: {
            infiniteQueryOptions: (input: unknown, options: Record<string, unknown>) => {
              const queryFn:
                | typeof skipToken
                | (() => Promise<{ cursor: null; items: never[]; queryState: string }>) =
                input === skipToken
                  ? skipToken
                  : async () => {
                      queryState.requests.push(input);
                      return {
                        cursor: null,
                        items: [],
                        queryState: 'state-1',
                      };
                    };

              return {
                ...options,
                queryKey: ['mail', 'view', 'threadPage', input],
                queryFn,
                initialPageParam: null,
              };
            },
          },
          threadDetail: {
            queryOptions: buildQueryOptions,
          },
        },
      },
    }),
  };
});

vi.mock('@/modules/mail/queries/use-mailboxes', () => ({
  useMailboxes: () => ({
    isLoading: false,
    mailboxes: [],
  }),
}));

vi.mock('@/modules/mail/providers/mail-account-provider', async () => {
  return import('../providers/mail-account-provider');
});

vi.mock('@/modules/mail/adapters', () => ({
  adaptEmail: (value: unknown) => value,
  adaptThreadSummary: (value: unknown) => value,
  adaptThreadSummaryForList: (value: unknown) => value,
  buildThreadDisplay: () => ({ messages: [] }),
}));

vi.mock('@/modules/mail/queries/thread-query-input', () => ({
  buildThreadDetailInput: () => ({}),
  buildThreadPageInput: () => ({}),
}));

vi.mock('@/modules/mail/routing/mailbox-route', () => ({
  resolveMailboxRoute: () => ({ kind: 'not-found' }),
}));

vi.mock('@/hooks/use-search-value', () => ({
  useSearchValue: () => [{ value: '' }],
}));

vi.mock('@/hooks/use-categories', () => ({
  useCategorySettings: () => [
    {
      id: 'All Mail',
      name: 'All Mail',
      searchValue: '',
      order: 0,
      isDefault: true,
    },
  ],
}));

vi.mock('nuqs', () => ({
  useQueryState: () => [null],
}));

vi.mock('react-router', () => ({
  useParams: () => ({ folder: 'inbox' }),
}));

describe('useThreads account guard', () => {
  beforeEach(() => {
    queryState.requests = [];
  });

  it('cannot issue a thread page request before a local mail account is available', async () => {
    const queryClient = new QueryClient();
    let refetch: (() => Promise<{ error: unknown }>) | undefined;

    function Probe() {
      const [query] = useThreads();
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

  it('cannot issue a thread detail request before an account and thread are available', async () => {
    const queryClient = new QueryClient();
    let refetch: (() => Promise<{ error: unknown }>) | undefined;

    function Probe() {
      const query = useThread(null);
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
