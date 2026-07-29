import { describe, expect, it } from 'vitest';

import { resolveChannelConnectAction } from './connect-mode';

describe('mail channel connection routing', () => {
  it('routes provider OAuth through the selected channel endpoint', () => {
    expect(resolveChannelConnectAction('outlook', 'zero_oauth')).toEqual({
      type: 'redirect',
      path: '/api/integrations/outlook/connect/start',
    });
    expect(resolveChannelConnectAction('zoho_mail', 'zero_oauth')).toEqual({
      type: 'redirect',
      path: '/api/integrations/zoho_mail/connect/start',
    });
  });

  it('keeps Nango and manual credentials inside their dedicated dialogs', () => {
    expect(resolveChannelConnectAction('gmail', 'nango')).toEqual({
      type: 'nango',
      channelId: 'gmail',
    });
    expect(resolveChannelConnectAction('imap_smtp', 'manual')).toEqual({
      type: 'manual',
    });
  });

  it('does not fall back to another authorization source', () => {
    expect(resolveChannelConnectAction('outlook', 'unavailable')).toEqual({
      type: 'unavailable',
    });
  });
});
