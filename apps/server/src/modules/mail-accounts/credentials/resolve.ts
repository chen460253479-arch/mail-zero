import {
  resolveNangoCredential,
  type NangoAuthorizationRecord,
  type NangoCredentialResolverOptions,
} from './nango';
import { decryptCredential } from '../../../infrastructure/security/credential-encryption';
import type { ResolvedCredential } from '../../../mail-channel/contracts';
import { readZeroOAuthSnapshot } from './zero-oauth';

type AuthSource = 'zero_oauth' | 'nango' | 'manual';

type AuthorizationCredentialRecord = {
  id?: string;
  authSource: AuthSource;
  encryptedCredentialSnapshot: string | null;
  accessTokenExpiresAt: Date | null;
  nangoConnectionId?: string | null;
  nangoProviderConfigKey?: string | null;
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
  dependencies: CredentialResolutionDependencies,
) => Promise<ResolvedCredential>;

export type CredentialResolutionDependencies = {
  nango?: NangoCredentialResolverOptions;
};

const resolveZeroOAuthCredential: CredentialResolver = async (authorization, encryptionKey) => {
  if (!authorization.encryptedCredentialSnapshot) {
    throw new Error('Encrypted mailbox credential is missing');
  }
  const value = await decryptCredential(authorization.encryptedCredentialSnapshot, encryptionKey);
  const snapshot = readZeroOAuthSnapshot(value);
  return {
    ...snapshot,
    expiresAt: authorization.accessTokenExpiresAt,
  };
};

const resolveRegisteredNangoCredential: CredentialResolver = async (
  authorization,
  encryptionKey,
  dependencies,
) => {
  if (!dependencies.nango) throw new Error('Nango credential resolver is not configured');
  if (!authorization.id) throw new Error('Nango authorization ID is missing');
  return await resolveNangoCredential(
    {
      ...authorization,
      id: authorization.id,
      authSource: 'nango',
      nangoConnectionId: authorization.nangoConnectionId ?? null,
      nangoProviderConfigKey: authorization.nangoProviderConfigKey ?? null,
    } satisfies NangoAuthorizationRecord,
    encryptionKey,
    dependencies.nango,
  );
};

const resolvers = {
  zero_oauth: resolveZeroOAuthCredential,
  nango: resolveRegisteredNangoCredential,
} satisfies Partial<Record<AuthSource, CredentialResolver>>;

export const resolveConnectionCredential = async (
  record: ConnectionCredentialRecord,
  encryptionKey: string,
  dependencies: CredentialResolutionDependencies = {},
): Promise<ResolvedCredential> => {
  if (record.connection.status !== 'connected') throw new Error('Mailbox is disconnected');
  if (!record.authorization) throw new Error('Mailbox authorization is missing');

  const resolver = resolvers[record.authorization.authSource as keyof typeof resolvers];
  if (!resolver) {
    throw new Error(`Unsupported authorization source: ${record.authorization.authSource}`);
  }
  return await resolver(record.authorization, encryptionKey, dependencies);
};
