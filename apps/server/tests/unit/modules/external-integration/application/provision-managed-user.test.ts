import { describe, expect, it, vi } from 'vitest';

import {
  provisionManagedUser,
  type CreateManagedUserRecord,
  type ManagedUserRepository,
} from '../../../../../src/modules/external-integration/application/provision-managed-user';

const now = new Date('2026-07-30T08:00:00.000Z');

const createRepository = () => {
  const state: {
    existing: { userId: string; role: string } | null;
    created: CreateManagedUserRecord | null;
  } = {
    existing: null,
    created: null,
  };
  const repository: ManagedUserRepository = {
    findByExternalUserId: vi.fn(async () => state.existing),
    create: vi.fn(async (record) => {
      state.created = record;
      state.existing = { userId: record.userId, role: record.role };
      return true;
    }),
  };
  return { repository, state };
};

describe('managed external user provisioning', () => {
  it('creates a credential user whose username and initial password equal externalUserId', async () => {
    const { repository, state } = createRepository();

    await expect(
      provisionManagedUser(
        { externalUserId: 'user_200' },
        {
          repository,
          hashPassword: async (password) => `hashed:${password}`,
          now: () => now,
          newId: () => 'managed-user-1',
        },
      ),
    ).resolves.toEqual({ userId: 'managed-user-1', created: true });

    expect(state.created).toEqual({
      userId: 'managed-user-1',
      externalUserId: 'user_200',
      name: 'user_200',
      email:
        'managed-94e8d038cb00c34a778bd517ee69176d4ede0c513d7c633188f9fcbf7181289b@zero.invalid',
      role: 'user',
      emailVerified: true,
      mustChangePassword: true,
      passwordHash: 'hashed:user_200',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('returns an existing ordinary user without replacing its password', async () => {
    const { repository, state } = createRepository();
    state.existing = { userId: 'managed-user-1', role: 'user' };
    const hashPassword = vi.fn(async () => 'unused');

    await expect(
      provisionManagedUser(
        { externalUserId: 'user_200' },
        {
          repository,
          hashPassword,
          now: () => now,
          newId: () => 'unused',
        },
      ),
    ).resolves.toEqual({ userId: 'managed-user-1', created: false });

    expect(hashPassword).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([' user_200', 'user 200', 'a', '用户_200', 'user/200'])(
    'rejects invalid externalUserId %j',
    async (externalUserId) => {
      const { repository } = createRepository();

      await expect(
        provisionManagedUser(
          { externalUserId },
          {
            repository,
            hashPassword: async () => 'unused',
            now: () => now,
            newId: () => 'unused',
          },
        ),
      ).rejects.toMatchObject({ code: 'EXTERNAL_USER_INVALID' });

      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a username collision with a non-user account', async () => {
    const { repository, state } = createRepository();
    state.existing = { userId: 'admin-1', role: 'admin' };

    await expect(
      provisionManagedUser(
        { externalUserId: 'user_200' },
        {
          repository,
          hashPassword: async () => 'unused',
          now: () => now,
          newId: () => 'unused',
        },
      ),
    ).rejects.toMatchObject({ code: 'EXTERNAL_USER_INVALID' });
  });

  it('returns the winner when concurrent creation loses the unique-key race', async () => {
    const { repository, state } = createRepository();
    vi.mocked(repository.create).mockImplementationOnce(async () => {
      state.existing = { userId: 'managed-user-winner', role: 'user' };
      return false;
    });

    await expect(
      provisionManagedUser(
        { externalUserId: 'user_200' },
        {
          repository,
          hashPassword: async () => 'hashed',
          now: () => now,
          newId: () => 'managed-user-loser',
        },
      ),
    ).resolves.toEqual({ userId: 'managed-user-winner', created: false });
  });
});
