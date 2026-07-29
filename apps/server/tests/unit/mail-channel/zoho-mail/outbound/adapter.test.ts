import { describe, expect, it, vi } from 'vitest';

import type {
  ZohoMailClient,
  ZohoMailboxContext,
} from '../../../../../src/mail-channel/zoho-mail/shared/zoho-client';
import { createZohoMailOutboundAdapter } from '../../../../../src/mail-channel/zoho-mail/outbound/adapter';
import type { FrozenOutboundMessage } from '../../../../../src/mail-channel/contracts';

const context: ZohoMailboxContext = {
  accountId: 'account-1',
  inboxFolderId: 'folder-1',
  email: 'sender@example.test',
  name: 'Sender',
  picture: '',
};

const message: FrozenOutboundMessage = {
  accountId: 'local-account-1',
  connectionId: 'connection-1',
  submissionId: 'submission-1',
  deliveryId: 'delivery-1',
  envelope: {
    from: 'sender@example.test',
    to: ['recipient@example.test'],
    cc: [],
    bcc: [],
  },
  rawMime: new TextEncoder().encode(
    [
      'Message-ID: <stable@example.test>',
      'From: sender@example.test',
      'To: recipient@example.test',
      'Subject: Hello',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Local frozen body',
    ].join('\r\n'),
  ),
  messageId: '<stable@example.test>',
  remoteThreadId: null,
};

const createClient = (overrides: Partial<ZohoMailClient> = {}): ZohoMailClient =>
  ({
    uploadAttachment: vi.fn(),
    sendMessage: vi.fn(async () => ({
      messageId: 'zoho-message-1',
      mailId: 'zoho-mail-1',
    })),
    replyToMessage: vi.fn(),
    ...overrides,
  }) as ZohoMailClient;

describe('Zoho Mail outbound adapter', () => {
  it('projects only local frozen MIME into the structured send API', async () => {
    const client = createClient();
    const adapter = createZohoMailOutboundAdapter(client, context, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(adapter.send(message)).resolves.toEqual({
      remoteMessageId: 'zoho-message-1',
      remoteThreadId: 'zoho-mail-1',
      acceptedAt: new Date('2026-07-28T12:00:00.000Z'),
      providerCode: '200',
      safeResponse: 'accepted',
    });
    expect(client.sendMessage).toHaveBeenCalledWith({
      accountId: 'account-1',
      body: {
        fromAddress: 'sender@example.test',
        toAddress: 'recipient@example.test',
        subject: 'Hello',
        content: 'Local frozen body',
        mailFormat: 'plaintext',
      },
    });
    expect(client.uploadAttachment).not.toHaveBeenCalled();
  });

  it('uses the persisted remote parent ID for replies', async () => {
    const replyToMessage = vi.fn(async () => ({
      messageId: 'zoho-reply-1',
      mailId: 'zoho-thread-1',
    }));
    const adapter = createZohoMailOutboundAdapter(createClient({ replyToMessage }), context, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await adapter.send({
      ...message,
      remoteParentMessageId: 'zoho-parent-1',
    });
    expect(replyToMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account-1',
        parentMessageId: 'zoho-parent-1',
      }),
    );
  });

  it('keeps an uncertain submission in reconciliation instead of blind resend', async () => {
    const adapter = createZohoMailOutboundAdapter(createClient(), context, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(
      adapter.reconcile!({
        accountId: 'local-account-1',
        connectionId: 'connection-1',
        submissionId: 'submission-1',
        deliveryId: 'delivery-1',
        messageId: '<stable@example.test>',
        remoteThreadId: null,
      }),
    ).resolves.toEqual({
      status: 'inconclusive',
      retryAfter: new Date('2026-07-28T12:05:00.000Z'),
    });
  });
});
