import { describe, expect, it } from 'vitest';

import {
  AppAccessProvider,
  loadAppAccess,
  resolveAppAccess,
  useAppAccess,
} from './access-context';
import { getQueryCacheStorageKey } from '../mail/api/query-cache-scope';
import { renderToStaticMarkup } from 'react-dom/server';

describe('application access context', () => {
  it('recognizes an external session when no Better Auth user exists', () => {
    expect(
      resolveAppAccess({
        userId: null,
        externalSessionId: 'external-session-1',
      }),
    ).toEqual({
      mode: 'external',
      cacheSubject: 'external:external-session-1',
    });
  });

  it('gives a Better Auth user priority over an external session', () => {
    expect(
      resolveAppAccess({
        userId: 'user-1',
        externalSessionId: 'external-session-1',
      }),
    ).toEqual({
      mode: 'user',
      cacheSubject: 'user:user-1',
    });
  });

  it('uses different persisted query cache keys for user and external access', () => {
    expect(getQueryCacheStorageKey('user:user-1')).not.toBe(
      getQueryCacheStorageKey('external:session-1'),
    );
  });

  it('exposes access mode through a provider', () => {
    function AccessMode() {
      return <span>{useAppAccess().mode}</span>;
    }

    expect(
      renderToStaticMarkup(
        <AppAccessProvider
          access={{
            mode: 'external',
            cacheSubject: 'external:external-session-1',
          }}
        >
          <AccessMode />
        </AppAccessProvider>,
      ),
    ).toContain('external');
  });

  it('falls back to anonymous access when the external session cannot be loaded', async () => {
    await expect(
      loadAppAccess({
        userId: null,
        loadExternalSessionId: async () => {
          throw new Error('external access is unavailable');
        },
      }),
    ).resolves.toEqual({
      mode: 'anonymous',
      cacheSubject: null,
    });
  });
});
