import { describe, expect, it } from 'vitest';

import { parseGmailChannelConfig } from '../../../../src/mail-channel/gmail/config';

describe('Gmail channel configuration', () => {
  it('accepts manual-only operation without Pub/Sub configuration', () => {
    expect(
      parseGmailChannelConfig({
        channelId: 'gmail',
        authSource: 'nango',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: false,
        syncIntervalMinutes: 10,
        providerConfig: {},
      }),
    ).toEqual({
      channelId: 'gmail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 10,
      providerConfig: {},
    });
  });

  it('requires only the Google Pub/Sub topic when Inbox Watch is enabled', () => {
    expect(() =>
      parseGmailChannelConfig({
        channelId: 'gmail',
        authSource: 'zero_oauth',
        inboxWatchEnabled: true,
        scheduledSyncEnabled: false,
        syncIntervalMinutes: 10,
        providerConfig: {},
      }),
    ).toThrow();

    expect(
      parseGmailChannelConfig({
        channelId: 'gmail',
        authSource: 'zero_oauth',
        inboxWatchEnabled: true,
        scheduledSyncEnabled: false,
        syncIntervalMinutes: 10,
        providerConfig: {
          topicName: 'projects/zero-mail/topics/gmail-inbound',
          subscriptionName: 'projects/zero-mail/subscriptions/gmail-inbound-push',
          pushAudience: 'https://mail.example.test/api/mail/channels/gmail/push',
          pushServiceAccount: 'gmail-push@zero-mail.iam.gserviceaccount.com',
        },
      }),
    ).toMatchObject({
      inboxWatchEnabled: true,
      providerConfig: {
        topicName: 'projects/zero-mail/topics/gmail-inbound',
      },
    });

    const parsed = parseGmailChannelConfig({
      channelId: 'gmail',
      authSource: 'zero_oauth',
      inboxWatchEnabled: true,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 10,
      providerConfig: {
        topicName: 'projects/zero-mail/topics/gmail-inbound',
        subscriptionName: 'projects/zero-mail/subscriptions/gmail-inbound-push',
        pushAudience: 'https://mail.example.test/api/mail/channels/gmail/push',
        pushServiceAccount: 'gmail-push@zero-mail.iam.gserviceaccount.com',
      },
    });

    expect(parsed.providerConfig).not.toHaveProperty('subscriptionName');
    expect(parsed.providerConfig).not.toHaveProperty('pushAudience');
    expect(parsed.providerConfig).not.toHaveProperty('pushServiceAccount');
  });

  it('rejects unsupported authorization sources and invalid sync intervals', () => {
    expect(() =>
      parseGmailChannelConfig({
        channelId: 'gmail',
        authSource: 'manual',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 10,
        providerConfig: {},
      }),
    ).toThrow();

    expect(() =>
      parseGmailChannelConfig({
        channelId: 'gmail',
        authSource: 'nango',
        inboxWatchEnabled: false,
        scheduledSyncEnabled: true,
        syncIntervalMinutes: 0,
        providerConfig: {},
      }),
    ).toThrow();
  });
});
