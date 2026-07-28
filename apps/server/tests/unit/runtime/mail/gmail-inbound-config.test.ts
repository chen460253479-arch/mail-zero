import { describe, expect, it } from 'vitest';

import { readGmailInboundConfig } from '../../../../src/runtime/mail/gmail-inbound-config';

const valid = {
  GMAIL_PUBSUB_TOPIC_NAME: 'projects/zero-mail/topics/gmail-inbound',
  GMAIL_PUBSUB_SUBSCRIPTION_NAME: 'projects/zero-mail/subscriptions/gmail-inbound-push',
  GMAIL_PUBSUB_PUSH_AUDIENCE: 'https://api.example.com/a8n/notify/google',
  GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT: 'gmail-push@zero-mail.iam.gserviceaccount.com',
};

describe('Gmail inbound deployment configuration', () => {
  it('returns one deployment-level Topic and Subscription without a connection suffix', () => {
    expect(readGmailInboundConfig(valid)).toEqual({
      topicName: 'projects/zero-mail/topics/gmail-inbound',
      subscriptionName: 'projects/zero-mail/subscriptions/gmail-inbound-push',
      pushAudience: 'https://api.example.com/a8n/notify/google',
      pushServiceAccount: 'gmail-push@zero-mail.iam.gserviceaccount.com',
    });
  });

  it.each([
    ['GMAIL_PUBSUB_TOPIC_NAME', 'projects/zero-mail/topics/'],
    ['GMAIL_PUBSUB_SUBSCRIPTION_NAME', 'gmail-inbound-push'],
    ['GMAIL_PUBSUB_PUSH_AUDIENCE', 'not-a-url'],
    ['GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT', 'not-a-service-account@example.com'],
  ] as const)('rejects invalid %s', (key, value) => {
    expect(() => readGmailInboundConfig({ ...valid, [key]: value })).toThrow(`Invalid ${key}`);
  });
});
