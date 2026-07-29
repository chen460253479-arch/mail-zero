import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationRoot = resolve(import.meta.dirname, '../../../src/db/migrations');

describe('development database baseline', () => {
  it('keeps one schema baseline and ordered matching incremental migrations', () => {
    const sqlFiles = readdirSync(migrationRoot)
      .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
      .sort();
    const snapshotFiles = readdirSync(resolve(migrationRoot, 'meta'))
      .filter((name) => /^\d{4}_snapshot\.json$/u.test(name))
      .sort();
    const journal = JSON.parse(
      readFileSync(resolve(migrationRoot, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { idx: number; tag: string }[];
    };

    expect(sqlFiles[0]).toMatch(/^0000_.+\.sql$/u);
    expect(sqlFiles.filter((name) => name.startsWith('0000_'))).toHaveLength(1);
    expect(snapshotFiles).toEqual(sqlFiles.map((name) => `${name.slice(0, 4)}_snapshot.json`));
    expect(journal.entries).toHaveLength(sqlFiles.length);
    expect(journal.entries.map(({ idx }) => idx)).toEqual(sqlFiles.map((_, index) => index));
    expect(journal.entries.map(({ tag }) => tag)).toEqual(
      sqlFiles.map((name) => name.replace(/\.sql$/u, '')),
    );

    const migrationSql = readFileSync(resolve(migrationRoot, sqlFiles[0]!), 'utf8');
    for (const schemaName of ['auth', 'app', 'integration', 'mail']) {
      expect(migrationSql).toContain(`CREATE SCHEMA "${schemaName}"`);
    }
    for (const file of sqlFiles) {
      const source = readFileSync(resolve(migrationRoot, file), 'utf8');
      expect(source).not.toContain('mail0_');
      expect(source).not.toMatch(/\bINSERT\s+INTO\b/iu);
    }
  });
});
