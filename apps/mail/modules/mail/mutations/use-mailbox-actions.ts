import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useTRPC } from '@/providers/query-provider';
import type { Label } from '@/types';

import {
  buildCreateMailboxInput,
  buildDestroyMailboxInput,
  buildUpdateMailboxInput,
} from './mailbox-set-input';
import { useMailboxes } from '../queries/use-mailboxes';

function nextClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `mailbox-${Date.now()}`;
}

function getLabelColor(color: Label['color']) {
  return color?.backgroundColor;
}

export function useMailboxActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { account, mailboxState } = useMailboxes();
  const setMailbox = useMutation(trpc.mail.mailbox.set.mutationOptions());

  const invalidateMailboxes = useCallback(async () => {
    if (!account) return;
    await queryClient.invalidateQueries({
      queryKey: trpc.mail.mailbox.get.queryKey({ accountId: account.id }),
    });
  }, [account, queryClient, trpc.mail.mailbox.get]);

  const createLabel = useCallback(
    async ({ name, color }: Pick<Label, 'name' | 'color'>) => {
      if (!account) throw new Error('No active mail account');

      const clientId = nextClientId();
      const result = await setMailbox.mutateAsync(
        buildCreateMailboxInput({
          accountId: account.id,
          state: mailboxState,
          clientId,
          name,
        }),
      );
      const created = result.created[clientId];
      const failure = result.notCreated[clientId];
      if (!created || failure) {
        throw new Error(failure?.code ?? 'Failed to create mailbox');
      }

      const labelColor = getLabelColor(color);
      if (labelColor) {
        const colorResult = await setMailbox.mutateAsync(
          buildUpdateMailboxInput({
            accountId: account.id,
            state: result.newState,
            mailboxId: created.id,
            color: labelColor,
          }),
        );
        const colorFailure = colorResult.notUpdated[created.id];
        if (colorFailure) {
          throw new Error(colorFailure.code);
        }
      }

      await invalidateMailboxes();
      return created;
    },
    [account, invalidateMailboxes, mailboxState, setMailbox],
  );

  const updateLabel = useCallback(
    async ({ id, name, color }: Pick<Label, 'id' | 'name' | 'color'>) => {
      if (!account) throw new Error('No active mail account');

      const result = await setMailbox.mutateAsync(
        buildUpdateMailboxInput({
          accountId: account.id,
          state: mailboxState,
          mailboxId: id,
          name,
          color: getLabelColor(color),
        }),
      );
      const failure = result.notUpdated[id];
      if (failure) {
        throw new Error(failure.code);
      }

      await invalidateMailboxes();
      return result.updated[id];
    },
    [account, invalidateMailboxes, mailboxState, setMailbox],
  );

  const deleteLabel = useCallback(
    async ({ id }: Pick<Label, 'id'>) => {
      if (!account) throw new Error('No active mail account');

      const result = await setMailbox.mutateAsync(
        buildDestroyMailboxInput({
          accountId: account.id,
          state: mailboxState,
          mailboxId: id,
        }),
      );
      const failure = result.notDestroyed[id];
      if (failure) {
        throw new Error(failure.code);
      }

      await invalidateMailboxes();
      return result.destroyed.includes(id);
    },
    [account, invalidateMailboxes, mailboxState, setMailbox],
  );

  return {
    createLabel,
    updateLabel,
    deleteLabel,
    isPending: setMailbox.isPending,
  };
}
