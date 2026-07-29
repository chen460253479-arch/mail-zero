import { afterEach, describe, expect, it } from 'vitest';

import { createMailProtocolServer } from '../../../src/protocol-worker/server';

const servers: ReturnType<typeof createMailProtocolServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

const startServer = async () => {
  const server = createMailProtocolServer({
    secret: '0123456789abcdef0123456789abcdef',
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing address');
  return `http://127.0.0.1:${address.port}`;
};

describe('mail protocol Worker HTTP boundary', () => {
  it('exposes only health publicly and requires the shared secret for protocol RPC', async () => {
    const baseUrl = await startServer();

    await expect(fetch(`${baseUrl}/health`).then((response) => response.json())).resolves.toEqual({
      status: 'ok',
    });
    const unauthorized = await fetch(`${baseUrl}/v1/imap/baseline`, {
      method: 'POST',
      body: '{}',
    });
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toMatchObject({
      error: { code: 'MAIL_PROTOCOL_UNAUTHORIZED' },
    });
  });

  it('rejects invalid authenticated requests without returning validation details', async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/v1/imap/baseline`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer 0123456789abcdef0123456789abcdef',
        'content-type': 'application/json',
      },
      body: '{}',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'MAIL_PROTOCOL_INVALID_REQUEST',
        classification: 'permanent',
      },
    });
  });
});
