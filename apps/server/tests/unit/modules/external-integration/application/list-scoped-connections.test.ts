import { describe, expect, it, vi } from 'vitest';

import {
  listScopedConnections,
  setScopedActiveConnection,
} from '../../../../../src/modules/external-integration/application/list-scoped-connections';

const externalSession = {
  id: 'external-session-1',
  ownerUserId: 'zero-external-integration' as const,
  scopes: [
    {
      nangoConnectionId: 'connect-2',
      connectionId: 'zero-connection-2',
      mailAccountId: 'account-2',
    },
    {
      nangoConnectionId: 'connect-1',
      connectionId: 'zero-connection-1',
      mailAccountId: 'account-1',
    },
  ],
  activeConnectionId: 'zero-connection-1',
  expiresAt: new Date('2026-08-20T00:00:00.000Z'),
  updatedAt: new Date('2026-07-29T00:00:00.000Z'),
};

const connections = [
  {
    id: 'zero-connection-1',
    email: 'one@example.test',
    name: 'One',
    picture: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    channelId: 'gmail' as const,
    status: 'connected' as const,
    authSource: 'nango' as const,
  },
  {
    id: 'zero-connection-2',
    email: 'two@example.test',
    name: 'Two',
    picture: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    channelId: 'outlook' as const,
    status: 'connected' as const,
    authSource: 'nango' as const,
  },
  {
    id: 'zero-connection-3',
    email: 'three@example.test',
    name: 'Three',
    picture: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    channelId: 'gmail' as const,
    status: 'connected' as const,
    authSource: 'nango' as const,
  },
];

describe('external scoped connection directory', () => {
  it('lists only granted connections in grant order', async () => {
    const repository = {
      list: vi.fn(async () => connections),
      setActiveConnection: vi.fn(),
    };

    const result = await listScopedConnections(externalSession, repository);

    expect(result.map(({ id }) => id)).toEqual(['zero-connection-2', 'zero-connection-1']);
    expect(repository.list).toHaveBeenCalledWith('zero-external-integration');
  });

  it('updates only the external session active connection', async () => {
    const repository = {
      list: vi.fn(async () => connections),
      setActiveConnection: vi.fn(async () => externalSession),
    };

    await setScopedActiveConnection(
      externalSession,
      'zero-connection-2',
      repository,
      new Date('2026-07-29T10:00:00.000Z'),
    );

    expect(repository.setActiveConnection).toHaveBeenCalledWith({
      sessionId: 'external-session-1',
      connectionId: 'zero-connection-2',
      now: new Date('2026-07-29T10:00:00.000Z'),
    });
  });

  it('returns NOT_FOUND semantics outside the grant scope', async () => {
    const repository = {
      list: vi.fn(async () => connections),
      setActiveConnection: vi.fn(),
    };

    await expect(
      setScopedActiveConnection(
        externalSession,
        'zero-connection-3',
        repository,
        new Date('2026-07-29T10:00:00.000Z'),
      ),
    ).rejects.toMatchObject({
      code: 'EXTERNAL_SESSION_SCOPE_NOT_FOUND',
    });
    expect(repository.setActiveConnection).not.toHaveBeenCalled();
  });
});
