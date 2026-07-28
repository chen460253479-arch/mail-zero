import { describe, expect, it } from 'vitest';

import {
  DevelopmentPushError,
  decideDevelopmentPush,
  pushOutputContainsError,
  sanitizedDatabaseTarget,
  type ExistingSchema,
} from '../../../src/db/development-push';

const existing: ExistingSchema[] = [
  { schemaName: 'auth', tableCount: 8 },
  { schemaName: 'mail', tableCount: 18 },
];

describe('development database push policy', () => {
  it('initializes an empty database without requiring reset confirmation', () => {
    expect(
      decideDevelopmentPush([], {
        reset: false,
        yes: false,
        production: false,
        interactive: false,
      }),
    ).toEqual({ action: 'initialize' });
  });

  it('prompts before changing an existing database in an interactive terminal', () => {
    expect(
      decideDevelopmentPush(existing, {
        reset: false,
        yes: false,
        production: false,
        interactive: true,
      }),
    ).toEqual({ action: 'prompt', existing });
  });

  it('requires both reset and confirmation flags outside an interactive terminal', () => {
    expect(() =>
      decideDevelopmentPush(existing, {
        reset: true,
        yes: false,
        production: false,
        interactive: false,
      }),
    ).toThrowError(
      new DevelopmentPushError(
        'Existing Zero schemas require both --reset and --yes in a non-interactive environment.',
      ),
    );
  });

  it('allows an explicitly confirmed development reset', () => {
    expect(
      decideDevelopmentPush(existing, {
        reset: true,
        yes: true,
        production: false,
        interactive: false,
      }),
    ).toEqual({ action: 'reset', existing });
  });

  it('refuses to reset a production database even with explicit flags', () => {
    expect(() =>
      decideDevelopmentPush(existing, {
        reset: true,
        yes: true,
        production: true,
        interactive: false,
      }),
    ).toThrowError(
      new DevelopmentPushError('Refusing to reset Zero schemas when NODE_ENV=production.'),
    );
  });

  it('refuses to initialize a production database with push', () => {
    expect(() =>
      decideDevelopmentPush([], {
        reset: false,
        yes: false,
        production: true,
        interactive: false,
      }),
    ).toThrowError(
      new DevelopmentPushError(
        'Refusing to initialize or reset Zero schemas when NODE_ENV=production; use db:migrate.',
      ),
    );
  });

  it('prints a database target without credentials or query parameters', () => {
    const target = sanitizedDatabaseTarget(
      'postgresql://mail_user:p%40ss@db.example.test:5432/zero_dev?sslmode=require',
    );

    expect(target).toBe('postgresql://db.example.test:5432/zero_dev');
    expect(target).not.toContain('mail_user');
    expect(target).not.toContain('p%40ss');
    expect(target).not.toContain('sslmode');
  });

  it('recognizes a PostgreSQL failure even when Drizzle reports exit code zero', () => {
    expect(
      pushOutputContainsError(
        'PostgresError: cannot drop constraint example because other objects depend on it',
      ),
    ).toBe(true);
    expect(pushOutputContainsError('No schema changes, nothing to migrate 😴')).toBe(false);
  });
});
