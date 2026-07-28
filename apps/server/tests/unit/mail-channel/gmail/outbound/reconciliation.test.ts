import { describe, expect, it, vi } from 'vitest';

import type { GmailApiClient } from '../../../../../src/mail-channel/gmail/shared/api-client';
import { createGmailOutboundAdapter } from '../../../../../src/mail-channel/gmail/outbound/adapter';

describe('Gmail Sent reconciliation', () => {
  it('uses the exact stable Message-ID and returns the earliest verified match', async () => {
    const findSentByMessageId = vi.fn(async () => [
      {
        id: 'later',
        threadId: 'thread-later',
        internalDate: '2000',
      },
      {
        id: 'earlier',
        threadId: 'thread-earlier',
        internalDate: '1000',
      },
    ]);
    const adapter = createGmailOutboundAdapter(
      {
        sendRawMessage: vi.fn(),
        findSentByMessageId,
      } as unknown as GmailApiClient,
      { now: () => new Date('2026-01-01T00:00:05.000Z') },
    );

    await expect(
      adapter.reconcile?.({
        accountId: 'account-1',
        connectionId: 'connection-1',
        submissionId: 'submission-1',
        deliveryId: 'delivery-1',
        messageId: '<stable@example.test>',
        remoteThreadId: null,
      }),
    ).resolves.toEqual({
      status: 'found',
      result: {
        remoteMessageId: 'earlier',
        remoteThreadId: 'thread-earlier',
        acceptedAt: new Date(1000),
        providerCode: null,
        safeResponse: 'accepted',
      },
    });
    expect(findSentByMessageId).toHaveBeenCalledWith('<stable@example.test>');
  });

  it('returns not_found without issuing another send', async () => {
    const sendRawMessage = vi.fn();
    const adapter = createGmailOutboundAdapter(
      {
        sendRawMessage,
        findSentByMessageId: async () => [],
      } as unknown as GmailApiClient,
      { now: () => new Date('2026-01-01T00:00:05.000Z') },
    );

    await expect(
      adapter.reconcile?.({
        accountId: 'account-1',
        connectionId: 'connection-1',
        submissionId: 'submission-1',
        deliveryId: 'delivery-1',
        messageId: '<missing@example.test>',
        remoteThreadId: null,
      }),
    ).resolves.toEqual({ status: 'not_found' });
    expect(sendRawMessage).not.toHaveBeenCalled();
  });
});
