import { describe, expect, it, vi } from 'vitest';

import type { CreateExternalAccessGrantRecord } from '../../../../../src/modules/external-integration/application/create-access-grant';
import { createAccessGrant } from '../../../../../src/modules/external-integration/application/create-access-grant';
import { accessGrantInputSchema } from '../../../../../src/modules/external-integration/contracts/access';

const now = new Date('2026-07-30T10:00:00.000Z');

const createDependencies = (
  managedUser: { userId: string; role: string } | null = {
    userId: 'managed-user-1',
    role: 'user',
  },
  hasActiveMailbox = true,
) => {
  const repository = {
    findManagedUser: vi.fn(async () => managedUser),
    hasActiveMailbox: vi.fn(async () => hasActiveMailbox),
    createGrant: vi.fn(async (_input: CreateExternalAccessGrantRecord) => undefined),
  };
  return {
    repository,
    dependencies: {
      repository,
      clock: { now: () => now },
      nextId: () => 'grant-1',
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
    },
  };
};

describe('external access grant contract', () => {
  it('accepts only externalUserId', () => {
    expect(accessGrantInputSchema.parse({ externalUserId: 'user_200' })).toEqual({
      externalUserId: 'user_200',
    });
    expect(() =>
      accessGrantInputSchema.parse({
        externalUserId: 'user_200',
        allowedNangoConnectIds: ['connect-1'],
      }),
    ).toThrow();
  });
});

describe('createAccessGrant', () => {
  it('stores only the target user and a digest for five minutes', async () => {
    const { dependencies, repository } = createDependencies();

    const result = await createAccessGrant({ externalUserId: 'user_200' }, dependencies);

    expect(result).toEqual({ launchCode: expect.any(String) });
    expect(repository.findManagedUser).toHaveBeenCalledWith('user_200');
    expect(repository.hasActiveMailbox).toHaveBeenCalledWith('managed-user-1');
    expect(repository.createGrant).toHaveBeenCalledWith({
      id: 'grant-1',
      userId: 'managed-user-1',
      codeDigest: expect.any(String),
      createdAt: now,
      expiresAt: new Date('2026-07-30T10:05:00.000Z'),
      consumedAt: null,
    });
    const storedGrant = repository.createGrant.mock.calls[0]![0];
    expect(storedGrant.codeDigest).not.toBe(result.launchCode);
    expect(storedGrant).not.toHaveProperty('scopes');
  });

  it('rejects an unknown external user', async () => {
    const { dependencies } = createDependencies(null);

    await expect(
      createAccessGrant({ externalUserId: 'missing_user' }, dependencies),
    ).rejects.toMatchObject({ code: 'EXTERNAL_USER_NOT_FOUND' });
  });

  it('rejects a non-user role collision', async () => {
    const { dependencies } = createDependencies({ userId: 'admin-1', role: 'admin' });

    await expect(
      createAccessGrant({ externalUserId: 'admin_user' }, dependencies),
    ).rejects.toMatchObject({ code: 'EXTERNAL_USER_NOT_FOUND' });
  });

  it('rejects a user without an active mailbox', async () => {
    const { dependencies } = createDependencies({ userId: 'managed-user-1', role: 'user' }, false);

    await expect(
      createAccessGrant({ externalUserId: 'user_200' }, dependencies),
    ).rejects.toMatchObject({ code: 'ACTIVE_MAILBOX_NOT_FOUND' });
  });
});
