import type { ResolvedCredential } from '../mail-channel/types';
import { decryptCredential } from './encryption';
import { readZeroOAuthSnapshot } from './zero-oauth';

type AuthSource = 'zero_oauth' | 'nango' | 'manual';

type AuthorizationCredentialRecord = {
  authSource: AuthSource;
  encryptedCredentialSnapshot: string | null;
  accessTokenExpiresAt: Date | null;
};

export type ConnectionCredentialRecord = {
  connection: {
    status: 'connected' | 'disconnected' | 'reconnect_required' | 'deleting';
  };
  authorization: AuthorizationCredentialRecord | null;
};

type CredentialResolver = (
  authorization: AuthorizationCredentialRecord,
  encryptionKey: string,
) => Promise<ResolvedCredential>;

const resolveZeroOAuthCredential: CredentialResolver = async (
  authorization,
  encryptionKey,
) => {
  if (!authorization.encryptedCredentialSnapshot) {
    throw new Error('Encrypted mailbox credential is missing');
  }
  const value = await decryptCredential(
    authorization.encryptedCredentialSnapshot,
    encryptionKey,
  );
  const snapshot = readZeroOAuthSnapshot(value);
  return {
    ...snapshot,
    expiresAt: authorization.accessTokenExpiresAt,
  };
};

const resolvers = {
  zero_oauth: resolveZeroOAuthCredential,
} satisfies Partial<Record<AuthSource, CredentialResolver>>;

export const resolveConnectionCredential = async (
  record: ConnectionCredentialRecord,
  encryptionKey: string,
): Promise<ResolvedCredential> => {
  if (record.connection.status !== 'connected') throw new Error('Mailbox is disconnected');
  if (!record.authorization) throw new Error('Mailbox authorization is missing');

  const resolver = resolvers[record.authorization.authSource as keyof typeof resolvers];
  if (!resolver) {
    throw new Error(`Unsupported authorization source: ${record.authorization.authSource}`);
  }
  return await resolver(record.authorization, encryptionKey);
};
