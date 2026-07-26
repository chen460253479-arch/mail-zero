import { describe, expect, it, vi } from 'vitest';

import { createRetryingMailClient } from './retry';

type TestClient = {
  read(): Promise<string>;
  label: string;
};

const unauthorized = Object.assign(new Error('Unauthorized'), { code: 401 });
const forbidden = Object.assign(new Error('Missing scope'), { code: 403 });

const classifyError = (error: unknown) => ({
  unauthorized:
    typeof error === 'object' && error !== null && 'code' in error && Number(error.code) === 401,
  unrecoverableAuth:
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'INVALID_CREDENTIALS',
});

describe('Nango mail client retry', () => {
  it('invalidates Nango cache and retries once after 401', async () => {
    const initial = { read: vi.fn().mockRejectedValue(unauthorized), label: 'initial' };
    const refreshed = { read: vi.fn().mockResolvedValue('ok'), label: 'refreshed' };
    const refreshCredential = vi.fn().mockResolvedValue('new-credential');
    const client = createRetryingMailClient<TestClient, string>({
      initialCredential: 'old-credential',
      createClient: (credential) => (credential === 'old-credential' ? initial : refreshed),
      refreshCredential,
      classifyError,
    });

    await expect(client.read()).resolves.toBe('ok');
    expect(refreshCredential).toHaveBeenCalledOnce();
    expect(initial.read).toHaveBeenCalledOnce();
    expect(refreshed.read).toHaveBeenCalledOnce();
  });

  it('does not retry a second 401', async () => {
    const first = { read: vi.fn().mockRejectedValue(unauthorized), label: 'first' };
    const second = { read: vi.fn().mockRejectedValue(unauthorized), label: 'second' };
    const reconnect = vi.fn();
    const client = createRetryingMailClient<TestClient, string>({
      initialCredential: 'old',
      createClient: (credential) => (credential === 'old' ? first : second),
      refreshCredential: vi.fn().mockResolvedValue('new'),
      classifyError,
      onUnrecoverableAuth: reconnect,
    });

    await expect(client.read()).rejects.toBe(unauthorized);
    expect(first.read).toHaveBeenCalledOnce();
    expect(second.read).toHaveBeenCalledOnce();
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('does not refresh on 403 missing scope', async () => {
    const refreshCredential = vi.fn();
    const client = createRetryingMailClient<TestClient, string>({
      initialCredential: 'old',
      createClient: () => ({
        read: vi.fn().mockRejectedValue(forbidden),
        label: 'client',
      }),
      refreshCredential,
      classifyError,
    });

    await expect(client.read()).rejects.toBe(forbidden);
    expect(refreshCredential).not.toHaveBeenCalled();
  });

  it('does not mark reconnect_required after a temporary refresh failure', async () => {
    const reconnect = vi.fn();
    const refreshFailure = new Error('Nango unavailable');
    const client = createRetryingMailClient<TestClient, string>({
      initialCredential: 'old',
      createClient: () => ({
        read: vi.fn().mockRejectedValue(unauthorized),
        label: 'client',
      }),
      refreshCredential: vi.fn().mockRejectedValue(refreshFailure),
      classifyError,
      onUnrecoverableAuth: reconnect,
    });

    await expect(client.read()).rejects.toBe(refreshFailure);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it('marks reconnect_required after Nango reports invalid credentials', async () => {
    const reconnect = vi.fn();
    const invalidCredentials = Object.assign(new Error('Invalid credentials'), {
      code: 'INVALID_CREDENTIALS',
    });
    const client = createRetryingMailClient<TestClient, string>({
      initialCredential: 'old',
      createClient: () => ({
        read: vi.fn().mockRejectedValue(unauthorized),
        label: 'client',
      }),
      refreshCredential: vi.fn().mockRejectedValue(invalidCredentials),
      classifyError,
      onUnrecoverableAuth: reconnect,
    });

    await expect(client.read()).rejects.toBe(invalidCredentials);
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('preserves non-function properties from the current client', () => {
    const client = createRetryingMailClient<TestClient, string>({
      initialCredential: 'old',
      createClient: () => ({ read: vi.fn(), label: 'current' }),
      refreshCredential: vi.fn(),
      classifyError,
    });

    expect(client.label).toBe('current');
  });
});
