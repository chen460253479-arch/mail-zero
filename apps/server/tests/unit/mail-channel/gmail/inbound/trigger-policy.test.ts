import { describe, expect, it } from 'vitest';

import { resolveGmailInboundTriggerPolicy } from '../../../../../src/mail-channel/gmail/inbound/trigger-policy';
import type { GmailChannelConfig } from '../../../../../src/mail-channel/gmail/config';

const now = new Date('2026-07-28T08:00:00.000Z');

describe('Gmail inbound trigger policy', () => {
  it('disables only time-based work while retaining the configured discovery interval', () => {
    const config: GmailChannelConfig = {
      channelId: 'gmail',
      authSource: 'nango',
      inboxWatchEnabled: false,
      scheduledSyncEnabled: false,
      syncIntervalMinutes: 30,
      providerConfig: {},
    };

    expect(resolveGmailInboundTriggerPolicy(config, now)).toEqual({
      subscriptionTarget: null,
      reconcileBefore: new Date(0),
      renewalBefore: new Date(0),
      reconcileAfterMs: 1_800_000,
    });
  });

  it('enables scheduled reconciliation and Watch renewal independently', () => {
    const config: GmailChannelConfig = {
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
    };

    expect(resolveGmailInboundTriggerPolicy(config, now)).toEqual({
      subscriptionTarget: {
        version: 1,
        topicName: 'projects/zero-mail/topics/gmail-inbound',
      },
      reconcileBefore: new Date(0),
      renewalBefore: new Date('2026-07-29T08:00:00.000Z'),
      reconcileAfterMs: 600_000,
    });
  });
});
