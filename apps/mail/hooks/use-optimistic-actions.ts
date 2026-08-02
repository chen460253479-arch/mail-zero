import {
  optimisticActionsManager,
  settlePendingAction,
  type PendingAction,
} from '@/lib/optimistic-actions-manager';
import { addOptimisticActionAtom, removeOptimisticActionAtom } from '@/store/optimistic-updates';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  buildKeywordThreadAction,
  buildMoveThreadAction,
  buildSetThreadLabelsAction,
  resolveSystemMoveDestinationMailboxId,
} from '@/modules/mail/mutations/thread-action-input';
import {
  KeyedActionQueue,
  startImmediateReversibleAction,
} from '@/lib/immediate-reversible-action';
import { createKeywordActionOperations } from '@/modules/mail/mutations/keyword-action-operations';
import { useMailAccountContext } from '@/modules/mail/providers/mail-account-provider';
import { useMailboxes } from '@/modules/mail/queries/use-mailboxes';
import type { ThreadDestination } from '@/lib/thread-actions';
import { useTRPC } from '@/providers/query-provider';
import { useMail } from '@/components/mail/use-mail';
import { m } from '@/paraglide/messages';
import { formatDate } from '@/lib/utils';
import { useQueryState } from 'nuqs';
import { useCallback } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';

const keywordActionQueue = new KeyedActionQueue();

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
  const { mutateAsync: moveThreads } = useMutation(trpc.mail.action.moveThreads.mutationOptions());
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
      queryClient.refetchQueries({
        queryKey: trpc.mail.view.threadDetail.queryKey(),
      }),
      account
        ? queryClient.refetchQueries({
            queryKey: trpc.mail.mailbox.get.queryKey({ accountId: account.id }),
          })
        : Promise.resolve(),
    ]);
  }, [
    account,
    queryClient,
    trpc.mail.mailbox.get,
    trpc.mail.view.threadDetail,
    trpc.mail.view.threadPage,
  ]);

  function createPendingAction({
    type,
    threadIds,
    params,
    optimisticId,
    execute,
    revert,
    queueKey,
    undo,
    toastMessage,
  }: {
    type: PendingAction['type'];
    threadIds: string[];
    params: PendingAction['params'];
    optimisticId: string;
    execute: () => Promise<void>;
    revert?: () => Promise<void>;
    queueKey?: string;
    undo: () => void;
    toastMessage: string;
    folders?: string[];
  }) {
    const pendingActionId = generatePendingActionId();
    optimisticActionsManager.lastActionId = pendingActionId;

    if (!optimisticActionsManager.pendingActionsByType.has(type)) {
      optimisticActionsManager.pendingActionsByType.set(type, new Set());
    }
    optimisticActionsManager.pendingActionsByType.get(type)?.add(pendingActionId);

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
    const bulkActionMessage =
      itemCount > 1
        ? m['common.actions.bulkAction']({ message: toastMessage, count: itemCount })
        : toastMessage;

    async function doAction() {
      try {
        await execute();
        const { shouldRefresh } = settlePendingAction(
          optimisticActionsManager,
          pendingActionId,
          type,
        );

        if (shouldRefresh) {
          await refreshData();
        }
        removeOptimisticAction(optimisticId);
      } catch (error) {
        console.error('Action failed:', error);
        removeOptimisticAction(optimisticId);
        settlePendingAction(optimisticActionsManager, pendingActionId, type);
        await refreshData();
        toast.error(m['common.actions.actionFailed']());
      }
    }

    if (revert || queueKey) {
      if (!revert || !queueKey) {
        throw new Error('REVERSIBLE_ACTION_CONFIGURATION_INVALID');
      }

      const reversibleAction = startImmediateReversibleAction({
        queue: keywordActionQueue,
        key: queueKey,
        execute,
        revert,
        onUndoRequested: undo,
        onCommitted: async () => {
          const { shouldRefresh } = settlePendingAction(
            optimisticActionsManager,
            pendingActionId,
            type,
          );
          try {
            if (shouldRefresh) {
              await refreshData();
            }
          } finally {
            removeOptimisticAction(optimisticId);
          }
        },
        onForwardFailed: async (error) => {
          console.error('Action failed:', error);
          removeOptimisticAction(optimisticId);
          settlePendingAction(optimisticActionsManager, pendingActionId, type);
          await refreshData();
          toast.error(m['common.actions.actionFailed']());
        },
        onReverted: async () => {
          await refreshData();
        },
        onRevertFailed: async (error) => {
          console.error('Undo failed:', error);
          await refreshData();
          toast.error(m['common.actions.actionFailed']());
        },
      });

      pendingAction.undo = () => {
        void reversibleAction.undo();
      };

      if (toastMessage.trim().length) {
        toast(bulkActionMessage, {
          onAutoClose: () => {
            void reversibleAction.finalize();
          },
          onDismiss: () => {
            void reversibleAction.finalize();
          },
          action: {
            label: m['common.actions.undo'](),
            onClick: () => {
              pendingAction.undo();
              settlePendingAction(optimisticActionsManager, pendingActionId, type);
            },
          },
          duration: 5000,
        });
      } else {
        void reversibleAction.finalize();
      }

      return pendingActionId;
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
          label: m['common.actions.undo'](),
          onClick: () => {
            undo();
            settlePendingAction(optimisticActionsManager, pendingActionId, type);
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

      const keywordAction = createKeywordActionOperations({
        accountId: account?.id ?? 'unavailable',
        threadIds,
        keyword: '$seen',
        enabled: true,
        updateKeyword,
      });

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
          await keywordAction.execute();

          if (mail.bulkSelected.length > 0) {
            setMail((prev) => ({ ...prev, bulkSelected: [] }));
          }
        },
        revert: keywordAction.revert,
        queueKey: keywordAction.queueKey,
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: silent ? '' : m['common.mail.markedAsRead'](),
      });
    },
    [account?.id, addOptimisticAction, removeOptimisticAction, setMail, updateKeyword],
  );

  function optimisticMarkAsUnread(threadIds: string[]) {
    if (!threadIds.length) return;

    const keywordAction = createKeywordActionOperations({
      accountId: account?.id ?? 'unavailable',
      threadIds,
      keyword: '$seen',
      enabled: false,
      updateKeyword,
    });

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
        await keywordAction.execute();

        if (mail.bulkSelected.length > 0) {
          setMail({ ...mail, bulkSelected: [] });
        }
      },
      revert: keywordAction.revert,
      queueKey: keywordAction.queueKey,
      undo: () => {
        removeOptimisticAction(optimisticId);
      },
      toastMessage: m['common.mail.markedAsUnread'](),
    });
  }

  const optimisticToggleStar = useCallback(
    (threadIds: string[], starred: boolean) => {
      if (!threadIds.length) return;

      const keywordAction = createKeywordActionOperations({
        accountId: account?.id ?? 'unavailable',
        threadIds,
        keyword: '$flagged',
        enabled: starred,
        updateKeyword,
      });

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
        execute: keywordAction.execute,
        revert: keywordAction.revert,
        queueKey: keywordAction.queueKey,
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: starred
          ? m['common.actions.addedToFavorites']()
          : m['common.actions.removedFromFavorites'](),
      });
    },
    [account?.id, addOptimisticAction, removeOptimisticAction, updateKeyword],
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
        const destinationMailboxId = resolveSystemMoveDestinationMailboxId(destination, mailboxes);
        const result = await moveThreads(
          buildMoveThreadAction({
            accountId: account.id,
            threadIds,
            destinationMailboxId,
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

  async function moveThreadsToMailbox(threadIds: string[], destinationMailboxId: string) {
    if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
    if (threadIds.length === 0 || !destinationMailboxId) {
      throw new Error('MAIL_MOVE_DESTINATION_UNAVAILABLE');
    }
    const result = await moveThreads(
      buildMoveThreadAction({
        accountId: account.id,
        threadIds,
        destinationMailboxId,
        ...(mailboxState ? { ifInState: mailboxState } : {}),
        clientMutationId: mutationId(),
      }),
    );
    if (Object.keys(result.failed).length > 0) {
      throw new Error('THREAD_MOVE_PARTIAL_FAILURE');
    }

    if (threadId && threadIds.includes(threadId)) {
      setThreadId(null);
      setActiveReplyId(null);
    }
    setMail((current) => ({ ...current, bulkSelected: [] }));
    await refreshData();
    return result.movedThreadIds;
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
        const result = await moveThreads(
          buildMoveThreadAction({
            accountId: account.id,
            threadIds,
            destinationMailboxId: resolveSystemMoveDestinationMailboxId('bin', mailboxes),
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

      const keywordAction = createKeywordActionOperations({
        accountId: account?.id ?? 'unavailable',
        threadIds,
        keyword: '$important',
        enabled: isImportant,
        updateKeyword,
      });

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
          await keywordAction.execute();

          if (mail.bulkSelected.length > 0) {
            setMail((prev) => ({ ...prev, bulkSelected: [] }));
          }
        },
        revert: keywordAction.revert,
        queueKey: keywordAction.queueKey,
        undo: () => {
          removeOptimisticAction(optimisticId);
        },
        toastMessage: isImportant
          ? m['common.mail.markedAsImportant']()
          : m['common.mail.markedAsUnimportant'](),
      });
    },
    [account?.id, addOptimisticAction, removeOptimisticAction, setMail, updateKeyword],
  );

  async function setThreadLabels(
    threadIds: string[],
    addLabelIds: string[],
    removeLabelIds: string[],
  ) {
    if (!account) throw new Error('MAIL_ACCOUNT_UNAVAILABLE');
    if (threadIds.length === 0 || (addLabelIds.length === 0 && removeLabelIds.length === 0)) {
      return [];
    }
    const result = await updateThreads(
      buildSetThreadLabelsAction({
        accountId: account.id,
        threadIds,
        addLabelIds,
        removeLabelIds,
        mailboxes,
        ...(mailboxState ? { ifInState: mailboxState } : {}),
        clientMutationId: mutationId(),
      }),
    );
    if (Object.keys(result.failed).length > 0) {
      throw new Error('THREAD_LABEL_PARTIAL_FAILURE');
    }

    setMail((current) => ({ ...current, bulkSelected: [] }));
    await refreshData();
    return result.updatedThreadIds;
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
      toastMessage: m['common.mail.snoozedUntil']({ date: formatDate(wakeAt) }),
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
      toastMessage: m['common.actions.movedToInbox'](),
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
      toastMessage: m['common.mail.draftDeleted'](),
    });
  }

  function undoLastAction() {
    if (!optimisticActionsManager.lastActionId) return;

    const lastAction = optimisticActionsManager.pendingActions.get(
      optimisticActionsManager.lastActionId,
    );
    if (!lastAction) return;

    lastAction.undo();
    settlePendingAction(
      optimisticActionsManager,
      optimisticActionsManager.lastActionId,
      lastAction.type,
    );

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
    moveThreadsToMailbox,
    optimisticDeleteThreads,
    permanentlyDeleteThreads,
    optimisticToggleImportant,
    setThreadLabels,
    optimisticSnooze,
    optimisticUnsnooze,
    optimisticDeleteDraft,
    undoLastAction,
  };
}
