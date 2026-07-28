import { describe, expect, it } from 'vitest';

import type { NangoIntegration } from '../../../../../src/integrations/nango/schemas';
import { defaultMailChannelRegistry } from '../../../../../src/mail-channel/registry';
import { listAvailableNangoChannels } from '../../../../../src/modules/mail-accounts/application/list-nango-channels';

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
      defaultMailChannelRegistry.list(),
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
      defaultMailChannelRegistry.list(),
    );

    expect(result).toEqual([]);
  });

  it('does not expose non-mail Nango integrations', () => {
    const result = listAvailableNangoChannels(
      [integration('slack-primary', 'Slack', 'slack')],
      defaultMailChannelRegistry.list(),
    );

    expect(result).toEqual([]);
  });

  it('deduplicates channels while preserving sorted integration IDs', () => {
    const result = listAvailableNangoChannels(
      [
        integration('gmail-secondary', 'Secondary', 'google'),
        integration('gmail-primary', 'Primary', 'google-mail'),
      ],
      defaultMailChannelRegistry.list(),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.integrations).toEqual([
      { integrationId: 'gmail-primary', displayName: 'Primary' },
      { integrationId: 'gmail-secondary', displayName: 'Secondary' },
    ]);
  });
});
