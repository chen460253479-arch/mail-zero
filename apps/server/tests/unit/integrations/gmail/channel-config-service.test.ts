import { beforeEach, describe, expect, it } from 'vitest';

import type {
  ChannelConfigRecord,
  ChannelConfigRepository,
  SaveChannelConfigInput,
} from '../../../../src/integrations/core/channel-config-repository';
import {
  createGmailChannelConfigService,
  type GmailChannelConfigServiceDependencies,
} from '../../../../src/integrations/gmail/channel-config-service';
import type { NangoChannelRuntimeStatus } from '../../../../src/integrations/nango/channels';
import type { SystemIntegrationRecord } from '../../../../src/integrations/core/repository';

const now = new Date('2026-07-28T08:00:00.000Z');

const activeIntegration = (): SystemIntegrationRecord => ({
  id: 'gmail_zero_oauth-config',
  integrationKey: 'gmail_zero_oauth',
  publicConfig: { clientId: 'gmail-client-id' },
  encryptedSecret: 'ciphertext',
  status: 'active',
  validatedAt: now,
  updatedBy: 'admin-1',
  createdAt: now,
  updatedAt: now,
});

const createChannelRepository = (): ChannelConfigRepository & {
  current: ChannelConfigRecord | null;
} => ({
  current: null,
  async get() {
    return this.current;
  },
  async save(input: SaveChannelConfigInput) {
    this.current = {
      id: this.current?.id ?? 'gmail-channel-config',
      ...input,
      createdAt: this.current?.createdAt ?? now,
      updatedAt: now,
    };
    return this.current;
  },
});

describe('Gmail channel configuration service', () => {
  let channels: ReturnType<typeof createChannelRepository>;
  let integrations: Map<string, SystemIntegrationRecord>;
  let bindingCounts: { nango: number; zero_oauth: number };
  let subscriptionRefreshes: string[];
  let subscriptionDisables: string[];
  let nangoStatus: NangoChannelRuntimeStatus;
  let dependencies: GmailChannelConfigServiceDependencies;

  beforeEach(() => {
    channels = createChannelRepository();
    integrations = new Map();
    bindingCounts = { nango: 0, zero_oauth: 0 };
    subscriptionRefreshes = [];
    subscriptionDisables = [];
    nangoStatus = {
      state: 'unconfigured',
      checkedAt: now,
      errorCode: 'NANGO_CHANNEL_KEY_MISSING',
    };
    dependencies = {
      channels,
      integrations: {
        get: async (key) => integrations.get(key) ?? null,
        countBindings: async (_channelId, authSource) =>
          authSource === undefined
            ? bindingCounts.nango + bindingCounts.zero_oauth
            : bindingCounts[authSource],
      },
      publicBackendUrl: 'https://mail.example.test/',
      getNangoStatus: async () => nangoStatus,
      requestSubscriptionRefresh: async (provider) => {
        subscriptionRefreshes.push(provider);
      },
      disableSubscriptions: async (provider) => {
        subscriptionDisables.push(provider);
      },
    };
  });

  it.each(['unconfigured', 'unavailable'] as const)(
    'rejects Nango mode while the fixed channel Integration is %s',
    async (state) => {
      nangoStatus =
        state === 'unavailable'
          ? {
              state,
              checkedAt: now,
              errorCode: 'NANGO_UNREACHABLE',
            }
          : {
              state,
              checkedAt: now,
              errorCode: 'NANGO_CHANNEL_KEY_MISSING',
            };

      await expect(
        createGmailChannelConfigService(dependencies).save({
          authSource: 'nango',
          inboxWatchEnabled: false,
          scheduledSyncEnabled: true,
          syncIntervalMinutes: 10,
          providerConfig: {},
          updatedBy: 'admin-1',
        }),
      ).rejects.toMatchObject({ code: 'GMAIL_AUTH_SOURCE_NOT_CONFIGURED' });
    },
  );

  it('allows Nango mode when the fixed Gmail Integration is available', async () => {
    nangoStatus = {
      state: 'available',
      checkedAt: now,
      errorCode: null,
    };
    const saved = await createGmailChannelConfigService(dependencies).save({
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
    });

    expect(saved).toMatchObject({
      authSource: 'nango',
      authSourceLocked: true,
      authorizationSources: {
        nango: {
          state: 'available',
          checkedAt: now,
          errorCode: null,
        },
      },
    });
    expect(saved.authorizationSources.nango).not.toHaveProperty('gmailIntegrationId');
  });

  it('blocks changing the configured authorization source without mailbox bindings', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration());
    nangoStatus = {
      state: 'available',
      checkedAt: now,
      errorCode: null,
    };
    channels.current = {
      id: 'gmail-channel-config',
      channelId: 'gmail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    };

    await expect(
      createGmailChannelConfigService(dependencies).save({
        authSource: 'zero_oauth',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: {},
        updatedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'GMAIL_AUTH_SOURCE_IN_USE' });
    expect(channels.current.authSource).toBe('nango');
  });

  it('rejects Zero OAuth mode until its validated configuration is active', async () => {
    await expect(
      createGmailChannelConfigService(dependencies).save({
        authSource: 'zero_oauth',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: {},
        updatedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'GMAIL_AUTH_SOURCE_NOT_CONFIGURED' });
  });

  it('blocks changing the authorization source while Gmail bindings exist', async () => {
    bindingCounts.zero_oauth = 1;
    channels.current = {
      id: 'gmail-channel-config',
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    };

    await expect(
      createGmailChannelConfigService(dependencies).save({
        authSource: 'nango',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: {},
        updatedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'GMAIL_AUTH_SOURCE_IN_USE' });
  });

  it('rejects a mixed authorization binding state even when the saved source matches', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration());
    bindingCounts = { nango: 1, zero_oauth: 1 };
    channels.current = {
      id: 'gmail-channel-config',
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    };

    await expect(
      createGmailChannelConfigService(dependencies).save({
        authSource: 'zero_oauth',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: {},
        updatedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'GMAIL_AUTH_SOURCE_IN_USE' });
  });

  it('allows trigger settings to change while the selected source has bindings', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration());
    bindingCounts.zero_oauth = 1;
    channels.current = {
      id: 'gmail-channel-config',
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    };

    const saved = await createGmailChannelConfigService(dependencies).save({
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 30,
      providerConfig: {},
      updatedBy: 'admin-2',
    });

    expect(saved).toMatchObject({
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 30,
      manualOnly: true,
      authSourceLocked: true,
      webhookUrl: 'https://mail.example.test/api/mail/channels/gmail/push',
      authorizationSources: {
        zero_oauth: {
          configured: true,
          clientId: 'gmail-client-id',
          bindingCount: 1,
          redirectUris: {
            validation: 'https://mail.example.test/api/integrations/gmail/validation/callback',
            mailbox: 'https://mail.example.test/api/integrations/gmail/connect/callback',
          },
        },
        nango: {
          state: 'unconfigured',
          checkedAt: now,
          errorCode: 'NANGO_CHANNEL_KEY_MISSING',
          bindingCount: 0,
        },
      },
    });
  });

  it('marks every existing Gmail subscription due when Watch is enabled', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration());
    channels.current = {
      id: 'gmail-channel-config',
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    };

    await createGmailChannelConfigService(dependencies).save({
      authSource: 'zero_oauth',
      inboxWatchEnabled: true,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {
        topicName: 'projects/zero-mail/topics/gmail-inbound',
      },
      updatedBy: 'admin-1',
    });

    expect(subscriptionRefreshes).toEqual(['gmail']);
  });

  it('clears existing subscription routing while Watch is disabled', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration());

    await createGmailChannelConfigService(dependencies).save({
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
    });

    expect(subscriptionRefreshes).toEqual([]);
    expect(subscriptionDisables).toEqual(['gmail']);
  });
});
