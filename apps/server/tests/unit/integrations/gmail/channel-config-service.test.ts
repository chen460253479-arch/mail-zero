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
import type { SystemIntegrationRecord } from '../../../../src/integrations/core/repository';
import type { NangoRuntimeStatus } from '../../../../src/integrations/nango/service';

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
  let gmailMapping: { externalIntegrationId: string } | null;
  let bindingCounts: { nango: number; zero_oauth: number };
  let subscriptionRefreshes: string[];
  let subscriptionDisables: string[];
  let nangoStatus: NangoRuntimeStatus;
  let dependencies: GmailChannelConfigServiceDependencies;

  beforeEach(() => {
    channels = createChannelRepository();
    integrations = new Map();
    gmailMapping = null;
    bindingCounts = { nango: 0, zero_oauth: 0 };
    subscriptionRefreshes = [];
    subscriptionDisables = [];
    nangoStatus = {
      state: 'unconfigured',
      checkedAt: null,
      errorCode: null,
    };
    dependencies = {
      channels,
      integrations: {
        get: async (key) => integrations.get(key) ?? null,
        getMapping: async () => gmailMapping as never,
        countBindings: async (_channelId, authSource) =>
          authSource === undefined
            ? bindingCounts.nango + bindingCounts.zero_oauth
            : bindingCounts[authSource],
      },
      publicBackendUrl: 'https://mail.example.test/',
      getNangoStatus: () => nangoStatus,
      requestSubscriptionRefresh: async (provider) => {
        subscriptionRefreshes.push(provider);
      },
      disableSubscriptions: async (provider) => {
        subscriptionDisables.push(provider);
      },
    };
  });

  it.each(['unconfigured', 'validating', 'unavailable'] as const)(
    'rejects Nango mode while the environment runtime is %s',
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
              checkedAt: null,
              errorCode: null,
            };
      gmailMapping = { externalIntegrationId: 'gmail-integration' };

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

  it('rejects Nango mode until a Gmail Integration mapping is selected', async () => {
    nangoStatus = {
      state: 'available',
      checkedAt: now,
      errorCode: null,
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
  });

  it('allows Nango mode when the environment runtime and Gmail mapping are ready', async () => {
    nangoStatus = {
      state: 'available',
      checkedAt: now,
      errorCode: null,
    };
    gmailMapping = { externalIntegrationId: 'gmail-integration' };

    await expect(
      createGmailChannelConfigService(dependencies).save({
        authSource: 'nango',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: {},
        updatedBy: 'admin-1',
      }),
    ).resolves.toMatchObject({
      authSource: 'nango',
      authorizationSources: {
        nango: {
          state: 'available',
          checkedAt: now,
          errorCode: null,
          gmailIntegrationId: 'gmail-integration',
        },
      },
    });
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
    gmailMapping = { externalIntegrationId: 'gmail-integration' };
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
          checkedAt: null,
          errorCode: null,
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
        subscriptionName: 'projects/zero-mail/subscriptions/gmail-inbound-push',
        pushAudience: 'https://mail.example.test/api/mail/channels/gmail/push',
        pushServiceAccount: 'gmail-push@zero-mail.iam.gserviceaccount.com',
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
