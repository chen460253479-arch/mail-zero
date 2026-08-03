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

const objectKeyPrefix = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.endsWith('/') &&
      !/[\u0000-\u001f\u007f\\]/u.test(value) &&
      value
        .split('/')
        .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
    'Expected a safe S3 object key prefix',
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
    MAIL_BLOB_STORE: z.literal('s3'),
    MAIL_BLOB_S3_ENDPOINT: z.string().url(),
    MAIL_BLOB_S3_REGION: z.string().trim().min(1),
    MAIL_BLOB_S3_BUCKET: z.string().trim().min(1),
    MAIL_BLOB_S3_PREFIX: objectKeyPrefix,
    MAIL_BLOB_S3_FORCE_PATH_STYLE: booleanFromEnvironment(false),
    MAIL_BLOB_S3_ACCESS_KEY_ID: z.string().trim().min(1),
    MAIL_BLOB_S3_SECRET_ACCESS_KEY: z.string().trim().min(1),
    VITE_PUBLIC_APP_URL: z.string().url(),
    VITE_PUBLIC_BACKEND_URL: z.string().url(),
    BASE_URL: optionalUrl,
    JWT_SECRET: optionalString,
    BETTER_AUTH_SECRET: z.string().min(32),
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
    INTEGRATION_API_TOKEN: optionalString,
    MAIL_WEBHOOK_ENABLED: booleanFromEnvironment(false),
    MAIL_WEBHOOK_URL: optionalUrl,
  })
  .superRefine((value, context) => {
    if ((value.NANGO_BASE_URL === undefined) !== (value.NANGO_SECRET_KEY === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'NANGO_BASE_URL and NANGO_SECRET_KEY must be configured together',
        path: ['NANGO_BASE_URL'],
      });
    }
    if (value.MAIL_WEBHOOK_ENABLED && value.MAIL_WEBHOOK_URL === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MAIL_WEBHOOK_URL is required when MAIL_WEBHOOK_ENABLED is true',
        path: ['MAIL_WEBHOOK_URL'],
      });
    }
  });

export type RuntimeConfig = {
  nodeEnv: 'local' | 'development' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  mailBlobStore: {
    type: 's3';
    endpoint: string;
    region: string;
    bucket: string;
    prefix: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  shutdownGraceMs: number;
  publicAppUrl: string;
  publicBackendUrl: string;
  baseUrl?: string;
  jwtSecret: string;
  betterAuthSecret: string;
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
  admin: {
    autoProvision: boolean;
    name?: string;
    email?: string;
    password?: string;
    bootstrapSecret?: string;
  };
  github: { clientId?: string; clientSecret?: string };
  protocolAllowedHosts?: string;
  externalIntegration: {
    apiToken?: string;
    webhook: {
      enabled: boolean;
      url?: string;
    };
  };
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
    mailBlobStore: {
      type: parsed.MAIL_BLOB_STORE,
      endpoint: parsed.MAIL_BLOB_S3_ENDPOINT,
      region: parsed.MAIL_BLOB_S3_REGION,
      bucket: parsed.MAIL_BLOB_S3_BUCKET,
      prefix: parsed.MAIL_BLOB_S3_PREFIX,
      forcePathStyle: parsed.MAIL_BLOB_S3_FORCE_PATH_STYLE,
      accessKeyId: parsed.MAIL_BLOB_S3_ACCESS_KEY_ID,
      secretAccessKey: parsed.MAIL_BLOB_S3_SECRET_ACCESS_KEY,
    },
    shutdownGraceMs: parsed.ZERO_SHUTDOWN_GRACE_MS,
    publicAppUrl: parsed.VITE_PUBLIC_APP_URL,
    publicBackendUrl: parsed.VITE_PUBLIC_BACKEND_URL,
    ...(parsed.BASE_URL === undefined ? {} : { baseUrl: parsed.BASE_URL }),
    jwtSecret: parsed.JWT_SECRET ?? parsed.BETTER_AUTH_SECRET,
    betterAuthSecret: parsed.BETTER_AUTH_SECRET,
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
    externalIntegration: {
      ...(parsed.INTEGRATION_API_TOKEN === undefined
        ? {}
        : { apiToken: parsed.INTEGRATION_API_TOKEN }),
      webhook: {
        enabled: parsed.MAIL_WEBHOOK_ENABLED,
        ...(parsed.MAIL_WEBHOOK_URL === undefined ? {} : { url: parsed.MAIL_WEBHOOK_URL }),
      },
    },
  };
};
