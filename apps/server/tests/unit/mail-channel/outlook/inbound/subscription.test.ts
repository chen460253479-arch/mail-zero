import { describe, expect, it, vi } from 'vitest';

import { createOutlookSubscription } from '../../../../../src/mail-channel/outlook/inbound/subscription';
import type { MicrosoftGraphClient } from '../../../../../src/mail-channel/outlook/shared/graph-client';

describe('Outlook Inbox subscription', () => {
  it('creates a short-lived Inbox notification and persists only encrypted clientState', async () => {
    const createInboxSubscription = vi.fn(async () => ({
      id: 'subscription-1',
      expiresAt: '2026-07-30T12:00:00.000Z',
    }));
    const client = { createInboxSubscription } as unknown as MicrosoftGraphClient;

    await expect(
      createOutlookSubscription(client, {
        notificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
        lifecycleNotificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
        clientState: 'plain-secret',
        encryptedClientState: 'encrypted-secret',
        expiresAt: new Date('2026-07-30T12:00:00.000Z'),
        establishedAt: new Date('2026-07-28T12:00:00.000Z'),
      }),
    ).resolves.toEqual({
      externalId: 'subscription-1',
      endpointTokenHash: null,
      encryptedSecret: 'encrypted-secret',
      expiresAt: new Date('2026-07-30T12:00:00.000Z'),
      establishedAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    expect(createInboxSubscription).toHaveBeenCalledWith({
      notificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
      lifecycleNotificationUrl: 'https://mail.example.test/api/webhooks/mail/outlook',
      clientState: 'plain-secret',
      expiresAt: new Date('2026-07-30T12:00:00.000Z'),
    });
  });
});
