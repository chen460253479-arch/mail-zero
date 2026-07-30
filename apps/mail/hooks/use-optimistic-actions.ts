import { addOptimisticActionAtom, removeOptimisticActionAtom } from '@/store/optimistic-updates';
import { optimisticActionsManager, type PendingAction } from '@/lib/optimistic-actions-manager';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  buildKeywordThreadAction,
  buildMoveThreadAction,
} from '@/modules/mail/mutations/thread-action-input';
import { useMailAccountContext } from '@/modules/mail/providers/mail-account-provider';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import type { ThreadDestination } from '@/lib/thread-actions';
import { useTRPC } from '@/providers/query-provider';
import { useMail } from '@/components/mail/use-mail';
import { m } from '@/paraglide/messages';
import { useQueryState } from 'nuqs';
import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';

export function useOptimisticActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [, addOptimisticAction] = useAtom(addOptimisticActionAtom);
  const [, removeOptimisticAction] = useAtom(removeOptimisticActionAtom);
  const [threadId, setThreadId] = useQueryState('threadId');
  const [, setActiveReplyId] = useQueryState('activeReplyId');
  const [mail, setMail] = useMail();
  const { account } = useMailAccountContext();
  const { mailboxes, mailboxState } = useMailboxes();
  const { mutateAsync: updateThreads } = useMutation(
    trpc.mail.action.updateThreads.mutationOptions(),
  );
  const { mutateAsync: snoozeThreads } = useMutation(
    trpc.mail.action.snoozeThreads.mutationOptions(),
  );
  const { mutateAsync: unsnoozeThreads } = useMutation(
    trpc.mail.action.unsnoozeThreads.mutationOptions(),
  );
  const { mutateAsync: setEmails } = useMutation(trpc.mail.email.set.mutationOptions());
  const { mutateAsync: destroyThreads } = useMutation(
    trpc.mail.action.destroyThreads.mutationOptions(),
  );

  const mutationId = () =>
    globalThis.crypto?.randomUUID?.() ??
    `mutation_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const updateKeyword = async (threadIds: string[], keyword: string, enabled: boolean) => {
    if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
    const result = await updateThreads(
      buildKeywordThreadAction({
        accountId: account.id,
        threadIds,
        keyword,
        enabled,
        ifInState: mailboxState,
        clientMutationId: mutationId(),
      }),
    );
    if (Object.keys(result.failed).length > 0) {
      throw new Error('THREAD_ACTION_PARTIAL_FAILURE');
    }
  };

  const generatePendingActionId = () =>
    `pending_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const refreshData = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({
        queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
      }),
      account
        ? queryClient.refetchQueries({
            queryKey: trpc.mail.mailbox.get.queryKey({ accountId: account.id }),
          })
        : Promise.resolve(),
    ]);
  }, [account, queryClient, trpc.mail.mailbox.get, trpc.mail.view.threadPage]);

  function createPendingAction({
    type,
    threadIds,
    params,
    optimisticId,
    execute,
    undo,
    toastMessage,
  }: {
    type: PendingAction['type'];
    threadIds: string[];
    params: PendingAction['params'];
    optimisticId: string;
    execute: () => Promise<void>;
    undo: () => void;
    toastMessage: string;
    folders?: string[];
  }) {
    const pendingActionId = generatePendingActionId();
    optimisticActionsManager.lastActionId = pendingActionId;
    console.log('here Generated pending action ID:', pendingActionId);

    if (!optimisticActionsManager.pendingActionsByType.has(type)) {
      console.log('here Creating new Set for action type:', type);
      optimisticActionsManager.pendingActionsByType.set(type, new Set());
    }
    optimisticActionsManager.pendingActionsByType.get(type)?.add(pendingActionId);
    console.log(
      'here',
      'Added pending action to type:',
      type,
      'Current size:',
      optimisticActionsManager.pendingActionsByType.get(type)?.size,
    );

    const pendingAction = {
      id: pendingActionId,
      type,
      threadIds,
      params,
      optimisticId,
      execute,
      undo,
    };

    optimisticActionsManager.pendingActions.set(pendingActionId, pendingAction as PendingAction);

    const itemCount = threadIds.length;
    const bulkActionMessage = itemCount > 1 ? `${toastMessage} (${itemCount} items)` : toastMessage;

    async function doAction() {
      try {
        await execute();
        const typeActions = optimisticActionsManager.pendingActionsByType.get(type);
        console.log('here', {
          pendingActionsByTypeRef: optimisticActionsManager.pendingActionsByType.get(type)?.size,
          pendingActionsRef: optimisticActionsManager.pendingActions.size,
          typeActions: typeActions?.size,
        });

        optimisticActionsManager.pendingActions.delete(pendingActionId);
        optimisticActionsManager.pendingActionsByType.get(type)?.delete(pendingActionId);
        if (typeActions?.size === 1) {
          await refreshData();
          removeOptimisticAction(optimisticId);
        }
      } catch (error) {
        console.error('Action failed:', error);
        removeOptimisticAction(optimisticId);
        optimisticActionsManager.pendingActions.delete(pendingActionId);
        optimisticActionsManager.pendingActionsByType.get(type)?.delete(pendingActionId);
        await refreshData();
        toast.error('Action failed');
      }
    }

    if (toastMessage.trim().length) {
      toast(bulkActionMessage, {
        onAutoClose: () => {
          doAction();
        },
        onDismiss: () => {
          doAction();
        },
        action: {
          label: 'Undo',
          onClick: () => {
            undo();
            optimisticActionsManager.pendingActions.delete(pendingActionId);
            optimisticActionsManager.pendingActionsByType.get(type)?.delete(pendingActionId);
          },
        },
        duration: 5000,
      });
    } else {
      doAction();
    }

    return pendingActionId;
  }

  const optimisticMarkAsRead = useCallback(
    (threadIds: string[], silent = false) => {
      if (!threadIds.length) return;

      const optimisticId = addOptimisticAction({
        type: 'READ',
        threadIds,
        read: true,
      });

      createPendingAction({
        type: 'READ',
        threadIds,
        params: { read: true },
        optimisticId,
        execute: async () => {
          await updateKeyword(threadIds, '$seen', true);

          if (mail.bulkSelected.length > 0) {
            setMail((prev) => ({ ...prev, bulkSelected: [] }));
          }
        },
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: silent ? '' : 'Marked as read',
      });
    },
    [addOptimisticAction, removeOptimisticAction, setMail, updateKeyword],
  );

  function optimisticMarkAsUnread(threadIds: string[]) {
    if (!threadIds.length) return;

    const optimisticId = addOptimisticAction({
      type: 'READ',
      threadIds,
      read: false,
    });

    createPendingAction({
      type: 'READ',
      threadIds,
      params: { read: false },
      optimisticId,
      execute: async () => {
        await updateKeyword(threadIds, '$seen', false);

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: 'Marked as unread',
    });
  }

  const optimisticToggleStar = useCallback(
    (threadIds: string[], starred: boolean) => {
      if (!threadIds.length) return;

      const optimisticId = addOptimisticAction({
        type: 'STAR',
        threadIds,
        starred,
      });

      createPendingAction({
        type: 'STAR',
        threadIds,
        params: { starred },
        optimisticId,
        execute: async () => {
          await updateKeyword(threadIds, '$flagged', starred);
        },
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: starred
          ? m['common.actions.addedToFavorites']()
          : m['common.actions.removedFromFavorites'](),
      });
    },
    [addOptimisticAction, removeOptimisticAction, setMail, updateKeyword],
  );

  function optimisticMoveThreadsTo(
    threadIds: string[],
    currentFolder: string,
    destination: ThreadDestination,
  ) {
    if (!threadIds.length || !destination) return;

    // setFocusedIndex(null);

    const optimisticId = addOptimisticAction({
      type: 'MOVE',
      threadIds,
      destination,
    });

    if (threadId && threadIds.includes(threadId)) {
      setThreadId(null);
      setActiveReplyId(null);
    }
    const successMessage =
      destination === 'inbox'
        ? m['common.actions.movedToInbox']()
        : destination === 'spam'
          ? m['common.actions.movedToSpam']()
          : destination === 'bin'
            ? m['common.actions.movedToBin']()
            : m['common.actions.archived']();

    createPendingAction({
      type: 'MOVE',
      threadIds,
      params: { currentFolder, destination },
      optimisticId,
      execute: async () => {
        if (!account || !destination || destination === 'snoozed') {
          throw new Error('MAIL_MOVE_DESTINATION_UNAVAILABLE');
        }
        const result = await updateThreads(
          buildMoveThreadAction({
            accountId: account.id,
            threadIds,
            destination,
            mailboxes,
            ifInState: mailboxState,
            clientMutationId: mutationId(),
          }),
        );
        if (Object.keys(result.failed).length > 0) {
          throw new Error('THREAD_MOVE_PARTIAL_FAILURE');
        }

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: successMessage,
      folders: [currentFolder, destination],
    });
  }

  function optimisticDeleteThreads(threadIds: string[], currentFolder: string) {
    if (!threadIds.length) return;

    // setFocusedIndex(null);

    const optimisticId = addOptimisticAction({
      type: 'MOVE',
      threadIds,
      destination: 'bin',
    });

    if (threadId && threadIds.includes(threadId)) {
      setThreadId(null);
      setActiveReplyId(null);
    }
    createPendingAction({
      type: 'MOVE',
      threadIds,
      params: { currentFolder, destination: 'bin' },
      optimisticId,
      execute: async () => {
        if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
        const result = await updateThreads(
          buildMoveThreadAction({
            accountId: account.id,
            threadIds,
            destination: 'bin',
            mailboxes,
            ifInState: mailboxState,
            clientMutationId: mutationId(),
          }),
        );
        if (Object.keys(result.failed).length > 0) {
          throw new Error('THREAD_MOVE_PARTIAL_FAILURE');
        }

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: m['common.actions.movedToBin'](),
    });
  }

  async function permanentlyDeleteThreads(threadIds: string[]) {
    if (!account || threadIds.length === 0) return;
    const result = await destroyThreads({
      accountId: account.id,
      threadIds,
      clientMutationId: mutationId(),
    });
    if (Object.keys(result.failed).length > 0) {
      throw new Error('THREAD_DESTROY_PARTIAL_FAILURE');
    }
    if (threadId && threadIds.includes(threadId)) {
      setThreadId(null);
      setActiveReplyId(null);
    }
    setMail((current) => ({ ...current, bulkSelected: [] }));
    await refreshData();
    return result.destroyedThreadIds;
  }

  const optimisticToggleImportant = useCallback(
    (threadIds: string[], isImportant: boolean) => {
      if (!threadIds.length) return;

      const optimisticId = addOptimisticAction({
        type: 'IMPORTANT',
        threadIds,
        important: isImportant,
      });

      createPendingAction({
        type: 'IMPORTANT',
        threadIds,
        params: { important: isImportant },
        optimisticId,
        execute: async () => {
          await updateKeyword(threadIds, '$important', isImportant);

          if (mail.bulkSelected.length > 0) {
            setMail((prev) => ({ ...prev, bulkSelected: [] }));
          }
        },
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: isImportant ? 'Marked as important' : 'Unmarked as important',
      });
    },
    [addOptimisticAction, removeOptimisticAction, setMail, updateKeyword],
  );

  function optimisticToggleLabel(threadIds: string[], labelId: string, add: boolean) {
    if (!threadIds.length || !labelId) return;

    const optimisticId = addOptimisticAction({
      type: 'LABEL',
      threadIds,
      labelIds: [labelId],
      add,
    });

    createPendingAction({
      type: 'LABEL',
      threadIds,
      params: { labelId, add },
      optimisticId,
      execute: async () => {
        if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
        const result = await updateThreads({
          accountId: account.id,
          threadIds,
          ...(mailboxState ? { ifInState: mailboxState } : {}),
          addMailboxIds: add ? [labelId] : [],
          removeMailboxIds: add ? [] : [labelId],
          addKeywords: [],
          removeKeywords: [],
          clientMutationId: mutationId(),
        });
        if (Object.keys(result.failed).length > 0) {
          throw new Error('THREAD_LABEL_PARTIAL_FAILURE');
        }

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: add
        ? `Label added${threadIds.length > 1 ? ` to ${threadIds.length} threads` : ''}`
        : `Label removed${threadIds.length > 1 ? ` from ${threadIds.length} threads` : ''}`,
    });
  }

  function optimisticSnooze(threadIds: string[], currentFolder: string, wakeAt: Date) {
    if (!threadIds.length) return;

    const optimisticId = addOptimisticAction({
      type: 'SNOOZE',
      threadIds,
      wakeAt: wakeAt.toISOString(),
    });

    createPendingAction({
      type: 'SNOOZE',
      threadIds,
      params: { currentFolder, wakeAt: wakeAt.toISOString() },
      optimisticId,
      execute: async () => {
        if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
        await snoozeThreads({
          accountId: account.id,
          threadIds,
          wakeAt: wakeAt.toISOString(),
          clientMutationId: mutationId(),
        });

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: `Snoozed until ${wakeAt.toLocaleString()}`,
      folders: [currentFolder, 'snoozed'],
    });
  }

  function optimisticUnsnooze(threadIds: string[], currentFolder: string) {
    if (!threadIds.length) return;

    const optimisticId = addOptimisticAction({
      type: 'UNSNOOZE',
      threadIds,
    });

    createPendingAction({
      type: 'UNSNOOZE',
      threadIds,
      params: { currentFolder },
      optimisticId,
      execute: async () => {
        if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
        await unsnoozeThreads({
          accountId: account.id,
          threadIds,
          clientMutationId: mutationId(),
        });
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: 'Moved to Inbox',
      folders: [currentFolder, 'inbox'],
    });
  }

  function optimisticDeleteDraft(draftId: string, threadId: string) {
    if (!draftId || !threadId) return;

    const optimisticId = addOptimisticAction({
      type: 'DELETE_DRAFT',
      threadIds: [threadId],
    });

    createPendingAction({
      type: 'DELETE_DRAFT',
      threadIds: [threadId],
      params: {},
      optimisticId,
      execute: async () => {
        if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
        await setEmails({
          accountId: account.id,
          create: {},
          update: {},
          destroy: [draftId],
        });
        await queryClient.invalidateQueries({
          queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
        });
      },
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: 'Draft deleted',
    });
  }

  function undoLastAction() {
    if (!optimisticActionsManager.lastActionId) return;

    const lastAction = optimisticActionsManager.pendingActions.get(
      optimisticActionsManager.lastActionId,
    );
    if (!lastAction) return;

    lastAction.undo();

    optimisticActionsManager.pendingActions.delete(optimisticActionsManager.lastActionId);
    optimisticActionsManager.pendingActionsByType
      .get(lastAction.type)
      ?.delete(optimisticActionsManager.lastActionId);

    if (lastAction.toastId) {
      toast.dismiss(lastAction.toastId);
    }

    optimisticActionsManager.lastActionId = null;
  }

  return {
    optimisticMarkAsRead,
    optimisticMarkAsUnread,
    optimisticToggleStar,
    optimisticMoveThreadsTo,
    optimisticDeleteThreads,
    permanentlyDeleteThreads,
    optimisticToggleImportant,
    optimisticToggleLabel,
    optimisticSnooze,
    optimisticUnsnooze,
    optimisticDeleteDraft,
    undoLastAction,
  };
}
