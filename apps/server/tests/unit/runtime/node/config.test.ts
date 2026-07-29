import { describe, expect, it } from 'vitest';

import {
  parseRuntimeConfig,
  type RuntimeEnvironmentSource,
} from '../../../../src/runtime/node/config';

const validEnvironment = (): Record<string, string | undefined> => ({
  NODE_ENV: 'production',
  ZERO_SERVER_HOST: '127.0.0.1',
  ZERO_SERVER_PORT: '8787',
  ZERO_SHUTDOWN_GRACE_MS: '45000',
  DATABASE_URL: 'postgresql://postgres:postgres@db:5432/zero',
  MAIL_BLOB_ROOT: '/data/blobs',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'https://api.example.test',
  VITE_PUBLIC_APP_URL: 'https://mail.example.test',
  VITE_PUBLIC_BACKEND_URL: 'https://api.example.test',
  COOKIE_DOMAIN: 'example.test',
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  BETTER_AUTH_TRUSTED_ORIGINS:
    'https://mail.example.test, https://admin.example.test,https://mail.example.test',
  NANGO_GMAIL_INTEGRATION_KEY: 'google-mail',
  NANGO_OUTLOOK_INTEGRATION_KEY: 'outlook',
  NANGO_ZOHO_MAIL_INTEGRATION_KEY: 'zoho-mail',
  NANGO_IMAP_SMTP_INTEGRATION_KEY: 'generic-email',
  REDIS_URL: 'http://redis.example.test',
  REDIS_TOKEN: 'redis-token',
});

describe('parseRuntimeConfig', () => {
  it('parses generic external integration configuration', () => {
    expect(
      parseRuntimeConfig({
        ...validEnvironment(),
        INTEGRATION_API_TOKEN: 'integration-secret',
        MAIL_WEBHOOK_ENABLED: 'true',
        MAIL_WEBHOOK_URL: 'https://external.example.test/mail-events',
      }),
    ).toMatchObject({
      externalIntegration: {
        apiToken: 'integration-secret',
        webhook: {
          enabled: true,
          url: 'https://external.example.test/mail-events',
        },
      },
    });
  });

  it('requires a webhook URL when mail notifications are enabled', () => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        MAIL_WEBHOOK_ENABLED: 'true',
        MAIL_WEBHOOK_URL: '',
      }),
    ).toThrow(/MAIL_WEBHOOK_URL/u);
  });

  it('normalizes the complete self-hosted runtime boundary', () => {
    const source: RuntimeEnvironmentSource = validEnvironment();

    expect(parseRuntimeConfig(source)).toMatchObject({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 8787,
      shutdownGraceMs: 45_000,
      databaseUrl: 'postgresql://postgres:postgres@db:5432/zero',
      mailBlobRoot: '/data/blobs',
      publicAppUrl: 'https://mail.example.test',
      publicBackendUrl: 'https://api.example.test',
      betterAuthUrl: 'https://api.example.test',
      cookieDomain: 'example.test',
      betterAuthTrustedOrigins: ['https://mail.example.test', 'https://admin.example.test'],
      nango: {
        gmailIntegrationKey: 'google-mail',
        outlookIntegrationKey: 'outlook',
        zohoMailIntegrationKey: 'zoho-mail',
        imapSmtpIntegrationKey: 'generic-email',
      },
      redis: {
        url: 'http://redis.example.test',
        token: 'redis-token',
      },
    });
  });

  it('uses self-hosted defaults for optional process settings', () => {
    const environment = validEnvironment();
    delete environment.ZERO_SERVER_HOST;
    delete environment.ZERO_SERVER_PORT;
    delete environment.ZERO_SHUTDOWN_GRACE_MS;
    delete environment.MAIL_BLOB_ROOT;

    expect(parseRuntimeConfig(environment)).toMatchObject({
      host: '0.0.0.0',
      port: 8787,
      shutdownGraceMs: 30_000,
      mailBlobRoot: '/var/lib/zero/mail-blobs',
    });
  });

  it('rejects a missing PostgreSQL connection string', () => {
    const environment = validEnvironment();
    delete environment.DATABASE_URL;

    expect(() => parseRuntimeConfig(environment)).toThrow();
  });

  it.each(['0', '65536', '1.5', 'invalid'])('rejects invalid server port %s', (port) => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        ZERO_SERVER_PORT: port,
      }),
    ).toThrow();
  });

  it('rejects a relative Blob root', () => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        MAIL_BLOB_ROOT: 'data/blobs',
      }),
    ).toThrow();
  });

  it('rejects a short authentication secret', () => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        BETTER_AUTH_SECRET: 'too-short',
      }),
    ).toThrow();
  });

  it('rejects a credential key that is not exactly 32 decoded bytes', () => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(31, 7).toString('base64'),
      }),
    ).toThrow();
  });
});
