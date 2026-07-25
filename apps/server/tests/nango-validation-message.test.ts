import { describe, expect, it } from 'vitest';

import { getNangoValidationErrorMessage } from '../../mail/lib/nango-validation-error';

describe('Nango administrator validation messages', () => {
  it.each([
    [
      'NANGO_API_KEY_INVALID|list_integrations|401',
      'The Nango API Key is invalid or belongs to a different environment (401).',
    ],
    [
      'NANGO_INSUFFICIENT_PERMISSIONS|list_integrations|403',
      'The Nango API Key is missing environment:integrations:list (403).',
    ],
    [
      'NANGO_INSUFFICIENT_PERMISSIONS|get_connection|403',
      'The Nango API Key is missing environment:connections:read_credentials (403).',
    ],
    [
      'NANGO_ENDPOINT_NOT_FOUND|list_integrations|404',
      'The Nango Base URL does not expose the integrations endpoint (404).',
    ],
    [
      'NANGO_CONNECTION_NOT_FOUND|get_connection|404',
      'An existing Nango connection could not be found; disconnect that mailbox before updating the configuration (404).',
    ],
    [
      'NANGO_UNREACHABLE|list_integrations|',
      'Zero could not reach the Nango service while listing integrations.',
    ],
    [
      'NANGO_INVALID_RESPONSE|get_connection|200',
      'Nango returned an incompatible response while reading connection credentials (200).',
    ],
    [
      'NANGO_CONNECTION_INVALID|get_connection|424',
      'Nango could not provide valid credentials for an existing connection (424).',
    ],
  ])('maps %s to an actionable safe message', (message, expected) => {
    expect(getNangoValidationErrorMessage(new Error(message))).toBe(expected);
  });

  it('does not display unknown upstream error text', () => {
    expect(getNangoValidationErrorMessage(new Error('sensitive upstream response'))).toBe(
      'Nango validation failed; the existing configuration was kept.',
    );
  });
});
