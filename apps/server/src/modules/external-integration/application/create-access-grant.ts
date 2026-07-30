import { createHash } from 'node:crypto';

import type { AccessGrantInput } from '../contracts/access';
import { ExternalIntegrationError } from '../errors';

export const EXTERNAL_LAUNCH_CODE_TTL_MS = 5 * 60_000;

export type CreateExternalAccessGrantRecord = {
  id: string;
  userId: string;
  codeDigest: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: null;
};

export interface ExternalAccessGrantWriter {
  findManagedUser(externalUserId: string): Promise<{ userId: string; role: string } | null>;
  hasActiveMailbox(userId: string): Promise<boolean>;
  createGrant(input: CreateExternalAccessGrantRecord): Promise<void>;
}

export type CreateAccessGrantDependencies = {
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
  const managedUser = await dependencies.repository.findManagedUser(input.externalUserId);
  if (managedUser === null || managedUser.role !== 'user') {
    throw new ExternalIntegrationError('EXTERNAL_USER_NOT_FOUND');
  }
  if (!(await dependencies.repository.hasActiveMailbox(managedUser.userId))) {
    throw new ExternalIntegrationError('ACTIVE_MAILBOX_NOT_FOUND');
  }

  const launchCode = generateExternalSecret(dependencies.randomBytes);
  const createdAt = dependencies.clock.now();
  await dependencies.repository.createGrant({
    id: dependencies.nextId(),
    userId: managedUser.userId,
    codeDigest: digestExternalSecret(launchCode),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + EXTERNAL_LAUNCH_CODE_TTL_MS),
    consumedAt: null,
  });
  return { launchCode };
};
