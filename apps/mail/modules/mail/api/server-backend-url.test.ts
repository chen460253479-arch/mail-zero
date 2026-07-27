import { describe, expect, it } from 'vitest';

import { resolveServerBackendUrl } from '../../../lib/server-backend-url';

describe('resolveServerBackendUrl', () => {
  it('uses the Docker-internal backend URL for server-side requests', () => {
    expect(
      resolveServerBackendUrl({
        internalBackendUrl: 'http://server:8787/',
        isBrowser: false,
        publicBackendUrl: 'http://localhost:8787',
      }),
    ).toBe('http://server:8787');
  });

  it('never exposes the Docker-internal backend URL to browser requests', () => {
    expect(
      resolveServerBackendUrl({
        internalBackendUrl: 'http://server:8787/',
        isBrowser: true,
        publicBackendUrl: 'http://localhost:8787',
      }),
    ).toBe('http://localhost:8787');
  });

  it('falls back to the public backend URL outside Docker', () => {
    expect(
      resolveServerBackendUrl({
        isBrowser: false,
        publicBackendUrl: 'http://localhost:8787/',
      }),
    ).toBe('http://localhost:8787');
  });
});
