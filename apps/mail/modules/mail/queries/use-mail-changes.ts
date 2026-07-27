import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { trpcClient, useTRPC } from '@/providers/query-provider';

import { useMailAccountContext } from '../providers/mail-account-provider';
import { drainChanges } from './changes-reconciler';

export function useMailChanges({
  mailboxState,
  threadState,
}: {
  mailboxState?: string;
  threadState?: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { account } = useMailAccountContext();
  const states = useRef({ mailbox: mailboxState, thread: threadState });
  const running = useRef(false);

  useEffect(() => {
    if (mailboxState) states.current.mailbox = mailboxState;
  }, [mailboxState]);
  useEffect(() => {
    if (threadState) states.current.thread = threadState;
  }, [threadState]);

  const invalidateAccountMail = useCallback(async () => {
    if (!account) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.mail.mailbox.get.queryKey({ accountId: account.id }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.mail.view.threadDetail.queryKey(),
      }),
    ]);
  }, [
    account,
    queryClient,
    trpc.mail.mailbox.get,
    trpc.mail.view.threadDetail,
    trpc.mail.view.threadPage,
  ]);

  const reconcile = useCallback(async () => {
    if (!account || running.current) return;
    running.current = true;
    try {
      const [mailboxChanges, threadChanges] = await Promise.all([
        states.current.mailbox
          ? drainChanges(states.current.mailbox, (sinceState) =>
              trpcClient.mail.mailbox.changes.query({
                accountId: account.id,
                sinceState,
                maxChanges: 500,
              }),
            )
          : null,
        states.current.thread
          ? drainChanges(states.current.thread, (sinceState) =>
              trpcClient.mail.thread.changes.query({
                accountId: account.id,
                sinceState,
                maxChanges: 500,
              }),
            )
          : null,
      ]);
      if (mailboxChanges) states.current.mailbox = mailboxChanges.newState;
      if (threadChanges) states.current.thread = threadChanges.newState;
      const changed = [mailboxChanges, threadChanges].some(
        (changes) =>
          changes &&
          (changes.created.length > 0 ||
            changes.updated.length > 0 ||
            changes.destroyed.length > 0),
      );
      if (changed) await invalidateAccountMail();
    } catch {
      await invalidateAccountMail();
    } finally {
      running.current = false;
    }
  }, [account, invalidateAccountMail]);

  useEffect(() => {
    if (!account) return;
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 15_000);
    const onFocus = () => void reconcile();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [account, reconcile]);
}
