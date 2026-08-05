import { describe, expect, it, vi } from 'vitest';

import type {
  ZohoMailClient,
  ZohoMailboxContext,
} from '../../../../../src/mail-channel/zoho-mail/shared/zoho-client';
import { createZohoMailIngressAdapter } from '../../../../../src/mail-channel/zoho-mail/inbound/adapter';
import { createZohoMailIngressScopes } from '../../../../../src/mail-channel/zoho-mail/inbound/scope';

const context: ZohoMailboxContext = {
  accountId: '100',
  folderIds: ['200'],
  email: 'owner@example.com',
  name: 'Owner',
  picture: '',
};
const [fixedScope] = createZohoMailIngressScopes({ accountId: '100', folderIds: ['200'] });

const createClient = (overrides: Partial<ZohoMailClient> = {}): ZohoMailClient =>
  ({
    getMailboxContext: vi.fn(async () => context),
    listFolderMessages: vi.fn(async () => []),
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

    await expect(adapter.establishCheckpoint(fixedScope!.scope)).resolves.toEqual({
      version: 2,
      accountId: '100',
      folderId: '200',
      receivedTime: '1785240000000',
      messageId: '\uffff',
      baselineReceivedTime: '1785240000000',
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    });
    expect(client.listFolderMessages).not.toHaveBeenCalled();
  });

  it('uses an overlap window and imports same-timestamp messages without losing IDs', async () => {
    const listFolderMessages = vi.fn(async () => [
      {
        messageId: 'message-3',
        threadId: 'thread-1',
        receivedTime: '1785240060000',
        folderId: '200',
      },
      {
        messageId: 'message-late',
        threadId: null,
        receivedTime: '1785239940000',
        folderId: '200',
      },
      {
        messageId: 'too-old',
        threadId: null,
        receivedTime: '1785239800000',
        folderId: '200',
      },
    ]);
    const adapter = createZohoMailIngressAdapter(createClient({ listFolderMessages }), context, {
      now: () => new Date('2026-07-28T12:02:00.000Z'),
    });

    await expect(
      adapter.discover({
        scope: fixedScope!.scope,
        checkpoint: {
          version: 2,
          accountId: '100',
          folderId: '200',
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
        version: 2,
        accountId: '100',
        folderId: '200',
        receivedTime: '1785240060000',
        messageId: 'message-3',
        baselineReceivedTime: '1785239900000',
        lastSuccessfulAt: '2026-07-28T12:02:00.000Z',
      },
    });
    expect(listFolderMessages).toHaveBeenCalledWith({
      accountId: '100',
      folderId: '200',
      start: 1,
      limit: 200,
    });
  });

  it('never imports messages at or before the binding baseline while retaining overlap', async () => {
    const adapter = createZohoMailIngressAdapter(
      createClient({
        listFolderMessages: vi.fn(async () => [
          {
            messageId: 'after-binding',
            threadId: null,
            receivedTime: '1785240060000',
            folderId: '200',
          },
          {
            messageId: 'before-binding',
            threadId: null,
            receivedTime: '1785239999999',
            folderId: '200',
          },
        ]),
      }),
      context,
      { now: () => new Date('2026-07-28T12:02:00.000Z') },
    );

    await expect(
      adapter.discover({
        scope: fixedScope!.scope,
        checkpoint: {
          version: 2,
          accountId: '100',
          folderId: '200',
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

  it('fetches original RFC 822 bytes from the fixed account and folder', async () => {
    const client = createClient();
    const adapter = createZohoMailIngressAdapter(client, context);

    await expect(
      adapter.fetchRawMessage({
        scope: fixedScope!.scope,
        remoteMessageId: 'message-1',
      }),
    ).resolves.toEqual({
      remoteMessageId: 'message-1',
      raw: new Uint8Array([0, 255, 1]),
      receivedAt: null,
    });
    expect(client.getOriginalMessage).toHaveBeenCalledWith({
      accountId: '100',
      folderId: '200',
      messageId: 'message-1',
    });
  });

  it('uses the folder encoded in the durable scope for scheduled discovery', async () => {
    const selectedContext: ZohoMailboxContext = {
      accountId: '100',
      folderIds: ['200', '300'],
      email: 'owner@example.com',
      name: 'Owner',
      picture: '',
    };
    const listFolderMessages = vi.fn(async () => []);
    const adapter = createZohoMailIngressAdapter(
      createClient({ listFolderMessages }),
      selectedContext,
      { now: () => new Date('2026-07-28T12:00:00.000Z') },
    );
    const [selectedScope] = createZohoMailIngressScopes({
      accountId: '100',
      folderIds: ['300'],
    });
    const checkpoint = await adapter.establishCheckpoint(selectedScope!.scope);

    await adapter.discover({
      scope: selectedScope!.scope,
      checkpoint,
      pageToken: null,
    });

    expect(listFolderMessages).toHaveBeenCalledWith({
      accountId: '100',
      folderId: '300',
      start: 1,
      limit: 200,
    });
  });

  it('registers a tokenized manual webhook without trusting webhook message data', async () => {
    const adapter = createZohoMailIngressAdapter(createClient(), context);
    const checkpoint = await adapter.establishCheckpoint(fixedScope!.scope);

    await expect(
      adapter.subscribe?.({
        scope: fixedScope!.scope,
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
