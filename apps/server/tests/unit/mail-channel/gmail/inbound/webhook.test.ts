import { describe, expect, it } from 'vitest';

import {
  handleGmailWebhookRequest,
  type GmailWebhookDependencies,
} from '../../../../../src/mail-channel/gmail/inbound/webhook';
import type { GmailChannelConfig } from '../../../../../src/mail-channel/gmail/config';

const watchConfig: GmailChannelConfig = {
  channelId: 'gmail',
  authSource: 'zero_oauth',
  inboxWatchEnabled: true,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  providerConfig: {
    topicName: 'projects/zero-mail/topics/gmail-inbound',
  },
};

const createRequest = (body: unknown) =>
  new Request('https://mail.example.test/api/mail/channels/gmail/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const createDependencies = (
  overrides: Partial<GmailWebhookDependencies> = {},
): GmailWebhookDependencies => ({
  getChannelConfig: async () => watchConfig,
  recordSignal: async () => ['sync-1'],
  enqueueDiscover: async () => undefined,
  ...overrides,
});

describe('Gmail Pub/Sub webhook', () => {
  it('accepts a valid notification without custom authorization or subscription headers', async () => {
    const events: unknown[] = [];
    const response = await handleGmailWebhookRequest(
      createRequest({ emailAddress: 'user@example.test', historyId: '100' }),
      createDependencies({
        recordSignal: async (signal) => {
          events.push(signal);
          return ['sync-1'];
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        provider: 'gmail',
        externalAccount: 'user@example.test',
        cursorHint: '100',
      },
    ]);
  });

  it('acknowledges without a sync signal while Watch is disabled', async () => {
    let persisted = false;
    const response = await handleGmailWebhookRequest(
      createRequest({ emailAddress: 'user@example.test', historyId: '100' }),
      createDependencies({
        getChannelConfig: async () => ({
          ...watchConfig,
          inboxWatchEnabled: false,
          providerConfig: {},
        }),
        recordSignal: async () => {
          persisted = true;
          return [];
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(persisted).toBe(false);
  });

  it('records one standard signal before acknowledging a valid notification', async () => {
    const events: unknown[] = [];
    const response = await handleGmailWebhookRequest(
      createRequest({ emailAddress: 'User@Example.test', historyId: '123' }),
      createDependencies({
        recordSignal: async (signal) => {
          events.push(signal);
          return ['sync-1'];
        },
        enqueueDiscover: async (syncId) => {
          events.push({ queued: syncId });
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        provider: 'gmail',
        externalAccount: 'user@example.test',
        cursorHint: '123',
      },
      { queued: 'sync-1' },
    ]);
  });

  it('acknowledges and drops a malformed payload', async () => {
    let persisted = false;
    const response = await handleGmailWebhookRequest(
      createRequest({ emailAddress: 'invalid', historyId: 'not-a-number' }),
      createDependencies({
        recordSignal: async () => {
          persisted = true;
          return [];
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(persisted).toBe(false);
  });
});
