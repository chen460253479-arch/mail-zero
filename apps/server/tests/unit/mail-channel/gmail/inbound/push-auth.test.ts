import { describe, expect, it } from 'vitest';

import { authenticateGmailPush } from '../../../../../src/mail-channel/gmail/inbound/push-auth';

const config = {
  topicName: 'projects/zero-mail/topics/gmail-inbound',
  subscriptionName: 'projects/zero-mail/subscriptions/gmail-inbound-push',
  pushAudience: 'https://api.example.com/a8n/notify/google',
  pushServiceAccount: 'gmail-push@zero-mail.iam.gserviceaccount.com',
};

const verifier = (payload: Record<string, unknown>) => ({
  verifyIdToken: async (input: { idToken: string; audience: string }) => {
    expect(input).toEqual({
      idToken: 'signed-token',
      audience: config.pushAudience,
    });
    return { payload };
  },
});

const validPayload = {
  iss: 'https://accounts.google.com',
  aud: config.pushAudience,
  email: config.pushServiceAccount,
  email_verified: true,
};

describe('Gmail Pub/Sub push authentication', () => {
  it('accepts only the configured shared Subscription and OIDC identity', async () => {
    await expect(
      authenticateGmailPush(
        {
          authorizationHeader: 'Bearer signed-token',
          subscriptionName: config.subscriptionName,
        },
        config,
        verifier(validPayload),
      ),
    ).resolves.toBe(true);
  });

  it.each([
    ['issuer', { ...validPayload, iss: 'https://example.com' }],
    ['audience', { ...validPayload, aud: 'https://other.example.com' }],
    ['service account', { ...validPayload, email: 'other@zero-mail.iam.gserviceaccount.com' }],
    ['verified email', { ...validPayload, email_verified: false }],
  ])('rejects a token with the wrong %s', async (_label, payload) => {
    await expect(
      authenticateGmailPush(
        {
          authorizationHeader: 'Bearer signed-token',
          subscriptionName: config.subscriptionName,
        },
        config,
        verifier(payload),
      ),
    ).resolves.toBe(false);
  });

  it('rejects a different Subscription before verifying a token', async () => {
    let verified = false;
    await expect(
      authenticateGmailPush(
        {
          authorizationHeader: 'Bearer signed-token',
          subscriptionName: 'projects/other/subscriptions/other',
        },
        config,
        {
          verifyIdToken: async () => {
            verified = true;
            return { payload: validPayload };
          },
        },
      ),
    ).resolves.toBe(false);
    expect(verified).toBe(false);
  });

  it.each([undefined, '', 'Basic signed-token', 'Bearer'])(
    'rejects malformed authorization %o',
    async (authorizationHeader) => {
      await expect(
        authenticateGmailPush(
          {
            authorizationHeader,
            subscriptionName: config.subscriptionName,
          },
          config,
          verifier(validPayload),
        ),
      ).resolves.toBe(false);
    },
  );
});
