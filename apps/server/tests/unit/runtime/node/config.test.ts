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
  MAIL_BLOB_STORE: 's3',
  MAIL_BLOB_S3_ENDPOINT: 'https://objects.example.test',
  MAIL_BLOB_S3_REGION: 'ap-southeast-1',
  MAIL_BLOB_S3_BUCKET: 'zero-mail-production',
  MAIL_BLOB_S3_PREFIX: 'mail',
  MAIL_BLOB_S3_FORCE_PATH_STYLE: 'false',
  MAIL_BLOB_S3_ACCESS_KEY_ID: 'external-s3-access-key',
  MAIL_BLOB_S3_SECRET_ACCESS_KEY: 'external-s3-secret-key',
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
      mailBlobStore: {
        type: 's3',
        endpoint: 'https://objects.example.test',
        region: 'ap-southeast-1',
        bucket: 'zero-mail-production',
        prefix: 'mail',
        forcePathStyle: false,
        accessKeyId: 'external-s3-access-key',
        secretAccessKey: 'external-s3-secret-key',
      },
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

    expect(parseRuntimeConfig(environment)).toMatchObject({
      host: '0.0.0.0',
      port: 8787,
      shutdownGraceMs: 30_000,
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

  it('rejects any production Blob store other than S3', () => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        MAIL_BLOB_STORE: 'local',
      }),
    ).toThrow();
  });

  it.each([
    'MAIL_BLOB_STORE',
    'MAIL_BLOB_S3_ENDPOINT',
    'MAIL_BLOB_S3_REGION',
    'MAIL_BLOB_S3_BUCKET',
    'MAIL_BLOB_S3_PREFIX',
    'MAIL_BLOB_S3_ACCESS_KEY_ID',
    'MAIL_BLOB_S3_SECRET_ACCESS_KEY',
  ] as const)('requires external object storage setting %s', (name) => {
    const environment = validEnvironment();
    delete environment[name];

    expect(() => parseRuntimeConfig(environment)).toThrow();
  });

  it.each([
    ['MAIL_BLOB_S3_REGION', ''],
    ['MAIL_BLOB_S3_BUCKET', ''],
    ['MAIL_BLOB_S3_PREFIX', '../mail'],
    ['MAIL_BLOB_S3_FORCE_PATH_STYLE', 'yes'],
  ] as const)('rejects invalid S3 setting %s', (name, value) => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnvironment(),
        [name]: value,
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
