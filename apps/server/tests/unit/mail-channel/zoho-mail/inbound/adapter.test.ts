import { describe, expect, it, vi } from 'vitest';

import type {
  ZohoMailClient,
  ZohoMailboxContext,
} from '../../../../../src/mail-channel/zoho-mail/shared/zoho-client';
import { createZohoMailIngressAdapter } from '../../../../../src/mail-channel/zoho-mail/inbound/adapter';
import { parseIngressScope } from '../../../../../src/modules/mail-sync';

const context: ZohoMailboxContext = {
  accountId: 'account-1',
  inboxFolderId: 'folder-1',
  email: 'owner@example.com',
  name: 'Owner',
  picture: '',
};

const createClient = (overrides: Partial<ZohoMailClient> = {}): ZohoMailClient =>
  ({
    getMailboxContext: vi.fn(async () => context),
    listInboxMessages: vi.fn(async () => []),
    getOriginalMessage: vi.fn(async () => new Uint8Array([0, 255, 1])),
    uploadAttachment: vi.fn(),
    sendMessage: vi.fn(),
    replyToMessage: vi.fn(),
    ...overrides,
  }) as ZohoMailClient;

describe('Zoho Mail inbound adapter', () => {
  it('establishes a no-history baseline at binding time without listing messages', async () => {
    const client = createClient();
    const adapter = createZohoMailIngressAdapter(client, context, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(adapter.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      accountId: 'account-1',
      inboxFolderId: 'folder-1',
      receivedTime: '1785240000000',
      messageId: '\uffff',
      baselineReceivedTime: '1785240000000',
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    });
    expect(client.listInboxMessages).not.toHaveBeenCalled();
  });

  it('uses an overlap window and imports same-timestamp messages without losing IDs', async () => {
    const listInboxMessages = vi.fn(async () => [
      {
        messageId: 'message-3',
        threadId: 'thread-1',
        receivedTime: '1785240060000',
        folderId: 'folder-1',
      },
      {
        messageId: 'message-late',
        threadId: null,
        receivedTime: '1785239940000',
        folderId: 'folder-1',
      },
      {
        messageId: 'too-old',
        threadId: null,
        receivedTime: '1785239800000',
        folderId: 'folder-1',
      },
    ]);
    const adapter = createZohoMailIngressAdapter(createClient({ listInboxMessages }), context, {
      now: () => new Date('2026-07-28T12:02:00.000Z'),
    });

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint: {
          version: 1,
          accountId: 'account-1',
          inboxFolderId: 'folder-1',
          receivedTime: '1785240000000',
          messageId: 'message-2',
          baselineReceivedTime: '1785239900000',
          lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        },
        pageToken: null,
      }),
    ).resolves.toEqual({
      events: [
        {
          type: 'message_added',
          remoteMessageId: 'message-3',
          remoteThreadId: 'thread-1',
        },
        {
          type: 'message_added',
          remoteMessageId: 'message-late',
          remoteThreadId: null,
        },
      ],
      nextPageToken: null,
      checkpoint: {
        version: 1,
        accountId: 'account-1',
        inboxFolderId: 'folder-1',
        receivedTime: '1785240060000',
        messageId: 'message-3',
        baselineReceivedTime: '1785239900000',
        lastSuccessfulAt: '2026-07-28T12:02:00.000Z',
      },
    });
    expect(listInboxMessages).toHaveBeenCalledWith({
      accountId: 'account-1',
      inboxFolderId: 'folder-1',
      start: 1,
      limit: 200,
    });
  });

  it('never imports messages at or before the binding baseline while retaining overlap', async () => {
    const adapter = createZohoMailIngressAdapter(
      createClient({
        listInboxMessages: vi.fn(async () => [
          {
            messageId: 'after-binding',
            threadId: null,
            receivedTime: '1785240060000',
            folderId: 'folder-1',
          },
          {
            messageId: 'before-binding',
            threadId: null,
            receivedTime: '1785239999999',
            folderId: 'folder-1',
          },
        ]),
      }),
      context,
      { now: () => new Date('2026-07-28T12:02:00.000Z') },
    );

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint: {
          version: 1,
          accountId: 'account-1',
          inboxFolderId: 'folder-1',
          receivedTime: '1785240060000',
          messageId: 'after-binding',
          baselineReceivedTime: '1785240000000',
          lastSuccessfulAt: '2026-07-28T12:01:00.000Z',
        },
        pageToken: null,
      }),
    ).resolves.toMatchObject({
      events: [
        {
          type: 'message_added',
          remoteMessageId: 'after-binding',
          remoteThreadId: null,
        },
      ],
      checkpoint: {
        baselineReceivedTime: '1785240000000',
      },
    });
  });

  it('fetches original RFC 822 bytes from the checkpointed account Inbox', async () => {
    const client = createClient();
    const adapter = createZohoMailIngressAdapter(client, context);

    await expect(
      adapter.fetchRawMessage({
        scope: parseIngressScope(),
        remoteMessageId: 'message-1',
      }),
    ).resolves.toEqual({
      remoteMessageId: 'message-1',
      raw: new Uint8Array([0, 255, 1]),
      receivedAt: null,
    });
    expect(client.getOriginalMessage).toHaveBeenCalledWith({
      accountId: 'account-1',
      inboxFolderId: 'folder-1',
      messageId: 'message-1',
    });
  });

  it('registers a tokenized manual webhook without trusting webhook message data', async () => {
    const adapter = createZohoMailIngressAdapter(createClient(), context);
    const checkpoint = await adapter.establishCheckpoint(parseIngressScope());

    await expect(
      adapter.subscribe?.({
        scope: parseIngressScope(),
        checkpoint,
        target: {
          version: 1,
          notificationUrl:
            'https://mail.example.test/api/webhooks/mail/zoho/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
          endpointTokenHash: 'a'.repeat(64),
          establishedAt: '2026-07-28T12:00:00.000Z',
        },
      }),
    ).resolves.toEqual({
      expiresAt: null,
      externalId: null,
      endpointTokenHash: 'a'.repeat(64),
      encryptedSecret: null,
      establishedAt: new Date('2026-07-28T12:00:00.000Z'),
    });
  });
});
