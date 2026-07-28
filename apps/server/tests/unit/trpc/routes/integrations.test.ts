import { describe, expect, it, vi } from 'vitest';

import { GmailOAuthError } from '../../../../src/modules/mail-accounts/application/connect-gmail-oauth';
import { GmailChannelConfigError } from '../../../../src/integrations/gmail/channel-config-service';
import { mapIntegrationError } from '../../../../src/trpc/routes/integration-errors';
import { NangoIntegrationError } from '../../../../src/integrations/nango/errors';
import { integrationsRouter } from '../../../../src/trpc/routes/integrations';

vi.mock('cloudflare:workers', () => ({ env: {} }));

describe('administrator integrations router', () => {
  it('exposes the unified Gmail channel configuration procedures', () => {
    const procedures = Object.keys(integrationsRouter._def.procedures);
    for (const procedure of ['getChannels', 'getGmailConfig', 'saveGmailConfig']) {
      expect(procedures).toContain(procedure);
    }
  });

  it('maps occupied integration errors to conflict without provider details', () => {
    expect(() => mapIntegrationError(new NangoIntegrationError('INTEGRATION_IN_USE'))).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        message: 'INTEGRATION_IN_USE',
      }),
    );
  });

  it('maps validation errors to stable precondition codes', () => {
    expect(() => mapIntegrationError(new GmailOAuthError('GMAIL_OAUTH_VALIDATION_FAILED'))).toThrow(
      expect.objectContaining({
        code: 'PRECONDITION_FAILED',
        message: 'GMAIL_OAUTH_VALIDATION_FAILED',
      }),
    );
  });

  it('preserves safe Nango operation details for the administrator client', () => {
    expect(() =>
      mapIntegrationError(
        new NangoIntegrationError('NANGO_INSUFFICIENT_PERMISSIONS', 'list_integrations', 403),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'PRECONDITION_FAILED',
        message: 'NANGO_INSUFFICIENT_PERMISSIONS|list_integrations|403',
      }),
    );
  });

  it('maps a locked Gmail authorization source to a conflict', () => {
    expect(() =>
      mapIntegrationError(new GmailChannelConfigError('GMAIL_AUTH_SOURCE_IN_USE')),
    ).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        message: 'GMAIL_AUTH_SOURCE_IN_USE',
      }),
    );
  });
});
