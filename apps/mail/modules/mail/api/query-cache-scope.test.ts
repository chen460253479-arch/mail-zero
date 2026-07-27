import { getQueryCacheStorageKey } from './query-cache-scope';
import { describe, expect, it } from 'vitest';

describe('getQueryCacheStorageKey', () => {
  it('isolates persisted cache by authenticated local user', () => {
    expect(getQueryCacheStorageKey('user-a')).toBe('zero-query-cache-user-a');
    expect(getQueryCacheStorageKey('user-b')).toBe('zero-query-cache-user-b');
  });

  it('disables persisted cache before an authenticated user is known', () => {
    expect(getQueryCacheStorageKey(null)).toBeNull();
  });
});
