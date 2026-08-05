export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type VersionedProviderState = {
  version: number;
  [key: string]: JsonValue;
};

export type IngressScope = {
  version: 1;
  mailboxRoles: ['inbox'];
  initialSync: 'none';
  externalData?: JsonValue;
};

const DEFAULT_INGRESS_SCOPE: IngressScope = {
  version: 1,
  mailboxRoles: ['inbox'],
  initialSync: 'none',
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
};

export const parseVersionedProviderState = (value: unknown): VersionedProviderState => {
  const version =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as { version?: unknown }).version
      : undefined;
  if (
    !isJsonValue(value) ||
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new Error('MAIL_SYNC_INVALID_PROVIDER_STATE');
  }
  return value as VersionedProviderState;
};

export const parseIngressScope = (value: unknown = DEFAULT_INGRESS_SCOPE): IngressScope => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1 ||
    (value as { initialSync?: unknown }).initialSync !== 'none'
  ) {
    throw new Error('MAIL_SYNC_UNSUPPORTED_SCOPE');
  }

  const mailboxRoles = (value as { mailboxRoles?: unknown }).mailboxRoles;
  if (!Array.isArray(mailboxRoles) || mailboxRoles.length !== 1 || mailboxRoles[0] !== 'inbox') {
    throw new Error('MAIL_SYNC_UNSUPPORTED_SCOPE');
  }

  const externalData = (value as { externalData?: unknown }).externalData;
  if (externalData !== undefined && !isJsonValue(externalData)) {
    throw new Error('MAIL_SYNC_UNSUPPORTED_SCOPE');
  }

  return {
    version: 1,
    mailboxRoles: ['inbox'],
    initialSync: 'none',
    ...(externalData === undefined ? {} : { externalData }),
  };
};
