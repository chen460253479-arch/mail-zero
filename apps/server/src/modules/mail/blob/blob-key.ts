import { MailCoreError, type BlobKind, type MailAccountId } from '@zero/mail-core';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TEMPORARY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

const invalidKey = (): never => {
  throw new MailCoreError('INVALID_BLOB_KEY');
};

export const requireMailAccountId = (value: string): MailAccountId =>
  SAFE_ID.test(value) ? (value as MailAccountId) : invalidKey();

export const requireUserId = (value: string): string =>
  SAFE_ID.test(value) ? value : invalidKey();

export const requireSha256 = (value: string): string => (SHA256.test(value) ? value : invalidKey());

const DIRECTORY_BY_KIND: Record<BlobKind, string> = {
  attachment: 'attachments',
  draft_mime: 'drafts',
  message_mime: 'messages',
};

const KIND_BY_DIRECTORY = new Map(
  Object.entries(DIRECTORY_BY_KIND).map(([kind, directory]) => [directory, kind as BlobKind]),
);

const requireBlobKind = (value: string): BlobKind => {
  if (value === 'attachment' || value === 'draft_mime' || value === 'message_mime') return value;
  return invalidKey();
};

export const buildObjectKey = (
  userId: string,
  accountId: MailAccountId,
  kind: BlobKind,
  sha256: string,
): string => {
  const safeUserId = requireUserId(userId);
  const safeAccountId = requireMailAccountId(accountId);
  const safeSha256 = requireSha256(sha256);
  return `mail/users/${safeUserId}/accounts/${safeAccountId}/${DIRECTORY_BY_KIND[kind]}/sha256/${safeSha256.slice(0, 2)}/${safeSha256}`;
};

export const buildObjectPrefix = (
  userId: string,
  accountId: MailAccountId,
  kind: BlobKind,
): string =>
  `mail/users/${requireUserId(userId)}/accounts/${requireMailAccountId(accountId)}/${DIRECTORY_BY_KIND[kind]}/sha256/`;

export const parseObjectKey = (
  key: string,
): { userId: string; accountId: MailAccountId; kind: BlobKind; sha256: string } => {
  const match =
    /^mail\/users\/([^/]+)\/accounts\/([^/]+)\/([^/]+)\/sha256\/([^/]+)\/([^/]+)$/u.exec(key);
  if (match === null) return invalidKey();
  const userId = requireUserId(match[1]!);
  const accountId = requireMailAccountId(match[2]!);
  const kind = KIND_BY_DIRECTORY.get(match[3]!) ?? invalidKey();
  const shard = match[4]!;
  const sha256 = requireSha256(match[5]!);
  if (shard !== sha256.slice(0, 2)) invalidKey();
  return { userId, accountId, kind, sha256 };
};

export const buildTemporaryKey = (
  userId: string,
  accountId: MailAccountId,
  kind: BlobKind,
): string => {
  const safeUserId = requireUserId(userId);
  const safeAccountId = requireMailAccountId(accountId);
  return `mail/users/${safeUserId}/accounts/${safeAccountId}/temporary/${kind}/${crypto.randomUUID()}`;
};

export const buildTemporaryPrefix = (
  userId: string,
  accountId: MailAccountId,
  kind?: BlobKind,
): string =>
  `mail/users/${requireUserId(userId)}/accounts/${requireMailAccountId(accountId)}/temporary/${kind === undefined ? '' : `${kind}/`}`;

export const parseTemporaryKey = (
  key: string,
): { userId: string; accountId: MailAccountId; kind: BlobKind } => {
  const match = /^mail\/users\/([^/]+)\/accounts\/([^/]+)\/temporary\/([^/]+)\/([^/]+)$/u.exec(key);
  if (match === null || !TEMPORARY_ID.test(match[4]!)) return invalidKey();
  return {
    userId: requireUserId(match[1]!),
    accountId: requireMailAccountId(match[2]!),
    kind: requireBlobKind(match[3]!),
  };
};

export const requireObjectKeyForAccount = (
  accountId: MailAccountId,
  objectKey: string,
): { userId: string; accountId: MailAccountId; kind: BlobKind; sha256: string } => {
  const safeAccountId = requireMailAccountId(accountId);
  const parsed = parseObjectKey(objectKey);
  if (parsed.accountId !== safeAccountId) return invalidKey();
  return parsed;
};

export const requireTemporaryKeyForAccount = (
  accountId: MailAccountId,
  temporaryKey: string,
): { userId: string; accountId: MailAccountId; kind: BlobKind } => {
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
