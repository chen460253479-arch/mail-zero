import { describe, expect, it, vi } from 'vitest';

import {
  assertAuthorizationCanBeAttached,
  deleteRetainedMailboxData,
  disconnectAuthorization,
  type ConnectionLifecycleDependencies,
} from '../../../../../src/modules/mail-accounts/application/disconnect-mailbox';

const connection = {
  id: 'connection-1',
  channelId: 'gmail' as const,
  status: 'connected' as const,
};

const createDependencies = (
  status: 'connected' | 'disconnecting' | 'disconnected' | 'deleting' = 'connected',
) => {
  const calls: string[] = [];
  const repository = {
    getConnection: vi.fn().mockResolvedValue({ ...connection, status }),
    removeAuthorizationBinding: vi.fn(async () => {
      calls.push('removeAuthorizationBinding');
    }),
    markDisconnecting: vi.fn(async () => {
      calls.push('markDisconnecting');
    }),
    markDisconnected: vi.fn(async () => {
      calls.push('markDisconnected');
    }),
    markDeleting: vi.fn(async () => {
      calls.push('markDeleting');
    }),
    deleteMailbox: vi.fn(async () => {
      calls.push('deleteMailbox');
    }),
    deleteNangoConnection: vi.fn(),
    updateAuthSource: vi.fn(),
  };
  const dependencies: ConnectionLifecycleDependencies = {
    repository,
    stopMailboxTasks: vi.fn(async () => {
      calls.push('stopMailboxTasks');
    }),
    revokeAuthorization: vi.fn(async () => {
      calls.push('revokeAuthorization');
    }),
    cleanupLocalData: vi.fn(async () => {
      calls.push('cleanupLocalData');
    }),
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  };
  return { calls, dependencies, repository };
};

describe('connection lifecycle', () => {
  it('allows reauthorization only after the previous binding was removed', () => {
    expect(() => assertAuthorizationCanBeAttached('disconnected', false)).not.toThrow();
    expect(() => assertAuthorizationCanBeAttached('connected', false)).toThrow(
      'Mailbox is already connected',
    );
    expect(() => assertAuthorizationCanBeAttached('disconnected', true)).toThrow(
      'Mailbox authorization already exists',
    );
  });

  it('disconnects by deleting credentials and retaining mailbox data', async () => {
    const { calls, dependencies, repository } = createDependencies();

    await expect(
      disconnectAuthorization(
        { userId: 'user-1', connectionId: connection.id, deleteLocalData: false },
        dependencies,
      ),
    ).resolves.toEqual({ status: 'disconnected' });
    expect(calls).toEqual([
      'markDisconnecting',
      'stopMailboxTasks',
      'revokeAuthorization',
      'removeAuthorizationBinding',
      'markDisconnected',
    ]);
    expect(repository.getConnection).toHaveBeenCalledWith('user-1', connection.id);
    expect(repository.removeAuthorizationBinding).toHaveBeenCalledWith('user-1', connection.id);
    expect(repository.markDisconnected).toHaveBeenCalledWith(
      'user-1',
      connection.id,
      new Date('2026-07-24T00:00:00.000Z'),
    );
  });

  it('marks the mailbox deleting before stopping external work', async () => {
    const { calls, dependencies, repository } = createDependencies();

    await expect(
      disconnectAuthorization(
        { userId: 'user-1', connectionId: connection.id, deleteLocalData: true },
        dependencies,
      ),
    ).resolves.toEqual({ status: 'deleted' });
    expect(calls).toEqual([
      'markDeleting',
      'stopMailboxTasks',
      'revokeAuthorization',
      'removeAuthorizationBinding',
      'cleanupLocalData',
      'deleteMailbox',
    ]);
    expect(repository.markDeleting).toHaveBeenCalledWith('user-1', connection.id);
    expect(repository.deleteMailbox).toHaveBeenCalledWith('user-1', connection.id);
  });

  it('keeps deleting recoverable when external task cleanup fails', async () => {
    const { dependencies, repository } = createDependencies();
    vi.mocked(dependencies.stopMailboxTasks).mockRejectedValueOnce(
      new Error('provider task cleanup failed'),
    );

    await expect(
      disconnectAuthorization(
        { userId: 'user-1', connectionId: connection.id, deleteLocalData: true },
        dependencies,
      ),
    ).rejects.toThrow('provider task cleanup failed');
    expect(repository.markDeleting).toHaveBeenCalledWith('user-1', connection.id);
    expect(repository.deleteMailbox).not.toHaveBeenCalled();
  });

  it('does not delete a Nango connection when removing a local binding', async () => {
    const { dependencies, repository } = createDependencies();

    await disconnectAuthorization(
      { userId: 'user-1', connectionId: connection.id, deleteLocalData: false },
      dependencies,
    );

    expect(repository.deleteNangoConnection).not.toHaveBeenCalled();
  });

  it('allows retained data cleanup only for a disconnected mailbox', async () => {
    const connected = createDependencies();
    await expect(
      deleteRetainedMailboxData(
        { userId: 'user-1', connectionId: connection.id },
        connected.dependencies,
      ),
    ).rejects.toThrow('Mailbox must be disconnected');

    const disconnected = createDependencies('disconnected');
    await expect(
      deleteRetainedMailboxData(
        { userId: 'user-1', connectionId: connection.id },
        disconnected.dependencies,
      ),
    ).resolves.toEqual({ status: 'deleted' });
  });

  it('can retry retained data cleanup after an object-store failure left it deleting', async () => {
    const deleting = createDependencies('deleting');

    await expect(
      deleteRetainedMailboxData(
        { userId: 'user-1', connectionId: connection.id },
        deleting.dependencies,
      ),
    ).resolves.toEqual({ status: 'deleted' });
  });

  it('can retry a disconnect after an earlier failure left it disconnecting', async () => {
    const disconnecting = createDependencies('disconnecting');

    await expect(
      disconnectAuthorization(
        { userId: 'user-1', connectionId: connection.id, deleteLocalData: false },
        disconnecting.dependencies,
      ),
    ).resolves.toEqual({ status: 'disconnected' });

    expect(disconnecting.calls).toEqual([
      'markDisconnecting',
      'stopMailboxTasks',
      'revokeAuthorization',
      'removeAuthorizationBinding',
      'markDisconnected',
    ]);
  });

  it('keeps the deleting database record when object cleanup fails', async () => {
    const { dependencies, repository } = createDependencies();
    vi.mocked(dependencies.cleanupLocalData).mockRejectedValueOnce(
      new Error('object store unavailable'),
    );

    await expect(
      disconnectAuthorization(
        { userId: 'user-1', connectionId: connection.id, deleteLocalData: true },
        dependencies,
      ),
    ).rejects.toThrow('object store unavailable');
    expect(repository.markDeleting).toHaveBeenCalledWith('user-1', connection.id);
    expect(repository.deleteMailbox).not.toHaveBeenCalled();
  });

  it('does not expose an operation that updates authSource in place', async () => {
    const { dependencies, repository } = createDependencies();

    await disconnectAuthorization(
      { userId: 'user-1', connectionId: connection.id, deleteLocalData: false },
      dependencies,
    );

    expect(repository.updateAuthSource).not.toHaveBeenCalled();
  });
});
