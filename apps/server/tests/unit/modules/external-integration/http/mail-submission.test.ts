import { describe, expect, it, vi } from 'vitest';

import { createExternalIntegrationRouter } from '../../../../../src/modules/external-integration/http/router';
import { ExternalIntegrationError } from '../../../../../src/modules/external-integration/errors';
import type { RuntimeServices } from '../../../../../src/runtime/node/services';

const response = {
  id: 'external-submission-1',
  externalUserId: 'crm_user_200',
  connectionId: 'connection_01',
  status: 'accepted' as const,
  messageId: null,
  createdAt: '2026-08-05T08:00:00.000Z',
  updatedAt: '2026-08-05T08:00:00.000Z',
  sentAt: null,
  error: null,
};

const createRouter = () => {
  const submit = vi.fn(async (input: unknown) => {
    void input;
    return { response, created: true };
  });
  const get = vi.fn(async (id: string) => {
    if (id === response.id) return response;
    throw new ExternalIntegrationError('EXTERNAL_MAIL_SUBMISSION_NOT_FOUND');
  });
  const app = createExternalIntegrationRouter(
    {
      config: { externalIntegration: { apiToken: 'fixed-token', webhook: { enabled: false } } },
      database: { db: {} },
    } as RuntimeServices,
    {
      createMailSubmissionService: () => ({ submit, get }),
    },
  );
  return { app, submit };
};

const requestBody = {
  externalUserId: 'crm_user_200',
  connectionId: 'connection_01',
  to: [{ email: 'customer@example.test' }],
  subject: 'Itinerary',
  htmlBody: '<p>Your itinerary</p>',
  attachments: [
    {
      filename: 'itinerary.pdf',
      url: 'https://assets.example.test/signed/itinerary.pdf',
    },
  ],
};

const post = async (headers: Record<string, string> = {}) => {
  const { app, submit } = createRouter();
  const result = await app.request('/mail/submissions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer fixed-token',
      'content-type': 'application/json',
      'idempotency-key': 'crm-send-1001',
      ...headers,
    },
    body: JSON.stringify(requestBody),
  });
  return { result, submit };
};

describe('external mail submission HTTP contract', () => {
  it('accepts a durable send request without channelId', async () => {
    const { result, submit } = await post();

    expect(result.status).toBe(202);
    expect(result.headers.get('location')).toBe(
      '/api/integrations/mail/submissions/external-submission-1',
    );
    await expect(result.json()).resolves.toEqual(response);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: 'crm_user_200',
        connectionId: 'connection_01',
        idempotencyKey: 'crm-send-1001',
      }),
    );
    expect(submit.mock.calls[0]![0]).not.toHaveProperty('channelId');
  });

  it('requires service authorization and an idempotency key', async () => {
    const { app } = createRouter();
    const unauthorized = await app.request('/mail/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'key' },
      body: JSON.stringify(requestBody),
    });
    const missingKey = await app.request('/mail/submissions', {
      method: 'POST',
      headers: { authorization: 'Bearer fixed-token', 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    expect(unauthorized.status).toBe(401);
    expect(missingKey.status).toBe(400);
  });

  it('exposes a status endpoint and returns 404 for an unknown submission', async () => {
    const { app } = createRouter();
    const found = await app.request('/mail/submissions/external-submission-1', {
      headers: { authorization: 'Bearer fixed-token' },
    });
    const missing = await app.request('/mail/submissions/missing', {
      headers: { authorization: 'Bearer fixed-token' },
    });

    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual(response);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: 'EXTERNAL_MAIL_SUBMISSION_NOT_FOUND',
    });
  });
});
