import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useQueryState } from 'nuqs';
import { useMemo } from 'react';

import {
  adaptEmail,
  adaptThreadSummary,
  adaptThreadSummaryForList,
  buildThreadDisplay,
} from '@/modules/mail/adapters';
import {
  buildThreadDetailInput,
  buildThreadPageInput,
} from '@/modules/mail/queries/thread-query-input';
import { useMailAccountContext } from '@/modules/mail/providers/mail-account-provider';
import { resolveMailboxRoute } from '@/modules/mail/routing/mailbox-route';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import { useSearchValue } from '@/hooks/use-search-value';
import { useTRPC } from '@/providers/query-provider';

export const useThreads = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const { folder = 'inbox' } = useParams<{ folder: string }>();
  const [searchValue] = useSearchValue();
  const trpc = useTRPC();
  const { account, status } = useMailAccountContext();
  const mailboxQuery = useMailboxes({ enabled });
  const route = useMemo(
    () => resolveMailboxRoute(folder, mailboxQuery.mailboxes),
    [folder, mailboxQuery.mailboxes],
  );
  const canQuery =
    enabled &&
    status === 'ready' &&
    Boolean(account) &&
    !mailboxQuery.isLoading &&
    route.kind !== 'not-found';
  const input = canQuery
    ? buildThreadPageInput({
        accountId: account!.id,
        route,
        text: searchValue.value,
      })
    : skipToken;
  const threadsQuery = useInfiniteQuery(
    trpc.mail.view.threadPage.infiniteQueryOptions(input, {
      initialCursor: undefined,
      getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
      staleTime: 60_000,
      refetchOnMount: true,
      enabled: canQuery,
    }),
  );
  const threads = useMemo(
    () =>
      threadsQuery.data?.pages.flatMap((page) =>
        page.items.map((item) =>
          adaptThreadSummaryForList(adaptThreadSummary(item), mailboxQuery.mailboxes),
        ),
      ) ?? [],
    [mailboxQuery.mailboxes, threadsQuery.data],
  );
  const isEmpty = threads.length === 0;
  const isReachingEnd = isEmpty || threadsQuery.data?.pages.at(-1)?.cursor === null;

  const loadMore = async () => {
    if (threadsQuery.isLoading || threadsQuery.isFetching || !threadsQuery.hasNextPage) return;
    await threadsQuery.fetchNextPage();
  };

  const guardedThreadsQuery = canQuery
    ? threadsQuery
    : {
        ...threadsQuery,
        refetch: async () => threadsQuery,
      };

  return [guardedThreadsQuery, threads, isReachingEnd, loadMore] as const;
};

export const useThread = (threadId: string | null) => {
  const [_threadId] = useQueryState('threadId');
  const id = threadId ?? _threadId;
  const trpc = useTRPC();
  const { account, status } = useMailAccountContext();
  const mailboxQuery = useMailboxes();
  const canQuery = status === 'ready' && Boolean(account && id);
  const threadQuery = useQuery(
    trpc.mail.view.threadDetail.queryOptions(
      canQuery ? buildThreadDetailInput(account!.id, id!) : skipToken,
      {
        enabled: canQuery,
        staleTime: 60_000,
      },
    ),
  );
  const derived = useMemo(() => {
    if (!threadQuery.data || !account) {
      return {
        data: undefined,
        isGroupThread: false,
        latestDraft: undefined,
      };
    }

    const emails = threadQuery.data.emails.map(adaptEmail);
    const display = buildThreadDisplay(emails, mailboxQuery.mailboxes, {
      accountId: account.id,
      backendBaseUrl: import.meta.env.VITE_PUBLIC_BACKEND_URL,
    });
    const latestDraft = display.messages.findLast((message) => message.isDraft);
    const nonDraftMessages = display.messages.filter((message) => !message.isDraft);
    const latestMessage = nonDraftMessages.at(-1);
    const isGroupThread =
      (latestMessage?.to.length ?? 0) +
        (latestMessage?.cc?.length ?? 0) +
        (latestMessage?.bcc?.length ?? 0) >
      1;

    return {
      data: {
        ...display,
        messages: nonDraftMessages,
      },
      isGroupThread,
      latestDraft,
    };
  }, [account, mailboxQuery.mailboxes, threadQuery.data]);

  const guardedThreadQuery = canQuery
    ? threadQuery
    : {
        ...threadQuery,
        refetch: async () => threadQuery,
      };

  return { ...guardedThreadQuery, ...derived };
};
