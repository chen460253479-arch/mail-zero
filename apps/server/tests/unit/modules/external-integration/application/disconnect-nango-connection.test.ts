import { describe, expect, it, vi } from 'vitest';

import { disconnectExternalNangoConnection } from '../../../../../src/modules/external-integration/application/disconnect-nango-connection';

const input = {
  externalUserId: 'user_200',
  channelId: 'gmail' as const,
  connectionId: 'nango-connection-1',
};

const createDependencies = () => ({
  findManagedUser: vi.fn(async () => ({ userId: 'managed-user-1', role: 'user' })),
  findNangoMailbox: vi.fn(
    async (): Promise<{ connectionId: string; userId: string } | null> => ({
      connectionId: 'zero-connection-1',
      userId: 'managed-user-1',
    }),
  ),
  disconnect: vi.fn(
    async (): Promise<{ status: 'disconnected' | 'deleted' }> => ({
      status: 'disconnected',
    }),
  ),
});

describe('external Nango connection disconnect', () => {
  it('disconnects the matching Zero mailbox while retaining local data', async () => {
    const dependencies = createDependencies();

    await expect(disconnectExternalNangoConnection(input, dependencies)).resolves.toEqual({
      id: 'zero-connection-1',
      status: 'disconnected',
    });
    expect(dependencies.findNangoMailbox).toHaveBeenCalledWith('gmail', 'nango-connection-1');
    expect(dependencies.disconnect).toHaveBeenCalledWith({
      userId: 'managed-user-1',
      connectionId: 'zero-connection-1',
      deleteLocalData: false,
    });
  });

  it('treats a repeated notification as already disconnected', async () => {
    const dependencies = createDependencies();
    dependencies.findNangoMailbox.mockResolvedValueOnce(null);

    await expect(disconnectExternalNangoConnection(input, dependencies)).resolves.toEqual({
      status: 'already_disconnected',
    });
    expect(dependencies.disconnect).not.toHaveBeenCalled();
  });

  it('does not disconnect a mailbox owned by another external user', async () => {
    const dependencies = createDependencies();
    dependencies.findNangoMailbox.mockResolvedValueOnce({
      connectionId: 'zero-connection-1',
      userId: 'another-user',
    });

    await expect(disconnectExternalNangoConnection(input, dependencies)).resolves.toEqual({
      status: 'already_disconnected',
    });
    expect(dependencies.disconnect).not.toHaveBeenCalled();
  });
});
