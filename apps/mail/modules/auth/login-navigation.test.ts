import { describe, expect, it, vi } from 'vitest';

import { enterMailboxAfterLogin } from './login-navigation';

describe('successful login navigation', () => {
  it('reloads the document so the protected route reads the new Session', () => {
    const assign = vi.fn();

    enterMailboxAfterLogin({ assign });

    expect(assign).toHaveBeenCalledWith('/mail/inbox');
  });
});
