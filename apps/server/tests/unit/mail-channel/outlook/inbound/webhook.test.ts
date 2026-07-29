import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  handleOutlookWebhookRequest,
  type OutlookWebhookDependencies,
} from '../../../../../src/mail-channel/outlook/inbound/webhook';

const dependencies = (
  overrides: Partial<OutlookWebhookDependencies> = {},
): OutlookWebhookDependencies => ({
  verifySubscription: async () => true,
  recordSubscriptionSignal: async () => ['sync-1'],
  enqueueDiscover: async () => undefined,
  ...overrides,
});

describe('Outlook webhook endpoint', () => {
  it('is exposed as a public provider webhook before session-dependent APIs', () => {
    const application = readFileSync(
      resolve(process.cwd(), 'src/runtime/node/application.ts'),
      'utf8',
    );
    expect(application).toContain("post('/api/webhooks/mail/outlook'");
    expect(application).toContain('services.webhooks.outlook');
  });

  it('echoes the Graph validation token as plain text without reading a notification body', async () => {
    const response = await handleOutlookWebhookRequest(
      new Request(
        'https://mail.example.test/api/webhooks/mail/outlook?validationToken=opaque-token',
        { method: 'POST' },
      ),
      dependencies(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    await expect(response.text()).resolves.toBe('opaque-token');
  });

  it('accepts a verified notification and never exposes its payload in the response', async () => {
    const response = await handleOutlookWebhookRequest(
      new Request('https://mail.example.test/api/webhooks/mail/outlook', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: [
            {
              subscriptionId: 'subscription-1',
              clientState: 'secret',
              resource: "me/mailFolders('inbox')/messages/message-1",
            },
          ],
        }),
      }),
      dependencies(),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: 1,
      matched: 1,
      queued: 1,
    });
  });

  it('rejects oversized notification bodies before parsing', async () => {
    const response = await handleOutlookWebhookRequest(
      new Request('https://mail.example.test/api/webhooks/mail/outlook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(300 * 1024),
        },
        body: '{}',
      }),
      dependencies(),
    );

    expect(response.status).toBe(413);
  });
});
