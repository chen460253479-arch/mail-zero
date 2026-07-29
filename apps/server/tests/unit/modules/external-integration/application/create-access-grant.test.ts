import { describe, expect, it, vi } from 'vitest';

import type { CreateExternalAccessGrantRecord } from '../../../../../src/modules/external-integration/application/create-access-grant';
import { createAccessGrant } from '../../../../../src/modules/external-integration/application/create-access-grant';
import { accessGrantInputSchema } from '../../../../../src/modules/external-integration/contracts/access';

const now = new Date('2026-07-29T10:00:00.000Z');

const scopes = [
  {
    nangoConnectionId: 'connect-gmail-1',
    connectionId: 'connection-gmail-1',
    mailAccountId: 'account-gmail-1',
  },
  {
    nangoConnectionId: 'connect-outlook-1',
    connectionId: 'connection-outlook-1',
    mailAccountId: 'account-outlook-1',
  },
];

const createDependencies = (resolvedScopes: typeof scopes = scopes) => {
  const repository = {
    resolveMailboxScopes: vi.fn(async () => resolvedScopes),
    createGrant: vi.fn(async (_input: CreateExternalAccessGrantRecord) => undefined),
  };
  return {
    repository,
    dependencies: {
      ownerUserId: 'zero-external-integration' as const,
      repository,
      clock: { now: () => now },
      nextId: () => 'grant-1',
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
    },
  };
};

describe('external access grant contract', () => {
  it('accepts only allowedNangoConnectIds', () => {
    expect(
      accessGrantInputSchema.parse({
        allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
      }),
    ).toEqual({
      allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
    });
  });

  it.each([
    ['selectedNangoConnectId', 'connect-gmail-1'],
    ['crmUserId', 'user-1'],
    ['crmTenantId', 'tenant-1'],
    ['mode', 'CRM_MAIL'],
    ['returnUrl', 'https://crm.example.test/customer/1'],
  ])('rejects the additional field %s', (field, value) => {
    expect(() =>
      accessGrantInputSchema.parse({
        allowedNangoConnectIds: ['connect-gmail-1'],
        [field]: value,
      }),
    ).toThrow();
  });
});

describe('createAccessGrant', () => {
  it('resolves every Nango ID to exactly one mailbox scope', async () => {
    const { dependencies, repository } = createDependencies();

    const result = await createAccessGrant(
      {
        allowedNangoConnectIds: ['connect-gmail-1', 'connect-outlook-1'],
      },
      dependencies,
    );

    expect(result).toEqual({
      launchCode: expect.any(String),
    });
    expect(repository.resolveMailboxScopes).toHaveBeenCalledWith({
      ownerUserId: 'zero-external-integration',
      nangoConnectionIds: ['connect-gmail-1', 'connect-outlook-1'],
    });
    expect(repository.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'grant-1',
        ownerUserId: 'zero-external-integration',
        scopes,
        createdAt: now,
        expiresAt: new Date('2026-07-29T10:05:00.000Z'),
        consumedAt: null,
      }),
    );
    const storedGrant = repository.createGrant.mock.calls[0]![0];
    expect(storedGrant.codeDigest).not.toBe(result.launchCode);
  });

  it('rejects an unbound Nango ID', async () => {
    const { dependencies } = createDependencies([]);

    await expect(
      createAccessGrant(
        {
          allowedNangoConnectIds: ['missing'],
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: 'NANGO_CONNECTION_NOT_BOUND',
    });
  });

  it('rejects an ambiguous Nango ID', async () => {
    const { dependencies } = createDependencies([
      scopes[0]!,
      {
        ...scopes[0]!,
        connectionId: 'connection-gmail-2',
        mailAccountId: 'account-gmail-2',
      },
    ]);

    await expect(
      createAccessGrant(
        {
          allowedNangoConnectIds: ['connect-gmail-1'],
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: 'NANGO_CONNECTION_NOT_BOUND',
    });
  });
});
