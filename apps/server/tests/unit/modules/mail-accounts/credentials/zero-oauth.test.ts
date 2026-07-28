import { describe, expect, it } from 'vitest';

import { createZeroOAuthSnapshot, readZeroOAuthSnapshot } from '../../../../../src/modules/mail-accounts/credentials/zero-oauth';

describe('Zero OAuth credentials', () => {
  it('creates and validates an OAuth snapshot', () => {
    const snapshot = createZeroOAuthSnapshot({
      accessToken: 'access',
      refreshToken: 'refresh',
      scope: 'mail',
    });

    expect(readZeroOAuthSnapshot(snapshot)).toEqual({
      type: 'oauth2',
      accessToken: 'access',
      refreshToken: 'refresh',
      scope: 'mail',
    });
  });

  it('rejects incomplete snapshots', () => {
    expect(() => readZeroOAuthSnapshot({ type: 'oauth2', accessToken: 'access' })).toThrow();
  });
});
