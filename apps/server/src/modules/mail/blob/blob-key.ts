import { MailCoreError, type MailAccountId } from '@zero/mail-core';

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TEMPORARY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

const invalidKey = (): never => {
  throw new MailCoreError('INVALID_BLOB_KEY');
};

export const requireMailAccountId = (value: string): MailAccountId =>
  ACCOUNT_ID.test(value) ? (value as MailAccountId) : invalidKey();

export const requireSha256 = (value: string): string => (SHA256.test(value) ? value : invalidKey());

export const buildObjectKey = (accountId: MailAccountId, sha256: string): string => {
  const safeAccountId = requireMailAccountId(accountId);
  const safeSha256 = requireSha256(sha256);
  return `mail/${safeAccountId}/sha256/${safeSha256.slice(0, 2)}/${safeSha256}`;
};

export const buildObjectPrefix = (accountId: MailAccountId): string =>
  `mail/${requireMailAccountId(accountId)}/sha256/`;

export const parseObjectKey = (key: string): { accountId: MailAccountId; sha256: string } => {
  const match = /^mail\/([^/]+)\/sha256\/([^/]+)\/([^/]+)$/u.exec(key);
  if (match === null) return invalidKey();
  const accountId = requireMailAccountId(match[1]!);
  const shard = match[2]!;
  const sha256 = requireSha256(match[3]!);
  if (shard !== sha256.slice(0, 2)) invalidKey();
  return { accountId, sha256 };
};

export const buildTemporaryKey = (accountId: MailAccountId): string => {
  const safeAccountId = requireMailAccountId(accountId);
  return `mail/${safeAccountId}/temporary/${crypto.randomUUID()}`;
};

export const buildTemporaryPrefix = (accountId: MailAccountId): string =>
  `mail/${requireMailAccountId(accountId)}/temporary/`;

export const parseTemporaryKey = (key: string): { accountId: MailAccountId } => {
  const match = /^mail\/([^/]+)\/temporary\/([^/]+)$/u.exec(key);
  if (match === null || !TEMPORARY_ID.test(match[2]!)) return invalidKey();
  return { accountId: requireMailAccountId(match[1]!) };
};

export const requireObjectKeyForAccount = (
  accountId: MailAccountId,
  objectKey: string,
): { accountId: MailAccountId; sha256: string } => {
  const safeAccountId = requireMailAccountId(accountId);
  const parsed = parseObjectKey(objectKey);
  if (parsed.accountId !== safeAccountId) return invalidKey();
  return parsed;
};

export const requireTemporaryKeyForAccount = (
  accountId: MailAccountId,
  temporaryKey: string,
): { accountId: MailAccountId } => {
  const safeAccountId = requireMailAccountId(accountId);
  const parsed = parseTemporaryKey(temporaryKey);
  if (parsed.accountId !== safeAccountId) return invalidKey();
  return parsed;
};

export const copyBytes = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);

export const calculateSha256 = async (bytes: Uint8Array): Promise<string> => {
  try {
    const digest = await crypto.subtle.digest('SHA-256', copyBytes(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    throw new MailCoreError('BLOB_STORE_FAILURE');
  }
};

export const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
