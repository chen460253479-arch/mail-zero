import { describe, expect, it, vi } from 'vitest';

import type { MicrosoftGraphClient } from '../../../../../src/mail-channel/outlook/shared/graph-client';
import { createOutlookOutboundAdapter } from '../../../../../src/mail-channel/outlook/outbound/adapter';

describe('Outlook sent reconciliation', () => {
  it('finds the accepted immutable message by RFC Message-ID', async () => {
    const findSentByMessageId = vi.fn(async () => [
      {
        id: 'immutable-message-1',
        conversationId: 'conversation-1',
        sentDateTime: '2026-07-28T12:00:01.000Z',
      },
    ]);
    const adapter = createOutlookOutboundAdapter(
      { findSentByMessageId } as unknown as MicrosoftGraphClient,
      { now: () => new Date('2026-07-28T12:05:00.000Z') },
    );

    await expect(
      adapter.reconcile!({
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
        remoteMessageId: 'immutable-message-1',
        remoteThreadId: 'conversation-1',
        acceptedAt: new Date('2026-07-28T12:00:01.000Z'),
        providerCode: 'reconciled',
        safeResponse: 'accepted',
      },
    });
    expect(findSentByMessageId).toHaveBeenCalledWith('<stable@example.test>');
  });
});
