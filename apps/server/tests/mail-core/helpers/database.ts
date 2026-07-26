import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import postgres, { type Sql } from 'postgres';

import { PostgresMailUnitOfWork } from '../../../src/modules/mail/postgres/postgres-unit-of-work';
import { createDrizzle, type DB } from '../../../src/db';

const SAFE_DATABASE = /^mail_core_test_[a-f0-9]{32}$/;

export const requireSafeDatabase = (databaseName: string): void => {
  if (!SAFE_DATABASE.test(databaseName)) {
    throw new Error('Unsafe mail-core test database name');
  }
};

export const databaseUrlFor = (databaseUrl: string, databaseName: string): string => {
  requireSafeDatabase(databaseName);
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  return isolatedUrl.toString();
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

const applyGeneratedMigrations = async (connection: Sql): Promise<void> => {
  const migrationsFolder = resolve(import.meta.dirname, '../../../src/db/migrations');
  for (const tag of migrationTags(migrationsFolder)) {
    const migration = readFileSync(resolve(migrationsFolder, `${tag}.sql`), 'utf8');
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
    sql: Sql;
    unitOfWork: PostgresMailUnitOfWork;
    databaseUrl: string;
  }) => Promise<void>,
  options: { applyMigrations?: boolean } = {},
): Promise<void> => {
  const databaseUrl = resolveDatabaseUrl();
  const databaseName = `mail_core_test_${randomBytes(16).toString('hex')}`;
  requireSafeDatabase(databaseName);
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  let isolated: Sql | null = null;
  let created = false;
  let primaryFailure = false;
  try {
    requireSafeDatabase(databaseName);
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    isolated = postgres(databaseUrlFor(databaseUrl, databaseName), {
      max: 10,
      onnotice: () => undefined,
    });
    if (options.applyMigrations !== false) {
      await applyGeneratedMigrations(isolated);
    }
    const isolatedDatabaseUrl = databaseUrlFor(databaseUrl, databaseName);
    const db = createDrizzle(isolated);
    await test({
      db,
      sql: isolated,
      unitOfWork: new PostgresMailUnitOfWork(db),
      databaseUrl: isolatedDatabaseUrl,
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
            requireSafeDatabase(databaseName);
            await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
          }
        },
        () => admin.end(),
      ],
      primaryFailure,
    );
  }
};
