import { describe, expect, it, vi } from 'vitest';

import type { MicrosoftGraphClient } from '../../../../../src/mail-channel/outlook/shared/graph-client';
import { createOutlookOutboundAdapter } from '../../../../../src/mail-channel/outlook/outbound/adapter';
import type { FrozenOutboundMessage } from '../../../../../src/mail-channel/contracts';

const message: FrozenOutboundMessage = {
  accountId: 'account-1',
  connectionId: 'connection-1',
  submissionId: 'submission-1',
  deliveryId: 'delivery-1',
  envelope: {
    from: 'sender@example.test',
    to: ['recipient@example.test'],
    cc: [],
    bcc: [],
  },
  rawMime: new Uint8Array([0, 255, 1]),
  messageId: '<stable@example.test>',
  remoteThreadId: null,
};

const createClient = (overrides: Partial<MicrosoftGraphClient> = {}): MicrosoftGraphClient =>
  ({
    createMimeDraft: vi.fn(async () => ({
      id: 'immutable-draft-id',
      conversationId: 'conversation-1',
      internetMessageId: '<stable@example.test>',
    })),
    sendDraft: vi.fn(async () => undefined),
    findSentByMessageId: vi.fn(async () => []),
    ...overrides,
  }) as MicrosoftGraphClient;

describe('Outlook outbound adapter', () => {
  it('creates and sends one immutable MIME draft without changing frozen bytes', async () => {
    const client = createClient();
    const adapter = createOutlookOutboundAdapter(client, {
      now: () => new Date('2026-07-28T12:00:00.000Z'),
    });

    await expect(adapter.send(message)).resolves.toEqual({
      remoteMessageId: 'immutable-draft-id',
      remoteThreadId: 'conversation-1',
      acceptedAt: new Date('2026-07-28T12:00:00.000Z'),
      providerCode: '202',
      safeResponse: 'accepted',
    });
    expect(client.createMimeDraft).toHaveBeenCalledWith(message.rawMime);
    expect(client.sendDraft).toHaveBeenCalledWith('immutable-draft-id');
  });

  it('marks a server failure after dispatch as uncertain instead of blindly retrying', async () => {
    const adapter = createOutlookOutboundAdapter(
      createClient({
        sendDraft: vi.fn(async () => {
          throw { status: 503 };
        }),
      }),
      { now: () => new Date('2026-07-28T12:00:00.000Z') },
    );

    let failure: unknown;
    try {
      await adapter.send(message);
    } catch (error) {
      failure = error;
    }
    expect(adapter.classifyError(failure)).toMatchObject({
      kind: 'uncertain',
      safeResponse: 'unknown_result',
    });
  });
});
