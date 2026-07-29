import { describe, expect, it } from 'vitest';

import { externalAccessRouter } from '../../../../../src/modules/external-integration/trpc/router';
import { connectionsRouter } from '../../../../../src/trpc/routes/connections';

const externalSession = {
  id: 'external-session-1',
  ownerUserId: 'zero-external-integration' as const,
  scopes: [
    {
      nangoConnectionId: 'connect-1',
      connectionId: 'connection-1',
      mailAccountId: 'account-1',
    },
  ],
  activeConnectionId: 'connection-1',
  expiresAt: new Date('2026-08-20T00:00:00.000Z'),
  updatedAt: new Date('2026-07-29T00:00:00.000Z'),
};

describe('externalAccess router', () => {
  it('returns only mode and sessionId for an external session', async () => {
    const caller = externalAccessRouter.createCaller({
      c: { var: {} } as never,
      auth: {} as never,
      sessionUser: undefined,
      externalSession,
    });

    await expect(caller.current()).resolves.toEqual({
      mode: 'external',
      sessionId: 'external-session-1',
    });
  });

  it('does not expose external access when a real user is present', async () => {
    const caller = externalAccessRouter.createCaller({
      c: { var: {} } as never,
      auth: {} as never,
      sessionUser: { id: 'real-user' } as never,
      externalSession,
    });

    await expect(caller.current()).resolves.toBeNull();
  });
});

describe('external session connection permissions', () => {
  const caller = connectionsRouter.createCaller({
    c: {
      var: {
        services: {
          database: { db: {} },
        },
      },
    } as never,
    auth: {} as never,
    sessionUser: undefined,
    externalSession,
  });

  it('keeps binding and disconnect behind privateProcedure', async () => {
    await expect(
      caller.bindNango({
        channelId: 'gmail',
        connectionId: 'connect-3',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await expect(
      caller.disconnect({
        connectionId: '00000000-0000-4000-8000-000000000003',
        deleteLocalData: false,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('maps an out-of-scope default connection to NOT_FOUND', async () => {
    await expect(
      caller.setDefault({
        connectionId: 'connection-outside-grant',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
