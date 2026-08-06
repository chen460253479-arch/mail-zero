export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Readonly<Record<string, unknown>>;
export type LogMethod = (event: string, fields?: LogFields) => void;

export type Logger = {
  readonly level: LogLevel;
  child(bindings: LogFields): Logger;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};

export type LogSink = (level: Exclude<LogLevel, 'silent'>, line: string) => void;

type CreateLoggerInput = {
  level: LogLevel;
  bindings?: LogFields;
  now?: () => Date;
  sink?: LogSink;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: Number.POSITIVE_INFINITY,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

const REDACTED = '[REDACTED]';
const MAX_NORMALIZE_DEPTH = 6;
const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|signature|token|credential|raw[_-]?body|html|subject|sender|recipient|from(?:address)?|to(?:address)?|cc(?:address)?|bcc(?:address)?|attachment|access[_-]?key|api[_-]?key)/iu;

const defaultSink: LogSink = (level, line) => {
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  if (level === 'info') {
    console.info(line);
    return;
  }
  console.debug(line);
};

const errorCode = (error: Error): string | undefined => {
  const candidate = (error as Error & { code?: unknown }).code;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
};

const normalize = (value: unknown, seen: WeakSet<object>, depth = 0): unknown => {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      ...(errorCode(value) === undefined ? {} : { code: errorCode(value) }),
    };
  }
  if (depth >= MAX_NORMALIZE_DEPTH) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => normalize(entry, seen, depth + 1));
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    normalized[key] =
      SENSITIVE_KEY.test(key) && typeof entry !== 'boolean'
        ? REDACTED
        : normalize(entry, seen, depth + 1);
  }
  return normalized;
};

const normalizeFields = (fields: LogFields): Record<string, unknown> =>
  normalize(fields, new WeakSet()) as Record<string, unknown>;

export const createLogger = ({
  level,
  bindings = {},
  now = () => new Date(),
  sink = defaultSink,
}: CreateLoggerInput): Logger => {
  const write = (
    recordLevel: Exclude<LogLevel, 'silent'>,
    event: string,
    fields: LogFields = {},
  ) => {
    if (LEVEL_PRIORITY[recordLevel] < LEVEL_PRIORITY[level]) return;
    const record = normalizeFields({
      ...bindings,
      ...fields,
      timestamp: now().toISOString(),
      level: recordLevel,
      event,
    });
    sink(recordLevel, JSON.stringify(record));
  };

  return {
    level,
    child: (childBindings) =>
      createLogger({ level, bindings: { ...bindings, ...childBindings }, now, sink }),
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
};

export const createNoopLogger = (): Logger => createLogger({ level: 'silent' });
