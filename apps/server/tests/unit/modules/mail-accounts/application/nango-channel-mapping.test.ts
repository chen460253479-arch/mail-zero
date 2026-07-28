import { describe, expect, it, vi } from 'vitest';

import type { SystemIntegrationRepository } from '../../../../../src/integrations/core/repository';
import { NangoIntegrationError } from '../../../../../src/integrations/nango/errors';
import { NangoChannelMappingService } from '../../../../../src/modules/mail-accounts/application/nango-channel-mapping';

const now = new Date('2026-07-24T08:00:00.000Z');
const gmailIntegration = {
  unique_key: 'gmail-production',
  display_name: 'Gmail Production',
  provider: 'google-mail',
};
const unrelatedIntegration = {
  unique_key: 'calendar-production',
  display_name: 'Calendar Production',
  provider: 'google-calendar',
};

const createRepository = () => {
  let mapping: Awaited<ReturnType<SystemIntegrationRepository['getMapping']>> = null;
  let bindingCount = 0;
  const repository = {
    getMapping: vi.fn(async () => mapping),
    setMapping: vi.fn(async (channelId, authSource, integrationId) => {
      mapping = {
        id: 'mapping-1',
        channelId,
        authSource,
        externalIntegrationId: integrationId,
        createdAt: now,
        updatedAt: now,
      };
    }),
    countNangoBindings: vi.fn(async () => bindingCount),
  } as unknown as SystemIntegrationRepository;
  return {
    repository,
    setMapping(value: typeof mapping) {
      mapping = value;
    },
    setBindingCount(value: number) {
      bindingCount = value;
    },
  };
};

const createService = (state: ReturnType<typeof createRepository>) =>
  new NangoChannelMappingService({
    repository: state.repository,
    listIntegrations: async () => [gmailIntegration, unrelatedIntegration],
    getChannel: () => ({
      id: 'gmail',
      nangoProviders: ['google-mail'],
    }),
  });

describe('Nango channel mapping service', () => {
  it('lists only integrations supported by the selected mail channel', async () => {
    const state = createRepository();

    await expect(createService(state).listIntegrations('gmail')).resolves.toEqual([
      gmailIntegration,
    ]);
  });

  it('rejects replacing a mapping that still has authorization bindings', async () => {
    const state = createRepository();
    state.setMapping({
      id: 'mapping-1',
      channelId: 'gmail',
      authSource: 'nango',
      externalIntegrationId: 'gmail-production',
      createdAt: now,
      updatedAt: now,
    });
    state.setBindingCount(1);

    await expect(createService(state).setMapping('gmail', 'gmail-replacement')).rejects.toEqual(
      new NangoIntegrationError('INTEGRATION_IN_USE'),
    );
  });

  it('rejects an integration that the selected channel does not support', async () => {
    const state = createRepository();

    await expect(createService(state).setMapping('gmail', 'calendar-production')).rejects.toEqual(
      new NangoIntegrationError('NANGO_INTEGRATION_UNAVAILABLE'),
    );
  });
});
