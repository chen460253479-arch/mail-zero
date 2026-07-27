export function getQueryCacheStorageKey(userId: string | null): string | null {
  return userId ? `zero-query-cache-${userId}` : null;
}
