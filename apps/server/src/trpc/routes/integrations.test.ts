import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { GmailOAuthError } from '../../lib/integrations/gmail-oauth-service';
import { NangoIntegrationError } from '../../integrations/nango/errors';
import { mapIntegrationError } from './integration-errors';

describe('administrator integrations router', () => {
  it('registers only the approved integration management procedures', () => {
    const source = readFileSync('src/trpc/routes/integrations.ts', 'utf8');
    for (const procedure of [
      'deleteGmailZeroOAuth',
      'deleteNango',
      'getGmailValidationStatus',
      'getOverview',
      'listNangoGmailIntegrations',
      'setNangoGmailIntegration',
      'startGmailValidation',
      'validateAndSaveNango',
    ]) {
      expect(source).toMatch(new RegExp(`${procedure}: adminProcedure`));
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
});
