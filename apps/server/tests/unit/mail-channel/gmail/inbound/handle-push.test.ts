import { describe, expect, it } from 'vitest';

import { handleGmailPush } from '../../../../../src/mail-channel/gmail/inbound/handle-push';

describe('Gmail inbound push handler', () => {
  it('turns a valid Gmail notification into a generic signal command', async () => {
    const events: unknown[] = [];

    await expect(
      handleGmailPush(
        {
          emailAddress: 'User@Example.com',
          historyId: '123',
        },
        {
          recordSignal: async (signal) => {
            events.push({ type: 'record', signal });
            return ['sync-1'];
          },
          enqueueDiscover: async (syncId) => {
            events.push({ type: 'enqueue', syncId });
          },
        },
      ),
    ).resolves.toEqual({ accepted: true, matched: 1, queued: 1 });

    expect(events).toEqual([
      {
        type: 'record',
        signal: {
          provider: 'gmail',
          externalAccount: 'user@example.com',
          cursorHint: '123',
        },
      },
      { type: 'enqueue', syncId: 'sync-1' },
    ]);
  });

  it('decodes the standard Pub/Sub message envelope', async () => {
    let signal: unknown;
    const data = Buffer.from(
      JSON.stringify({
        emailAddress: 'wrapped@example.com',
        historyId: '456',
      }),
    ).toString('base64');

    await expect(
      handleGmailPush(
        {
          message: {
            data,
            messageId: 'pubsub-message-1',
          },
          subscription: 'projects/zero-mail/subscriptions/gmail-inbound-push',
        },
        {
          recordSignal: async (input) => {
            signal = input;
            return [];
          },
          enqueueDiscover: async () => undefined,
        },
      ),
    ).resolves.toEqual({ accepted: true, matched: 0, queued: 0 });
    expect(signal).toEqual({
      provider: 'gmail',
      externalAccount: 'wrapped@example.com',
      cursorHint: '456',
    });
  });

  it('acknowledges a durably recorded signal even when Queue wakeup fails', async () => {
    const events: string[] = [];

    await expect(
      handleGmailPush(
        {
          emailAddress: 'user@example.com',
          historyId: '789',
        },
        {
          recordSignal: async () => {
            events.push('record');
            return ['sync-1'];
          },
          enqueueDiscover: async () => {
            events.push('enqueue');
            throw new Error('queue unavailable');
          },
        },
      ),
    ).resolves.toEqual({ accepted: true, matched: 1, queued: 0 });
    expect(events).toEqual(['record', 'enqueue']);
  });

  it.each([
    null,
    {},
    { emailAddress: '', historyId: '123' },
    { emailAddress: 'user@example.com', historyId: '' },
    { emailAddress: 'user@example.com', historyId: 'not-a-number' },
    { emailAddress: 'user@example.com', historyId: '1'.repeat(129) },
    { emailAddress: 'not-an-email', historyId: '123' },
  ])('rejects malformed notification payload %o', async (payload) => {
    await expect(
      handleGmailPush(payload, {
        recordSignal: async () => {
          throw new Error('must not persist');
        },
        enqueueDiscover: async () => {
          throw new Error('must not enqueue');
        },
      }),
    ).resolves.toEqual({ accepted: false, matched: 0, queued: 0 });
  });
});
