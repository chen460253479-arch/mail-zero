import type { QueryClient, QueryKey } from '@tanstack/react-query';

export type MailboxConnectionQueryKeys = Readonly<{
  connectionList: QueryKey;
  defaultConnection: QueryKey;
  mailAccountList: QueryKey;
}>;

export type RefreshMailboxConnectionQueryOptions = Readonly<{
  clearDefaultConnection?: boolean;
}>;

export async function refreshMailboxConnectionQueries(
  queryClient: QueryClient,
  queryKeys: MailboxConnectionQueryKeys,
  options: RefreshMailboxConnectionQueryOptions = {},
): Promise<void> {
  if (options.clearDefaultConnection) {
    queryClient.setQueryData(queryKeys.defaultConnection, null);
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.connectionList }),
    queryClient.invalidateQueries({ queryKey: queryKeys.defaultConnection }),
    queryClient.invalidateQueries({ queryKey: queryKeys.mailAccountList }),
  ]);
}
