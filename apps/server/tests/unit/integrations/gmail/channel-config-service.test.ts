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

const now = new Date('2026-07-28T08:00:00.000Z');

const activeIntegration = (
  integrationKey: 'nango' | 'gmail_zero_oauth',
): SystemIntegrationRecord => ({
  id: `${integrationKey}-config`,
  integrationKey,
  publicConfig:
    integrationKey === 'nango'
      ? { baseUrl: 'https://api.nango.dev' }
      : { clientId: 'gmail-client-id' },
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
  let dependencies: GmailChannelConfigServiceDependencies;

  beforeEach(() => {
    channels = createChannelRepository();
    integrations = new Map();
    gmailMapping = null;
    bindingCounts = { nango: 0, zero_oauth: 0 };
    subscriptionRefreshes = [];
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
      requestSubscriptionRefresh: async (provider) => {
        subscriptionRefreshes.push(provider);
      },
    };
  });

  it('rejects Nango mode until Nango and its Gmail mapping are active', async () => {
    integrations.set('nango', activeIntegration('nango'));

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
    integrations.set('nango', activeIntegration('nango'));
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
    integrations.set('gmail_zero_oauth', activeIntegration('gmail_zero_oauth'));
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
    integrations.set('gmail_zero_oauth', activeIntegration('gmail_zero_oauth'));
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
          configured: false,
          serviceConfigured: false,
          bindingCount: 0,
        },
      },
    });
  });

  it('marks every existing Gmail subscription due when Watch is enabled', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration('gmail_zero_oauth'));
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

  it('does not request a subscription refresh while Watch is disabled', async () => {
    integrations.set('gmail_zero_oauth', activeIntegration('gmail_zero_oauth'));

    await createGmailChannelConfigService(dependencies).save({
      authSource: 'zero_oauth',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: {},
      updatedBy: 'admin-1',
    });

    expect(subscriptionRefreshes).toEqual([]);
  });
});
