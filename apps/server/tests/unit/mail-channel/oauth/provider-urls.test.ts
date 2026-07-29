import { describe, expect, it } from 'vitest';

import { MicrosoftOutlookOAuthGateway } from '../../../../src/mail-channel/outlook/auth/microsoft-oauth-gateway';
import { ZohoMailOAuthGateway } from '../../../../src/mail-channel/zoho-mail/auth/zoho-oauth-gateway';

describe('mail OAuth provider URL policy', () => {
  it('uses only the fixed Microsoft identity origin and configured tenant', () => {
    const url = new URL(
      new MicrosoftOutlookOAuthGateway().createAuthorizationUrl({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'https://mail.example.test/callback',
        providerConfig: { tenantId: 'organizations' },
        state: 'state',
      }),
    );
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/organizations/oauth2/v2.0/authorize');
    const scopes = new Set(url.searchParams.get('scope')?.split(' '));
    expect(scopes).toContain('Mail.ReadWrite');
    expect(scopes).toContain('Mail.Send');
    expect(scopes).not.toContain('Mail.Read');
  });

  it('maps Zoho data centers to a fixed account origin', () => {
    const url = new URL(
      new ZohoMailOAuthGateway().createAuthorizationUrl({
        clientId: 'client-id',
        clientSecret: 'secret',
        redirectUri: 'https://mail.example.test/callback',
        providerConfig: { dataCenter: 'eu' },
        state: 'state',
      }),
    );
    expect(url.origin).toBe('https://accounts.zoho.eu');
    expect(url.pathname).toBe('/oauth/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('ZohoMail.messages.READ');
  });
});
