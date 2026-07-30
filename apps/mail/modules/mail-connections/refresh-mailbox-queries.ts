import type { QueryClient, QueryKey } from '@tanstack/react-query';

export type MailboxConnectionQueryKeys = Readonly<{
  connectionList: QueryKey;
  defaultConnection: QueryKey;
  mailAccountList: QueryKey;
}>;

export async function refreshMailboxConnectionQueries(
  queryClient: QueryClient,
  queryKeys: MailboxConnectionQueryKeys,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.connectionList }),
    queryClient.invalidateQueries({ queryKey: queryKeys.defaultConnection }),
    queryClient.invalidateQueries({ queryKey: queryKeys.mailAccountList }),
  ]);
}
