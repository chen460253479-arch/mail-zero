import { createInterface } from 'node:readline/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import postgres, { type Sql } from 'postgres';

import {
  DevelopmentPushError,
  ZERO_SCHEMA_NAMES,
  decideDevelopmentPush,
  pushOutputContainsError,
  sanitizedDatabaseTarget,
  type ExistingSchema,
  type PushDecision,
} from './development-push';

type SchemaCountRow = {
  schema_name: string;
  table_count: number;
};

export const inspectZeroSchemas = async (sql: Sql): Promise<ExistingSchema[]> => {
  const rows = await sql<SchemaCountRow[]>`
    SELECT
      table_schema AS schema_name,
      count(*)::integer AS table_count
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('auth', 'app', 'integration', 'mail')
    GROUP BY table_schema
    ORDER BY table_schema
  `;

  return rows.map(({ schema_name: schemaName, table_count: tableCount }) => {
    const knownSchema = ZERO_SCHEMA_NAMES.find((candidate) => candidate === schemaName);
    if (knownSchema === undefined) {
      throw new DevelopmentPushError(`Unexpected Zero schema: ${schemaName}`);
    }
    return { schemaName: knownSchema, tableCount };
  });
};

export const resetZeroSchemas = async (sql: Sql): Promise<void> => {
  await sql.begin(async (transaction) => {
    await transaction.unsafe('DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations" CASCADE');
    for (const schemaName of ZERO_SCHEMA_NAMES) {
      await transaction.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    }
  });
};

const parseArguments = (argv: string[]): { reset: boolean; yes: boolean } => {
  const unknown = argv.filter((argument) => argument !== '--reset' && argument !== '--yes');
  if (unknown.length > 0) {
    throw new DevelopmentPushError(`Unknown db:push argument: ${unknown.join(', ')}`);
  }
  return {
    reset: argv.includes('--reset'),
    yes: argv.includes('--yes'),
  };
};

const describeExisting = (existing: ExistingSchema[]): string =>
  existing.map(({ schemaName, tableCount }) => `${schemaName}: ${tableCount}`).join(', ');

const confirmReset = async (existing: ExistingSchema[]): Promise<boolean> => {
  process.stdout.write(`Existing Zero tables detected (${describeExisting(existing)}).\n`);
  process.stdout.write(
    'Reset removes auth/app/integration/mail data and development migration metadata.\n',
  );
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Clear and reinitialize these schemas? [y/N] ');
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    prompt.close();
  }
};

const require = createRequire(import.meta.url);

export const runDrizzleKitCommand = async (command: 'push' | 'migrate'): Promise<string> => {
  const drizzleKitEntry = require.resolve('drizzle-kit');
  const drizzleKitCli = resolve(dirname(drizzleKitEntry), 'bin.cjs');
  const child = spawn(process.execPath, [drizzleKitCli, command], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0 || pushOutputContainsError(output)) {
    throw new DevelopmentPushError(
      `Drizzle ${command} failed${exitCode === 0 ? ' despite reporting exit code 0' : ` with exit code ${exitCode}`}.`,
    );
  }
  return output;
};

const resolvePromptDecision = async (decision: PushDecision): Promise<PushDecision> => {
  if (decision.action !== 'prompt') return decision;
  return (await confirmReset(decision.existing))
    ? { action: 'reset', existing: decision.existing }
    : { action: 'cancel' };
};

export const runDevelopmentPush = async (argv: string[]): Promise<void> => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DevelopmentPushError('DATABASE_URL is required.');
  }
  const flags = parseArguments(argv);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  let decision: PushDecision;
  try {
    const existing = await inspectZeroSchemas(sql);
    process.stdout.write(`Target database: ${sanitizedDatabaseTarget(databaseUrl)}\n`);
    decision = await resolvePromptDecision(
      decideDevelopmentPush(existing, {
        ...flags,
        production: process.env.NODE_ENV === 'production',
        interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
      }),
    );
    if (decision.action === 'cancel') {
      process.stdout.write('Database unchanged.\n');
      return;
    }
    if (decision.action === 'reset') {
      await resetZeroSchemas(sql);
    }
  } finally {
    await sql.end();
  }

  await runDrizzleKitCommand('push');
};

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  void runDevelopmentPush(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`db:push failed: ${message}\n`);
    process.exitCode = 1;
  });
}
