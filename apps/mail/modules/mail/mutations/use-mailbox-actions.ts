import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useTRPC } from '@/providers/query-provider';
import type { Label } from '@/types';
import type { CustomMailboxKind } from '../model/mailbox';

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

export type CreateMailboxActionInput = {
  name: string;
  kind: CustomMailboxKind;
  parentId: string | null;
  color?: string | null;
  sortOrder?: number;
  isSubscribed?: boolean;
};

export type UpdateMailboxActionInput = {
  id: string;
  name?: string;
  parentId?: string | null;
  color?: string | null;
  sortOrder?: number;
  isSubscribed?: boolean;
};

export type UpdateMailboxBatchInput = UpdateMailboxActionInput[];

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

  const createMailbox = useCallback(
    async ({
      name,
      kind,
      parentId,
      color,
      sortOrder,
      isSubscribed,
    }: CreateMailboxActionInput) => {
      if (!account) throw new Error('No active mail account');

      const clientId = nextClientId();
      const result = await setMailbox.mutateAsync(
        buildCreateMailboxInput({
          accountId: account.id,
          state: mailboxState,
          clientId,
          name,
          kind,
          parentId,
        }),
      );
      const created = result.created[clientId];
      const failure = result.notCreated[clientId];
      if (!created || failure) {
        throw new Error(failure?.code ?? 'Failed to create mailbox');
      }

      let completed = created;
      if (color !== undefined || sortOrder !== undefined || isSubscribed !== undefined) {
        const updateResult = await setMailbox.mutateAsync(
          buildUpdateMailboxInput({
            accountId: account.id,
            state: result.newState,
            mailboxId: created.id,
            color,
            sortOrder,
            isSubscribed,
          }),
        );
        const updateFailure = updateResult.notUpdated[created.id];
        if (updateFailure) {
          throw new Error(updateFailure.code);
        }
        completed = updateResult.updated[created.id] ?? created;
      }

      await invalidateMailboxes();
      return completed;
    },
    [account, invalidateMailboxes, mailboxState, setMailbox],
  );

  const updateMailbox = useCallback(
    async ({
      id,
      name,
      parentId,
      color,
      sortOrder,
      isSubscribed,
    }: UpdateMailboxActionInput) => {
      if (!account) throw new Error('No active mail account');

      const result = await setMailbox.mutateAsync(
        buildUpdateMailboxInput({
          accountId: account.id,
          state: mailboxState,
          mailboxId: id,
          name,
          parentId,
          color,
          sortOrder,
          isSubscribed,
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

  const destroyMailbox = useCallback(
    async ({ id }: { id: string }) => {
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

  const updateMailboxes = useCallback(
    async (updates: UpdateMailboxBatchInput) => {
      if (!account) throw new Error('No active mail account');
      if (updates.length === 0) return {};
      const result = await setMailbox.mutateAsync({
        accountId: account.id,
        ...(mailboxState ? { ifInState: mailboxState } : {}),
        create: {},
        update: Object.fromEntries(
          updates.map(({ id, ...patch }) => [
            id,
            Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
          ]),
        ),
        destroy: [],
      });
      const firstFailure = Object.values(result.notUpdated)[0];
      if (firstFailure) throw new Error(firstFailure.code);
      await invalidateMailboxes();
      return result.updated;
    },
    [account, invalidateMailboxes, mailboxState, setMailbox],
  );

  const createLabel = useCallback(
    ({ name, color }: Pick<Label, 'name' | 'color'>) =>
      createMailbox({
        name,
        kind: 'label',
        parentId: null,
        color: getLabelColor(color),
      }),
    [createMailbox],
  );

  const updateLabel = useCallback(
    ({ id, name, color }: Pick<Label, 'id' | 'name' | 'color'>) =>
      updateMailbox({ id, name, color: getLabelColor(color) }),
    [updateMailbox],
  );

  const deleteLabel = useCallback(
    ({ id }: Pick<Label, 'id'>) => destroyMailbox({ id }),
    [destroyMailbox],
  );

  return {
    createMailbox,
    updateMailbox,
    updateMailboxes,
    destroyMailbox,
    createLabel,
    updateLabel,
    deleteLabel,
    isPending: setMailbox.isPending,
  };
}
