import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppAccessProvider, loadAppAccess, resolveAppAccess, useAppAccess } from './access-context';

describe('application access context', () => {
  it('uses the same user cache subject for password and Launch authentication', async () => {
    expect(resolveAppAccess({ userId: 'user-1' })).toEqual({
      mode: 'user',
      cacheSubject: 'user:user-1',
    });
    await expect(loadAppAccess({ userId: 'user-1' })).resolves.toEqual({
      mode: 'user',
      cacheSubject: 'user:user-1',
    });
  });

  it('resolves an anonymous browser without a standard Session', () => {
    expect(resolveAppAccess({ userId: null })).toEqual({
      mode: 'anonymous',
      cacheSubject: null,
    });
  });

  it('exposes the standard user mode through the provider', () => {
    function AccessMode() {
      return <span>{useAppAccess().mode}</span>;
    }

    expect(
      renderToStaticMarkup(
        <AppAccessProvider
          access={{
            mode: 'user',
            cacheSubject: 'user:user-1',
          }}
        >
          <AccessMode />
        </AppAccessProvider>,
      ),
    ).toContain('user');
  });
});
