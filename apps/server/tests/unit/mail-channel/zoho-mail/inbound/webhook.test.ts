import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { fromByteArray } from 'base64-js';

import {
  handleZohoMailWebhookRequest,
  type ZohoMailWebhookDependencies,
} from '../../../../../src/mail-channel/zoho-mail/inbound/webhook';

const folderId = '3881227000000013000';
const messageId = '1560840837125110000';
const body = `{
  "summary": "Hi Rebecca, I have shared the slide deck.",
  "sentDateInGMT": 1560866021000,
  "subject": "Marketing - Product pitch",
  "messageId": ${messageId},
  "toAddress": "\\\"Rebecca A\\\"<rebecca@zylker.com>",
  "folderId": ${folderId},
  "zuid": 647772765,
  "ccAddress": "",
  "size": 55503,
  "sender": "Paula",
  "receivedTime": 1560840837126,
  "fromAddress": "paula@zylker.com",
  "html": "<meta /><div>Hi Rebecca</div>",
  "IntegIdList": "34000000580271,"
}`;

const signature = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return fromByteArray(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))),
  );
};

const request = async (
  secret: string,
  options: { payload?: string; includeSecret?: boolean; signatureSecret?: string } = {},
) => {
  const payload = options.payload ?? body;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-hook-signature': await signature(options.signatureSecret ?? secret, payload),
  };
  if (options.includeSecret !== false) headers['x-hook-secret'] = secret;
  return new Request('https://mail.example.test/api/webhooks/mail/zoho', {
    method: 'POST',
    headers,
    body: payload,
  });
};

const dependencies = (
  overrides: Partial<ZohoMailWebhookDependencies> = {},
): ZohoMailWebhookDependencies => ({
  resolveTarget: async () => ({ targetId: 'account-1', syncIds: ['sync-1'], secret: null }),
  storeSecret: async () => undefined,
  recordSignal: async (syncIds) => syncIds,
  enqueueDiscover: async () => undefined,
  ...overrides,
});

describe('Zoho Mail webhook endpoint', () => {
  it('is exposed as one fixed public provider route', () => {
    const application = readFileSync(
      resolve(process.cwd(), 'src/runtime/node/application.ts'),
      'utf8',
    );
    expect(application).toContain("post('/api/webhooks/mail/zoho'");
    expect(application).not.toContain('zoho/:endpointToken');
    expect(application).toContain('services.webhooks.zohoMail');
  });

  it('stores the first Zoho secret, records the exact folder signal, and returns 200', async () => {
    const calls: unknown[] = [];
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret'),
      dependencies({
        resolveTarget: async (payload) => {
          calls.push({
            resolve: {
              folderId: payload.folderId,
              messageId: payload.messageId,
              zuid: payload.zuid,
              subject: payload.subject,
            },
          });
          return { targetId: 'account-1', syncIds: ['sync-1'], secret: null };
        },
        storeSecret: async (targetId, secret) => {
          calls.push({ store: [targetId, secret] });
        },
        recordSignal: async (syncIds) => {
          calls.push({ record: syncIds });
          return syncIds;
        },
        enqueueDiscover: async (syncId) => {
          calls.push({ enqueue: syncId });
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        resolve: {
          folderId,
          messageId,
          zuid: '647772765',
          subject: 'Marketing - Product pitch',
        },
      },
      { store: ['account-1', 'hook-secret'] },
      { record: ['sync-1'] },
      { enqueue: 'sync-1' },
    ]);
    await expect(response.json()).resolves.toEqual({ matched: 1, queued: 1 });
  });

  it('verifies later requests with the stored secret', async () => {
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { includeSecret: false }),
      dependencies({
        resolveTarget: async () => ({
          targetId: 'account-1',
          syncIds: ['sync-1'],
          secret: 'hook-secret',
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejects an invalid signature without recording a signal', async () => {
    let recorded = false;
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { signatureSecret: 'wrong-secret' }),
      dependencies({
        recordSignal: async () => {
          recorded = true;
          return [];
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(recorded).toBe(false);
  });

  it('requires a structurally valid Zoho mail payload', async () => {
    const payload = '{"event":"new_mail"}';
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { payload }),
      dependencies(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'ZOHO_WEBHOOK_PAYLOAD_INVALID' });
  });

  it('returns not found when the folder is not bound to an active Zoho sync', async () => {
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret'),
      dependencies({ resolveTarget: async () => null }),
    );

    expect(response.status).toBe(404);
  });
});
