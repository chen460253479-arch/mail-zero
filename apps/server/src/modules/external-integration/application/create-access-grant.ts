import { createHash } from 'node:crypto';

import type { AccessGrantInput, GrantedMailboxScope } from '../contracts/access';
import type { IntegrationPrincipal } from '../principal';
import { ExternalIntegrationError } from '../errors';

export const EXTERNAL_LAUNCH_CODE_TTL_MS = 5 * 60_000;

export type CreateExternalAccessGrantRecord = {
  id: string;
  ownerUserId: IntegrationPrincipal['userId'];
  codeDigest: string;
  scopes: GrantedMailboxScope[];
  createdAt: Date;
  expiresAt: Date;
  consumedAt: null;
};

export interface ExternalAccessGrantWriter {
  resolveMailboxScopes(input: {
    ownerUserId: IntegrationPrincipal['userId'];
    nangoConnectionIds: string[];
  }): Promise<GrantedMailboxScope[]>;
  createGrant(input: CreateExternalAccessGrantRecord): Promise<void>;
}

export type CreateAccessGrantDependencies = {
  ownerUserId: IntegrationPrincipal['userId'];
  repository: ExternalAccessGrantWriter;
  clock: {
    now(): Date;
  };
  nextId(): string;
  randomBytes(size: number): Uint8Array;
};

export const digestExternalSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export const generateExternalSecret = (randomBytes: (size: number) => Uint8Array): string => {
  const bytes = randomBytes(32);
  if (bytes.byteLength !== 32) {
    throw new Error('EXTERNAL_SECRET_INVALID_LENGTH');
  }
  return Buffer.from(bytes).toString('base64url');
};

export const createAccessGrant = async (
  input: AccessGrantInput,
  dependencies: CreateAccessGrantDependencies,
): Promise<{ launchCode: string }> => {
  const resolved = await dependencies.repository.resolveMailboxScopes({
    ownerUserId: dependencies.ownerUserId,
    nangoConnectionIds: input.allowedNangoConnectIds,
  });
  const byNangoId = new Map<string, GrantedMailboxScope[]>();
  for (const scope of resolved) {
    const matches = byNangoId.get(scope.nangoConnectionId) ?? [];
    matches.push(scope);
    byNangoId.set(scope.nangoConnectionId, matches);
  }
  const scopes = input.allowedNangoConnectIds.map((nangoConnectionId) => {
    const matches = byNangoId.get(nangoConnectionId);
    if (matches?.length !== 1) {
      throw new ExternalIntegrationError('NANGO_CONNECTION_NOT_BOUND');
    }
    return matches[0]!;
  });

  const launchCode = generateExternalSecret(dependencies.randomBytes);
  const createdAt = dependencies.clock.now();
  await dependencies.repository.createGrant({
    id: dependencies.nextId(),
    ownerUserId: dependencies.ownerUserId,
    codeDigest: digestExternalSecret(launchCode),
    scopes,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + EXTERNAL_LAUNCH_CODE_TTL_MS),
    consumedAt: null,
  });
  return { launchCode };
};
