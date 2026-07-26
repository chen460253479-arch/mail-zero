import { describe, expect, it, vi } from 'vitest';

vi.mock('../driver/google', () => ({
  GoogleMailManager: class {},
}));

import {
  assertMailChannelBinding,
  channelIdToProviderId,
  getMailChannel,
  listMailChannels,
  providerIdToChannelId,
} from './registry';

describe('mail channel registry', () => {
  it('registers only channels that are operational', () => {
    expect(listMailChannels().map(({ id }) => id)).toEqual(['gmail']);
  });

  it('maps the legacy Google provider to Gmail', () => {
    expect(providerIdToChannelId('google')).toBe('gmail');
    expect(channelIdToProviderId('gmail')).toBe('google');
  });

  it('validates provider keys and credential support at the plugin boundary', () => {
    expect(() =>
      assertMailChannelBinding({
        channelId: 'gmail',
        providerKey: 'gmail',
        credentialType: 'oauth2',
      }),
    ).not.toThrow();
    expect(() =>
      assertMailChannelBinding({
        channelId: 'gmail',
        providerKey: 'outlook',
        credentialType: 'oauth2',
      }),
    ).toThrow('MAIL_CHANNEL_PROVIDER_MISMATCH');
    expect(() =>
      assertMailChannelBinding({
        channelId: 'gmail',
        providerKey: 'gmail',
        credentialType: 'basic',
      }),
    ).toThrow('MAIL_CHANNEL_CREDENTIAL_UNSUPPORTED');
  });

  it('rejects unknown channels instead of returning a partial plugin', () => {
    expect(() => getMailChannel('zoho_mail')).toThrow('Unsupported mail channel');
  });
});
