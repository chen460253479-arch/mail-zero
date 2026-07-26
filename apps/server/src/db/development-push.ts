export const ZERO_SCHEMA_NAMES = ['auth', 'app', 'integration', 'mail'] as const;

export type ZeroSchemaName = (typeof ZERO_SCHEMA_NAMES)[number];

export type ExistingSchema = {
  schemaName: ZeroSchemaName;
  tableCount: number;
};

export type PushOptions = {
  reset: boolean;
  yes: boolean;
  production: boolean;
  interactive: boolean;
};

export type PushDecision =
  | { action: 'initialize' }
  | { action: 'prompt'; existing: ExistingSchema[] }
  | { action: 'reset'; existing: ExistingSchema[] }
  | { action: 'cancel' };

export class DevelopmentPushError extends Error {
  override readonly name = 'DevelopmentPushError';
}

export const decideDevelopmentPush = (
  existing: ExistingSchema[],
  options: PushOptions,
): PushDecision => {
  if (options.production) {
    if (existing.length > 0 && options.reset && options.yes) {
      throw new DevelopmentPushError(
        'Refusing to reset Zero schemas when NODE_ENV=production.',
      );
    }
    throw new DevelopmentPushError(
      'Refusing to initialize or reset Zero schemas when NODE_ENV=production; use db:migrate.',
    );
  }

  if (existing.length === 0) {
    return { action: 'initialize' };
  }

  if (options.reset && options.yes) {
    return { action: 'reset', existing };
  }

  if (options.interactive) {
    return { action: 'prompt', existing };
  }

  throw new DevelopmentPushError(
    'Existing Zero schemas require both --reset and --yes in a non-interactive environment.',
  );
};

export const sanitizedDatabaseTarget = (databaseUrl: string): string => {
  const parsed = new URL(databaseUrl);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
};

const ANSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const PUSH_ERROR =
  /\bPostgresError\b|\bERR_PNPM\b|\bELIFECYCLE\b|(?:^|\n)\s*(?:error|cause):/iu;

export const pushOutputContainsError = (output: string): boolean =>
  PUSH_ERROR.test(output.replace(ANSI_SEQUENCE, ''));
