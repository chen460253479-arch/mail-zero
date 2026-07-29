import { describe, expect, it, vi } from 'vitest';

import { createMailboxLifecycleRuntime } from '../../../../../src/modules/mail-accounts/runtime/lifecycle';

const createHarness = (authSource: 'zero_oauth' | 'nango' = 'zero_oauth') => {
  const calls: string[] = [];
  const connection = {
    id: 'connection-1',
    channelId: 'gmail' as const,
    status: 'connected' as const,
  };
  const repository = {
    findOwnedConnection: vi.fn(async () => connection),
    findConnectionWithAuthorization: vi.fn(async () => ({
      connection,
      authorization: { authSource },
    })),
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
    listBlobObjectKeys: vi.fn(async () => ['mail/account-1/blob-1']),
    deleteMailbox: vi.fn(async () => {
      calls.push('deleteMailbox');
    }),
  };
  const dependencies = {
    repository,
    pauseConnectionSyncs: vi.fn(async () => {
      calls.push('pauseConnectionSyncs');
      return 1;
    }),
    stopChannelWatch: vi.fn(async () => {
      calls.push('stopChannelWatch');
    }),
    revokeZeroOAuth: vi.fn(async () => {
      calls.push('revokeZeroOAuth');
    }),
    deleteBlobObjects: vi.fn(async () => {
      calls.push('deleteBlobObjects');
    }),
    recordDiagnostic: vi.fn(),
    now: () => new Date('2026-07-27T00:00:00.000Z'),
  };
  return {
    calls,
    dependencies,
    repository,
    runtime: createMailboxLifecycleRuntime(dependencies),
  };
};

describe('mailbox lifecycle runtime', () => {
  it('pauses local work, stops Gmail Watch, revokes Zero OAuth, then disconnects', async () => {
    const { calls, runtime, repository } = createHarness();

    await expect(
      runtime.disconnect({
        userId: 'user-1',
        connectionId: 'connection-1',
        deleteLocalData: false,
      }),
    ).resolves.toEqual({ status: 'disconnected' });

    expect(calls).toEqual([
      'markDisconnecting',
      'pauseConnectionSyncs',
      'stopChannelWatch',
      'revokeZeroOAuth',
      'removeAuthorizationBinding',
      'markDisconnected',
    ]);
    expect(repository.findOwnedConnection).toHaveBeenCalledWith('user-1', 'connection-1');
  });

  it('unlinks Nango locally without revoking or deleting the Nango connection', async () => {
    const { runtime, dependencies } = createHarness('nango');

    await runtime.disconnect({
      userId: 'user-1',
      connectionId: 'connection-1',
      deleteLocalData: false,
    });

    expect(dependencies.revokeZeroOAuth).not.toHaveBeenCalled();
  });

  it('continues local disconnect after Gmail Watch stop fails but records a safe diagnostic', async () => {
    const { runtime, dependencies, repository } = createHarness();
    dependencies.stopChannelWatch.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(
      runtime.disconnect({
        userId: 'user-1',
        connectionId: 'connection-1',
        deleteLocalData: false,
      }),
    ).resolves.toEqual({ status: 'disconnected' });

    expect(dependencies.recordDiagnostic).toHaveBeenCalledWith(
      'MAIL_CHANNEL_WATCH_STOP_FAILED',
      'connection-1',
      expect.any(Error),
    );
    expect(repository.removeAuthorizationBinding).toHaveBeenCalled();
  });

  it('blocks new work but does not remove credentials when pausing local synchronization fails', async () => {
    const { runtime, dependencies, repository } = createHarness();
    dependencies.pauseConnectionSyncs.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      runtime.disconnect({
        userId: 'user-1',
        connectionId: 'connection-1',
        deleteLocalData: false,
      }),
    ).rejects.toThrow('database unavailable');
    expect(repository.markDisconnecting).toHaveBeenCalledWith('user-1', 'connection-1');
    expect(dependencies.stopChannelWatch).not.toHaveBeenCalled();
    expect(repository.removeAuthorizationBinding).not.toHaveBeenCalled();
  });

  it('deletes all recorded Blob objects before cascading local database data', async () => {
    const { calls, runtime, dependencies } = createHarness();

    await expect(
      runtime.disconnect({
        userId: 'user-1',
        connectionId: 'connection-1',
        deleteLocalData: true,
      }),
    ).resolves.toEqual({ status: 'deleted' });

    expect(dependencies.deleteBlobObjects).toHaveBeenCalledWith(['mail/account-1/blob-1']);
    expect(calls.indexOf('deleteBlobObjects')).toBeLessThan(calls.indexOf('deleteMailbox'));
  });
});
