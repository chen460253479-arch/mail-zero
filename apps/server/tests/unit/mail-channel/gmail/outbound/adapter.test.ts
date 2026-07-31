import { describe, expect, it, vi } from 'vitest';

import { createGmailOutboundAdapter } from '../../../../../src/mail-channel/gmail/outbound/adapter';
import type { GmailApiClient } from '../../../../../src/mail-channel/gmail/shared/api-client';
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
  rawMime: new Uint8Array([1, 2, 3]),
  messageId: '<stable@example.test>',
  remoteThreadId: 'thread-1',
};

const client = (sendRawMessage: GmailApiClient['sendRawMessage']): GmailApiClient =>
  ({
    sendRawMessage,
    findSentByMessageId: vi.fn(),
  }) as unknown as GmailApiClient;

describe('Gmail outbound adapter', () => {
  it('maps Gmail acceptance without mutating raw bytes', async () => {
    const rawBefore = message.rawMime.slice();
    const sendRawMessage = vi.fn<GmailApiClient['sendRawMessage']>(async () => ({
      id: 'gmail-message',
      threadId: 'gmail-thread',
    }));
    const adapter = createGmailOutboundAdapter(client(sendRawMessage), {
      now: () => new Date('2026-01-01T00:00:05.000Z'),
    });

    await expect(adapter.send(message)).resolves.toEqual({
      remoteMessageId: 'gmail-message',
      remoteThreadId: 'gmail-thread',
      acceptedAt: new Date('2026-01-01T00:00:05.000Z'),
      providerCode: null,
      safeResponse: 'accepted',
    });
    expect(sendRawMessage).toHaveBeenCalledWith({
      raw: message.rawMime,
      remoteThreadId: 'thread-1',
    });
    expect(message.rawMime).toEqual(rawBefore);
  });

  it('adds private Bcc recipients only to the transient Gmail request MIME', async () => {
    const rawMime = new TextEncoder().encode(
      'From: sender@example.test\r\nTo: recipient@example.test\r\nMessage-ID: <stable@example.test>\r\n\r\nBody',
    );
    const sendRawMessage = vi.fn<GmailApiClient['sendRawMessage']>(async () => ({
      id: 'gmail-message',
      threadId: 'gmail-thread',
    }));
    const adapter = createGmailOutboundAdapter(client(sendRawMessage), {
      now: () => new Date('2026-01-01T00:00:05.000Z'),
    });

    await adapter.send({
      ...message,
      envelope: { ...message.envelope, bcc: ['blind@example.test'] },
      rawMime,
    });

    const dispatched = sendRawMessage.mock.calls[0]![0].raw;
    expect(new TextDecoder().decode(dispatched)).toContain('\r\nBcc: blind@example.test\r\n\r\n');
    expect(new TextDecoder().decode(rawMime)).not.toContain('Bcc:');
  });

  it('rejects a Gmail success response without a message ID', async () => {
    const adapter = createGmailOutboundAdapter(
      client(async () => ({ id: null, threadId: null })),
      { now: () => new Date('2026-01-01T00:00:05.000Z') },
    );

    await expect(adapter.send(message)).rejects.toMatchObject({
      code: 'GMAIL_INVALID_RESPONSE',
    });
    expect(adapter.classifyError({ status: 401 })).toMatchObject({
      kind: 'authentication_required',
    });
    expect(adapter.classifyError({ status: 429 })).toMatchObject({
      kind: 'rate_limited',
    });
    expect(
      adapter.classifyError({
        status: 429,
        response: { headers: { 'retry-after': '120' } },
      }),
    ).toMatchObject({
      kind: 'rate_limited',
      retryAfter: new Date('2026-01-01T00:02:05.000Z'),
    });
    expect(
      adapter.classifyError({
        status: 429,
        response: { headers: { 'retry-after': '90000' } },
      }),
    ).toMatchObject({ retryAfter: null });
    expect(adapter.classifyError({ status: 503 })).toMatchObject({
      kind: 'uncertain',
    });
    expect(adapter.classifyError({ code: 'ECONNRESET' })).toMatchObject({
      kind: 'uncertain',
    });
  });

  it('classifies preflight failures as permanent without dispatching', async () => {
    const sendRawMessage = vi.fn();
    const adapter = createGmailOutboundAdapter(client(sendRawMessage), {
      now: () => new Date('2026-01-01T00:00:05.000Z'),
    });

    let failure: unknown;
    try {
      await adapter.send({ ...message, rawMime: new Uint8Array() });
    } catch (error) {
      failure = error;
    }
    expect(adapter.classifyError(failure)).toMatchObject({
      kind: 'permanent_failure',
      providerCode: 'GMAIL_INVALID_REQUEST',
    });
    expect(sendRawMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['rateLimitExceeded', 'rate_limited'],
    ['userRateLimitExceeded', 'rate_limited'],
    ['quotaExceeded', 'quota_exceeded'],
    ['dailyLimitExceeded', 'quota_exceeded'],
    ['invalidRecipient', 'invalid_recipient'],
    ['domainPolicy', 'policy_rejected'],
  ] as const)('maps Gmail reason %s to %s', (reason, kind) => {
    const adapter = createGmailOutboundAdapter(client(vi.fn()), {
      now: () => new Date('2026-01-01T00:00:05.000Z'),
    });

    expect(
      adapter.classifyError({
        response: {
          status: 403,
          data: {
            error: {
              errors: [{ reason }],
            },
          },
        },
      }),
    ).toMatchObject({ kind });
  });
});
