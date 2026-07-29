import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  handleZohoMailWebhookRequest,
  type ZohoMailWebhookDependencies,
} from '../../../../../src/mail-channel/zoho-mail/inbound/webhook';

const dependencies = (
  overrides: Partial<ZohoMailWebhookDependencies> = {},
): ZohoMailWebhookDependencies => ({
  recordEndpointSignal: async () => ['sync-1'],
  enqueueDiscover: async () => undefined,
  ...overrides,
});

const request = (headers: Record<string, string> = {}) =>
  new Request('https://mail.example.test/api/webhooks/mail/zoho/opaque-endpoint-token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ event: 'new_mail', messageId: 'provider-data-is-not-trusted' }),
  });

describe('Zoho Mail webhook endpoint', () => {
  it('is exposed as a public tokenized provider route', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
    expect(main).toContain("post('/api/webhooks/mail/zoho/:endpointToken'");
    expect(main).toContain('handleZohoMailWebhookForEnvironment');
  });

  it('uses the opaque endpoint token and triggers only the common incremental scan', async () => {
    const calls: unknown[] = [];
    const response = await handleZohoMailWebhookRequest(
      request(),
      'opaque-endpoint-token',
      dependencies({
        recordEndpointSignal: async (endpointToken) => {
          calls.push({ record: endpointToken });
          return ['sync-1'];
        },
        enqueueDiscover: async (syncId) => {
          calls.push({ enqueue: syncId });
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(calls).toEqual([{ record: 'opaque-endpoint-token' }, { enqueue: 'sync-1' }]);
    await expect(response.json()).resolves.toEqual({ matched: 1, queued: 1 });
  });

  it('returns not found for an unknown endpoint token', async () => {
    const response = await handleZohoMailWebhookRequest(
      request(),
      'opaque-endpoint-token',
      dependencies({
        recordEndpointSignal: async () => [],
      }),
    );

    expect(response.status).toBe(404);
  });
});
