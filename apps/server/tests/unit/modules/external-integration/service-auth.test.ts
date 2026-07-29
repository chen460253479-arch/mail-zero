import { describe, expect, it } from 'vitest';

import { requireIntegrationServiceToken } from '../../../../src/modules/external-integration/service-auth';

describe('external integration service authentication', () => {
  it('accepts the configured bearer token', () => {
    expect(() => requireIntegrationServiceToken('fixed-token', 'Bearer fixed-token')).not.toThrow();
  });

  it.each([undefined, '', 'Basic fixed-token', 'Bearer wrong-token', 'Bearer '])(
    'rejects an invalid authorization header',
    (authorizationHeader) => {
      expect(() => requireIntegrationServiceToken('fixed-token', authorizationHeader)).toThrow(
        'INTEGRATION_UNAUTHORIZED',
      );
    },
  );

  it('rejects requests when the service token is not configured', () => {
    expect(() => requireIntegrationServiceToken(undefined, 'Bearer fixed-token')).toThrow(
      'INTEGRATION_UNAUTHORIZED',
    );
  });
});
