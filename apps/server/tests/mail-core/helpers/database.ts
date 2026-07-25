import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import postgres, { type Sql } from 'postgres';

import { PostgresMailUnitOfWork } from '../../../src/modules/mail/postgres/postgres-unit-of-work';
import { createDrizzle, type DB } from '../../../src/db';

const SAFE_SCHEMA = /^mail_core_test_[a-f0-9]{32}$/;

const requireSafeSchema = (schemaName: string): void => {
  if (!SAFE_SCHEMA.test(schemaName)) {
    throw new Error('Unsafe mail-core test schema name');
  }
};

const parseDatabaseUrl = (contents: string): string | undefined => {
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*?)\s*$/u.exec(line);
    if (match === null) continue;
    const raw = match[1]!;
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return undefined;
};

const resolveDatabaseUrl = (): string => {
  if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL.length > 0) {
    return process.env.DATABASE_URL;
  }
  const devVars = resolve(import.meta.dirname, '../../../.dev.vars');
  const fromFile = existsSync(devVars)
    ? parseDatabaseUrl(readFileSync(devVars, 'utf8'))
    : undefined;
  if (fromFile === undefined || fromFile.length === 0) {
    throw new Error('DATABASE_URL is required for mail-core integration tests');
  }
  return fromFile;
};

const migrationTags = (migrationsFolder: string): string[] => {
  const journal = JSON.parse(
    readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries?: { tag?: unknown }[] };
  return (journal.entries ?? []).map(({ tag }) => {
    if (typeof tag !== 'string' || !/^[a-z0-9_]+$/u.test(tag)) {
      throw new Error('Invalid generated migration journal entry');
    }
    return tag;
  });
};

const applyGeneratedMigrations = async (connection: Sql, schemaName: string): Promise<void> => {
  requireSafeSchema(schemaName);
  const migrationsFolder = resolve(import.meta.dirname, '../../../src/db/migrations');
  const quotedSchema = `"${schemaName}".`;
  for (const tag of migrationTags(migrationsFolder)) {
    const migration = readFileSync(resolve(migrationsFolder, `${tag}.sql`), 'utf8').replaceAll(
      '"public".',
      quotedSchema,
    );
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (statement.trim().length > 0) {
        await connection.unsafe(statement);
      }
    }
  }
};

export const runFailureIndependentCleanup = async (
  actions: (() => Promise<void>)[],
  primaryFailure: boolean,
): Promise<void> => {
  let cleanupError: unknown;
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (!primaryFailure && cleanupError !== undefined) {
    throw cleanupError;
  }
};

export const withMailTestDatabase = async (
  test: (input: {
    db: DB;
    unitOfWork: PostgresMailUnitOfWork;
    schemaName: string;
  }) => Promise<void>,
): Promise<void> => {
  const databaseUrl = resolveDatabaseUrl();
  const schemaName = `mail_core_test_${randomBytes(16).toString('hex')}`;
  requireSafeSchema(schemaName);
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  let isolated: Sql | null = null;
  let created = false;
  let primaryFailure = false;
  try {
    requireSafeSchema(schemaName);
    await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
    created = true;
    const isolatedUrl = new URL(databaseUrl);
    const existingOptions = isolatedUrl.searchParams.get('options');
    isolatedUrl.searchParams.set(
      'options',
      `${existingOptions === null ? '' : `${existingOptions} `}-csearch_path=${schemaName}`,
    );
    isolated = postgres(isolatedUrl.toString(), { max: 10, onnotice: () => undefined });
    await applyGeneratedMigrations(isolated, schemaName);
    const db = createDrizzle(isolated);
    await test({
      db,
      unitOfWork: new PostgresMailUnitOfWork(db),
      schemaName,
    });
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    await runFailureIndependentCleanup(
      [
        async () => {
          if (isolated !== null) {
            await isolated.end();
          }
        },
        async () => {
          if (created) {
            requireSafeSchema(schemaName);
            await admin.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
          }
        },
        () => admin.end(),
      ],
      primaryFailure,
    );
  }
};
