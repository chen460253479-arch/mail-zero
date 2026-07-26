import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/driver/google', () => ({
  GoogleMailManager: class {},
}));

import type { NangoIntegration } from '../../../integrations/nango/schemas';
import { listMailChannels } from '../../../lib/mail-channel/registry';
import { listAvailableNangoChannels } from './list-nango-channels';

const integration = (
  unique_key: string,
  display_name: string,
  provider: string,
): NangoIntegration => ({
  unique_key,
  display_name,
  provider,
});

describe('Nango mail channel catalog', () => {
  it('shows Gmail when Nango has Google Mail and Gmail is registered', () => {
    const result = listAvailableNangoChannels(
      [integration('gmail-primary', 'Company Gmail', 'google-mail')],
      listMailChannels(),
    );

    expect(result).toEqual([
      {
        channelId: 'gmail',
        displayName: 'Gmail',
        integrations: [{ integrationId: 'gmail-primary', displayName: 'Company Gmail' }],
      },
    ]);
  });

  it('does not show Zoho when no Zoho channel plugin is registered', () => {
    const result = listAvailableNangoChannels(
      [integration('zoho-primary', 'Zoho Mail', 'zoho-mail')],
      listMailChannels(),
    );

    expect(result).toEqual([]);
  });

  it('does not expose non-mail Nango integrations', () => {
    const result = listAvailableNangoChannels(
      [integration('slack-primary', 'Slack', 'slack')],
      listMailChannels(),
    );

    expect(result).toEqual([]);
  });

  it('deduplicates channels while preserving sorted integration IDs', () => {
    const result = listAvailableNangoChannels(
      [
        integration('gmail-secondary', 'Secondary', 'google'),
        integration('gmail-primary', 'Primary', 'google-mail'),
      ],
      listMailChannels(),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.integrations).toEqual([
      { integrationId: 'gmail-primary', displayName: 'Primary' },
      { integrationId: 'gmail-secondary', displayName: 'Secondary' },
    ]);
  });
});
