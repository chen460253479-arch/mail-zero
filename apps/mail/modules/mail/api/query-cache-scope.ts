export function getQueryCacheStorageKey(cacheSubject: string | null): string | null {
  return cacheSubject ? `zero-query-cache-${cacheSubject}` : null;
}
