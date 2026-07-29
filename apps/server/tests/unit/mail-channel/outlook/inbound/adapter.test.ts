import { describe, expect, it, vi } from 'vitest';

import type { MicrosoftGraphClient } from '../../../../../src/mail-channel/outlook/shared/graph-client';
import { createOutlookIngressAdapter } from '../../../../../src/mail-channel/outlook/inbound/adapter';
import { OutlookApiError } from '../../../../../src/mail-channel/outlook/shared/errors';
import { parseIngressScope } from '../../../../../src/modules/mail-sync';

const deltaLink =
  'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=baseline';

const createClient = (overrides: Partial<MicrosoftGraphClient> = {}): MicrosoftGraphClient =>
  ({
    getIdentity: vi.fn(),
    getDeltaPage: vi.fn(async () => ({
      messages: [],
      nextLink: null,
      deltaLink,
    })),
    getRawMessage: vi.fn(async () => new Uint8Array([1, 2, 3])),
    createMimeDraft: vi.fn(),
    sendDraft: vi.fn(),
    findSentByMessageId: vi.fn(),
    createInboxSubscription: vi.fn(),
    ...overrides,
  }) as MicrosoftGraphClient;

describe('Outlook inbound adapter', () => {
  it('discards the binding-time baseline and stores only the final delta cursor', async () => {
    const client = createClient();
    const adapter = createOutlookIngressAdapter(client, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(adapter.establishCheckpoint(parseIngressScope())).resolves.toEqual({
      version: 1,
      inboxFolderId: 'inbox',
      cursorUrl: deltaLink,
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    });
    expect(client.getDeltaPage).toHaveBeenCalledWith(
      expect.stringContaining('receivedDateTime+ge+2026-07-28T12%3A00%3A00.000Z'),
    );
  });

  it('keeps the checkpoint until the final delta page and imports only created messages', async () => {
    const nextLink =
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=next';
    const client = createClient({
      getDeltaPage: vi.fn(async () => ({
        messages: [{ id: 'message-1', conversationId: 'thread-1' }],
        nextLink,
        deltaLink: null,
      })),
    });
    const adapter = createOutlookIngressAdapter(client, {
      now: () => new Date('2026-07-28T12:05:00.000Z'),
    });
    const checkpoint = {
      version: 1,
      inboxFolderId: 'inbox',
      cursorUrl: deltaLink,
      lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
    };

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint,
        pageToken: null,
      }),
    ).resolves.toEqual({
      events: [
        {
          type: 'message_added',
          remoteMessageId: 'message-1',
          remoteThreadId: 'thread-1',
        },
      ],
      checkpoint,
      nextPageToken: nextLink,
    });
  });

  it('recovers an expired delta token from a bounded last-success overlap', async () => {
    const getDeltaPage = vi
      .fn()
      .mockRejectedValueOnce(new OutlookApiError('SyncStateNotFound', 410))
      .mockResolvedValueOnce({
        messages: [{ id: 'message-2', conversationId: null }],
        nextLink: null,
        deltaLink:
          'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=recovered',
      });
    const adapter = createOutlookIngressAdapter(createClient({ getDeltaPage }), {
      now: () => new Date('2026-07-28T12:05:00.000Z'),
    });

    await expect(
      adapter.discover({
        scope: parseIngressScope(),
        checkpoint: {
          version: 1,
          inboxFolderId: 'inbox',
          cursorUrl: deltaLink,
          lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        },
        pageToken: null,
      }),
    ).resolves.toMatchObject({
      events: [{ remoteMessageId: 'message-2' }],
      checkpoint: {
        lastSuccessfulAt: '2026-07-28T12:05:00.000Z',
      },
    });
    expect(getDeltaPage).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('receivedDateTime+ge+2026-07-28T12%3A00%3A00.000Z'),
    );
  });

  it('returns the exact MIME bytes without text transcoding', async () => {
    const adapter = createOutlookIngressAdapter(createClient(), {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(
      adapter.fetchRawMessage({
        scope: parseIngressScope(),
        remoteMessageId: 'message-1',
      }),
    ).resolves.toEqual({
      remoteMessageId: 'message-1',
      raw: new Uint8Array([1, 2, 3]),
      receivedAt: null,
    });
  });

  it('creates a Graph Inbox subscription from a validated runtime target', async () => {
    const createInboxSubscription = vi.fn(async () => ({
      id: 'subscription-1',
      expiresAt: '2026-07-30T11:00:00.000Z',
    }));
    const adapter = createOutlookIngressAdapter(createClient({ createInboxSubscription }), {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(
      adapter.subscribe?.({
        scope: parseIngressScope(),
        checkpoint: {
          version: 1,
          inboxFolderId: 'inbox',
          cursorUrl: deltaLink,
          lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        },
        target: {
          version: 1,
          notificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
          lifecycleNotificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
          clientState: '0123456789abcdef0123456789abcdef',
          encryptedClientState: 'encrypted-secret',
          expiresAt: '2026-07-30T11:00:00.000Z',
          establishedAt: '2026-07-28T12:00:00.000Z',
        },
      }),
    ).resolves.toMatchObject({
      externalId: 'subscription-1',
      encryptedSecret: 'encrypted-secret',
      establishedAt: new Date('2026-07-28T12:00:00.000Z'),
    });
  });

  it('renews the existing Graph subscription without orphaning it or rotating client state', async () => {
    const renewInboxSubscription = vi.fn(async () => ({
      id: 'subscription-1',
      expiresAt: '2026-07-30T11:00:00.000Z',
    }));
    const createInboxSubscription = vi.fn();
    const adapter = createOutlookIngressAdapter(
      createClient({ createInboxSubscription, renewInboxSubscription }),
    );

    await expect(
      adapter.subscribe?.({
        scope: parseIngressScope(),
        checkpoint: {
          version: 1,
          inboxFolderId: 'inbox',
          cursorUrl: deltaLink,
          lastSuccessfulAt: '2026-07-28T12:00:00.000Z',
        },
        target: {
          version: 1,
          notificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
          lifecycleNotificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
          clientState: 'new-client-state-0123456789abcdef',
          encryptedClientState: 'new-encrypted-secret',
          expiresAt: '2026-07-30T11:00:00.000Z',
          establishedAt: '2026-07-28T12:00:00.000Z',
        },
        currentSubscription: {
          externalId: 'subscription-1',
          endpointTokenHash: null,
          encryptedSecret: 'existing-encrypted-secret',
          establishedAt: new Date('2026-07-27T12:00:00.000Z'),
          expiresAt: new Date('2026-07-29T12:00:00.000Z'),
        },
      }),
    ).resolves.toEqual({
      externalId: 'subscription-1',
      endpointTokenHash: null,
      encryptedSecret: 'existing-encrypted-secret',
      establishedAt: new Date('2026-07-27T12:00:00.000Z'),
      expiresAt: new Date('2026-07-30T11:00:00.000Z'),
    });
    expect(renewInboxSubscription).toHaveBeenCalledWith(
      'subscription-1',
      new Date('2026-07-30T11:00:00.000Z'),
    );
    expect(createInboxSubscription).not.toHaveBeenCalled();
  });
});
