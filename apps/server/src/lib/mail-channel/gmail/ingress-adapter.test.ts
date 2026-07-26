import { describe, expect, it } from 'vitest';

import { createGmailInboundAdapterFactory, createGmailIngressAdapter } from './ingress-adapter';
import { MailSyncError, parseIngressScope } from '../../../modules/mail-sync';
import type { GmailApiClient } from './gmail-api-client';

const createClient = (overrides: Partial<GmailApiClient> = {}): GmailApiClient => ({
  getProfile: async () => ({
    emailAddress: 'user@example.com',
    historyId: '100',
  }),
  listHistory: async () => ({
    history: [],
    historyId: '100',
    nextPageToken: null,
  }),
  getRawMessage: async () => ({
    raw: 'AP-AQQ',
    internalDate: '1785542400000',
  }),
  watchInbox: async () => ({
    historyId: '100',
    expiration: '1785542400000',
  }),
  ...overrides,
});

describe('Gmail inbound adapter', () => {
  it('uses the current profile History ID as the no-history binding baseline', async () => {
    const adapter = createGmailIngressAdapter(createClient());

    await expect(adapter.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      historyId: '100',
    });
  });

  it('keeps the old checkpoint while a History page has a continuation token', async () => {
    const adapter = createGmailIngressAdapter(
      createClient({
        listHistory: async (input) => {
          expect(input).toEqual({
            startHistoryId: '100',
            pageToken: 'page-1',
          });
          return {
            history: [
              {
                messagesAdded: [
                  {
                    message: {
                      id: 'message-1',
                      threadId: 'thread-1',
                      labelIds: ['INBOX'],
                    },
                  },
                ],
                labelsRemoved: [
                  {
                    message: { id: 'ignored-label-change' },
                    labelIds: ['UNREAD'],
                  },
                ],
              },
            ],
            historyId: '101',
            nextPageToken: 'page-2',
          };
        },
      }),
    );

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint: { version: 1, historyId: '100' },
        pageToken: 'page-1',
      }),
    ).resolves.toEqual({
      events: [
        {
          type: 'message_added',
          remoteMessageId: 'message-1',
          remoteThreadId: 'thread-1',
        },
      ],
      checkpoint: { version: 1, historyId: '100' },
      nextPageToken: 'page-2',
    });
  });

  it('advances the History checkpoint only after the final page', async () => {
    const adapter = createGmailIngressAdapter(
      createClient({
        listHistory: async () => ({
          history: [],
          historyId: '101',
          nextPageToken: null,
        }),
      }),
    );

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint: { version: 1, historyId: '100' },
        pageToken: 'last-page',
      }),
    ).resolves.toMatchObject({
      checkpoint: { version: 1, historyId: '101' },
      nextPageToken: null,
    });
  });

  it('decodes raw MIME as binary bytes without a UTF-8 round trip', async () => {
    const adapter = createGmailIngressAdapter(createClient());

    await expect(
      adapter.fetchRawMessage({
        scope: parseIngressScope(),
        remoteMessageId: 'message-1',
      }),
    ).resolves.toEqual({
      remoteMessageId: 'message-1',
      raw: new Uint8Array([0, 255, 128, 65]),
      receivedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('subscribes with a versioned topic target and returns the expiration', async () => {
    const adapter = createGmailIngressAdapter(
      createClient({
        watchInbox: async (topicName) => {
          expect(topicName).toBe('projects/zero/topics/gmail');
          return {
            historyId: '100',
            expiration: '1785542400000',
          };
        },
      }),
    );

    await expect(
      adapter.subscribe!({
        scope: parseIngressScope(),
        checkpoint: { version: 1, historyId: '100' },
        target: {
          version: 1,
          topicName: 'projects/zero/topics/gmail',
        },
      }),
    ).resolves.toEqual({
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  });

  it('classifies Gmail authentication, throttling, server, and permanent failures', () => {
    const adapter = createGmailIngressAdapter(createClient());

    expect(adapter.classifyError({ response: { status: 401 } })).toBe('authentication');
    expect(adapter.classifyError({ code: 403 })).toBe('authentication');
    expect(adapter.classifyError({ response: { status: 429 } })).toBe('retryable');
    expect(adapter.classifyError({ code: 503 })).toBe('retryable');
    expect(adapter.classifyError({ code: 'ECONNRESET' })).toBe('retryable');
    expect(adapter.classifyError({ response: { status: 400 } })).toBe('permanent');
    expect(adapter.classifyError(new MailSyncError('GMAIL_HISTORY_GAP', 'permanent'))).toBe(
      'permanent',
    );
  });

  it('turns an expired History cursor into an explicit gap without historical fallback', async () => {
    const adapter = createGmailIngressAdapter(
      createClient({
        listHistory: async () => {
          throw { response: { status: 404 } };
        },
      }),
    );

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint: { version: 1, historyId: 'expired' },
        pageToken: null,
      }),
    ).rejects.toMatchObject({
      code: 'GMAIL_HISTORY_GAP',
      classification: 'permanent',
    });
  });

  it('creates isolated adapters from per-connection Gmail clients', async () => {
    const seen: string[] = [];
    const factory = createGmailInboundAdapterFactory(async (connectionId) => {
      seen.push(connectionId);
      return createClient({
        getProfile: async () => ({
          emailAddress: `${connectionId}@example.com`,
          historyId: connectionId,
        }),
      });
    });

    const first = await factory.create('connection-1');
    const second = await factory.create('connection-2');

    expect(first).not.toBe(second);
    expect(seen).toEqual(['connection-1', 'connection-2']);
    await expect(first.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      historyId: 'connection-1',
    });
    await expect(second.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      historyId: 'connection-2',
    });
  });
});
