import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMailChannelConfigService,
  type MailChannelConfigServiceDependencies,
} from '../../../../src/integrations/mail-channel/channel-config-service';
import type {
  ChannelConfigRecord,
  ChannelConfigRepository,
  SaveChannelConfigInput,
} from '../../../../src/integrations/core/channel-config-repository';
import type { SystemIntegrationRecord } from '../../../../src/integrations/core/repository';

const now = new Date('2026-07-28T12:00:00.000Z');

const createChannelRepository = (): ChannelConfigRepository & {
  records: Map<string, ChannelConfigRecord>;
} => ({
  records: new Map(),
  async get(channelId) {
    return this.records.get(channelId) ?? null;
  },
  async save(input: SaveChannelConfigInput) {
    const saved = {
      id: `${input.channelId}-config`,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(input.channelId, saved);
    return saved;
  },
});

describe('managed mail-channel configuration', () => {
  let channels: ReturnType<typeof createChannelRepository>;
  let integrations: Map<string, SystemIntegrationRecord>;
  let mappings: Map<string, string>;
  let counts: Record<string, number>;
  let refreshed: string[];
  let disabled: string[];
  let dependencies: MailChannelConfigServiceDependencies;

  beforeEach(() => {
    channels = createChannelRepository();
    integrations = new Map();
    mappings = new Map();
    counts = {};
    refreshed = [];
    disabled = [];
    dependencies = {
      channels,
      integrations: {
        get: async (key) => integrations.get(key) ?? null,
        getMapping: async (channelId) => {
          const externalIntegrationId = mappings.get(channelId);
          return externalIntegrationId ? ({ externalIntegrationId } as never) : null;
        },
        countBindings: async (channelId, authSource) =>
          counts[`${channelId}:${authSource ?? 'all'}`] ?? 0,
      },
      getNangoStatus: () => ({
        state: 'available',
        checkedAt: now,
        errorCode: null,
      }),
      publicBackendUrl: 'https://mail.example.test/',
      protocolWorkerAvailable: true,
      requestSubscriptionRefresh: async (provider) => {
        refreshed.push(provider);
      },
      disableSubscriptions: async (provider) => {
        disabled.push(provider);
      },
    };
  });

  it('requires a selected Nango integration for Outlook', async () => {
    await expect(
      createMailChannelConfigService(dependencies).save({
        channelId: 'outlook',
        authSource: 'nango',
        inboxWatchEnabled: true,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: { tenantId: 'common' },
        updatedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'MAIL_CHANNEL_AUTH_SOURCE_NOT_CONFIGURED' });
  });

  it('persists Zoho data-center and exposes the fixed webhook template', async () => {
    mappings.set('zoho_mail', 'zoho-primary');

    const saved = await createMailChannelConfigService(dependencies).save({
      channelId: 'zoho_mail',
      authSource: 'nango',
      inboxWatchEnabled: true,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 15,
      providerConfig: { dataCenter: 'eu' },
      updatedBy: 'admin-1',
    });

    expect(saved).toMatchObject({
      channelId: 'zoho_mail',
      providerConfig: { dataCenter: 'eu' },
      webhookUrl: 'https://mail.example.test/api/webhooks/mail/zoho/:endpointToken',
      authorizationSources: {
        nango: { integrationId: 'zoho-primary', configured: true },
      },
    });
    expect(refreshed).toEqual(['zoho_mail']);
  });

  it('supports manual IMAP/SMTP only when the protocol worker is configured', async () => {
    dependencies.protocolWorkerAvailable = false;
    const input = {
      channelId: 'imap_smtp' as const,
      authSource: 'manual' as const,
      inboxWatchEnabled: false as const,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 5,
      providerConfig: {},
      updatedBy: 'admin-1',
    };

    await expect(createMailChannelConfigService(dependencies).save(input)).rejects.toMatchObject({
      code: 'MAIL_CHANNEL_AUTH_SOURCE_NOT_CONFIGURED',
    });

    dependencies.protocolWorkerAvailable = true;
    await expect(createMailChannelConfigService(dependencies).save(input)).resolves.toMatchObject({
      channelId: 'imap_smtp',
      authSource: 'manual',
      webhookUrl: null,
    });
  });

  it('locks the selected authorization source while bindings exist', async () => {
    mappings.set('outlook', 'outlook-primary');
    counts['outlook:zero_oauth'] = 1;
    channels.records.set('outlook', {
      id: 'outlook-config',
      channelId: 'outlook',
      authSource: 'zero_oauth',
      inboxWatchEnabled: true,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 10,
      providerConfig: { tenantId: 'common' },
      updatedBy: 'admin-1',
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      createMailChannelConfigService(dependencies).save({
        channelId: 'outlook',
        authSource: 'nango',
        inboxWatchEnabled: true,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: { tenantId: 'common' },
        updatedBy: 'admin-1',
      }),
    ).rejects.toMatchObject({ code: 'MAIL_CHANNEL_AUTH_SOURCE_IN_USE' });
  });

  it('clears provider subscription routing when Inbox Watch is disabled', async () => {
    mappings.set('zoho_mail', 'zoho-primary');

    await createMailChannelConfigService(dependencies).save({
      channelId: 'zoho_mail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: true,
      syncIntervalMinutes: 15,
      providerConfig: { dataCenter: 'eu' },
      updatedBy: 'admin-1',
    });

    expect(refreshed).toEqual([]);
    expect(disabled).toEqual(['zoho_mail']);
  });
});
