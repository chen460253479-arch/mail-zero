import { describe, expect, it } from 'vitest';

import { inspectZeroSchemas, resetZeroSchemas } from '../../../src/db/push-development-database';
import { withMailTestDatabase } from '../../helpers/mail-core/database';

describe('development database push protection', () => {
  it('detects every populated Zero business schema', async () => {
    await withMailTestDatabase(async ({ sql }) => {
      const existing = await inspectZeroSchemas(sql);

      expect(existing.map(({ schemaName }) => schemaName)).toEqual([
        'app',
        'auth',
        'integration',
        'mail',
      ]);
      expect(existing.every(({ tableCount }) => tableCount > 0)).toBe(true);
    });
  });

  it('removes only Zero schemas and development migration metadata', async () => {
    await withMailTestDatabase(async ({ sql }) => {
      await sql.unsafe(`
        CREATE TABLE public.push_reset_sentinel (
          id integer PRIMARY KEY
        );
        INSERT INTO public.push_reset_sentinel (id) VALUES (1);
        CREATE SCHEMA drizzle;
        CREATE TABLE drizzle.__drizzle_migrations (
          id integer PRIMARY KEY
        );
        INSERT INTO drizzle.__drizzle_migrations (id) VALUES (1);
      `);

      await resetZeroSchemas(sql);

      await expect(inspectZeroSchemas(sql)).resolves.toEqual([]);
      const sentinel = await sql<{ id: number }[]>`
        SELECT id
        FROM public.push_reset_sentinel
      `;
      expect(sentinel).toEqual([{ id: 1 }]);
      const migrationTable = await sql<{ name: string | null }[]>`
        SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name
      `;
      expect(migrationTable).toEqual([{ name: null }]);
    });
  });
});
