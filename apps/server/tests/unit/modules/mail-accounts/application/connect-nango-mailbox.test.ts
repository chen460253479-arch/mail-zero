import { describe, expect, it, vi } from 'vitest';

import {
  connectNangoMailbox,
  type ConnectNangoMailboxDependencies,
} from '../../../../../src/modules/mail-accounts/application/connect-nango-mailbox';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

describe('connectNangoMailbox', () => {
  it('binds and provisions the mailbox through one application service', async () => {
    const provisioned: Array<{
      userId: string;
      connectionId: string;
      channelId: string;
    }> = [];
    const dependencies: ConnectNangoMailboxDependencies = {
      assertNangoChannelAvailable: vi.fn(async () => 'gmail-primary'),
      reserve: vi.fn(),
      bind: vi.fn(async () => ({
        id: 'zero-connection-1',
        ready: true,
        identity: {
          email: 'owner@example.test',
          name: 'Owner',
          picture: '',
        },
      })),
      provision: vi.fn(async (input) => {
        provisioned.push({
          userId: input.userId,
          connectionId: input.connectionId,
          channelId: input.channelId,
        });
      }),
    };

    const result = await connectNangoMailbox(
      {
        userId: 'owner-1',
        channelId: 'gmail',
        connectionId: 'connect-gmail-1',
      },
      {} as RuntimeServices,
      dependencies,
    );

    expect(result).toEqual({ id: 'zero-connection-1' });
    expect(provisioned).toEqual([
      {
        userId: 'owner-1',
        connectionId: 'zero-connection-1',
        channelId: 'gmail',
      },
    ]);
  });

  it('does not bind when the channel is unavailable', async () => {
    const bind = vi.fn();
    const dependencies: ConnectNangoMailboxDependencies = {
      assertNangoChannelAvailable: vi.fn(async () => {
        throw new Error('MAIL_CHANNEL_UNAVAILABLE');
      }),
      reserve: vi.fn(),
      bind,
      provision: vi.fn(),
    };

    await expect(
      connectNangoMailbox(
        {
          userId: 'owner-1',
          channelId: 'gmail',
          connectionId: 'connect-gmail-1',
        },
        {} as RuntimeServices,
        dependencies,
      ),
    ).rejects.toThrow('MAIL_CHANNEL_UNAVAILABLE');
    expect(bind).not.toHaveBeenCalled();
  });

  it('reserves a Zoho authorization without calling mailbox APIs when externalData is absent', async () => {
    const reserve = vi.fn(async () => ({ id: 'pending-zoho-1' }));
    const bind = vi.fn();
    const provision = vi.fn();
    const dependencies: ConnectNangoMailboxDependencies = {
      assertNangoChannelAvailable: vi.fn(async () => 'zoho-mail-primary'),
      reserve,
      bind,
      provision,
    };

    await expect(
      connectNangoMailbox(
        {
          userId: 'owner-1',
          channelId: 'zoho_mail',
          connectionId: 'nango-zoho-1',
        },
        {} as RuntimeServices,
        dependencies,
      ),
    ).resolves.toEqual({ id: 'pending-zoho-1' });

    expect(reserve).toHaveBeenCalledWith({
      userId: 'owner-1',
      channelId: 'zoho_mail',
      connectionId: 'nango-zoho-1',
      integrationId: 'zoho-mail-primary',
    });
    expect(bind).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  it('does not provision Zoho until accountId and folderIds are complete', async () => {
    const provision = vi.fn();
    const dependencies: ConnectNangoMailboxDependencies = {
      assertNangoChannelAvailable: vi.fn(async () => 'zoho-mail-primary'),
      reserve: vi.fn(),
      bind: vi.fn(async () => ({
        id: 'pending-zoho-1',
        ready: false,
        identity: { email: 'owner@example.test', name: 'Owner', picture: '' },
      })),
      provision,
    };

    await expect(
      connectNangoMailbox(
        {
          userId: 'owner-1',
          channelId: 'zoho_mail',
          connectionId: 'nango-zoho-1',
          externalData: { accountId: '100' },
        },
        {} as RuntimeServices,
        dependencies,
      ),
    ).resolves.toEqual({ id: 'pending-zoho-1' });

    expect(provision).not.toHaveBeenCalled();
  });
});
