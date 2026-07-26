import { describe, expect, it } from 'vitest';

import { runDevelopmentPush, runDrizzleKitCommand } from '../../src/db/push-development-database';
import { withMailTestDatabase } from './helpers/database';
import type { Sql } from 'postgres';

const withDatabaseEnvironment = async <T>(
  databaseUrl: string,
  run: () => Promise<T>,
): Promise<T> => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  try {
    return await run();
  } finally {
    if (previousDatabaseUrl === undefined) Reflect.deleteProperty(process.env, 'DATABASE_URL');
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else process.env.NODE_ENV = previousNodeEnv;
  }
};

const readBusinessCatalog = async (sql: Sql) => {
  const columns = await sql`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attnum AS ordinal_position,
      attribute.attname AS column_name,
      format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
      attribute.attnotnull AS not_null,
      pg_get_expr(default_value.adbin, default_value.adrelid) AS default_value
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_attrdef AS default_value
      ON default_value.adrelid = relation.oid
      AND default_value.adnum = attribute.attnum
    WHERE namespace.nspname IN ('auth', 'app', 'integration', 'mail')
      AND relation.relkind = 'r'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY namespace.nspname, relation.relname, attribute.attnum
  `;
  const constraints = await sql`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      constraint_row.conname AS constraint_name,
      constraint_row.contype AS constraint_type,
      pg_get_constraintdef(constraint_row.oid, true) AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('auth', 'app', 'integration', 'mail')
    ORDER BY namespace.nspname, relation.relname, constraint_row.conname
  `;
  const indexes = await sql`
    SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
    WHERE schemaname IN ('auth', 'app', 'integration', 'mail')
    ORDER BY schemaname, tablename, indexname
  `;
  return {
    columns: columns.map((row) => ({ ...row })),
    constraints: constraints.map((row) => ({ ...row })),
    indexes: indexes.map((row) => ({ ...row })),
  };
};

describe('development database CLI', () => {
  it('pushes the declarative schema into an empty database', () =>
    withMailTestDatabase(
      async ({ databaseUrl, sql }) => {
        await withDatabaseEnvironment(databaseUrl, () => runDevelopmentPush([]));

        const [result] = await sql<{ provider_key: string }[]>`
          SELECT column_name AS provider_key
          FROM information_schema.columns
          WHERE table_schema = 'integration'
            AND table_name = 'connection'
            AND column_name = 'provider_key'
        `;
        expect(result?.provider_key).toBe('provider_key');
      },
      { applyMigrations: false },
    ));

  it('resets only Zero schemas and repushes when explicitly confirmed', () =>
    withMailTestDatabase(async ({ databaseUrl, sql }) => {
      await sql`CREATE TABLE public.push_cli_sentinel (id integer PRIMARY KEY)`;
      await sql`INSERT INTO public.push_cli_sentinel (id) VALUES (1)`;

      await withDatabaseEnvironment(databaseUrl, () => runDevelopmentPush(['--reset', '--yes']));

      await expect(sql<{ id: number }[]>`SELECT id FROM public.push_cli_sentinel`).resolves.toEqual(
        [{ id: 1 }],
      );
      const [column] = await sql<{ name: string | null }[]>`
        SELECT to_regclass('integration.connection')::text AS name
      `;
      expect(column?.name).toBe('integration.connection');
    }));

  it('applies the same single baseline through drizzle migrate', () =>
    withMailTestDatabase(
      async ({ databaseUrl, sql }) => {
        await expect(
          withDatabaseEnvironment(databaseUrl, () => runDrizzleKitCommand('migrate')),
        ).resolves.toContain('migrations applied');
        const [table] = await sql<{ name: string | null }[]>`
          SELECT to_regclass('mail.email')::text AS name
        `;
        expect(table?.name).toBe('mail.email');
      },
      { applyMigrations: false },
    ));

  it('keeps push and migrate catalogs identical for every business schema', async () => {
    let pushedCatalog: Awaited<ReturnType<typeof readBusinessCatalog>> | undefined;
    let migratedCatalog: Awaited<ReturnType<typeof readBusinessCatalog>> | undefined;

    await withMailTestDatabase(
      async ({ databaseUrl, sql }) => {
        await withDatabaseEnvironment(databaseUrl, () => runDevelopmentPush([]));
        pushedCatalog = await readBusinessCatalog(sql);
      },
      { applyMigrations: false },
    );
    await withMailTestDatabase(
      async ({ databaseUrl, sql }) => {
        await withDatabaseEnvironment(databaseUrl, () => runDrizzleKitCommand('migrate'));
        migratedCatalog = await readBusinessCatalog(sql);
      },
      { applyMigrations: false },
    );

    expect(migratedCatalog).toEqual(pushedCatalog);
  });
});
