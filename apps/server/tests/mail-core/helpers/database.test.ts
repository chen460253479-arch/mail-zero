import { describe, expect, it, vi } from 'vitest';

import { databaseUrlFor, requireSafeDatabase, runFailureIndependentCleanup } from './database';

describe('mail-core test database isolation', () => {
  it('accepts only generated mail-core database names', () => {
    expect(() =>
      requireSafeDatabase('mail_core_test_0123456789abcdef0123456789abcdef'),
    ).not.toThrow();
    expect(() => requireSafeDatabase('postgres')).toThrow('Unsafe mail-core test database name');
    expect(() => requireSafeDatabase('mail_core_test_0123"; DROP DATABASE postgres; --')).toThrow(
      'Unsafe mail-core test database name',
    );
  });

  it('changes only the database pathname in a PostgreSQL URL', () => {
    const source =
      'postgresql://mail_user:p%40ss@db.example.test:5432/zero_dev?sslmode=require&application_name=zero';
    const result = new URL(
      databaseUrlFor(source, 'mail_core_test_0123456789abcdef0123456789abcdef'),
    );

    expect(result.username).toBe('mail_user');
    expect(result.password).toBe('p%40ss');
    expect(result.host).toBe('db.example.test:5432');
    expect(result.pathname).toBe('/mail_core_test_0123456789abcdef0123456789abcdef');
    expect(result.searchParams.get('sslmode')).toBe('require');
    expect(result.searchParams.get('application_name')).toBe('zero');
  });
});

describe('mail-core database cleanup', () => {
  it('attempts every cleanup action and preserves the first cleanup failure', async () => {
    const first = vi.fn().mockRejectedValue(new Error('isolated close failed'));
    const second = vi.fn().mockRejectedValue(new Error('drop failed'));
    const third = vi.fn().mockResolvedValue(undefined);

    await expect(runFailureIndependentCleanup([first, second, third], false)).rejects.toThrow(
      'isolated close failed',
    );
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(third).toHaveBeenCalledOnce();
  });

  it('does not replace a primary test failure with cleanup failures', async () => {
    const actions = [
      vi.fn().mockRejectedValue(new Error('isolated close failed')),
      vi.fn().mockRejectedValue(new Error('drop failed')),
      vi.fn().mockRejectedValue(new Error('admin close failed')),
    ];

    await expect(runFailureIndependentCleanup(actions, true)).resolves.toBeUndefined();
    expect(actions.every((action) => action.mock.calls.length === 1)).toBe(true);
  });
});
