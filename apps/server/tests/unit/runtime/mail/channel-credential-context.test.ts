import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { canReuseResolvedCredential } from '../../../../src/runtime/mail/channel-credential-context';

const testRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(testRoot, '../../../..');
const runtimeRoot = resolve(serverRoot, 'src/runtime/mail');
const readRuntime = (name: string): string => readFileSync(resolve(runtimeRoot, name), 'utf8');

describe('provider-neutral channel credential context', () => {
  it('owns connection loading, Nango resolution, invalidation, and reconnect state', () => {
    const source = readRuntime('channel-credential-context.ts');

    expect(source).toContain('resolveConnectionCredential');
    expect(source).toContain('createNangoCredentialRepository');
    expect(source).toContain('invalidateCredential');
    expect(source).toContain("status: 'reconnect_required'");
    expect(source).not.toContain('Gmail');
  });

  it('keeps the Gmail context as a provider-specific client adapter', () => {
    const source = readRuntime('gmail-credential-context.ts');

    expect(source).toContain("from './channel-credential-context'");
    expect(source).toContain('createGoogleGmailApiExecutor');
    expect(source).not.toContain('createNangoCredentialRepository');
    expect(source).not.toContain('resolveConnectionCredential');
  });

  it('reuses protocol and non-expiring OAuth credentials inside one runtime job', () => {
    const now = new Date('2026-07-28T00:00:00.000Z');

    expect(
      canReuseResolvedCredential(
        {
          type: 'imap_smtp',
          email: 'owner@example.com',
          username: 'owner@example.com',
          password: 'secret',
          imap: { host: 'imap.example.com', port: 993, secure: true },
          smtp: { host: 'smtp.example.com', port: 465, secure: true },
        },
        now,
      ),
    ).toBe(true);
    expect(
      canReuseResolvedCredential(
        {
          type: 'oauth2',
          accessToken: 'access-token',
          expiresAt: null,
          scope: '',
        },
        now,
      ),
    ).toBe(true);
  });

  it('does not reuse OAuth credentials inside the refresh window', () => {
    const now = new Date('2026-07-28T00:00:00.000Z');

    expect(
      canReuseResolvedCredential(
        {
          type: 'oauth2',
          accessToken: 'access-token',
          expiresAt: new Date('2026-07-28T00:14:59.999Z'),
          scope: '',
        },
        now,
      ),
    ).toBe(false);
    expect(
      canReuseResolvedCredential(
        {
          type: 'oauth2',
          accessToken: 'access-token',
          expiresAt: new Date('2026-07-28T00:30:00.000Z'),
          scope: '',
        },
        now,
      ),
    ).toBe(true);
  });
});
