import { describe, expect, it, vi } from 'vitest';

import {
  assertAuthorizationCanBeAttached,
  deleteRetainedMailboxData,
  disconnectAuthorization,
  type ConnectionLifecycleDependencies,
} from './disconnect-mailbox';

const connection = {
  id: 'connection-1',
  status: 'connected' as const,
};

const createDependencies = (status: 'connected' | 'disconnected' = 'connected') => {
  const calls: string[] = [];
  const repository = {
    getConnection: vi.fn().mockResolvedValue({ ...connection, status }),
    removeAuthorizationBinding: vi.fn(async () => {
      calls.push('removeAuthorizationBinding');
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
    const { calls, dependencies } = createDependencies();

    await expect(
      disconnectAuthorization(
        { connectionId: connection.id, deleteLocalData: false },
        dependencies,
      ),
    ).resolves.toEqual({ status: 'disconnected' });
    expect(calls).toEqual(['stopMailboxTasks', 'removeAuthorizationBinding', 'markDisconnected']);
  });

  it('stops external work before marking the mailbox deleting', async () => {
    const { calls, dependencies } = createDependencies();

    await expect(
      disconnectAuthorization({ connectionId: connection.id, deleteLocalData: true }, dependencies),
    ).resolves.toEqual({ status: 'deleted' });
    expect(calls).toEqual([
      'stopMailboxTasks',
      'markDeleting',
      'removeAuthorizationBinding',
      'cleanupLocalData',
      'deleteMailbox',
    ]);
  });

  it('does not persist deleting when external task cleanup fails', async () => {
    const { dependencies, repository } = createDependencies();
    vi.mocked(dependencies.stopMailboxTasks).mockRejectedValueOnce(
      new Error('provider task cleanup failed'),
    );

    await expect(
      disconnectAuthorization({ connectionId: connection.id, deleteLocalData: true }, dependencies),
    ).rejects.toThrow('provider task cleanup failed');
    expect(repository.markDeleting).not.toHaveBeenCalled();
  });

  it('does not delete a Nango connection when removing a local binding', async () => {
    const { dependencies, repository } = createDependencies();

    await disconnectAuthorization(
      { connectionId: connection.id, deleteLocalData: false },
      dependencies,
    );

    expect(repository.deleteNangoConnection).not.toHaveBeenCalled();
  });

  it('allows retained data cleanup only for a disconnected mailbox', async () => {
    const connected = createDependencies();
    await expect(deleteRetainedMailboxData(connection.id, connected.dependencies)).rejects.toThrow(
      'Mailbox must be disconnected',
    );

    const disconnected = createDependencies('disconnected');
    await expect(
      deleteRetainedMailboxData(connection.id, disconnected.dependencies),
    ).resolves.toEqual({ status: 'deleted' });
  });

  it('does not expose an operation that updates authSource in place', async () => {
    const { dependencies, repository } = createDependencies();

    await disconnectAuthorization(
      { connectionId: connection.id, deleteLocalData: false },
      dependencies,
    );

    expect(repository.updateAuthSource).not.toHaveBeenCalled();
  });
});
