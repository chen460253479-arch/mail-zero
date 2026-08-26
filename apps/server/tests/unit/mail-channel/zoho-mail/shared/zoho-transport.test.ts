import { describe, expect, it, vi } from 'vitest';

import { createZohoMailTransport } from '../../../../../src/mail-channel/zoho-mail/shared/zoho-transport';

const credential = {
  type: 'oauth2' as const,
  accessToken: 'access-token',
  expiresAt: null,
  scope: 'ZohoMail.messages.ALL',
};

describe('Zoho Mail transport', () => {
  it('does not abort an in-flight provider request', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        status: { code: 200 },
        data: [],
      }),
    );
    const transport = createZohoMailTransport(credential, 'https://mail.zoho.com', fetcher);

    await transport.request({
      method: 'GET',
      path: '/api/accounts',
    });

    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://mail.zoho.com/api/accounts'),
      expect.not.objectContaining({ signal: expect.anything() }),
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
    const transport = createZohoMailTransport(credential, 'https://mail.zoho.com', fetcher);

    await expect(
      transport.request({
        method: 'GET',
        path: '/api/accounts',
      }),
    ).rejects.toThrow('ZOHO_RESPONSE_TOO_LARGE');
  });
});
