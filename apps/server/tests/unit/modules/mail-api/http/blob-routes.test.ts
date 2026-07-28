import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailCoreError } from '@zero/mail-core';
import { Hono } from 'hono';

const runtimeMocks = vi.hoisted(() => ({
  openOwned: vi.fn(),
  close: vi.fn(async () => undefined),
}));

vi.mock('cloudflare:workers', () => {
  class RuntimeBase {}
  return {
    env: {},
    DurableObject: RuntimeBase,
    RpcTarget: RuntimeBase,
    WorkerEntrypoint: RuntimeBase,
    WorkflowEntrypoint: RuntimeBase,
  };
});

vi.mock('../../../../../src/modules/mail-api/runtime/create-mail-api', async (importOriginal) => ({
  ...(await importOriginal()),
  openOwnedMailApiRuntime: runtimeMocks.openOwned,
}));

import type { HonoContext } from '../../../../../src/ctx';
import { registerMailBlobRoutes } from '../../../../../src/modules/mail-api/http';

const createApp = () => {
  const app = new Hono<HonoContext>();
  app.use('*', async (c, next) => {
    c.set('sessionUser', { id: 'user-1' } as never);
    await next();
  });
  registerMailBlobRoutes(app);
  return app;
};

describe('Mail Blob HTTP routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when the account is not owned by the session user', async () => {
    runtimeMocks.openOwned.mockRejectedValue(
      new MailCoreError('ACCOUNT_NOT_FOUND', { accountId: 'foreign' }),
    );

    const response = await createApp().request('/mail/accounts/foreign/blobs/blob-1/file.bin');

    expect(response.status).toBe(404);
  });

  it('sets safe download headers and closes the account runtime', async () => {
    runtimeMocks.openOwned.mockResolvedValue({
      core: {
        getBlob: vi.fn(async () => ({ contentType: 'application/pdf' })),
        readBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
      },
      close: runtimeMocks.close,
    });

    const response = await createApp().request(
      '/mail/accounts/account-1/blobs/blob-1/a%22%0D%0Aevil.bin',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="a___evil.bin"');
    expect(response.headers.get('content-length')).toBe('3');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(runtimeMocks.close).toHaveBeenCalledOnce();
  });

  it('rejects an oversized upload before buffering the request body', async () => {
    const response = await createApp().request('/mail/accounts/account-1/blobs', {
      method: 'POST',
      headers: { 'content-length': String(25 * 1024 * 1024 + 1) },
      body: new Uint8Array([1]),
    });

    expect(response.status).toBe(413);
    expect(runtimeMocks.openOwned).not.toHaveBeenCalled();
  });

  it('does not disguise infrastructure failures as missing resources', async () => {
    runtimeMocks.openOwned.mockRejectedValue(new Error('database unavailable'));

    const response = await createApp().request('/mail/accounts/account-1/blobs/blob-1/file.bin');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'STORAGE_FAILURE',
      retryable: true,
    });
  });
});
