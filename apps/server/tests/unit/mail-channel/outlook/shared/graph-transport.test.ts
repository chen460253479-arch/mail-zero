import { describe, expect, it, vi } from 'vitest';

import { createMicrosoftGraphTransport } from '../../../../../src/mail-channel/outlook/shared/graph-transport';

const credential = {
  type: 'oauth2' as const,
  accessToken: 'access-token',
  expiresAt: null,
  scope: 'Mail.ReadWrite',
};

describe('Microsoft Graph transport', () => {
  it('applies a bounded request timeout', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        value: [],
      }),
    );
    const transport = createMicrosoftGraphTransport(credential, fetcher);

    await transport.request({
      method: 'GET',
      url: 'https://graph.microsoft.com/v1.0/me/messages',
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects an oversized provider response before reading its body', async () => {
    const fetcher = vi.fn(async () => {
      const response = new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(32 * 1024 * 1024 + 1),
        },
      });
      Object.defineProperty(response, 'arrayBuffer', {
        value: vi.fn(async () => {
          throw new Error('body must not be read');
        }),
      });
      return response;
    });
    const transport = createMicrosoftGraphTransport(credential, fetcher);

    await expect(
      transport.request({
        method: 'GET',
        url: 'https://graph.microsoft.com/v1.0/me/messages',
      }),
    ).rejects.toThrow('OUTLOOK_RESPONSE_TOO_LARGE');
  });
});
