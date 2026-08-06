import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

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
  "toAddress": "\\"Rebecca A\\"<rebecca@zylker.com>",
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

const request = (payload = body, headers: Record<string, string> = {}) =>
  new Request('https://mail.example.test/api/webhooks/mail/zoho', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: payload,
  });

const dependencies = (
  overrides: Partial<ZohoMailWebhookDependencies> = {},
): ZohoMailWebhookDependencies => ({
  resolveTarget: async () => ({
    targetId: 'account-1',
    syncIds: ['sync-1'],
  }),
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

  it('processes a complete event without requiring authentication headers', async () => {
    const calls: unknown[] = [];
    const logger = createLogger();
    const response = await handleZohoMailWebhookRequest(
      request(),
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
      status: 200,
    });
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain(
      'Marketing - Product pitch',
    );
  });

  it('acknowledges an empty registration probe without querying sync targets', async () => {
    const resolveTarget = vi.fn();
    const logger = createLogger();

    const response = await handleZohoMailWebhookRequest(
      request(''),
      dependencies({ logger, requestId: 'request-1', resolveTarget }),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('mail.webhook.request_acknowledged', {
      provider: 'zoho_mail',
      requestId: 'request-1',
      reason: 'probe_or_incomplete_payload',
      status: 200,
    });
  });

  it('acknowledges an incomplete payload without scheduling work', async () => {
    const recordSignal = vi.fn();
    const response = await handleZohoMailWebhookRequest(
      request('{"event":"new_mail"}'),
      dependencies({ recordSignal }),
    );

    expect(response.status).toBe(200);
    expect(recordSignal).not.toHaveBeenCalled();
  });

  it('acknowledges an event that is not bound to an active sync', async () => {
    const recordSignal = vi.fn();
    const logger = createLogger();
    const response = await handleZohoMailWebhookRequest(
      request(),
      dependencies({
        logger,
        resolveTarget: async () => null,
        recordSignal,
      }),
    );

    expect(response.status).toBe(200);
    expect(recordSignal).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('mail.webhook.target_not_found', {
      provider: 'zoho_mail',
      folderId,
      messageId,
      status: 200,
    });
  });

  it('reports partial queue publication without rejecting the event', async () => {
    const logger = createLogger();
    const response = await handleZohoMailWebhookRequest(
      request(),
      dependencies({
        logger,
        resolveTarget: async () => ({
          targetId: 'account-1',
          syncIds: ['sync-1', 'sync-2'],
        }),
        enqueueDiscover: async (syncId) => {
          if (syncId === 'sync-2') throw new Error('queue unavailable');
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ matched: 2, queued: 1 });
    expect(logger.warn).toHaveBeenCalledWith('mail.webhook.signal_completed', {
      provider: 'zoho_mail',
      targetId: 'account-1',
      syncIds: ['sync-1', 'sync-2'],
      matched: 2,
      queued: 1,
      failedWakeups: 1,
      status: 200,
    });
  });

  it('rejects a declared payload larger than the endpoint limit', async () => {
    const response = await handleZohoMailWebhookRequest(
      request('{}', { 'content-length': String(256 * 1024 + 1) }),
      dependencies(),
    );

    expect(response.status).toBe(413);
  });
});
