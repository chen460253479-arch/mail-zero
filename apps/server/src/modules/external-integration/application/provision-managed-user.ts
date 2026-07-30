import { createHash } from 'node:crypto';

import { externalUserIdSchema } from '../contracts/bind';
import { ExternalIntegrationError } from '../errors';

export type ManagedUserRecord = {
  userId: string;
  role: string;
};

export type CreateManagedUserRecord = {
  userId: string;
  externalUserId: string;
  name: string;
  email: string;
  role: 'user';
  emailVerified: true;
  mustChangePassword: true;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface ManagedUserRepository {
  findByExternalUserId(externalUserId: string): Promise<ManagedUserRecord | null>;
  create(record: CreateManagedUserRecord): Promise<boolean>;
}

export type ProvisionManagedUserDependencies = {
  repository: ManagedUserRepository;
  hashPassword(password: string): Promise<string>;
  now(): Date;
  newId(): string;
};

const requireOrdinaryUser = (record: ManagedUserRecord | null): ManagedUserRecord | null => {
  if (record !== null && record.role !== 'user') {
    throw new ExternalIntegrationError('EXTERNAL_USER_INVALID');
  }
  return record;
};

export const provisionManagedUser = async (
  input: { externalUserId: string },
  dependencies: ProvisionManagedUserDependencies,
): Promise<{ userId: string; created: boolean }> => {
  const parsed = externalUserIdSchema.safeParse(input.externalUserId);
  if (!parsed.success) {
    throw new ExternalIntegrationError('EXTERNAL_USER_INVALID');
  }
  const externalUserId = parsed.data;
  const existing = requireOrdinaryUser(
    await dependencies.repository.findByExternalUserId(externalUserId),
  );
  if (existing !== null) {
    return { userId: existing.userId, created: false };
  }

  const now = dependencies.now();
  const userId = dependencies.newId();
  const digest = createHash('sha256').update(externalUserId).digest('hex');
  const created = await dependencies.repository.create({
    userId,
    externalUserId,
    name: externalUserId,
    email: `managed-${digest}@zero.invalid`,
    role: 'user',
    emailVerified: true,
    mustChangePassword: true,
    passwordHash: await dependencies.hashPassword(externalUserId),
    createdAt: now,
    updatedAt: now,
  });
  if (created) return { userId, created: true };

  const winner = requireOrdinaryUser(
    await dependencies.repository.findByExternalUserId(externalUserId),
  );
  if (winner === null) {
    throw new ExternalIntegrationError('EXTERNAL_USER_INVALID');
  }
  return { userId: winner.userId, created: false };
};
