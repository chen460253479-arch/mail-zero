import { describe, expect, it } from 'vitest';

import { handleOutlookPush } from '../../../../../src/mail-channel/outlook/inbound/handle-push';

describe('Outlook change notification handler', () => {
  it('verifies every subscription notification before coalescing a delta scan', async () => {
    const events: unknown[] = [];

    await expect(
      handleOutlookPush(
        {
          value: [
            {
              subscriptionId: 'subscription-1',
              clientState: 'client-state',
              resource: "me/mailFolders('inbox')/messages/message-1",
              changeType: 'created',
            },
          ],
        },
        {
          verifySubscription: async (input) => {
            events.push({ verify: input });
            return true;
          },
          recordSubscriptionSignal: async (input) => {
            events.push({ record: input });
            return ['sync-1'];
          },
          enqueueDiscover: async (syncId) => {
            events.push({ enqueue: syncId });
          },
        },
      ),
    ).resolves.toEqual({ accepted: 1, matched: 1, queued: 1 });

    expect(events).toEqual([
      {
        verify: {
          subscriptionId: 'subscription-1',
          clientState: 'client-state',
          resource: "me/mailFolders('inbox')/messages/message-1",
        },
      },
      {
        record: {
          provider: 'outlook',
          subscriptionExternalId: 'subscription-1',
        },
      },
      { enqueue: 'sync-1' },
    ]);
  });

  it('drops invalid clientState without signaling synchronization', async () => {
    let recorded = false;
    await expect(
      handleOutlookPush(
        {
          value: [
            {
              subscriptionId: 'subscription-1',
              clientState: 'wrong',
              resource: 'resource',
            },
          ],
        },
        {
          verifySubscription: async () => false,
          recordSubscriptionSignal: async () => {
            recorded = true;
            return [];
          },
          enqueueDiscover: async () => undefined,
        },
      ),
    ).resolves.toEqual({ accepted: 0, matched: 0, queued: 0 });
    expect(recorded).toBe(false);
  });
});
