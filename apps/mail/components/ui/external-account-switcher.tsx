import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useActiveConnection, useConnections } from '@/hooks/use-connections';
import { useTRPC } from '@/providers/query-provider';

export type ExternalConnectionOption = {
  id: string;
  email: string;
  name: string | null;
};

export const switchExternalAccount = async (
  connectionId: string,
  activeConnectionId: string | null,
  dependencies: {
    setDefault(input: { connectionId: string }): Promise<unknown>;
    refresh(): Promise<unknown>;
  },
): Promise<void> => {
  if (connectionId === activeConnectionId) return;
  await dependencies.setDefault({ connectionId });
  await dependencies.refresh();
};

export function ExternalAccountSwitcherView({
  connections,
  activeConnectionId,
  onSelect,
  disabled = false,
}: {
  connections: readonly ExternalConnectionOption[];
  activeConnectionId: string | null;
  onSelect(connectionId: string): void;
  disabled?: boolean;
}) {
  if (connections.length === 0) {
    return (
      <div className="text-muted-foreground px-2 py-2 text-xs">No mailboxes are available.</div>
    );
  }
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-[11px]">Mailbox</span>
      <select
        aria-label="Mailbox"
        className="border-border bg-background h-9 min-w-0 rounded-md border px-2 text-xs"
        value={activeConnectionId ?? ''}
        disabled={disabled}
        onChange={(event) => onSelect(event.currentTarget.value)}
      >
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.email}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ExternalAccountSwitcher() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const connections = useConnections();
  const activeConnection = useActiveConnection();
  const setDefault = useMutation(trpc.connections.setDefault.mutationOptions());
  const options =
    connections.data?.connections.map(({ id, email, name }) => ({
      id,
      email,
      name,
    })) ?? [];

  const select = (connectionId: string) => {
    void switchExternalAccount(connectionId, activeConnection.data?.id ?? null, {
      setDefault: (input) => setDefault.mutateAsync(input),
      refresh: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.connections.getDefault.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.connections.list.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.mail.account.list.queryKey(),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
          }),
        ]);
      },
    });
  };

  return (
    <ExternalAccountSwitcherView
      connections={options}
      activeConnectionId={activeConnection.data?.id ?? null}
      onSelect={select}
      disabled={connections.isLoading || activeConnection.isLoading || setDefault.isPending}
    />
  );
}
