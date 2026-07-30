import { describe, expect, it, vi } from 'vitest';

import { enterMailboxAfterLogin } from './login-navigation';

describe('successful login navigation', () => {
  it('reloads the document so the root access context sees the new Session', () => {
    const assign = vi.fn();

    enterMailboxAfterLogin({ assign });

    expect(assign).toHaveBeenCalledWith('/mail/inbox');
  });
});
