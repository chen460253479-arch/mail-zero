import type { QueryClient, QueryKey } from '@tanstack/react-query';

const restoredMailQueryFamilies = [
  [['mail', 'view', 'threadPage'], { type: 'infinite' }],
  [['mail', 'view', 'threadDetail'], { type: 'query' }],
  [['mail', 'mailbox', 'get'], { type: 'query' }],
] as const satisfies readonly QueryKey[];

export async function revalidatePersistedMailCache(queryClient: QueryClient) {
  await Promise.all(
    restoredMailQueryFamilies.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
