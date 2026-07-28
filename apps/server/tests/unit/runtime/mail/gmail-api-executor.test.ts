import { describe, expect, it, vi } from 'vitest';

import type { GmailApiExecutor } from '../../../../src/mail-channel/gmail/shared/api-transport';
import { createCredentialAwareGmailExecutor } from '../../../../src/runtime/mail/gmail-api-executor';
import type { OAuth2Credential } from '../../../../src/mail-channel/contracts';

const oauth = (accessToken: string): OAuth2Credential => ({
  type: 'oauth2',
  accessToken,
  expiresAt: null,
  scope: 'gmail.modify',
});

const unauthorized = () => Object.assign(new Error('unauthorized'), { code: 401 });

const createClient = (run: (token: string) => Promise<string>) =>
  vi.fn(
    (credential: OAuth2Credential): GmailApiExecutor => ({
      runGmailApi: async <Result>() => (await run(credential.accessToken)) as Result,
    }),
  );

describe('credential-aware Gmail API executor', () => {
  it('uses the same executor contract for any OAuth credential source', async () => {
    const createSdkExecutor = createClient(async (token) => token);
    const executor = createCredentialAwareGmailExecutor({
      resolveCredential: vi.fn().mockResolvedValue(oauth('zero-or-nango-token')),
      createClient: createSdkExecutor,
      invalidateCredential: vi.fn(),
      markReconnectRequired: vi.fn(),
      isUnauthorized: (error) => (error as { code?: number }).code === 401,
    });

    await expect(executor.runGmailApi(async () => 'ignored')).resolves.toBe('zero-or-nango-token');
  });

  it('invalidates and retries once after the first unauthorized response', async () => {
    const resolveCredential = vi
      .fn()
      .mockResolvedValueOnce(oauth('expired'))
      .mockResolvedValueOnce(oauth('fresh'));
    const invalidateCredential = vi.fn();
    const createSdkExecutor = createClient(async (token) => {
      if (token === 'expired') throw unauthorized();
      return token;
    });
    const executor = createCredentialAwareGmailExecutor({
      resolveCredential,
      createClient: createSdkExecutor,
      invalidateCredential,
      markReconnectRequired: vi.fn(),
      isUnauthorized: (error) => (error as { code?: number }).code === 401,
    });

    await expect(executor.runGmailApi(async () => 'ignored')).resolves.toBe('fresh');
    expect(invalidateCredential).toHaveBeenCalledOnce();
    expect(resolveCredential).toHaveBeenNthCalledWith(1, false);
    expect(resolveCredential).toHaveBeenNthCalledWith(2, true);
  });

  it('marks reconnect required when the retry is also unauthorized', async () => {
    const markReconnectRequired = vi.fn();
    const executor = createCredentialAwareGmailExecutor({
      resolveCredential: vi
        .fn()
        .mockResolvedValueOnce(oauth('expired'))
        .mockResolvedValueOnce(oauth('still-invalid')),
      createClient: createClient(async () => {
        throw unauthorized();
      }),
      invalidateCredential: vi.fn(),
      markReconnectRequired,
      isUnauthorized: (error) => (error as { code?: number }).code === 401,
    });

    await expect(executor.runGmailApi(async () => 'ignored')).rejects.toThrow('unauthorized');
    expect(markReconnectRequired).toHaveBeenCalledOnce();
  });

  it('does not refresh credentials for non-authentication failures', async () => {
    const resolveCredential = vi.fn().mockResolvedValue(oauth('valid'));
    const invalidateCredential = vi.fn();
    const executor = createCredentialAwareGmailExecutor({
      resolveCredential,
      createClient: createClient(async () => {
        throw new Error('quota exceeded');
      }),
      invalidateCredential,
      markReconnectRequired: vi.fn(),
      isUnauthorized: (error) => (error as { code?: number }).code === 401,
    });

    await expect(executor.runGmailApi(async () => 'ignored')).rejects.toThrow('quota exceeded');
    expect(resolveCredential).toHaveBeenCalledOnce();
    expect(invalidateCredential).not.toHaveBeenCalled();
  });
});
