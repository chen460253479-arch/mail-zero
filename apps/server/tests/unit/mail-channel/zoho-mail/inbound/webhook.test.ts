import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { fromByteArray } from 'base64-js';

import {
  handleZohoMailWebhookRequest,
  type ZohoMailWebhookDependencies,
} from '../../../../../src/mail-channel/zoho-mail/inbound/webhook';
import type { Logger } from '../../../../../src/infrastructure/logging/logger';

const createLogger = (): Logger =>
  ({
    level: 'debug',
    child: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }) as unknown as Logger;

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
  resolveTarget: async () => ({
    targetId: 'account-1',
    syncIds: ['sync-1'],
    secrets: [],
    secretBound: false,
  }),
  storeRegistrationSecret: async () => true,
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

  it('parses exact Zoho identifiers, records the folder signal, and returns 200', async () => {
    const calls: unknown[] = [];
    const logger = createLogger();
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { includeSecret: false }),
      dependencies({
        logger,
        resolveTarget: async (payload) => {
          calls.push({
            resolve: {
              folderId: payload.folderId,
              messageId: payload.messageId,
              zuid: payload.zuid,
              subject: payload.subject,
            },
          });
          return {
            targetId: 'account-1',
            syncIds: ['sync-1'],
            secrets: ['hook-secret'],
            secretBound: true,
          };
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
      { record: ['sync-1'] },
      { enqueue: 'sync-1' },
    ]);
    await expect(response.json()).resolves.toEqual({ matched: 1, queued: 1 });
    expect(logger.info).toHaveBeenCalledWith('mail.webhook.signal_completed', {
      provider: 'zoho_mail',
      targetId: 'account-1',
      syncIds: ['sync-1'],
      matched: 1,
      queued: 1,
      failedWakeups: 0,
      secretBound: true,
      status: 200,
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
      'Marketing - Product pitch',
    );
  });

  it('verifies later requests with the stored secret', async () => {
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { includeSecret: false }),
      dependencies({
        resolveTarget: async () => ({
          targetId: 'account-1',
          syncIds: ['sync-1'],
          secrets: ['hook-secret'],
          secretBound: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejects an invalid signature without recording a signal', async () => {
    let recorded = false;
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', {
        includeSecret: false,
        signatureSecret: 'wrong-secret',
      }),
      dependencies({
        resolveTarget: async () => ({
          targetId: 'account-1',
          syncIds: ['sync-1'],
          secrets: ['hook-secret'],
          secretBound: true,
        }),
        recordSignal: async () => {
          recorded = true;
          return [];
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(recorded).toBe(false);
  });

  it('accepts and stores the signed registration POST before any mail event exists', async () => {
    const calls: unknown[] = [];
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { payload: '' }),
      dependencies({
        storeRegistrationSecret: async (secret) => {
          calls.push(secret);
          return true;
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual(['hook-secret']);
    await expect(response.text()).resolves.toBe('');
  });

  it('still returns 200 when registration secret persistence fails', async () => {
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { payload: '' }),
      dependencies({
        storeRegistrationSecret: async () => {
          throw new Error('database unavailable');
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
  });

  it('returns 200 without storing a registration secret with an invalid signature', async () => {
    let stored = false;
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { payload: '', signatureSecret: 'wrong-secret' }),
      dependencies({
        storeRegistrationSecret: async () => {
          stored = true;
          return true;
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(stored).toBe(false);
    await expect(response.text()).resolves.toBe('');
  });

  it('binds the matching pending registration secret to the routed mailbox', async () => {
    const stored: unknown[] = [];
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { includeSecret: false }),
      dependencies({
        resolveTarget: async () => ({
          targetId: 'account-1',
          syncIds: ['sync-1'],
          secrets: ['another-mailbox-secret', 'hook-secret'],
          secretBound: false,
        }),
        storeSecret: async (targetId, secret) => {
          stored.push([targetId, secret]);
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(stored).toEqual([['account-1', 'hook-secret']]);
  });

  it('returns 200 for a probe POST without a complete mail payload', async () => {
    const payload = '{"event":"new_mail"}';
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { payload, includeSecret: false }),
      dependencies(),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
  });

  it('returns not found when the folder is not bound to an active Zoho sync', async () => {
    const response = await handleZohoMailWebhookRequest(
      await request('hook-secret', { includeSecret: false }),
      dependencies({ resolveTarget: async () => null }),
    );

    expect(response.status).toBe(404);
  });

  it('logs registration diagnostics without exposing the secret or payload', async () => {
    const logger = createLogger();
    const response = await handleZohoMailWebhookRequest(
      await request('private-hook-secret', { payload: '' }),
      dependencies({ logger, requestId: 'request-1' }),
    );

    expect(response.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith('mail.webhook.registration_completed', {
      provider: 'zoho_mail',
      requestId: 'request-1',
      signatureValid: true,
      secretStored: true,
      status: 200,
    });
    const calls = JSON.stringify([
      ...vi.mocked(logger.debug).mock.calls,
      ...vi.mocked(logger.info).mock.calls,
    ]);
    expect(calls).not.toContain('private-hook-secret');
    expect(calls).not.toContain('Marketing - Product pitch');
  });
});
