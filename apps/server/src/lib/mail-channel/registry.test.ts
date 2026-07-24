import { describe, expect, it, vi } from 'vitest';

vi.mock('../driver/google', () => ({
  GoogleMailManager: class {},
}));

import { getMailChannel, listMailChannels, providerIdToChannelId } from './registry';

describe('mail channel registry', () => {
  it('registers only channels that are operational', () => {
    expect(listMailChannels().map(({ id }) => id)).toEqual(['gmail']);
  });

  it('maps the legacy Google provider to Gmail', () => {
    expect(providerIdToChannelId('google')).toBe('gmail');
  });

  it('rejects unknown channels instead of returning a partial plugin', () => {
    expect(() => getMailChannel('zoho_mail')).toThrow('Unsupported mail channel');
  });
});
