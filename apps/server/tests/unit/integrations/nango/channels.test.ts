import { describe, expect, it, vi } from 'vitest';

import {
  createNangoChannelIntegrationService,
  type NangoChannelEnvironment,
} from '../../../../src/integrations/nango/channels';
import type { NangoRuntimeStatus } from '../../../../src/integrations/nango/service';
import type { MailChannelId } from '../../../../src/mail-channel/contracts';

const checkedAt = new Date('2026-07-29T08:00:00.000Z');

const configuredEnvironment: NangoChannelEnvironment = {
  NANGO_GMAIL_INTEGRATION_KEY: 'gmail',
  NANGO_OUTLOOK_INTEGRATION_KEY: 'outlook',
  NANGO_ZOHO_MAIL_INTEGRATION_KEY: 'zoho-mail',
  NANGO_IMAP_SMTP_INTEGRATION_KEY: 'imap-smtp',
};

const providersByChannel: Record<MailChannelId, readonly string[]> = {
  gmail: ['google-mail'],
  outlook: ['microsoft'],
  zoho_mail: ['zoho-mail'],
  imap_smtp: ['generic-email'],
};

const integrations = [
  { unique_key: 'gmail', display_name: 'Gmail', provider: 'google-mail' },
  { unique_key: 'outlook', display_name: 'Outlook', provider: 'microsoft' },
  { unique_key: 'zoho-mail', display_name: 'Zoho Mail', provider: 'zoho-mail' },
  { unique_key: 'imap-smtp', display_name: 'IMAP/SMTP', provider: 'generic-email' },
];

const availableStatus: NangoRuntimeStatus = {
  state: 'available',
  checkedAt,
  errorCode: null,
};

const createService = (
  input: {
    environment?: NangoChannelEnvironment;
    runtimeStatus?: NangoRuntimeStatus;
    integrations?: typeof integrations;
  } = {},
) => {
  const initialize = vi.fn(async () => input.runtimeStatus ?? availableStatus);
  const listIntegrations = vi.fn(async () => input.integrations ?? integrations);
  const service = createNangoChannelIntegrationService({
    environment: input.environment ?? configuredEnvironment,
    nango: { initialize, listIntegrations },
    getChannel: (channelId) => ({
      id: channelId,
      nangoProviders: providersByChannel[channelId],
    }),
    now: () => checkedAt,
  });
  return { initialize, listIntegrations, service };
};

describe('Nango channel fixed Integration Keys', () => {
  it.each([
    ['gmail', 'gmail'],
    ['outlook', 'outlook'],
    ['zoho_mail', 'zoho-mail'],
    ['imap_smtp', 'imap-smtp'],
  ] as const)('resolves the server-owned key for %s', async (channelId, expectedKey) => {
    const { service } = createService();

    await expect(service.requireIntegrationKey(channelId)).resolves.toBe(expectedKey);
    await expect(service.getStatus(channelId)).resolves.toEqual(availableStatus);
  });

  it('marks only a channel with a missing key unconfigured', async () => {
    const { service } = createService({
      environment: {
        ...configuredEnvironment,
        NANGO_GMAIL_INTEGRATION_KEY: '   ',
      },
    });

    await expect(service.getStatus('gmail')).resolves.toEqual({
      state: 'unconfigured',
      checkedAt,
      errorCode: 'NANGO_CHANNEL_KEY_MISSING',
    });
    await expect(service.getStatus('outlook')).resolves.toEqual(availableStatus);
  });

  it('marks a configured key unavailable when Nango does not contain it', async () => {
    const { service } = createService({
      integrations: integrations.filter(({ unique_key }) => unique_key !== 'gmail'),
    });

    await expect(service.getStatus('gmail')).resolves.toEqual({
      state: 'unavailable',
      checkedAt,
      errorCode: 'NANGO_INTEGRATION_NOT_FOUND',
    });
  });

  it('rejects a fixed key whose Provider does not belong to the channel plugin', async () => {
    const { service } = createService({
      integrations: integrations.map((integration) =>
        integration.unique_key === 'gmail'
          ? { ...integration, provider: 'microsoft' }
          : integration,
      ),
    });

    await expect(service.getStatus('gmail')).resolves.toEqual({
      state: 'unavailable',
      checkedAt,
      errorCode: 'NANGO_PROVIDER_MISMATCH',
    });
  });

  it('propagates a safe global Nango failure to configured channels', async () => {
    const { listIntegrations, service } = createService({
      runtimeStatus: {
        state: 'unavailable',
        checkedAt,
        errorCode: 'NANGO_UNREACHABLE',
      },
    });

    await expect(service.getStatus('gmail')).resolves.toEqual({
      state: 'unavailable',
      checkedAt,
      errorCode: 'NANGO_UNREACHABLE',
    });
    expect(listIntegrations).not.toHaveBeenCalled();
  });

  it('shares one initialization across concurrent channel reads', async () => {
    const { initialize, listIntegrations, service } = createService();

    await Promise.all([
      service.getStatus('gmail'),
      service.getStatus('outlook'),
      service.requireIntegrationKey('zoho_mail'),
    ]);

    expect(initialize).toHaveBeenCalledOnce();
    expect(listIntegrations).toHaveBeenCalledOnce();
  });

  it('rejects binding when the fixed Integration is unavailable', async () => {
    const { service } = createService({
      integrations: integrations.filter(({ unique_key }) => unique_key !== 'gmail'),
    });

    await expect(service.requireIntegrationKey('gmail')).rejects.toMatchObject({
      code: 'NANGO_INTEGRATION_NOT_FOUND',
    });
  });
});
