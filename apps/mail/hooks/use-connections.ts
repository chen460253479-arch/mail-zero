import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { selectConnectedConnection } from '@/modules/mail-connections/connected-connections';

export const useConnections = () => {
  const trpc = useTRPC();
  const connectionsQuery = useQuery(trpc.connections.list.queryOptions());
  return connectionsQuery;
};

export const useDefaultConnection = () => {
  const trpc = useTRPC();
  return useQuery(trpc.connections.getDefault.queryOptions());
};

export const useActiveConnection = () => {
  const trpc = useTRPC();
  const connectionsQuery = useQuery(
    trpc.connections.getDefault.queryOptions(void 0, {
      staleTime: 1000 * 60 * 60, // 1 hour,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      select: selectConnectedConnection,
    }),
  );
  return connectionsQuery;
};
