import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import * as localMailSchema from '../../src/modules/mail/postgres/schema';
import { withMailTestDatabase } from './helpers/database';

describe('local mail PostgreSQL catalog', () => {
  it('uses the mail0_ prefix for every local-mail table', () =>
    withMailTestDatabase(async ({ db, schemaName }) => {
      const rows = (await db.execute<{
        tablename: string;
      }>(sql`select tablename from pg_tables where schemaname = ${schemaName}`)) as unknown as {
        tablename: string;
      }[];
      const catalog = new Set(rows.map(({ tablename }) => tablename));
      for (const [exportName, table] of Object.entries(localMailSchema)) {
        const tableName = getTableConfig(table).name;
        expect(tableName, exportName).toMatch(/^mail0_/u);
        expect(catalog.has(tableName), exportName).toBe(true);
        expect(catalog.has(tableName.slice('mail0_'.length)), exportName).toBe(false);
      }
    }));
});
