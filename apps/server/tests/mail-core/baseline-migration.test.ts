import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationRoot = resolve(import.meta.dirname, '../../src/db/migrations');

describe('development database baseline', () => {
  it('contains one schema-only migration and one matching snapshot', () => {
    const sqlFiles = readdirSync(migrationRoot).filter((name) => /^\d{4}_.+\.sql$/u.test(name));
    const snapshotFiles = readdirSync(resolve(migrationRoot, 'meta')).filter((name) =>
      /^\d{4}_snapshot\.json$/u.test(name),
    );
    const journal = JSON.parse(
      readFileSync(resolve(migrationRoot, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { idx: number; tag: string }[];
    };

    expect(sqlFiles).toHaveLength(1);
    expect(snapshotFiles).toEqual(['0000_snapshot.json']);
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0]?.idx).toBe(0);

    const migrationSql = readFileSync(resolve(migrationRoot, sqlFiles[0]!), 'utf8');
    for (const schemaName of ['auth', 'app', 'integration', 'mail']) {
      expect(migrationSql).toContain(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    }
    expect(migrationSql).not.toContain('mail0_');
    expect(migrationSql).not.toMatch(/\bINSERT\s+INTO\b/iu);
  });
});
