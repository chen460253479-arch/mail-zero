import { isAbsolute } from 'node:path';

import { z } from 'zod';

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().url().optional(),
);

const integerFromEnvironment = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? defaultValue : Number(value)),
    z.number().int().min(minimum).max(maximum),
  );

const booleanFromEnvironment = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return defaultValue;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }, z.boolean());

const absolutePath = z
  .string()
  .min(1)
  .refine(
    (value) => isAbsolute(value) || /^\/(?!\/)/u.test(value),
    'Expected an absolute filesystem path',
  );

const credentialEncryptionKey = z.string().refine((value) => {
  try {
    return Buffer.from(value, 'base64').byteLength === 32;
  } catch {
    return false;
  }
}, 'CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes');

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['local', 'development', 'production']).default('development'),
    ZERO_SERVER_HOST: z.string().trim().min(1).default('0.0.0.0'),
    ZERO_SERVER_PORT: integerFromEnvironment(8787, 1, 65_535),
    ZERO_SHUTDOWN_GRACE_MS: integerFromEnvironment(30_000, 1_000, 300_000),
    DATABASE_URL: z.string().trim().min(1),
    MAIL_BLOB_ROOT: absolutePath.default('/var/lib/zero/mail-blobs'),
    VITE_PUBLIC_APP_URL: z.string().url(),
    VITE_PUBLIC_BACKEND_URL: z.string().url(),
    BASE_URL: optionalUrl,
    JWT_SECRET: optionalString,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    COOKIE_DOMAIN: z.string().trim().min(1),
    BETTER_AUTH_TRUSTED_ORIGINS: optionalString,
    CREDENTIAL_ENCRYPTION_KEY: credentialEncryptionKey,
    RESEND_API_KEY: optionalString,
    NANGO_BASE_URL: optionalUrl,
    NANGO_SECRET_KEY: optionalString,
    NANGO_GMAIL_INTEGRATION_KEY: z.string().trim().min(1).default('google-mail'),
    NANGO_OUTLOOK_INTEGRATION_KEY: z.string().trim().min(1).default('outlook'),
    NANGO_ZOHO_MAIL_INTEGRATION_KEY: z.string().trim().min(1).default('zoho-mail'),
    NANGO_IMAP_SMTP_INTEGRATION_KEY: z.string().trim().min(1).default('generic-email'),
    REDIS_URL: z.string().url().default('http://upstash-proxy:80'),
    REDIS_TOKEN: z.string().min(1).default('upstash-local-token'),
    ZERO_ADMIN_AUTO_PROVISION: booleanFromEnvironment(false),
    ZERO_ADMIN_NAME: optionalString,
    ZERO_ADMIN_EMAIL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
      z.string().email().optional(),
    ),
    ZERO_ADMIN_PASSWORD: optionalString,
    ZERO_ADMIN_BOOTSTRAP_SECRET: optionalString,
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,
    MAIL_PROTOCOL_ALLOWED_HOSTS: optionalString,
  })
  .superRefine((value, context) => {
    if ((value.NANGO_BASE_URL === undefined) !== (value.NANGO_SECRET_KEY === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'NANGO_BASE_URL and NANGO_SECRET_KEY must be configured together',
        path: ['NANGO_BASE_URL'],
      });
    }
  });

export type RuntimeConfig = {
  nodeEnv: 'local' | 'development' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  mailBlobRoot: string;
  shutdownGraceMs: number;
  publicAppUrl: string;
  publicBackendUrl: string;
  baseUrl?: string;
  jwtSecret: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  cookieDomain: string;
  betterAuthTrustedOrigins: string[];
  credentialEncryptionKey: string;
  resendApiKey?: string;
  nango: {
    baseUrl?: string;
    secretKey?: string;
    gmailIntegrationKey: string;
    outlookIntegrationKey: string;
    zohoMailIntegrationKey: string;
    imapSmtpIntegrationKey: string;
  };
  redis: { url: string; token: string };
  admin: {
    autoProvision: boolean;
    name?: string;
    email?: string;
    password?: string;
    bootstrapSecret?: string;
  };
  github: { clientId?: string; clientSecret?: string };
  protocolAllowedHosts?: string;
};

export type RuntimeEnvironmentSource = Readonly<Record<string, string | undefined>>;

const splitOrigins = (configured: string | undefined, publicAppUrl: string): string[] => [
  ...new Set(
    (configured ?? publicAppUrl)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  ),
];

export const parseRuntimeConfig = (source: RuntimeEnvironmentSource): RuntimeConfig => {
  const parsed = environmentSchema.parse(source);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.ZERO_SERVER_HOST,
    port: parsed.ZERO_SERVER_PORT,
    databaseUrl: parsed.DATABASE_URL,
    mailBlobRoot: parsed.MAIL_BLOB_ROOT,
    shutdownGraceMs: parsed.ZERO_SHUTDOWN_GRACE_MS,
    publicAppUrl: parsed.VITE_PUBLIC_APP_URL,
    publicBackendUrl: parsed.VITE_PUBLIC_BACKEND_URL,
    ...(parsed.BASE_URL === undefined ? {} : { baseUrl: parsed.BASE_URL }),
    jwtSecret: parsed.JWT_SECRET ?? parsed.BETTER_AUTH_SECRET,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET,
    betterAuthUrl: parsed.BETTER_AUTH_URL,
    cookieDomain: parsed.COOKIE_DOMAIN,
    betterAuthTrustedOrigins: splitOrigins(
      parsed.BETTER_AUTH_TRUSTED_ORIGINS,
      parsed.VITE_PUBLIC_APP_URL,
    ),
    credentialEncryptionKey: parsed.CREDENTIAL_ENCRYPTION_KEY,
    ...(parsed.RESEND_API_KEY === undefined ? {} : { resendApiKey: parsed.RESEND_API_KEY }),
    nango: {
      ...(parsed.NANGO_BASE_URL === undefined ? {} : { baseUrl: parsed.NANGO_BASE_URL }),
      ...(parsed.NANGO_SECRET_KEY === undefined ? {} : { secretKey: parsed.NANGO_SECRET_KEY }),
      gmailIntegrationKey: parsed.NANGO_GMAIL_INTEGRATION_KEY,
      outlookIntegrationKey: parsed.NANGO_OUTLOOK_INTEGRATION_KEY,
      zohoMailIntegrationKey: parsed.NANGO_ZOHO_MAIL_INTEGRATION_KEY,
      imapSmtpIntegrationKey: parsed.NANGO_IMAP_SMTP_INTEGRATION_KEY,
    },
    redis: { url: parsed.REDIS_URL, token: parsed.REDIS_TOKEN },
    admin: {
      autoProvision: parsed.ZERO_ADMIN_AUTO_PROVISION,
      ...(parsed.ZERO_ADMIN_NAME === undefined ? {} : { name: parsed.ZERO_ADMIN_NAME }),
      ...(parsed.ZERO_ADMIN_EMAIL === undefined ? {} : { email: parsed.ZERO_ADMIN_EMAIL }),
      ...(parsed.ZERO_ADMIN_PASSWORD === undefined ? {} : { password: parsed.ZERO_ADMIN_PASSWORD }),
      ...(parsed.ZERO_ADMIN_BOOTSTRAP_SECRET === undefined
        ? {}
        : { bootstrapSecret: parsed.ZERO_ADMIN_BOOTSTRAP_SECRET }),
    },
    github: {
      ...(parsed.GITHUB_CLIENT_ID === undefined ? {} : { clientId: parsed.GITHUB_CLIENT_ID }),
      ...(parsed.GITHUB_CLIENT_SECRET === undefined
        ? {}
        : { clientSecret: parsed.GITHUB_CLIENT_SECRET }),
    },
    ...(parsed.MAIL_PROTOCOL_ALLOWED_HOSTS === undefined
      ? {}
      : { protocolAllowedHosts: parsed.MAIL_PROTOCOL_ALLOWED_HOSTS }),
  };
};
