const MAX_CAUSE_DEPTH = 8;

type ErrorRecord = Record<string, unknown>;

const asRecord = (value: unknown): ErrorRecord | null =>
  typeof value === 'object' && value !== null ? (value as ErrorRecord) : null;

const stringField = (record: ErrorRecord, key: string): string | null => {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const integerField = (record: ErrorRecord, key: string): number | null => {
  const raw = record[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
};

export type OutboundFailureLogDetails = {
  errorName: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorStack: string | null;
  sourceErrorCode: string | null;
  smtpCommand: string | null;
  smtpResponseCode: number | null;
  smtpResponse: string | null;
};

export const outboundFailureLogDetails = (error: unknown): OutboundFailureLogDetails => {
  const result: OutboundFailureLogDetails = {
    errorName: null,
    errorCode: null,
    errorMessage: null,
    errorStack: null,
    sourceErrorCode: null,
    smtpCommand: null,
    smtpResponseCode: null,
    smtpResponse: null,
  };
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;
  while (current !== null && current !== undefined && depth < MAX_CAUSE_DEPTH) {
    if (seen.has(current)) break;
    seen.add(current);
    const record = asRecord(current);
    if (record === null) {
      if (result.errorMessage === null && typeof current === 'string') {
        result.errorMessage = current;
      }
      break;
    }
    const name = stringField(record, 'name');
    const code = stringField(record, 'code');
    const message = stringField(record, 'message');
    const stack = stringField(record, 'stack');
    const command = stringField(record, 'command');
    const responseCode = integerField(record, 'responseCode');
    const response = stringField(record, 'response');
    result.errorName ??= name;
    result.errorCode ??= code;
    result.sourceErrorCode = code ?? result.sourceErrorCode;
    result.errorMessage = message ?? result.errorMessage;
    result.errorStack ??= stack;
    result.smtpCommand = command ?? result.smtpCommand;
    result.smtpResponseCode = responseCode ?? result.smtpResponseCode;
    result.smtpResponse = response ?? result.smtpResponse;
    current = record.cause;
    depth += 1;
  }
  return result;
};
